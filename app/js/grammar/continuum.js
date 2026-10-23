// The path: every skill and every paradigm table on one line, from the easiest to the hardest
// (2026-10-23: "map all skills, paradigm practice tables on a continuum from the very easiest skill to the
// next skill/skills to build upon all the way to the hardest so the progression can be practised as well").
//
// Built from what skills.json already says: each skill's `prereqs` (a graph with one root, nominative-subject,
// and no cycles; a prerequisite is never in a later chapter) and its chapter. A skill's **level** is the
// longest chain of prerequisites under it. The order is chapter, then level, then the book's own order — and
// since a prerequisite is in the same chapter or an earlier one, and in the same chapter always a lower level,
// every skill comes after everything it builds on.
//
// A **table** (decl1, pres-act-1 …) joins the path once its first skill has been met, at the end of that
// skill's chapter: by then the table's first forms are taught, and practising the table means practising
// them together.
//
//   buildPath(skills)       → { steps, index, of(id), next(id), prev(id), easier(id), harder(id), level(id) }
//     steps    [{ kind: 'skill', id, chapter, level } | { kind: 'table', id, chapter, after }]
//     easier   what to go back to when a skill is too hard: its prerequisites, the nearest first; the skill
//              before it on the path when it has none
//     harder   what to go on to when it is too easy: the skills that build on it, in path order; the next
//              skill on the path when nothing names it
// Pure: no DOM, no storage.

/** @param {Array|Map} list skills (rows of skills.json), as an array or a Map id → row */
export function buildPath(list) {
  const rows = (list instanceof Map ? [...list.values()] : [...(list ?? [])]).filter((s) => s && s.id && !s.set);
  const by = new Map(rows.map((s) => [s.id, s]));
  const book = new Map(rows.map((s, i) => [s.id, i]));
  const level = new Map();
  const levelOf = (id, seen = new Set()) => {
    if (level.has(id)) return level.get(id);
    if (seen.has(id)) return 0;   // a cycle cannot happen in the data (tests check), but must not hang the page
    seen.add(id);
    const ps = (by.get(id)?.prereqs ?? []).filter((p) => by.has(p));
    const v = ps.length ? 1 + Math.max(...ps.map((p) => levelOf(p, seen))) : 0;
    level.set(id, v);
    return v;
  };
  for (const s of rows) levelOf(s.id);
  const ch = (s) => Number(s.chapter) || 0;
  const order = [...rows].sort((a, b) => ch(a) - ch(b) || level.get(a.id) - level.get(b.id) || book.get(a.id) - book.get(b.id)).map((s) => s.id);
  const at = new Map(order.map((id, i) => [id, i]));

  // Each table after the last skill of the chapter its first skill is in.
  const firstOf = new Map();
  for (const id of order) for (const t of by.get(id).paradigms ?? []) if (!firstOf.has(t)) firstOf.set(t, id);
  const lastOfChapter = new Map();
  for (const id of order) lastOfChapter.set(ch(by.get(id)), id);
  const tablesAfter = new Map();
  for (const [t, first] of firstOf) {
    const after = lastOfChapter.get(ch(by.get(first)));
    if (!tablesAfter.has(after)) tablesAfter.set(after, []);
    tablesAfter.get(after).push({ kind: 'table', id: t, chapter: ch(by.get(first)), after: first });
  }
  const steps = [];
  for (const id of order) {
    steps.push({ kind: 'skill', id, chapter: ch(by.get(id)), level: level.get(id) });
    for (const t of tablesAfter.get(id) ?? []) steps.push(t);
  }
  const index = new Map(steps.map((s, i) => [`${s.kind}:${s.id}`, i]));

  const dependents = new Map(order.map((id) => [id, []]));
  for (const id of order) for (const p of by.get(id).prereqs ?? []) if (dependents.has(p)) dependents.get(p).push(id);
  const next = (id) => (at.has(id) && at.get(id) < order.length - 1 ? order[at.get(id) + 1] : null);
  const prev = (id) => (at.has(id) && at.get(id) > 0 ? order[at.get(id) - 1] : null);
  const easier = (id) => {
    if (!by.has(id)) return [];
    const ps = (by.get(id).prereqs ?? []).filter((p) => at.has(p)).sort((a, b) => at.get(b) - at.get(a));
    return ps.length ? ps : [prev(id)].filter(Boolean);
  };
  const harder = (id) => {
    if (!by.has(id)) return [];
    const ds = [...(dependents.get(id) ?? [])].sort((a, b) => at.get(a) - at.get(b));
    return ds.length ? ds : [next(id)].filter(Boolean);
  };
  return {
    steps,
    order,
    index,
    of: (id) => (at.has(id) ? at.get(id) : -1),
    level: (id) => level.get(id) ?? null,
    tables: (id) => tablesAfter.get(id) ?? [],
    next,
    prev,
    easier,
    harder,
  };
}

/**
 * The skills to learn next when climbing the path from `id` (or from the start): the first `n` on it, from
 * there, that `pending(id)` says still need learning. Pure.
 */
export function climbFrom(path, id = null, pending = () => true, n = 5) {
  const from = id == null ? 0 : Math.max(0, path.of(id));
  const out = [];
  for (let i = from; i < path.order.length && out.length < n; i++) if (pending(path.order[i])) out.push(path.order[i]);
  return out;
}
