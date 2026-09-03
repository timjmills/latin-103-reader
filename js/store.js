// Store — the CONTRACT.md interface, backed by IndexedDB (cache + outbox)
// and Supabase (source of truth, realtime for second-device updates).
//
//   import { store, registerServiceWorker } from './store.js';
//   await store.ready();                     // after auth; warms the cache
//
// Texts (weeks/units/highlights) are pull-only: re-fetched per week when the
// server's weeks.updated_at is newer than the cached one (the seed script bumps
// it after re-seeding). Progress (lookups/settings/alignments) is local-first:
// every write lands in IndexedDB immediately, is queued in the outbox, and is
// flushed when online; newest updated_at wins on both sides.

import * as db from './db.js';
import { auth, getClient } from './auth.js';
import {
  mergeRows, applyRealtime, coalesceOutbox, makeLookup, patchLookup,
  patchSettings, normaliseSettings, lookupsView, weekTag, staleWeeks, isNewer,
} from './sync.js';

export const SETTINGS_LS_KEY = 'latin103.settings';
const PAGE = 1000;
const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REUSE_MS = 50 * 60 * 1000;

const state = {
  uid: null,
  readyPromise: null,
  weeks: [],
  units: new Map(),        // weekN → unit[]
  highlights: new Map(),   // weekN → highlight[]
  lookups: new Map(),      // form → row
  settings: normaliseSettings(null),
  alignments: new Map(),   // `${week_n}|${unit_id}` → row
  signedUrls: new Map(),   // weekN → { url, exp }
  channel: null,
  flushing: false,
  syncing: null,
  wired: false,
};
const listeners = new Set();

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const nowIso = () => new Date().toISOString();
const alignKey = (r) => `${r.week_n}|${r.unit_id}`;

function emit(kind) {
  for (const cb of listeners) {
    try { cb(kind); } catch (e) { console.error('[store] listener failed', e); }
  }
}

function mirrorSettings() {
  try { localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(state.settings.data)); } catch { /* private mode */ }
}

function isTransient(err) {
  if (!online()) return true;
  const msg = String(err?.message || '');
  const status = Number(err?.status || err?.statusCode || 0);
  return err?.name === 'TypeError' || err?.name === 'AbortError'
    || status === 401 || status === 408 || status === 429 || status >= 500
    || /fetch|network|timeout|jwt|socket|load supabase/i.test(msg);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function ready() {
  if (!state.readyPromise) {
    state.readyPromise = boot().catch((e) => { state.readyPromise = null; throw e; });
  }
  return state.readyPromise;
}

async function boot() {
  const user = await auth.ensureSignedIn();
  state.uid = user.id;
  const prev = await db.getMeta('user_id');
  if (prev && prev !== user.id) await db.clearAll();     // never show another account's cache
  await db.setMeta('user_id', user.id);
  await db.setMeta('user_email', user.email || '');
  await loadLocal();
  wireEvents();
  if (online() && !user.offline) {
    try {
      await syncAll();
    } catch (e) {
      console.warn('[store] initial sync failed; serving the cache', e);
    }
  }
}

async function loadLocal() {
  state.weeks = (await db.getAll('weeks')).sort((a, b) => a.n - b.n);
  state.lookups = new Map((await db.getAll('lookups')).map((r) => [r.form, r]));
  state.settings = normaliseSettings(await db.get('settings', 'settings'));
  state.alignments = new Map((await db.getAll('alignments')).map((r) => [alignKey(r), r]));
  state.units.clear();
  state.highlights.clear();
  mirrorSettings();
}

function wireEvents() {
  if (state.wired) return;
  state.wired = true;
  window.addEventListener('online', () => { syncAll().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && online() && state.uid) {
      flushOutbox().then(() => pullProgress()).catch(() => {});
    }
  });
  auth.onSignOut(async () => {
    await teardown();
    await db.clearAll();
    clearRuntimeCache();
  });
  auth.onChange((u) => {
    if (!u) { teardown().catch(() => {}); return; }
    if (u.id !== state.uid) {                  // (re)login → reboot the cache
      state.readyPromise = null;
      ready().then(() => emit('weeks')).catch((e) => console.error(e));
    } else if (!u.offline && online()) {
      syncAll().catch(() => {});
    }
  });
}

