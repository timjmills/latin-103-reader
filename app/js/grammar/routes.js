// Old addresses → their new home (docs/SIMPLIFY-PLAN.md §7). Grammar, Word Work and Sheets are one section now,
// Study, with four tabs: Today · Course · Tables · Progress. Every old view name still opens: this table says
// where. Pure: no DOM.
//
//   resolveView(name, params) → { name, params }   the view to draw (often the same one)
//   tabOf(name)               → 'today' | 'course' | 'tables' | 'progress'   the tab a view lives under

const AREA_OF_CATEGORY = { 'verb-form': 'verbs', 'verb-use': 'sentences', 'noun-case': 'nouns', adjective: 'adjectives', pronoun: 'pronouns', syntax: 'sentences', metre: 'metre', vocabulary: 'verbs' };

export function resolveView(name, params = {}) {
  const p = params ?? {};
  switch (name) {
    // Skills: a chapter of it is that chapter's page; a category is that area of Course; the rest is Today.
    case 'map':
      if (p.chapter != null) return { name: 'chapter', params: { chapter: Number(p.chapter) } };
      if (p.category && p.category !== 'all') return p.category === 'sets' ? { name: 'course', params: { by: 'chapter' } } : { name: 'course', params: { by: 'area', area: AREA_OF_CATEGORY[p.category] ?? 'verbs' } };
      return { name: 'today', params: {} };
    case 'path': return p.area ? { name: 'course', params: { by: 'area', area: p.area, ...(p.at ? { at: p.at } : {}) } } : { name: 'course', params: { by: 'chapter', ...(p.at ? { at: p.at } : {}) } };
    case 'wwdrills': return { name: 'chapter', params: p.chapter != null ? { chapter: Number(p.chapter) } : {} };
    case 'wwpath': return { name: 'course', params: { by: 'area', area: p.area ?? 'verbs', ...(p.at ? { at: p.at } : {}) } };
    default: return { name, params: p };
  }
}

const TABS = {
  today: ['today', 'setup', 'session', 'redo', 'summary'],
  course: ['course', 'chapter', 'map', 'lesson', 'learn', 'part', 'drill', 'blocked', 'unlimited', 'mixed', 'wordwork', 'wwdrills', 'wwtable', 'sheets'],
  tables: ['catalogue', 'paradigms'],
  progress: ['chart', 'stats', 'history'],
};
export function tabOf(name) {
  for (const [tab, views] of Object.entries(TABS)) if (views.includes(name)) return tab;
  return 'today';
}
/** The four tabs, in order, with the view each opens: one list for the tab row and the game's ☰ menu. */
export const STUDY_TABS = [
  { id: 'today', label: 'Today', view: 'today' },
  { id: 'course', label: 'Course', view: 'course' },
  { id: 'tables', label: 'Tables', view: 'catalogue' },
  { id: 'progress', label: 'Progress', view: 'chart' },
];
