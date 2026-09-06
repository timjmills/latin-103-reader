// Grammar store (GRAMMAR-CONTRACT.md "Supabase"): skill_state, drill_attempts,
// confusions — local-first through the same path as the lookups. With the
// real store every write lands in IndexedDB (db.js v6 stores) and is queued
// in store.js's outbox through `grammarHooks` (never a second client, never a
// second outbox); skill_state arrives back in realtime on a second device.
// With the fixture store the three tables live in localStorage.
//
//   const g = createGrammarStore({ mode: 'idb' | 'local', hooks });   // hooks = store.js's grammarHooks (idb only)
//   await g.ready();
//   g.getStates() → Map skill → row       g.setState(row)      g.resetSkill(id) / g.resetAll()
//   g.getAttempts() → rows (oldest first) g.addAttempt(row)
//   g.getConfusions() → rows              g.bumpConfusion(a, b)
//   g.onChange(cb) → unsubscribe          (cb() after a pull / realtime change)

import { normaliseState } from './scheduler.js';

const LS = { states: 'l103.grammar.states', attempts: 'l103.grammar.attempts', confusions: 'l103.grammar.confusions' };
const ATTEMPT_PULL = 2000;
const nowIso = () => new Date().toISOString();
const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
/** The attempt's local id: the server has no client id, so (at, skill, item_key) names a row on both sides. */
export const attemptId = (a) => `${a.at}|${a.skill}|${a.item_key}`;
export const confusionKey = (a, b) => `${a}|${b}`;

/** The columns the server table has (anything else stays local). */
export function serverStateRow(row) {
  const { skill, state, stage, stability_days, due_at, last_at, streak, successes, failures, updated_at } = normaliseState(row);
  return { skill, state, stage, stability_days, due_at, last_at, streak, successes, failures, updated_at };
}
export function serverAttemptRow(a) {
  return { skill: a.skill, kind: a.kind, item_key: a.item_key, mode: a.mode, correct: !!a.correct, hinted: !!a.hinted, answer: a.answer ?? null, expected: a.expected ?? null, confused_with: a.confused_with ?? null, ms: a.ms == null ? null : Math.round(a.ms), at: a.at };
}
/** A clean attempt row from any source (bad rows → null). Pure. */
export function normaliseAttempt(a) {
  if (!a || typeof a.skill !== 'string' || typeof a.kind !== 'string' || !a.at) return null;
  // `at` canonical (…Z, milliseconds): the server hands timestamptz back as +00:00, and the id must be the same on both sides (C2).
  const t = Date.parse(a.at);
  if (!Number.isFinite(t)) return null;
  const row = { ...serverAttemptRow({ ...a, at: new Date(t).toISOString(), item_key: String(a.item_key ?? ''), mode: a.mode === 'learn' ? 'learn' : 'practice' }) };
  return { ...row, id: attemptId(row) };
}

