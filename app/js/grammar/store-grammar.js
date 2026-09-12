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
//   g.getLearnPlace(skill) → place|null   g.setLearnPlace(skill, place)   (skill_state.learn_place, §25)
//   g.getLearnPlaces() → { skill: place } g.importLearnPlaces(obj)        (the localStorage cache, both ways)
//   g.getPensa() → rows { chapter, kind, items }   (public.pensa, private: pulled with the grammar rows into the
//                                                  IndexedDB `pensa` store (db v7); the fixture store reads `localPensa()`)
//   g.onChange(cb) → unsubscribe          (cb() after a pull / realtime change)

import { normaliseState, mergeLearnPlace, normaliseLearnPlace, samePlace, newState } from './scheduler.js';

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

/**
 * The scheduler's columns of `skill_state` (anything else stays local).
 *
 * **`learn_place` is deliberately not here** (§25). It is a column the table
 * has, but it rides its own outbox op (`skill_state:learn_place`), which sends
 * that one field and nothing else. PostgREST's upsert only writes the columns
 * in the body, so a state row that leaves this function can never null the
 * place the server holds — and it would, every time a device answered an item
 * before its first pull had finished.
 */
export function serverStateRow(row) {
  // `successes_spaced` (migration 0017): the successes that count towards mastery — correct, unaided, and given when
  // the skill was already due. Mastery reads this, not the raw `successes` count.
  const { skill, state, stage, stability_days, due_at, last_at, streak, successes, successes_spaced, failures, updated_at } = normaliseState(row);
  return { skill, state, stage, stability_days, due_at, last_at, streak, successes, successes_spaced, failures, updated_at };
}
/** The free-form `meta` of an attempt, or null when there is nothing in it. Pure. */
export const cleanMeta = (m) => (m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length ? { ...m } : null);
const SELF = ['right', 'partly', 'wrong'];
export function serverAttemptRow(a) {
  // `self` (migration 0017): the learner's own grade on a translate item, so stats can tell a self-graded attempt from
  // a judged one instead of inferring it from the `answer` string. null on every other kind.
  const self = a.self === true ? String(a.answer ?? '').replace(/^self:\s*/, '') : a.self;
  // `meta` (migration 0020, §25): the device's own facts about the attempt — §18.3's `given` (the scaffold rung a
  // chart was finished at), §20's `uncounted` (practised from the Tables tab: it counts towards the progress sheet
  // and never towards review) and §11b's `generated`. It used to be dropped here, which is what §20.4 owned up to:
  // an uncounted row reached a second device looking like ordinary practice and could close a Learn run there.
  return { skill: a.skill, kind: a.kind, item_key: a.item_key, mode: a.mode, correct: !!a.correct, hinted: !!a.hinted, self: SELF.includes(self) ? self : null, answer: a.answer ?? null, expected: a.expected ?? null, confused_with: a.confused_with ?? null, ms: a.ms == null ? null : Math.round(a.ms), at: a.at, meta: cleanMeta(a.meta) };
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
  /*
   * `meta` syncs now (`drill_attempts.meta`, migration 0020): a generated item's
   * `{ generated: true, template, sentence }` (§11b), §18.3's `given` and §20's `uncounted`.
   *
   * **A missing `meta` means the attempt was counted — it does not mean unknown.** This is the one
   * place in §25 where the "null is unknown" rule does *not* apply, and the next reader will assume
   * it does, so: before §20 an uncounted attempt was never written down at all — `createCatalogueDrill`
   * returned from `onAnswer` before logging — so every row that predates the column is genuinely an
   * ordinary counted attempt. Reading a null `meta` as "might be uncounted" would take real practice
   * off the learner's record; reading it as counted is what actually happened. `isUncounted` asks for
   * `meta.uncounted === true` and so answers false here, which is the right answer and not a fallback.
   * `meta.given` is the opposite and stays unknown when absent (§18.3: never 0, never a failure).
   *
   * The key is left off the row entirely when there is nothing in it, so an attempt from before the
   * column and one written today with no meta are the same object.
   */
  const meta = cleanMeta(a.meta);
  delete row.meta;
  return { ...row, id: attemptId(row), ...(meta ? { meta } : {}) };
}

