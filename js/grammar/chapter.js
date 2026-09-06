// The chapter spine, grammar side (GRAMMAR-CONTRACT.md "Chapter spine —
// navigation by chapter"). Pure helpers only: which grammar belongs to a
// chapter, how much of it is done, and which of it a session may draw from.
// The chapter → readings mapping itself is `app/js/chapters.js`'s (owner A);
// nothing here re-derives it — a chapter entry is passed in when there is one,
// and without it the spine is simply the numerals I–XXXIV with no titles.

import { roman } from '../sync.js';

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
