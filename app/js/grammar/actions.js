// What a skill's one main button does (docs/SIMPLIFY-PLAN.md §6): the next sensible step, read off the skill's
// state, so every row, the skill page and Today agree. The other ways in (Learn, Mix, a part, Across the
// conjugations) stay beside it as small links; this only chooses the one in the button. Pure.
//
//   mainAction(state, { drillable, set, now }) → { verb, label, view }
//     verb   learn | continue | relearn | review | practise | read | start
//     view   the practice screen it opens: learn · blocked (the due five) · drill (the ten) · lesson
import { isDue } from './scheduler.js';

export function mainAction(state, { drillable = true, set = false, now = Date.now() } = {}) {
  const st = state?.state ?? 'new';
  if (set) return st === 'new' ? { verb: 'start', label: 'Start', view: 'blocked' } : { verb: 'review', label: 'Review', view: 'blocked' };
  if (st === 'learning') return { verb: 'continue', label: 'Continue', view: 'learn' };
  if (st === 'lapsed') return { verb: 'relearn', label: 'Re-learn', view: 'learn' };
  if (st === 'new') return drillable ? { verb: 'learn', label: 'Learn', view: 'learn' } : { verb: 'read', label: 'Read the lesson', view: 'lesson' };
  if (!drillable) return { verb: 'read', label: 'Read the lesson', view: 'lesson' };
  if (isDue(state, now)) return { verb: 'review', label: 'Review', view: 'blocked' };
  return { verb: 'practise', label: 'Practise', view: 'drill' };
}

/** The word for practising a skill's forms on every table it covers: "the conjugations", "the declensions" … */
export function acrossLabel(paradigms = []) {
  const ids = (paradigms ?? []).filter((x) => typeof x === 'string');
  if (ids.length < 2) return ids.length ? 'Its table' : '';
  const n = (re) => ids.filter((t) => re.test(t)).length;
  const verbs = n(/^conj/);
  const nouns = n(/^(decl|domus)/);
  const adjs = n(/^adj/);
  const irregular = n(/^(sum|possum|eo|fero|volo|nolo|malo|fio)$/);
  const pronouns = n(/^(hic|ille|is|iste|ipse|qui|quis|ego|tu|se)$/);
  const what = verbs >= ids.length / 2 ? 'conjugations' : nouns >= ids.length / 2 ? 'declensions' : adjs >= ids.length / 2 ? 'adjective types'
    : irregular === ids.length ? 'irregular verbs' : pronouns === ids.length ? 'pronouns' : 'tables';
  return `Across the ${what} (${ids.length})`;
}