async function teardown() {
  if (state.channel) {
    try { const sb = await getClient(); await sb.removeChannel(state.channel); } catch { /* ignore */ }
    state.channel = null;
  }
  state.uid = null;
  state.readyPromise = null;
  state.weeks = [];
  state.units.clear();
  state.highlights.clear();
  state.lookups.clear();
  state.alignments.clear();
  state.signedUrls.clear();
  state.settings = normaliseSettings(null);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function syncAll() {
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    if (!state.uid || !online()) return;
    await flushOutbox();
    await pullTexts();
    await pullProgress();
    await subscribeRealtime();
  })().finally(() => { state.syncing = null; });
  return state.syncing;
}

async function pageAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function pullTexts() {
  const sb = await getClient();
  const { data: remoteWeeks, error } = await sb.from('weeks').select('*').order('n');
  if (error) throw error;
  const hasUnits = new Map();
  for (const w of remoteWeeks) hasUnits.set(w.n, (await db.countByIndex('units', 'week_n', w.n)) > 0);
  const stale = staleWeeks(remoteWeeks, state.weeks, (n) => hasUnits.get(n));

  for (const n of stale) {
    const units = await pageAll(() => sb.from('units').select('*').eq('week_n', n).order('order'));
    const highlights = await pageAll(() => sb.from('highlights').select('*').eq('week_n', n).order('unit_id'));
    await db.replaceWeek('units', n, units);
    await db.replaceWeek('highlights', n, highlights);
    await db.put('weeks', remoteWeeks.find((w) => w.n === n));
    state.units.delete(n);
    state.highlights.delete(n);
  }
  // Weeks removed on the server disappear locally too.
  const remoteNs = new Set(remoteWeeks.map((w) => w.n));
  for (const w of state.weeks) {
    if (!remoteNs.has(w.n)) {
      await db.del('weeks', w.n);
      await db.deleteByIndex('units', 'week_n', w.n);
      await db.deleteByIndex('highlights', 'week_n', w.n);
      state.units.delete(w.n);
      state.highlights.delete(w.n);
    }
  }
  const changed = stale.length > 0 || remoteWeeks.length !== state.weeks.length;
  state.weeks = remoteWeeks.sort((a, b) => a.n - b.n);
  if (changed) {
    await db.setMeta('texts_synced_at', nowIso());
    emit('weeks');
  }
}

async function pullProgress() {
  if (!state.uid || !online()) return;
  const sb = await getClient();
  const outboxEmpty = (await db.getAllKeys('outbox')).length === 0;

  // lookups
  const remoteLookups = await pageAll(() => sb.from('lookups').select('*').order('form'));
  const { merged, changed } = mergeRows(state.lookups, remoteLookups, (r) => r.form);
  let removed = 0;
  if (outboxEmpty) {
    const remoteForms = new Set(remoteLookups.map((r) => r.form));
    for (const form of [...merged.keys()]) {
      if (!remoteForms.has(form)) { merged.delete(form); removed += 1; }
    }
  }
  if (changed.length || removed) {
    state.lookups = merged;
    await db.clear('lookups');
    await db.putMany('lookups', [...merged.values()]);
    emit('lookups');
  }

  // settings
  const { data: remoteSettings, error: sErr } = await sb.from('settings').select('*').maybeSingle();
  if (sErr) throw sErr;
  if (remoteSettings && isNewer(remoteSettings, state.settings)) {
    state.settings = normaliseSettings(remoteSettings);
    await db.put('settings', { key: 'settings', ...state.settings });
    mirrorSettings();
    emit('settings');
  }

  // alignments
  const remoteAlign = await pageAll(() => sb.from('audio_alignments').select('*').order('week_n'));
  const a = mergeRows(state.alignments, remoteAlign, alignKey);
  let aRemoved = 0;
  if (outboxEmpty) {
    const remoteKeys = new Set(remoteAlign.map(alignKey));
    for (const k of [...a.merged.keys()]) if (!remoteKeys.has(k)) { a.merged.delete(k); aRemoved += 1; }
  }
  if (a.changed.length || aRemoved) {
    state.alignments = a.merged;
    await db.clear('alignments');
    await db.putMany('alignments', [...a.merged.values()]);
    emit('alignments');
  }
}

