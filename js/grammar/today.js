// The daily plan (GRAMMAR-PLAN.md §5, GRAMMAR-CONTRACT.md "Daily plan"): a
// suggested set for today, never forced — Learn (one of the current 103 week's
// unlearned skills) · Practice (10 items: due skills, confusion pairs) ·
// Questions for the current week's passage · Vocabulary due — with estimated
// minutes: grammar items at the learner's own pace from the attempt log (≈ 25 s
// each until twenty attempts say otherwise), the reading line at the study
// log's pace. Pure; ui.js and main.js render it (tests/grammar.today.test.mjs).
//
//   buildToday({ states, skills, currentWeek, weekChapter, attempts, unread, pace, now, dismissed, drillable })
//     → { day, dismissed, lines: [{ id, kind, label, detail, minutes, action }], minutes }

import { decay, isDue, newState, suggestToday, inRotation } from './scheduler.js';
import { localDay } from './stats.js';

export const DEFAULT_ITEM_S = 25;
export const PACE_MIN_ATTEMPTS = 20;
export const LEARN_LESSON_MIN = 2;
export const LEARN_ITEMS = 15;          // guided 5 + blocked 10
export const PRACTICE_ITEMS = 10;
const pad = (n) => String(n).padStart(2, '0');

/** Seconds per grammar item from the attempt log: the mean over the last 200 attempts once there are 20 (clamped 8–90 s), else 25. Pure. */
export function itemSeconds(attempts, { min = PACE_MIN_ATTEMPTS, fallback = DEFAULT_ITEM_S } = {}) {
  const timed = (attempts || []).filter((a) => Number(a?.ms) > 0).slice(-200);
  if (timed.length < min) return fallback;
  const mean = timed.reduce((n, a) => n + Number(a.ms), 0) / timed.length / 1000;
  return Math.max(8, Math.min(90, Math.round(mean)));
}
const minutesOf = (items, s) => Math.max(1, Math.round((items * s) / 60));

/** True when the plan was dismissed for `day` (settings.todayDismissed = the local date). Pure. */
export const isDismissed = (dismissed, day) => !!dismissed && dismissed === day;

/**
 * The plan. `skills`: grammar skills ∪ set skills (Map); `currentWeek`: the
 * week's grammar skill ids; `weekChapter`: the chapter the current week reads
 * (for its question set and vocabulary deck); `unread` / `pace`: the reader's
 * sentences left this week and the study log's pace (optional reading line).
 * `drillable(id)`: the section's real pool test (ui.js passes `ctx.drillable`);
 * without it a skill counts as drillable when it has a parse filter at all, so
 * the two metre skills (lesson only) never reach the Learn line either way.
 */
