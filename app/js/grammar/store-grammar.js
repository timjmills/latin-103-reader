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
//   g.getMissed() → rows, newest first    g.countMissed()      ("Redo what was wrong")
//   g.getConfusions() → rows              g.bumpConfusion(a, b)
//   g.getPensa() → rows { chapter, kind, items }   (public.pensa, private: pulled with the grammar rows into the
//                                                  IndexedDB `pensa` store (db v7); the fixture store reads `localPensa()`)
//   g.onChange(cb) → unsubscribe          (cb() after a pull / realtime change)

import { normaliseState } from './scheduler.js';

const LS = { states: 'l103.grammar.states', attempts: 'l103.grammar.attempts', confusions: 'l103.grammar.confusions' };
const ATTEMPT_PULL = 2000;
const nowIso = () => new Date().toISOString();
const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
/** The attempt's local id: the server has no client id, so (at, skill, item_key) names a row on both sides. */
export const attemptId = (a) => `${a.at}|${a.skill}|${a.item_key}`;
export const confusionKey = (a, b) => `${a}|${b}`;
/** A clean pensa row from any source (bad rows → null). Pure. */
export function normalisePensum(r) {
  const chapter = Number(r?.chapter);
  const kind = String(r?.kind ?? '').toUpperCase();
  if (!Number.isFinite(chapter) || chapter < 1 || !['A', 'B', 'C'].includes(kind)) return null;
  const items = Array.isArray(r.items) ? r.items.filter((it) => it && typeof it === 'object') : [];
  return { id: `${chapter}:${kind}`, chapter, kind, items, updated_at: r.updated_at ?? null };
}

/** The columns the server table has (anything else stays local). */
export function serverStateRow(row) {
  // `successes_spaced` (migration 0017): the successes that count towards mastery — correct, unaided, and given when
  // the skill was already due. Mastery reads this, not the raw `successes` count.
  const { skill, state, stage, stability_days, due_at, last_at, streak, successes, successes_spaced, failures, updated_at } = normaliseState(row);
  return { skill, state, stage, stability_days, due_at, last_at, streak, successes, successes_spaced, failures, updated_at };
}
const SELF = ['right', 'partly', 'wrong'];
export function serverAttemptRow(a) {
  // `self` (migration 0017): the learner's own grade on a translate item, so stats can tell a self-graded attempt from
  // a judged one instead of inferring it from the `answer` string. null on every other kind.
  const self = a.self === true ? String(a.answer ?? '').replace(/^self:\s*/, '') : a.self;
  return { skill: a.skill, kind: a.kind, item_key: a.item_key, mode: a.mode, correct: !!a.correct, hinted: !!a.hinted, self: SELF.includes(self) ? self : null, answer: a.answer ?? null, expected: a.expected ?? null, confused_with: a.confused_with ?? null, ms: a.ms == null ? null : Math.round(a.ms), at: a.at };
}
/**
 * True when an attempt row leaves its item **missed** (GRAMMAR-CONTRACT.md
 * "Redo what was wrong"): the answer was wrong, and — on a self-graded
 * translate — the learner's own grade was "wrong", never "partly". `judge`
 * already counts "partly" as correct, so the `self` clause is the belt to that
 * brace: a row that ever arrives with `correct: false` and `self: 'partly'`
 * (an older client, a hand-edited row) is still not a miss. Pure.
 */
export const isMissedAttempt = (a) => !!a && !a.correct && a.self !== 'partly' && a.self !== 'right';

/**
 * The identity of a drill item across sessions: its key is stable per (kind,
 * unit, token), but only *within* a skill — two skills scanning the same word
 * of the same sentence produce the same `blank:w01:1.1:x:0`. The pair is what
 * names an item. Pure.
 */
export const missKey = (a) => `${a.skill}\u0000${a.item_key}`;

/** A clean attempt row from any source (bad rows → null). Pure. */
export function normaliseAttempt(a) {
  if (!a || typeof a.skill !== 'string' || typeof a.kind !== 'string' || !a.at) return null;
  // `at` canonical (…Z, milliseconds): the server hands timestamptz back as +00:00, and the id must be the same on both sides (C2).
  const t = Date.parse(a.at);
  if (!Number.isFinite(t)) return null;
  const row = { ...serverAttemptRow({ ...a, at: new Date(t).toISOString(), item_key: String(a.item_key ?? ''), mode: a.mode === 'learn' ? 'learn' : 'practice' }) };
  return { ...row, id: attemptId(row) };
}