async function subscribeRealtime() {
  if (state.channel || !state.uid) return;
  const sb = await getClient();
  const filter = `user_id=eq.${state.uid}`;
  state.channel = sb.channel(`store:${state.uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lookups', filter }, onLookupEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, onSettingsEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audio_alignments', filter }, onAlignmentEvent)
    .subscribe((status, err) => {
      if (err) console.warn('[store] realtime', status, err);
    });
}

async function onLookupEvent(payload) {
  const r = applyRealtime(state.lookups, payload, (row) => row.form);
  if (!r.changed) return;
  state.lookups = r.map;
  if (payload.eventType === 'DELETE') await db.del('lookups', r.key);
  else await db.put('lookups', r.map.get(r.key));
  emit('lookups');
}

async function onSettingsEvent(payload) {
  if (payload.eventType === 'DELETE') return;
  if (!isNewer(payload.new, state.settings)) return;
  state.settings = normaliseSettings(payload.new);
  await db.put('settings', { key: 'settings', ...state.settings });
  mirrorSettings();
  emit('settings');
}

async function onAlignmentEvent(payload) {
  const r = applyRealtime(state.alignments, payload, alignKey);
  if (!r.changed) return;
  state.alignments = r.map;
  if (payload.eventType === 'DELETE') {
    const [week_n, unit_id] = r.key.split('|');
    await db.del('alignments', [Number(week_n), unit_id]);
  } else {
    await db.put('alignments', r.map.get(r.key));
  }
  emit('alignments');
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

async function enqueue(op) {
  await db.put('outbox', { ...op, at: nowIso() });
  flushOutbox().catch(() => {});
}

async function flushOutbox() {
  if (state.flushing || !state.uid || !online()) return;
  state.flushing = true;
  try {
    const ops = await db.getAll('outbox');
    if (!ops.length) return;
    const { ops: todo, dropSeqs } = coalesceOutbox(ops);
    if (dropSeqs.length) await db.delMany('outbox', dropSeqs);
    const sb = await getClient();
    for (const op of todo) {
      try {
        await sendOp(sb, op);
        await db.del('outbox', op.seq);
      } catch (e) {
        if (isTransient(e)) { console.info('[store] flush deferred:', e?.message || e); return; }
        console.error('[store] dropping rejected write', op, e);   // e.g. constraint/RLS error: retrying cannot help
        await db.del('outbox', op.seq);
      }
    }
  } finally {
    state.flushing = false;
  }
}

async function sendOp(sb, op) {
  const uid = state.uid;
  let res;
  switch (`${op.table}:${op.op}`) {
    case 'lookups:upsert':
      res = await sb.from('lookups').upsert({ ...op.row, user_id: uid }, { onConflict: 'user_id,form' });
      break;
    case 'lookups:delete':
      res = await sb.from('lookups').delete().eq('form', op.key);
      break;
    case 'settings:upsert':
      res = await sb.from('settings').upsert({ user_id: uid, data: op.row.data, updated_at: op.row.updated_at }, { onConflict: 'user_id' });
      break;
    case 'audio_alignments:replace_week': {
      res = await sb.from('audio_alignments').delete().eq('week_n', op.week_n);
      if (res.error) break;
      if (op.rows.length) {
        res = await sb.from('audio_alignments').upsert(op.rows.map((r) => ({ ...r, user_id: uid })), { onConflict: 'user_id,week_n,unit_id' });
      }
      break;
    }
    default:
      throw new Error(`unknown outbox op ${op.table}:${op.op}`);
  }
  if (res?.error) throw res.error;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

async function getWeeks() {
  await ready();
  return state.weeks.map(({ user_id, ...w }) => w);
}

async function getUnits(weekN) {
  await ready();
  const n = Number(weekN);
  if (!state.units.has(n)) {
    const rows = (await db.byIndex('units', 'week_n', n)).sort((a, b) => a.order - b.order);
    state.units.set(n, rows.map(({ user_id, ...u }) => u));
  }
  return state.units.get(n);
}

async function getHighlights(weekN) {
  await ready();
  const n = Number(weekN);
  if (!state.highlights.has(n)) {
    const rows = await db.byIndex('highlights', 'week_n', n);
    state.highlights.set(n, rows.map(({ user_id, ...h }) => h));
  }
  return state.highlights.get(n);
}

async function getLookups() {
  await ready();
  return lookupsView(state.lookups);
}

async function addLookup(form, unitId) {
  await ready();
  const row = makeLookup(state.lookups.get(form), form, unitId, nowIso());
  if (!row) return;
  state.lookups.set(form, row);
  await db.put('lookups', row);
  await enqueue({ table: 'lookups', key: form, op: 'upsert', row });
}

async function setLearned(form, learned) {
  await ready();
  const row = patchLookup(state.lookups.get(form), { learned_at: learned ? nowIso() : null }, nowIso());
  if (!row) return;
  state.lookups.set(form, row);
  await db.put('lookups', row);
  await enqueue({ table: 'lookups', key: form, op: 'upsert', row });
}
const markLearned = (form) => setLearned(form, true);
const unlearn = (form) => setLearned(form, false);

async function removeLookup(form) {
  await ready();
  if (!state.lookups.has(form)) return;
  state.lookups.delete(form);
  await db.del('lookups', form);
  await enqueue({ table: 'lookups', key: form, op: 'delete' });
}

function getSettings() {
  // Synchronous-friendly: usable before ready() thanks to the localStorage mirror.
  if (state.uid) return { ...state.settings.data };
  try {
    const raw = localStorage.getItem(SETTINGS_LS_KEY);
    if (raw) return normaliseSettings({ data: JSON.parse(raw) }).data;
  } catch { /* ignore */ }
  return normaliseSettings(null).data;
}

async function setSettings(patch) {
  state.settings = patchSettings(state.settings, patch, nowIso());
  mirrorSettings();
  if (!state.uid) { await ready(); }
  await db.put('settings', { key: 'settings', ...state.settings });
  await enqueue({ table: 'settings', key: 'settings', op: 'upsert', row: state.settings });
  return { ...state.settings.data };
}

async function getAlignment(weekN) {
  await ready();
  const n = Number(weekN);
  return [...state.alignments.values()]
    .filter((r) => r.week_n === n)
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((r) => ({ unit_id: r.unit_id, start_ms: r.start_ms }));
}

async function saveAlignment(weekN, rows) {
  await ready();
  const n = Number(weekN);
  const at = nowIso();
  const clean = (rows || [])
    .filter((r) => r && r.unit_id && Number.isFinite(Number(r.start_ms)))
    .map((r) => ({ week_n: n, unit_id: String(r.unit_id), start_ms: Math.max(0, Math.round(Number(r.start_ms))), updated_at: at }));
  for (const k of [...state.alignments.keys()]) if (k.startsWith(`${n}|`)) state.alignments.delete(k);
  for (const r of clean) state.alignments.set(alignKey(r), r);
  await db.replaceWeek('alignments', n, clean);
  await enqueue({ table: 'audio_alignments', key: `week:${n}`, op: 'replace_week', week_n: n, rows: clean });
}

function audioPath(weekN) {
  return `${state.uid}/${weekTag(weekN)}.mp3`;
}

async function getAudioUrl(weekN) {
  await ready();
  if (!online()) return null;
  const n = Number(weekN);
  const cached = state.signedUrls.get(n);
  if (cached && cached.exp > Date.now()) return cached.url;
  try {
    const sb = await getClient();
    const { data, error } = await sb.storage.from('audio').createSignedUrl(audioPath(n), SIGNED_URL_TTL_S);
    if (error || !data?.signedUrl) return null;
    state.signedUrls.set(n, { url: data.signedUrl, exp: Date.now() + SIGNED_URL_REUSE_MS });
    return data.signedUrl;
  } catch (e) {
    console.warn('[store] signed URL failed', e);
    return null;
  }
}

async function uploadAudio(weekN, file) {
  await ready();
  if (!online()) throw new Error('You are offline — connect to upload audio.');
  const sb = await getClient();
  const { error } = await sb.storage.from('audio').upload(audioPath(weekN), file, {
    upsert: true,
    contentType: file?.type || 'audio/mpeg',
  });
  if (error) throw new Error(error.message || 'Upload failed');
  state.signedUrls.delete(Number(weekN));
}

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Force a sync now (e.g. a "Sync" button). Resolves when done or offline. */
function sync() {
  return syncAll();
}

export const store = {
  ready, getWeeks, getUnits, getHighlights,
  getLookups, addLookup, markLearned, unlearn, removeLookup,
  getSettings, setSettings,
  getAlignment, saveAlignment,
  getAudioUrl, uploadAudio,
  onChange, sync,
};

// ---------------------------------------------------------------------------
// Service worker helpers (PWA)
// ---------------------------------------------------------------------------

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' });
    return reg;
  } catch (e) {
    console.warn('[store] service worker registration failed', e);
    return null;
  }
}

function clearRuntimeCache() {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'clear-runtime' }); } catch { /* ignore */ }
}