/**
 * @param {object} o
 *   mode        'idb' (the real store, through store.js's outbox) or 'local' (the fixture store)
 *   hooks       store.js's `grammarHooks` — the outbox, the client, the user id, realtime (idb only)
 *   storage     the localStorage the fixture store persists to
 *   localPensa  the fixture store's pensa loader
 *   learnCache  the lesson place's **offline cache** (§25): `{ read() → { skill: place }, write(obj) }`.
 *               `read()` is the device's own record, unioned into the store at `ready()` so a device
 *               that has been working offline pushes its place up rather than being overwritten by an
 *               empty server; `write()` mirrors the merged truth back after every change, so a reader
 *               with no network still draws the pips. Optional: without it the store keeps the place
 *               in its rows and nothing else.
 *   dbModule    the IndexedDB module (app/js/db.js). Injected only by the tests, which model two
 *               devices over one backend; in the app it is imported.
 */
export function createGrammarStore({ mode = 'local', hooks = null, storage = typeof localStorage !== 'undefined' ? localStorage : null, localPensa = null, learnCache = null, dbModule = null } = {}) {
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
  let unnamedList = null;         // wrong answers that carry no item_key: countable, never redoable
  const confusions = new Map();   // key → row
  const pensa = new Map();        // `${chapter}:${kind}` → row (private, read-only on the device)
  const listeners = new Set();
  let readyP = null;
  let db = null;
  const dropIndex = () => { bySkill = null; missedList = null; unnamedList = null; };
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
   * That is also what keeps an **uncounted** table out of the redo (§20): a
   * catalogue item carries no key by design, so a miss on one has never been
   * offered back, whether the run counted or not. A redo is a review device
   * and an uncounted attempt asks for no review; the key rule already says so,
   * and `isUncounted` is not needed here to make it true.
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
  /**
   * Wrong answers that name **no item** — a generated sentence, a catalogue
   * table, a teaching step's check. They can never be offered back, so they
   * stay out of `missed()`; but they are not nothing, and the empty state
   * must not say "everything you have missed has since been answered right"
   * over the top of a hundred of them (QA M-3). One row per answer, because
   * without a key there is no item to collapse them onto.
   *
   * An **uncounted** table (§20) belongs here with the rest. This is not a
   * review device — it offers nothing back and schedules nothing; it is the
   * honesty counter that stops the empty state claiming a clean sheet, and a
   * table the learner got wrong from the Tables tab is a wrong answer they
   * really gave. The line that prints it already names "a catalogue table" as
   * one of the three things it means.
   */
  const unnamed = () => {
    if (!unnamedList) unnamedList = [...attempts.values()].filter((a) => !a.item_key && isMissedAttempt(a)).sort((a, b) => ts(b.at) - ts(a.at));
    return unnamedList;
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
      db = dbModule ?? await import('../db.js');
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
        const row = mergeState(cur, r);
        if (row !== cur) { states.set(r.skill, row); await db.put('skill_state', row); changed = true; }
        // The server holds less of the lesson place than we now do — because this device worked
        // offline, or because the other device's row won on `updated_at` and carried a smaller
        // `done`. Send the union back; `updated_at` is untouched, so the push settles nothing
        // the scheduler owns and cannot flip last-write-wins the wrong way (§25).
        if (!samePlace(row.learn_place, r.learn_place)) await pushPlace(row);
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
    if (changed) { mirrorPlaces(); emit(); }
  }

  /**
   * A remote `skill_state` row against the one we hold. The scheduler's
   * fields are **last-write-wins on `updated_at`**, exactly as before; the
   * lesson place is **merged**, whichever side wins, because two devices may
   * each hold part of one lesson and a union is the only merge that cannot
   * lose a step the learner really answered (§25, `mergeLearnPlace`).
   *
   * Returns `cur` itself when there is no news — the callers test identity to
   * decide whether anything has to be written or repainted. Pure.
   */
  function mergeState(cur, remote) {
    if (!cur) return remote;
    const place = mergeLearnPlace(cur.learn_place, remote.learn_place);
    const winner = ts(remote.updated_at) > ts(cur.updated_at) ? remote : cur;
    if (winner === cur && samePlace(cur.learn_place, place)) return cur;
    return samePlace(winner.learn_place, place) ? winner : { ...winner, learn_place: place };
  }
  /** Send one row's lesson place, and nothing else, to the server (§25). */
  async function pushPlace(row) {
    if (mode !== 'idb' || !hooks) return;
    // Its own outbox key: coalescing keeps the last op per (table, key), and a place write and a
    // state write must never swallow one another — they carry different columns.
    await hooks.enqueue({ table: 'skill_state', key: `place:${row.skill}`, op: 'learn_place', skill: row.skill, learn_place: row.learn_place ?? null });
  }

  async function onRealtime(payload) {
    const type = payload?.eventType;
    if (type === 'DELETE') {
      const skill = payload.old?.skill;
      if (skill && states.has(skill)) { states.delete(skill); await db.del('skill_state', skill); mirrorPlaces(); emit(); }
      return;
    }
    const r = normaliseState(payload?.new);
    if (!r) return;
    const cur = states.get(r.skill);
    const row = mergeState(cur, r);
    if (!samePlace(row.learn_place, r.learn_place)) await pushPlace(row);
    if (row === cur) return;   // own echo or older, and the place says nothing new either
    states.set(r.skill, row);
    await db.put('skill_state', row);
    mirrorPlaces();
    emit();
  }

  function ready() {
    if (!readyP) {
      readyP = (async () => {
        if (mode === 'idb' && hooks) await hooks.ready();
        await loadLocal();
        // The lesson place the device already had, unioned in **before the first pull** (§25). The
        // learner's computer is holding a finished lesson in localStorage right now and nothing has
        // ever sent it up; this is the write that does. It has to come first for two reasons: the
        // pull prunes local rows the server does not have, and it checks an empty outbox to decide
        // whether it may — so the push has to be queued before that check is made, or a place
        // created a moment later could be deleted locally while its own write was still in flight.
        let cached = null;
        try { cached = learnCache?.read?.() ?? null; } catch (e) { console.warn('[grammar] learn place cache not read', e?.message || e); }
        await importLearnPlaces(cached);
        mirrorPlaces();
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
    /*
     * The lesson place is not the scheduler's to set (§25). Callers build a state row from
     * `getState(id) ?? id` and the second half of that is a bare `newState`, whose `learn_place`
     * is null — *unknown*. Merging rather than assigning is what stops "add this skill to mixed
     * practice" quietly erasing the four steps the learner has finished in it. Taking a place off
     * is `setLearnPlace(skill, null)`'s job, and a reset's, and nothing else's.
     */
    const before = states.get(s.skill)?.learn_place ?? null;
    s.learn_place = mergeLearnPlace(before, s.learn_place);
    const placeMoved = !samePlace(before, s.learn_place);
    states.set(s.skill, s);
    if (mode === 'idb') {
      await db.put('skill_state', s);
      await hooks.enqueue({ table: 'skill_state', key: `skill:${s.skill}`, op: 'upsert', row: serverStateRow(s) });
      if (placeMoved) await pushPlace(s);
    } else persistLocal();
    if (placeMoved) mirrorPlaces();
    return s;
  }
  /* ------------------------------------------- the lesson place (§25) */
  /** Every skill's place, as the object the localStorage cache holds: `{ <skill id>: { done, seen, at } }`. */
  const placesObject = () => {
    const out = {};
    for (const [skill, s] of states) if (s.learn_place) out[skill] = { ...s.learn_place, ...(s.learn_place.done ? { done: [...s.learn_place.done] } : null) };
    return out;
  };
  /**
   * Write the merged truth back to the offline cache. Called after every
   * change to a place from any direction — a local write, a pull, a realtime
   * row, a reset — so the cache is a mirror and never a second opinion: a
   * device with no network draws its pips from it, and a reset or a pruned
   * row takes the cached place with it.
   */
  const mirrorPlaces = () => { try { learnCache?.write?.(placesObject()); } catch (e) { console.warn('[grammar] learn place cache not written', e?.message || e); } };
  /**
   * One skill's place, merged into what is already known and written down.
   *
   *   place  the place to record — **added** to the stored one, never
   *          substituted for it (`mergeLearnPlace`), so a step that is already
   *          ticked cannot come off by writing a smaller set over it
   *   null   clear it: the deliberate erase the app does when a Learn pass is
   *          finished, and when a skill is reset
   *
   * A skill with no `skill_state` row yet gets a fresh one (`newState`) to
   * carry the place. That row is `state: 'new'`, which every reader already
   * treats exactly as no row at all — `stateOf` answers `getState(id) ??
   * newState(id)` — so nothing is claimed about the skill by recording where
   * the learner is in its lesson.
   */
  async function setLearnPlace(skill, place) {
    if (typeof skill !== 'string' || !skill) return null;
    const cur = states.get(skill) ?? null;
    const next = place === null ? null : mergeLearnPlace(cur?.learn_place, normaliseLearnPlace(place));
    // Clearing a place a skill with no row has not got: the app does exactly this a line after a
    // reset. Making a row to record the absence of a place would undo the reset it follows.
    if (!cur && next === null) return null;
    if (cur && samePlace(cur.learn_place, next)) return placesObject()[skill] ?? null;   // no news; a copy, never the stored object
    /*
     * A row made only to carry a place is stamped at the **epoch**, so it loses last-write-wins to
     * any real row from anywhere. It has to: this device knows nothing about the skill's schedule,
     * and a row stamped `now` would beat the server's true state — a phone that had only opened the
     * lesson would tell the pull to ignore a `practising` row written on the computer an hour ago.
     * The place itself is unaffected; the merge never consults `updated_at` for it.
     */
    const row = { ...(cur ?? normaliseState(newState(skill, 0))), learn_place: next };
    states.set(skill, row);
    // `updated_at` is not touched. A place is not one of the scheduler's fields, and bumping it
    // would let a device that only opened a lesson win last-write-wins over another that really
    // did answer something — the wrong row would then stand for the scheduler too.
    if (mode === 'idb') { await db.put('skill_state', row); await pushPlace(row); }
    else persistLocal();
    mirrorPlaces();
    return next;
  }
  /**
   * The device's own cached places, unioned in (§25). This is the migration
   * of what is already on disk: `l103.grammar.learn` has never left the
   * browser, so on the first run after this change every place it holds is
   * news to the server and is pushed up. Nothing is overwritten in either
   * direction — each skill is merged, and a skill the cache says nothing
   * about is left exactly as the store has it.
   */
  async function importLearnPlaces(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
    let n = 0;
    for (const [skill, place] of Object.entries(obj)) {
      const clean = normaliseLearnPlace(place);
      if (!clean) continue;
      const before = states.get(skill)?.learn_place ?? null;
      if (samePlace(before, mergeLearnPlace(before, clean))) continue;   // the store already knows it all
      await setLearnPlace(skill, clean);
      n += 1;
    }
    return n;
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
    mirrorPlaces();   // the row is gone and the lesson place went with it: the cache must not keep a copy
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
    mirrorPlaces();
    emit();
  }

  // Cross-tab changes with the fixture store look like sync events.
  if (mode !== 'idb' && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (Object.values(LS).includes(e.key)) { states.clear(); attempts.clear(); confusions.clear(); dropIndex(); loadLocal().then(() => { mirrorPlaces(); emit(); }); }
    });
  }

  return {
    ready, pull,
    getStates: () => new Map([...states].map(([k, v]) => [k, { ...v }])),
    getState: (skill) => (states.has(skill) ? { ...states.get(skill) } : null),
    setState, resetSkill, resetAll,
    /**
     * Where the learner is in this skill's lesson (§25), or **null** — which
     * means *nothing is known here*, never "no steps done". A caller drawing
     * the pips treats null as "not started" only because that is all it can
     * draw; nothing may be *written* on the strength of it.
     */
    getLearnPlace: (skill) => { const p = states.get(skill)?.learn_place ?? null; return p ? { ...p, ...(p.done ? { done: [...p.done] } : null) } : null; },
    getLearnPlaces: placesObject,
    setLearnPlace, importLearnPlaces,
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
    /**
     * How many wrong answers in scope name no item, so could never be offered
     * back — a generated sentence, a catalogue table, a teaching step. The
     * empty state prints it rather than claiming nothing was missed
     * (GRAMMAR-CONTRACT.md "Redo what was wrong"; QA M-3). Answers, not items:
     * without a key there is nothing to collapse them onto.
     */
    countUnnamedMissed({ skill = null, skills = null } = {}) {
      const only = skills == null ? null : (skills instanceof Set ? skills : new Set(skills));
      let n = 0;
      for (const a of unnamed()) { if (skill != null && a.skill !== skill) continue; if (only && !only.has(a.skill)) continue; n += 1; }
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