export function buildToday({ states, skills, currentWeek = [], weekChapter = null, attempts = [], unread = 0, pace = null, now = Date.now(), dismissed = null, size = PRACTICE_ITEMS, drillable = null } = {}) {
  const day = localDay(now);
  const s = itemSeconds(attempts);
  const stateOf = (id) => decay(states.get(id) ?? newState(id, now), now);
  const lines = [];
  const today = suggestToday({ states, skills, currentWeek, now });

  // Learn: the week's first unlearned grammar skill (new / learning / lapsed) — one suggested, the rest counted.
  const canDrill = (id) => { const sk = skills.get(id); if (!sk || sk.set) return false; return drillable ? !!drillable(id) : sk.parse_filter != null; };
  const learnable = today.learn.filter(canDrill);
  if (learnable.length) {
    const id = learnable[0];
    const st = stateOf(id);
    lines.push({ id: 'learn', kind: 'learn', skill: id, label: st.state === 'lapsed' ? 'Re-learn' : st.state === 'learning' ? 'Continue learning' : 'Learn', detail: `${skills.get(id).title}${learnable.length > 1 ? ` (${learnable.length - 1} more this week)` : ' (new this week)'}`, minutes: LEARN_LESSON_MIN + minutesOf(LEARN_ITEMS, s), action: { view: 'learn', params: { skill: id } } });
  }
  // Practice: a 10-item mixed session while anything is in rotation.
  const rotation = [...skills.keys()].filter((id) => inRotation(stateOf(id)) && (skills.get(id)?.set ? true : canDrill(id)));
  if (rotation.length) {
    const due = today.due.length;
    const detail = `${size} items · ${due ? `${due} due skill${due === 1 ? '' : 's'}` : 'nothing due'}${today.pairs ? ` · ${today.pairs} confusion pair${today.pairs === 1 ? '' : 's'}` : ''}`;
    lines.push({ id: 'practice', kind: 'practice', label: 'Practice', detail, minutes: minutesOf(size, s), due, pairs: today.pairs, action: { view: 'session', params: { preset: 'review-heavy', size, oneSkill: null } } });
  }
  // Questions for the current week's passage: Learn while new, a set of ten when in rotation (and due or never practised).
  const qid = weekChapter != null ? `questions-${pad(weekChapter)}` : null;
  const qs = qid && skills.get(qid);
  if (qs && qs.count > 0) {
    const st = stateOf(qid);
    if (st.state === 'new' || st.state === 'learning' || st.state === 'lapsed') lines.push({ id: 'questions', kind: 'questions', skill: qid, label: 'Questions', detail: `${qs.title} · ${qs.count} items, once through`, minutes: minutesOf(qs.count + PRACTICE_ITEMS, s), action: { view: 'learn', params: { skill: qid } } });
    else if (isDue(st, now)) { const n = Math.min(PRACTICE_ITEMS, qs.count); lines.push({ id: 'questions', kind: 'questions', skill: qid, label: 'Questions', detail: `${qs.title} · ${n} due`, minutes: minutesOf(n, s), action: { view: 'session', params: { preset: 'one-skill', size: n, oneSkill: qid } } }); }
  }
  // Vocabulary due: every deck in rotation that is due, ten items each; the current week's deck first while new.
  const vid = weekChapter != null ? `vocab-${pad(weekChapter)}` : null;
  const vs = vid && skills.get(vid);
  if (vs && vs.count > 0 && ['new', 'learning', 'lapsed'].includes(stateOf(vid).state)) {
    lines.push({ id: `vocab:${vid}`, kind: 'vocab', skill: vid, label: 'Vocabulary', detail: `${vs.title} · ${vs.count} words, once through`, minutes: minutesOf(vs.count + PRACTICE_ITEMS, s), action: { view: 'learn', params: { skill: vid } } });
  }
  for (const id of [...skills.keys()].filter((k) => skills.get(k)?.set === 'vocab').sort()) {
    const st = stateOf(id);
    if (!inRotation(st) || !isDue(st, now)) continue;
    const n = Math.min(PRACTICE_ITEMS, skills.get(id).count);
    lines.push({ id: `vocab:${id}`, kind: 'vocab', skill: id, label: 'Vocabulary', detail: `${skills.get(id).title} · ${n} due`, minutes: minutesOf(n, s), action: { view: 'session', params: { preset: 'one-skill', size: n, oneSkill: id } } });
  }
  // Reading: the week's unread sentences at the study log's pace (the reader passes `unread`; the pace may be the rough one).
  if (unread > 0) {
    const perHour = typeof pace === 'number' ? pace : pace?.perHour;
    const min = perHour > 0 ? Math.max(1, Math.round((unread / perHour) * 60)) : null;
    lines.push({ id: 'read', kind: 'read', label: 'Read', detail: `${unread} sentence${unread === 1 ? '' : 's'} left this week`, minutes: min, action: { view: 'read' } });
  }
  const minutes = lines.reduce((n, l) => n + (l.minutes || 0), 0);
  return { day, dismissed: isDismissed(dismissed, day), lines, minutes, itemSeconds: s };
}

/** "about 12 min" / "under a minute". Pure. */
export function fmtMinutes(min) {
  if (min == null) return '';
  if (min < 1) return 'under a minute';
  return `about ${Math.round(min)} min`;
}
