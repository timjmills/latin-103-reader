// The chapter spine, grammar side (GRAMMAR-CONTRACT.md "Chapter spine —
// navigation by chapter"). Pure helpers only: which grammar belongs to a
// chapter, how much of it is done, and which of it a session may draw from.
// The chapter → readings mapping itself is `app/js/chapters.js`'s (owner A);
// nothing here re-derives it — a chapter entry is passed in when there is one,
// and without it the spine is simply the numerals I–XXXIV with no titles.

import { roman } from '../sync.js';
import { chapterOfWeek } from '../chapters.js';

export const CHAPTER_MIN = 1;
export const CHAPTER_MAX = 34;            // Familia Romana I–XXXIV
export const VIEWS = Object.freeze(['topic', 'chapter']);
/** The remembered choice of Grammar view (settings.grammar.view); anything unknown reads as the map we have always had. */
export const normaliseView = (v) => (v === 'chapter' ? 'chapter' : 'topic');

const ROTATION = new Set(['practising', 'mastered', 'lapsed']);
const SET_ORDER = { questions: 0, vocab: 1, pensum: 2 };

/**
 * The book's chapters in order, from `chapters()` when the shell has landed it
 * and from the numerals alone when it has not. Every chapter I–XXXIV is
 * present either way (and any further one the list names), so the by-chapter
 * view is the book's spine and not just the chapters that happen to carry a
 * skill. Pure.
 */
export function spine(list = null, { min = CHAPTER_MIN, max = CHAPTER_MAX } = {}) {
  const byN = new Map();
  for (const c of Array.isArray(list) ? list : []) {
    const n = Number(c?.n);
    if (!Number.isFinite(n) || n < 1) continue;
    byN.set(n, {
      n,
      roman: c.roman || roman(n),
      title: typeof c.title === 'string' ? c.title : '',
      readings: Array.isArray(c.readings) ? c.readings : [],
      grammar: c.grammar ?? null,
    });
  }
  const last = Math.max(max, ...byN.keys(), min);
  const out = [];
  for (let n = min; n <= last; n++) out.push(byN.get(n) ?? { n, roman: roman(n), title: '', readings: [], grammar: null });
  return out;
}

/**
 * One chapter's grammar: the skills the book introduces there (the chapter
 * entry's own list when it names one, else `skill.chapter`) in book order, and
 * the chapter's sets — questions, vocabulary (with the reverse deck after its
 * own) and pensa. `skills` is a Map id → definition, `sets` the Map of chapter
 * sets; `order` is the skill map's book order. Pure.
 */
export function chapterMaterial(chapter, { skills = new Map(), order = null, sets = new Map(), entry = null } = {}) {
  const n = Number(chapter);
  const named = Array.isArray(entry?.grammar?.skills) ? entry.grammar.skills : null;
  let list = named
    ? named.map((id) => skills.get(id)).filter((s) => s && !s.set)
    : [...skills.values()].filter((s) => s && !s.set && Number(s.chapter) === n);
  if (!named && Array.isArray(order) && order.length) {
    const pos = new Map(order.map((id, i) => [id, i]));
    list = [...list].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
  }
  const setList = [...sets.values()]
    .filter((s) => s && Number(s.chapter) === n)
    .sort((a, b) => (SET_ORDER[a.set] ?? 9) - (SET_ORDER[b.set] ?? 9) || Number(!!a.rev) - Number(!!b.rev));
  return { chapter: n, skills: list, sets: setList, members: [...list, ...setList], ids: [...list, ...setList].map((s) => s.id) };
}

/**
 * How much of a chapter is done. `state(id)` gives the (decayed) skill_state
 * row or null, `drillable(id)` says whether it can produce an item at all —
 * a lesson-only skill and a set with no items are counted but never claimed
 * to be practisable. Pure.
 */
export function chapterProgress(material, { state = () => null, drillable = () => true } = {}) {
  let mastered = 0;
  let rotation = 0;
  let started = 0;
  let can = 0;
  for (const s of material.members ?? []) {
    const name = state(s.id)?.state ?? 'new';
    if (name === 'mastered') mastered += 1;
    if (ROTATION.has(name)) rotation += 1;
    if (name !== 'new') started += 1;
    if (drillable(s.id)) can += 1;
  }
  return { total: material.members?.length ?? 0, skills: material.skills.length, sets: material.sets.length, mastered, rotation, started, drillable: can };
}

/** The chapter's state in one quiet line — counts only, no praise. Pure. */
export function chapterSummary(progress) {
  if (!progress?.total) return 'No grammar of its own';
  const parts = [];
  if (progress.skills) parts.push(`${progress.skills} skill${progress.skills === 1 ? '' : 's'}`);
  if (progress.sets) parts.push(`${progress.sets} set${progress.sets === 1 ? '' : 's'}`);
  parts.push(progress.mastered ? `${progress.mastered} of ${progress.total} mastered` : progress.started ? `${progress.started} of ${progress.total} started` : 'not started');
  return parts.join(' · ');
}