export function createGrammarStore({ mode = 'local', hooks = null, storage = typeof localStorage !== 'undefined' ? localStorage : null } = {}) {
  const states = new Map();
  const attempts = new Map();     // id → row
  const confusions = new Map();   // key → row
  const listeners = new Set();
  let readyP = null;
  let db = null;
  const emit = () => { for (const cb of listeners) { try { cb('grammar'); } catch (e) { console.error('[grammar] listener failed', e); } } };

  /* ------------------------------------------------------- local */
  const readLS = (k, d) => { try { const v = storage?.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const writeLS = (k, v) => { try { storage?.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const persistLocal = () => {
    writeLS(LS.states, [...states.values()]);
    writeLS(LS.attempts, [...attempts.values()]);
    writeLS(LS.confusions, [...confusions.values()]);
  };

  async function loadLocal() {
    if (mode === 'idb') {
      db = await import('../db.js');
      for (const r of await db.getAll('skill_state')) { const s = normaliseState(r); if (s) states.set(s.skill, s); }
      for (const r of await db.getAll('drill_attempts')) { const a = normaliseAttempt(r); if (a) attempts.set(a.id, a); }
      for (const r of await db.getAll('confusions')) if (r?.skill_a && r?.skill_b) confusions.set(confusionKey(r.skill_a, r.skill_b), r);
    } else {
      for (const r of readLS(LS.states, [])) { const s = normaliseState(r); if (s) states.set(s.skill, s); }
      for (const r of readLS(LS.attempts, [])) { const a = normaliseAttempt(r); if (a) attempts.set(a.id, a); }
      for (const r of readLS(LS.confusions, [])) if (r?.skill_a && r?.skill_b) confusions.set(confusionKey(r.skill_a, r.skill_b), r);
    }
  }

  /* -------------------------------------------------------- remote */
  async function pull() {
    if (mode !== 'idb' || !hooks?.uid() || !hooks.online()) return;
    let sb;
    try { sb = await hooks.getClient(); } catch { return; }
    let changed = false;
    try {
      const rows = await hooks.pageAll(() => sb.from('skill_state').select('*').order('skill'));
      const empty = await hooks.outboxEmpty();
      const remote = new Set();
      for (const raw of rows) {
        const r = normaliseState(raw);
        if (!r) continue;
        remote.add(r.skill);
        const cur = states.get(r.skill);
        if (!cur || ts(r.updated_at) > ts(cur.updated_at)) { states.set(r.skill, r); await db.put('skill_state', r); changed = true; }
      }
      if (empty) for (const k of [...states.keys()]) if (!remote.has(k)) { states.delete(k); await db.del('skill_state', k); changed = true; }
    } catch (e) { console.warn('[grammar] skill_state not synced', e?.message || e); }
    try {
      const { data, error } = await sb.from('drill_attempts').select('*').order('at', { ascending: false }).limit(ATTEMPT_PULL);
      if (error) throw error;
      for (const raw of data || []) { const a = normaliseAttempt(raw); if (a && !attempts.has(a.id)) { attempts.set(a.id, a); await db.put('drill_attempts', a); changed = true; } }
    } catch (e) { console.warn('[grammar] drill_attempts not synced', e?.message || e); }
    try {
      const rows = await hooks.pageAll(() => sb.from('confusions').select('*').order('skill_a'));
      for (const r of rows) {
        if (mergeConfusion(r)) { await db.put('confusions', confusions.get(confusionKey(r.skill_a, r.skill_b))); changed = true; }
      }
    } catch (e) { console.warn('[grammar] confusions not synced', e?.message || e); }
    if (changed) emit();
  }

  async function onRealtime(payload) {
    const type = payload?.eventType;
    if (type === 'DELETE') {
      const skill = payload.old?.skill;
      if (skill && states.has(skill)) { states.delete(skill); await db.del('skill_state', skill); emit(); }
      return;
    }
    const r = normaliseState(payload?.new);
    if (!r) return;
    const cur = states.get(r.skill);
    if (cur && ts(r.updated_at) <= ts(cur.updated_at)) return;   // own echo or older
    states.set(r.skill, r);
    await db.put('skill_state', r);
    emit();
  }

  function ready() {
    if (!readyP) {
      readyP = (async () => {
        if (mode === 'idb' && hooks) await hooks.ready();
        await loadLocal();
        if (mode === 'idb' && hooks) {
          hooks.onRealtime('skill_state', (p) => { onRealtime(p).catch((e) => console.warn('[grammar] realtime', e)); });
          hooks.onSynced(() => pull());
          pull().catch(() => {});
        }
      })();
    }
    return readyP;
  }

  /* -------------------------------------------------------- writes */
  async function setState(row) {
    const s = normaliseState({ ...row, updated_at: nowIso() });
    if (!s) return null;
    states.set(s.skill, s);
    if (mode === 'idb') { await db.put('skill_state', s); await hooks.enqueue({ table: 'skill_state', key: `skill:${s.skill}`, op: 'upsert', row: serverStateRow(s) }); }
    else persistLocal();
    return s;
  }
  async function addAttempt(row) {
    const a = normaliseAttempt({ ...row, at: row.at ?? nowIso() });
    if (!a) return null;
    attempts.set(a.id, a);
    if (mode === 'idb') { await db.put('drill_attempts', a); await hooks.enqueue({ table: 'drill_attempts', key: `attempt:${a.id}`, op: 'insert', row: serverAttemptRow(a) }); }
    else persistLocal();
    return a;
  }
  /** Merge a confusion row by max (the server's before-update trigger does the same, migration 0015): two devices never regress each other's count. */
  function mergeConfusion(r) {
    if (!r?.skill_a || !r?.skill_b) return false;
    const k = confusionKey(r.skill_a, r.skill_b);
    const cur = confusions.get(k);
    const row = { skill_a: r.skill_a, skill_b: r.skill_b, count: Math.max(Number(r.count) || 0, Number(cur?.count) || 0), updated_at: r.updated_at && cur?.updated_at ? (ts(r.updated_at) >= ts(cur.updated_at) ? r.updated_at : cur.updated_at) : (r.updated_at ?? cur?.updated_at ?? null) };
    if (cur && row.count === cur.count) return false;
    confusions.set(k, row);
    return true;
  }
  async function bumpConfusion(a, b) {
    if (!a || !b || a === b) return null;
    const k = confusionKey(a, b);
    const cur = confusions.get(k);
    const row = { skill_a: a, skill_b: b, count: (Number(cur?.count) || 0) + 1, updated_at: nowIso() };
    confusions.set(k, row);
    if (mode === 'idb') { await db.put('confusions', row); await hooks.enqueue({ table: 'confusions', key: `conf:${k}`, op: 'upsert', row }); }
    else persistLocal();
    return row;
  }
  async function resetSkill(skill) {
    states.delete(skill);
    for (const [id, a] of [...attempts]) if (a.skill === skill) attempts.delete(id);
    for (const [k, c] of [...confusions]) if (c.skill_a === skill || c.skill_b === skill) confusions.delete(k);
    if (mode === 'idb') {
      await db.del('skill_state', skill);
      await db.deleteByIndex('drill_attempts', 'skill', skill);
      for (const k of [...(await db.getAll('confusions'))].filter((c) => c.skill_a === skill || c.skill_b === skill).map((c) => confusionKey(c.skill_a, c.skill_b))) await db.del('confusions', k);
      const t = Date.now();
      await hooks.enqueue({ table: 'skill_state', key: `skill:${skill}`, op: 'delete', skill });
      await hooks.enqueue({ table: 'drill_attempts', key: `attempts-reset:${skill}:${t}`, op: 'delete', skill });
      await hooks.enqueue({ table: 'confusions', key: `conf-reset:${skill}:${t}`, op: 'delete', skill });
    } else persistLocal();
    emit();
  }
  async function resetAll() {
    states.clear(); attempts.clear(); confusions.clear();
    if (mode === 'idb') {
      await db.clear('skill_state'); await db.clear('drill_attempts'); await db.clear('confusions');
      const t = Date.now();
      await hooks.enqueue({ table: 'skill_state', key: `skill-reset:all:${t}`, op: 'delete', skill: null });
      await hooks.enqueue({ table: 'drill_attempts', key: `attempts-reset:all:${t}`, op: 'delete', skill: null });
      await hooks.enqueue({ table: 'confusions', key: `conf-reset:all:${t}`, op: 'delete', skill: null });
    } else persistLocal();
    emit();
  }

  // Cross-tab changes with the fixture store look like sync events.
  if (mode !== 'idb' && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (Object.values(LS).includes(e.key)) { states.clear(); attempts.clear(); confusions.clear(); loadLocal().then(emit); }
    });
  }

  return {
    ready, pull,
    getStates: () => new Map([...states].map(([k, v]) => [k, { ...v }])),
    getState: (skill) => (states.has(skill) ? { ...states.get(skill) } : null),
    setState, resetSkill, resetAll,
    getAttempts: ({ skill = null } = {}) => [...attempts.values()].filter((a) => skill == null || a.skill === skill).sort((a, b) => ts(a.at) - ts(b.at)),
    addAttempt,
    getConfusions: () => [...confusions.values()].map((r) => ({ ...r })),
    bumpConfusion, mergeConfusion,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    mode,
  };
}
