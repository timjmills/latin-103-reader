// Store — the CONTRACT.md interface, backed by IndexedDB (cache + outbox)
// and Supabase (source of truth, realtime for second-device updates).
//
//   import { store, registerServiceWorker } from './store.js';
//   await store.ready();                     // after auth; warms the cache
//
// Texts (weeks/units/highlights/pictures) are pull-only: re-fetched per week when the
// server's weeks.updated_at is newer than the cached one (the seed script bumps
// it after re-seeding). Progress (lookups/settings/alignments/reading progress) is local-first:
// every write lands in IndexedDB immediately, is queued in the outbox, and is
// flushed when online; newest updated_at wins on both sides.

import * as db from './db.js';
import { auth, getClient } from './auth.js';
import {
  mergeRows, applyRealtime, coalesceOutbox, makeLookup, patchLookup,
  patchSettings, normaliseSettings, lookupsView, weekTag, staleWeeks,
  cleanWords, normaliseAlignmentRows, normalisePictureRows, makeProgressRows,
  mergeProgress, patchLastPosition, mergeSettings,
} from './sync.js';

export const SETTINGS_LS_KEY = 'latin103.settings';
const PAGE = 1000;
const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REUSE_MS = 50 * 60 * 1000;
const PICTURE_SIGN_BATCH = 25;   // createSignedUrls() paths per request: a week's illustrations in a handful of calls, not one each

const state = {
  uid: null,
  readyPromise: null,
  weeks: [],
  units: new Map(),        // weekN → unit[]
  highlights: new Map(),   // weekN → highlight[]
  lookups: new Map(),      // form → row
  settings: normaliseSettings(null),
  alignments: new Map(),   // `${week_n}|${unit_id}` → row
  progress: new Map(),     // unit_id → reading_progress row (CONTRACT.md "Reading progress")
  pictures: new Map(),     // weekN → raw picture rows (+ url / url_exp once signed)
  signedUrls: new Map(),   // weekN → { url, exp }
  channel: null,
  flushing: null,          // the flushOutbox() run in flight (a promise), so a second caller chains onto it
  flushAgain: false,       // an enqueue() arrived while flushing: run once more when this run ends
  progressGen: 0,          // bumped by every local progress write; a pull that started before one does not merge over it
  progressEmit: 0,         // timer coalescing a burst of realtime progress events into one emit('progress')
  syncing: null,
  wired: false,
};
const listeners = new Set();
const PROGRESS_EMIT_MS = 100;

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
  state.progress = new Map((await db.getAll('progress')).map((r) => [r.unit_id, r]));
  state.units.clear();
  state.highlights.clear();
  state.pictures.clear();
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
  state.progress.clear();
  state.pictures.clear();
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
    await db.replaceWeek('pictures', n, await pullPictures(sb, n));
    await db.put('weeks', remoteWeeks.find((w) => w.n === n));
    state.units.delete(n);
    state.highlights.delete(n);
    state.pictures.delete(n);
  }
  // Weeks removed on the server disappear locally too.
  const remoteNs = new Set(remoteWeeks.map((w) => w.n));
  for (const w of state.weeks) {
    if (!remoteNs.has(w.n)) {
      await db.del('weeks', w.n);
      await db.deleteByIndex('units', 'week_n', w.n);
      await db.deleteByIndex('highlights', 'week_n', w.n);
      await db.deleteByIndex('pictures', 'week_n', w.n);
      state.units.delete(w.n);
      state.highlights.delete(w.n);
      state.pictures.delete(w.n);
    }
  }
  const changed = stale.length > 0 || remoteWeeks.length !== state.weeks.length;
  state.weeks = remoteWeeks.sort((a, b) => a.n - b.n);
  if (changed) {
    await db.setMeta('texts_synced_at', nowIso());
    emit('weeks');
  }
}