/**
 * What "Practise this chapter" may draw from: the chapter's drillable skills
 * and sets as a skills Map (handed to `createPractice` as its whole world, so
 * the fill and the re-queue stay inside the chapter too), which of them are in
 * rotation, which are lapsed (they may be practised — the one-skill rule) and
 * which are still new and could be added. Pure.
 */
export function chapterPool(material, { state = () => null, drillable = () => true } = {}) {
  const members = (material.members ?? []).filter((s) => drillable(s.id));
  const nameOf = (s) => state(s.id)?.state ?? 'new';
  return {
    map: new Map(members.map((s) => [s.id, s])),
    rotation: members.filter((s) => ROTATION.has(nameOf(s))).map((s) => s.id),
    lapsed: members.filter((s) => nameOf(s) === 'lapsed').map((s) => s.id),
    addable: members.filter((s) => nameOf(s) === 'new' && !s.rev).map((s) => s.id),
  };
}

/**
 * The by-chapter view's rows: every chapter of the spine with its material and
 * its progress, in book order. Pure — the view only paints these.
 */
export function spineRows({ chapters = null, skills = new Map(), order = null, sets = new Map(), state, drillable, min = CHAPTER_MIN, max = CHAPTER_MAX } = {}) {
  return spine(chapters, { min, max }).map((c) => {
    const material = chapterMaterial(c.n, { skills, order, sets, entry: c });
    return { ...c, material, progress: chapterProgress(material, { state, drillable }) };
  });
}

/* ================================================ the sentence's chapter */
// A chapter's practice must read like that chapter (QA M3): the skills were
// already kept inside it, but the *sentences* those skills were drilled on
// came from the whole library, so a chapter-VII session could quote Catullus
// 70 — cap. XXXIV, twenty-seven chapters ahead of the learner. The rule, and
// it applies wherever a chapter or a week scopes a session:
//
//   1. the chapter's own sentences;
//   2. failing those, sentences at or before it (Latin the learner has met);
//   3. only with neither, the wider library — and the item says so in its own
//      words rather than reaching forward silently.
//
// The chapter of a sentence is its library week's, through `chapters.js`
// (the one place the chapter → week mapping lives): 107 → VII, 207 → VII,
// week 4 → XXVII. A week the spine does not name has no chapter; such a
// sentence is never "own" or "earlier", so it can only be reached in tier 3.

/** The scopes a draw can end in, narrowest first. `beyond` is the honest one: nothing at or before the chapter. */
export const SCOPES = Object.freeze(['own', 'earlier', 'beyond']);

/**
 * How a chapter narrows a draw. Two callers, two rules:
 *
 *   'own-first'  a **chapter's** practice ("Practise this chapter"): that
 *                chapter's own sentences first, so the session reads like the
 *                chapter it is named after; earlier Latin only when it has none.
 *   'ceiling'    the **learner's own position**, which scopes every other
 *                session (§7.2). Everything at or before it is Latin they have
 *                already met and is equally fair game, so the two tiers are
 *                one: capping without narrowing to a single chapter keeps the
 *                pool wide enough that a skill is not drilled on four sentences.
 *
 * Both fall back outward the same way, and only when a skill has nothing at or
 * before the chapter at all — and the item then says so.
 */
export const SCOPE_MODES = Object.freeze(['own-first', 'ceiling']);

/** A chapter number, or null for anything that is not one (null and undefined included — `Number(null)` is 0, which is not chapter zero). Pure. */
const chapterNumber = (x) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= CHAPTER_MIN ? n : null; };

/** Where a library week sits relative to a chapter: 'own' | 'earlier' | 'later' | 'unknown'. Pure. */
export function chapterTier(weekN, chapter) {
  const n = chapterNumber(chapter);
  if (n == null) return 'unknown';
  const c = chapterOfWeek(weekN);
  if (c == null) return 'unknown';
  return c === n ? 'own' : c < n ? 'earlier' : 'later';
}

/** The chapter a sentence (a candidate, an item, a unit) belongs to, or null. Pure. */
export function chapterOfSentence(x) {
  const w = x?.unit?.week_n ?? x?.week_n ?? null;
  return w == null ? null : chapterOfWeek(w);
}

/**
 * Narrow a draw to the chapter that scopes it. `list` is whatever the
 * generator would otherwise have drawn from (candidates, transform spots …)
 * and `weekOf` reads a library week off one of them.
 *
 * Returns `{ list, scope, counts }`: the narrowest non-empty tier, which of
 * the three it is, and the count of each so a caller can say how thin the
 * chapter was. `chapter` null (or a list already empty) leaves everything
 * alone with `scope: null` — the whole library, exactly as before.
 * Pure.
 */