export function createGrammarStore({ mode = 'local', hooks = null, storage = typeof localStorage !== 'undefined' ? localStorage : null, localPensa = null } = {}) {
  const states = new Map();
  const attempts = new Map();     // id → row
  // A per-skill index over the attempts, built on demand and dropped on any write. The history view
  // (GRAMMAR-CONTRACT.md wave 3) asks for one skill's tail over and over as it repaints, and the log can
  // hold thousands of rows: without this every repaint would walk and sort the lot on a phone.
  let bySkill = null;
  // The missed items, newest first: the same idea one step further ("Redo what was wrong"). Every view that
  // offers a redo — the end of a session, Practice setup, a skill's history, a chapter panel — asks for a
  // count on every repaint, and the answer means finding the *latest* attempt on each item. Walking thousands
  // of rows per repaint on a phone is what this avoids; like `bySkill` it is built once and dropped on any write.
  let missedList = null;
  const confusions = new Map();   // key → row
  const pensa = new Map();        // `${chapter}:${kind}` → row (private, read-only on the device)
  const listeners = new Set();
  let readyP = null;
  let db = null;
  const dropIndex = () => { bySkill = null; missedList = null; };
  /** The per-skill index, built once and kept until the next write. Rows are the stored objects, not copies. */
  const index = () => {
    if (!bySkill) {
      bySkill = new Map();
      for (const a of attempts.values()) { let l = bySkill.get(a.skill); if (!l) bySkill.set(a.skill, l = []); l.push(a); }
      for (const l of bySkill.values()) l.sort((a, b) => ts(a.at) - ts(b.at));
    }
    return bySkill;
  };
  /**
   * Every item whose **most recent** attempt was a miss, newest miss first.
   * One pass over the log keeps the latest attempt per (skill, item_key); what
   * survives the `isMissedAttempt` filter is what a redo may draw from.
   * An attempt with no `item_key` is left out: it names no item, so it could
   * never be rebuilt, and counting it would promise a redo that cannot happen.
   */
  const missed = () => {
    if (!missedList) {
      const last = new Map();
      for (const a of attempts.values()) {
        if (!a.item_key) continue;
        const k = missKey(a);
        const cur = last.get(k);
        if (!cur || ts(a.at) > ts(cur.at)) last.set(k, a);
      }
      missedList = [...last.values()].filter(isMissedAttempt).sort((a, b) => ts(b.at) - ts(a.at));
    }
    return missedList;
  };
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
      dropIndex();
      for (const r of await db.getAll('confusions')) if (r?.skill_a && r?.skill_b) confusions.set(confusionKey(r.skill_a, r.skill_b), r);
      for (const r of await db.getAll('pensa')) { const p = normalisePensum(r); if (p) pensa.set(p.id, p); }
    } else {
      for (const r of readLS(LS.states, [])) { const s = normaliseState(r); if (s) states.set(s.skill, s); }
      for (const r of readLS(LS.attempts, [])) { const a = normaliseAttempt(r); if (a) attempts.set(a.id, a); }
      dropIndex();
      for (const r of readLS(LS.confusions, [])) if (r?.skill_a && r?.skill_b) confusions.set(confusionKey(r.skill_a, r.skill_b), r);
      // The fixture store's pensa (tests/fixtures/grammar/pensa/*.json through index.js): memory only, never persisted.
      if (localPensa) { try { for (const r of (await localPensa()) || []) { const p = normalisePensum(r); if (p) pensa.set(p.id, p); } } catch (e) { console.warn('[grammar] fixture pensa not loaded', e?.message || e); } }
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
      for (const raw of data || []) { const a = normaliseAttempt(raw); if (a && !attempts.has(a.id)) { attempts.set(a.id, a); dropIndex(); await db.put('drill_attempts', a); changed = true; } }
    } catch (e) { console.warn('[grammar] drill_attempts not synced', e?.message || e); }
    try {
      const rows = await hooks.pageAll(() => sb.from('confusions').select('*').order('skill_a'));
      for (const r of rows) {
        if (mergeConfusion(r)) { await db.put('confusions', confusions.get(confusionKey(r.skill_a, r.skill_b))); changed = true; }
      }
    } catch (e) { console.warn('[grammar] confusions not synced', e?.message || e); }
    // The pensa: private rows like the texts, pulled whole (a few dozen rows), replaced when the server's set differs.
    try {
      const rows = await hooks.pageAll(() => sb.from('pensa').select('*').order('chapter'));
      const remote = new Map();
      for (const raw of rows) { const p = normalisePensum(raw); if (p) remote.set(p.id, p); }
      for (const [id, p] of remote) { const cur = pensa.get(id); if (!cur || ts(p.updated_at) > ts(cur.updated_at) || cur.items.length !== p.items.length || JSON.stringify(cur.items) !== JSON.stringify(p.items)   /* content, not only the count: an edited item with the same updated_at never reached a device that already had the row (CR m3) */) { pensa.set(id, p); await db.put('pensa', p); changed = true; } }
      for (const id of [...pensa.keys()]) if (!remote.has(id)) { pensa.delete(id); await db.del('pensa', id); changed = true; }
    } catch (e) { console.warn('[grammar] pensa not synced', e?.message || e); }
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
    dropIndex();
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
    dropIndex();
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
    states.clear(); attempts.clear(); confusions.clear(); dropIndex();
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
      if (Object.values(LS).includes(e.key)) { states.clear(); attempts.clear(); confusions.clear(); dropIndex(); loadLocal().then(emit); }
    });
  }

  return {
    ready, pull,
    getStates: () => new Map([...states].map(([k, v]) => [k, { ...v }])),
    getState: (skill) => (states.has(skill) ? { ...states.get(skill) } : null),
    setState, resetSkill, resetAll,
    /**
     * The attempt log, oldest first. `skill` reads one skill's rows through a
     * per-skill index built once and dropped on the next write; `limit` keeps
     * only that many of the newest (the history view never needs more) and
     * `since` drops anything older than the timestamp. Everything is a copy.
     */
    getAttempts({ skill = null, limit = 0, since = null } = {}) {
      let rows;
      if (skill == null) rows = [...attempts.values()].sort((a, b) => ts(a.at) - ts(b.at));
      else rows = index().get(skill) ?? [];
      if (since != null) { const t = ts(since); rows = rows.filter((a) => ts(a.at) >= t); }
      if (limit > 0 && rows.length > limit) rows = rows.slice(-limit);
      return rows.map((a) => ({ ...a }));
    },
    /**
     * How many attempts one skill has, without materialising them: the same
     * per-skill index `getAttempts` uses, so the skill map's 87 calls a paint
     * cost one array lookup each rather than 87 walks of the whole log (G3-06).
     */
    countAttempts(skill) {
      if (skill == null) return attempts.size;
      return index().get(skill)?.length ?? 0;
    },
    /**
     * The items to redo (GRAMMAR-CONTRACT.md "Redo what was wrong"): those
     * whose most recent attempt was wrong, **most recently missed first**.
     * Answering one right anywhere — a redo, an ordinary session, a blocked
     * five — takes it off this list, because the newest attempt on it is then
     * a correct one; missing it again keeps it, with a fresher timestamp.
     *
     *   skill   only this skill's (a skill's history page)
     *   skills  only these ids — any iterable, Set or array (a chapter's)
     *   limit   at most this many of the most recent
     *
     * Rows are copies of the attempt that missed, so a caller can read `kind`
     * (which item to rebuild) and `at` (how long ago) without reaching in.
     */
    getMissed({ skill = null, skills = null, limit = 0 } = {}) {
      const only = skills == null ? null : (skills instanceof Set ? skills : new Set(skills));
      let rows = missed();
      if (skill != null) rows = rows.filter((a) => a.skill === skill);
      if (only) rows = rows.filter((a) => only.has(a.skill));
      if (limit > 0 && rows.length > limit) rows = rows.slice(0, limit);
      return rows.map((a) => ({ ...a }));
    },
    /** How many there are, without materialising them — the count every redo control prints. */
    countMissed({ skill = null, skills = null } = {}) {
      const only = skills == null ? null : (skills instanceof Set ? skills : new Set(skills));
      let n = 0;
      for (const a of missed()) { if (skill != null && a.skill !== skill) continue; if (only && !only.has(a.skill)) continue; n += 1; }
      return n;
    },
    addAttempt,
    getConfusions: () => [...confusions.values()].map((r) => ({ ...r })),
    bumpConfusion, mergeConfusion,
    getPensa: () => [...pensa.values()].map((r) => ({ ...r, items: r.items.map((it) => ({ ...it })) })),
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    mode,
  };
}