// The week's picture rows (table `pictures`, migration 0008). A library seeded
// before that migration has no table: the week still syncs, without pictures.
async function pullPictures(sb, n) {
  try {
    return await pageAll(() => sb.from('pictures').select('*').eq('week_n', n).order('sort'));
  } catch (e) {
    console.warn('[store] pictures not synced for week', n, e?.message || e);
    return [];
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

  // settings (the row by updated_at, lastPosition by its own `at` — mergeSettings)
  const { data: remoteSettings, error: sErr } = await sb.from('settings').select('*').maybeSingle();
  if (sErr) throw sErr;
  if (remoteSettings) await applyRemoteSettings(remoteSettings);

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

  // reading progress. Nothing is merged while a markRead / reset is still in
  // the outbox, or when one landed locally while the rows were in flight: a
  // pull overlapping a reset must not bring the deleted rows back (the next
  // pull, after the flush, is the one that reconciles).
  const gen = state.progressGen;
  const remoteProgress = await pageAll(() => sb.from('reading_progress').select('*').order('unit_id'));
  if (gen !== state.progressGen) return;
  const p = mergeProgress(state.progress, remoteProgress, await db.getAll('outbox'));
  if (p.skipped) return;
  if (p.changed.length || p.removed) {
    state.progress = p.merged;
    await db.clear('progress');
    await db.putMany('progress', [...p.merged.values()]);
    emit('progress');
  }
}

/** A settings row from the server (pull or realtime): kept when it moves anything locally. */
async function applyRemoteSettings(row) {
  const { settings, changed } = mergeSettings(state.settings, row);
  if (!changed) return;
  state.settings = settings;
  await db.put('settings', { key: 'settings', ...state.settings });
  mirrorSettings();
  emit('settings');
}

async function subscribeRealtime() {
  if (state.channel || !state.uid) return;
  const sb = await getClient();
  const filter = `user_id=eq.${state.uid}`;
  state.channel = sb.channel(`store:${state.uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lookups', filter }, onLookupEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, onSettingsEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audio_alignments', filter }, onAlignmentEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reading_progress', filter }, onProgressEvent)
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
  if (payload.eventType === 'DELETE' || !payload.new) return;
  await applyRemoteSettings(payload.new);
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

// A reset on another device arrives as one DELETE per row: the map is
// patched per event, the listeners hear about the burst once (PROGRESS_EMIT_MS).
async function onProgressEvent(payload) {
  const r = applyRealtime(state.progress, payload, (row) => row.unit_id);
  if (!r.changed) return;
  state.progress = r.map;
  if (payload.eventType === 'DELETE') await db.del('progress', r.key);
  else await db.put('progress', r.map.get(r.key));
  clearTimeout(state.progressEmit);
  state.progressEmit = setTimeout(() => { state.progressEmit = 0; emit('progress'); }, PROGRESS_EMIT_MS);
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

async function enqueue(op) {
  await db.put('outbox', { ...op, at: nowIso() });
  flushOutbox().catch(() => {});
}

// One flush runs at a time; a caller arriving mid-flush (an enqueue() during
// a sync, a reset during a markRead flush) waits for it and gets one more
// pass, so its op is never left behind for the next pull to race against.
function flushOutbox() {
  if (!state.uid || !online()) return Promise.resolve();
  if (state.flushing) { state.flushAgain = true; return state.flushing; }
  state.flushing = (async () => {
    do {
      state.flushAgain = false;
      await flushOnce();
    } while (state.flushAgain && online());
  })().finally(() => { state.flushing = null; state.flushAgain = false; });
  return state.flushing;
}

async function flushOnce() {
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
    case 'reading_progress:upsert_many':
      res = await sb.from('reading_progress').upsert(op.rows.map((r) => ({ ...r, user_id: uid })), { onConflict: 'user_id,unit_id' });
      break;
    case 'reading_progress:delete': {
      let q = sb.from('reading_progress').delete().eq('user_id', uid);
      if (op.week_n != null) q = q.eq('week_n', op.week_n);
      res = await q;
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
    // Rows cached before migration 0004 have no `margin`; the UI expects an array.
    // The plain-words layer (CONTRACT.md): `note_simple` and `margin[].en` ride along, missing → null.
    state.units.set(n, rows.map(({ user_id, ...u }) => ({
      ...u,
      note_simple: typeof u.note_simple === 'string' ? u.note_simple : null,
      margin: Array.isArray(u.margin) ? u.margin.map((m) => (m && typeof m === 'object' ? { ...m, en: typeof m.en === 'string' ? m.en : null } : m)) : [],
    })));
  }
  return state.units.get(n);
}

async function getHighlights(weekN) {
  await ready();
  const n = Number(weekN);
  if (!state.highlights.has(n)) {
    const rows = await db.byIndex('highlights', 'week_n', n);
    state.highlights.set(n, rows.map(({ user_id, ...h }) => ({ ...h, simple: typeof h.simple === 'string' ? h.simple : null })));
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

/**
 * Where the learner is (settings.lastPosition), written on its own: the
 * row's updated_at is not bumped (patchLastPosition), so a device that only
 * scrolls never outranks one that changed a real setting — lastPosition.at
 * is the clock the two sides merge on. Coalesces with any pending settings
 * upsert (same outbox key); the server keeps the row unless the timestamp
 * sent is older than the stored one.
 */
async function setLastPosition(lastPosition) {
  state.settings = patchLastPosition(state.settings, lastPosition);
  mirrorSettings();
  if (!state.uid) { await ready(); }
  await db.put('settings', { key: 'settings', ...state.settings });
  await enqueue({ table: 'settings', key: 'settings', op: 'upsert', row: state.settings });
  return { ...state.settings.data };
}

async function getAlignment(weekN) {
  await ready();
  const n = Number(weekN);
  // `words` ([{t, s, e}], absolute ms) come from the pipeline's Whisper / TTS
  // alignment; manual alignments have none → [] (cleanWords). `end_ms` and
  // `synth` are normalised too: rows cached before migration 0007 → null / false.
  return normaliseAlignmentRows([...state.alignments.values()].filter((r) => r.week_n === n));
}

async function saveAlignment(weekN, rows) {
  await ready();
  const n = Number(weekN);
  const at = nowIso();
  // end_ms (null: until the next row) and synth ride along; a manual
  // alignment from the overlay has neither → null / false (migration 0007).
  const clean = normaliseAlignmentRows(rows)
    .map((r) => ({ week_n: n, unit_id: r.unit_id, start_ms: r.start_ms, end_ms: r.end_ms, synth: r.synth, words: cleanWords(r.words), updated_at: at }));
  for (const k of [...state.alignments.keys()]) if (k.startsWith(`${n}|`)) state.alignments.delete(k);
  for (const r of clean) state.alignments.set(alignKey(r), r);
  await db.replaceWeek('alignments', n, clean);
  await enqueue({ table: 'audio_alignments', key: `week:${n}`, op: 'replace_week', week_n: n, rows: clean });
}

// ---------------------------------------------------------------------------
// Reading progress (CONTRACT.md "Reading progress"): local-first like lookups.
// markRead() is idempotent (ids already read are skipped); every batch is its
// own outbox entry (unique key, so coalescing never drops one) and a reset is
// one delete — for a week or for everything. Realtime keeps a second device
// in step (emit('progress')). Lookups are never touched here.
// ---------------------------------------------------------------------------

let markSeq = 0;

async function getProgress() {
  await ready();
  return new Map([...state.progress.values()].map((r) => [r.unit_id, r.read_at]));
}

async function markRead(unitIds) {
  await ready();
  const rows = makeProgressRows(unitIds, state.progress, nowIso());
  if (!rows.length) return;
  state.progressGen += 1;
  for (const r of rows) state.progress.set(r.unit_id, r);
  await db.putMany('progress', rows);
  await enqueue({ table: 'reading_progress', key: `mark:${Date.now()}:${markSeq++}`, op: 'upsert_many', rows });
}

async function resetProgress(weekN = null) {
  await ready();
  const n = weekN == null ? null : Number(weekN);
  state.progressGen += 1;
  for (const [id, r] of [...state.progress]) if (n == null || r.week_n === n) state.progress.delete(id);
  if (n == null) await db.clear('progress');
  else await db.deleteByIndex('progress', 'week_n', n);
  await enqueue({ table: 'reading_progress', key: `reset:${n ?? 'all'}:${Date.now()}`, op: 'delete', week_n: n });
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

// ---------------------------------------------------------------------------
// Pictures (CONTRACT.md "Pictures"): rows from IndexedDB, images from the
// private bucket `pictures` through signed URLs (1 h, re-signed after 50 min).
// URLs are signed lazily — when a week's pictures are asked for — in batches
// of PICTURE_SIGN_BATCH with createSignedUrls(), and kept on the cached row so
// an offline reload still has a URL (stale → the browser cache, or the alt text).
// ---------------------------------------------------------------------------

const picturePath = (r) => `${state.uid}/${r.path}`;

async function signPictures(rows) {
  const now = Date.now();
  const todo = rows.filter((r) => typeof r.path === 'string' && !(r.url && r.url_exp > now));
  if (!todo.length || !online()) return;
  try {
    const sb = await getClient();
    for (let i = 0; i < todo.length; i += PICTURE_SIGN_BATCH) {
      const batch = todo.slice(i, i + PICTURE_SIGN_BATCH);
      const { data, error } = await sb.storage.from('pictures').createSignedUrls(batch.map(picturePath), SIGNED_URL_TTL_S);
      if (error) throw error;
      const signed = [];
      (data || []).forEach((d, j) => {
        if (!d?.signedUrl) return;
        batch[j].url = d.signedUrl;
        batch[j].url_exp = now + SIGNED_URL_REUSE_MS;
        signed.push(batch[j]);
      });
      if (signed.length) await db.putMany('pictures', signed);
    }
  } catch (e) {
    console.warn('[store] picture URLs failed', e?.message || e);
  }
}

async function getPictures(weekN) {
  await ready();
  const n = Number(weekN);
  if (!state.pictures.has(n)) state.pictures.set(n, await db.byIndex('pictures', 'week_n', n));
  const raw = state.pictures.get(n);
  await signPictures(raw);
  const urls = new Map(raw.map((r) => [String(r.id), r.url ?? null]));
  return normalisePictureRows(raw.map(({ user_id, ...r }) => r))
    .map((p) => ({ ...p, url: urls.get(p.id) ?? null }))
    .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  getSettings, setSettings, setLastPosition,
  getAlignment, saveAlignment,
  getAudioUrl, uploadAudio,
  getPictures,
  getProgress, markRead, resetProgress,
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