export function scopeByChapter(list, chapter, weekOf = (x) => x?.unit?.week_n ?? x?.week_n ?? null, { mode = 'own-first' } = {}) {
  const n = chapterNumber(chapter);
  const all = Array.isArray(list) ? list : [];
  if (n == null || !all.length) return { list: all, scope: null, counts: null };
  const own = [];
  const earlier = [];
  const later = [];
  const unknown = [];
  for (const x of all) {
    const t = chapterTier(weekOf(x), n);
    (t === 'own' ? own : t === 'earlier' ? earlier : t === 'later' ? later : unknown).push(x);
  }
  const counts = { own: own.length, earlier: earlier.length, later: later.length, unknown: unknown.length, atOrBefore: own.length + earlier.length, total: all.length };
  if (mode === 'ceiling') {
    // The learner's ceiling: everything they have read, in one tier. `scopeNote` reads each drawn
    // sentence's own chapter back off it, so an item still says 'own' or 'earlier' as it always did.
    if (counts.atOrBefore) return { list: [...own, ...earlier], scope: 'at-or-before', counts };
  } else {
    if (own.length) return { list: own, scope: 'own', counts };
    if (earlier.length) return { list: earlier, scope: 'earlier', counts };
  }
  // Nothing at or before the chapter: the wider library, unknown weeks before the ones that are demonstrably ahead.
  return { list: [...unknown, ...later], scope: 'beyond', counts };
}

/**
 * What an item carries when a chapter scoped its draw: the chapter asked for,
 * the chapter the sentence actually came from, which tier it was drawn in, and
 * whether that is a reach forward. `null` only when no chapter scoped the draw
 * at all — an item from the chapter's own Latin still says which chapter that
 * is, because the pool it exhausts is the chapter's and not the library's.
 * Pure.
 */
export function scopeNote(chapter, scope, sentence) {
  const n = chapterNumber(chapter);
  if (n == null || !scope) return null;
  const from = chapterOfSentence(sentence);
  // A ceiling draws one tier out of two, so which of them this sentence came from is read off the
  // sentence itself: at or before the chapter, its own week says 'own' or 'earlier' without guessing.
  const s = scope !== 'at-or-before' ? scope : (from === n ? 'own' : 'earlier');
  const note = { chapter: n, from, scope: s, beyond: s === 'beyond' };
  // A ceiling says something different from a chapter's own practice, so the item remembers which it was:
  // an earlier chapter under a ceiling is the ordinary thing, not a sign that the chapter itself had none.
  if (scope === 'at-or-before') note.ceiling = true;
  return note;
}

/**
 * How much Latin a chapter can actually draw on, per skill — the measurement
 * behind the rule, so a regression shows up as a number and not as a lucky
 * sample. `skills` is the skill definitions (or ids) to report on and
 * `candidates(id)` the generator's candidate list for one of them; sentences
 * are counted once each, by unit id.
 *
 *   { chapter, skills: [ { skill, set, own, earlier, atOrBefore, later,
 *                          unknown, total } ], totals, none }
 *
 * `none` names the skills with nothing at or before the chapter — the ones
 * whose items must say so. A chapter set is counted but never listed there:
 * its items are the chapter's own by construction. Pure.
 */
export function chapterSentenceReport(chapter, { skills = [], candidates = () => [] } = {}) {
  const n = chapterNumber(chapter);
  const rows = [];
  for (const s of skills) {
    const id = typeof s === 'string' ? s : s?.id;
    if (!id) continue;
    const isSet = typeof s === 'string' ? false : !!s?.set;
    const seen = new Map();
    for (const c of candidates(id) ?? []) {
      const u = c?.unit?.id ?? c?.unit_id ?? null;
      if (u == null || seen.has(u)) continue;
      seen.set(u, chapterTier(c?.unit?.week_n ?? c?.week_n ?? null, n));
    }
    const tiers = [...seen.values()];
    const count = (t) => tiers.filter((x) => x === t).length;
    const own = count('own');
    const earlier = count('earlier');
    rows.push({ skill: id, set: isSet, own, earlier, atOrBefore: own + earlier, later: count('later'), unknown: count('unknown'), total: seen.size });
  }
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  return {
    chapter: n,
    skills: rows,
    totals: { own: sum('own'), earlier: sum('earlier'), atOrBefore: sum('atOrBefore'), later: sum('later'), unknown: sum('unknown'), total: sum('total') },
    none: rows.filter((r) => !r.set && !r.atOrBefore).map((r) => r.skill),
  };
}
