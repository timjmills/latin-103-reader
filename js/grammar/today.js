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
/** A set's Learn is a capped batch, not the whole deck (session.js SET_LEARN_BATCH): what one sitting actually holds. */
export const SET_LEARN_BATCH = 15;
export const LEARN_BLOCKED_ITEMS = 10;
/** One attempt counts for at most two minutes: an item left open while the learner walks away is not evidence of pace. */
export const ATTEMPT_CAP_MS = 120000;
/** The sane range a per-item estimate is clamped to. A tap is never under five seconds; nothing is over two minutes. */
export const ITEM_S_MIN = 5;
export const ITEM_S_MAX = 120;
/** What each kind plausibly costs before the log says otherwise: a recognition tap is not a translation. */
export const KIND_SECONDS = Object.freeze({ recognise: 12, chart: 30, parse: 20, blank: 20, transform: 35, reorder: 40, translate: 90, question: 25, vocab: 12, pensum: 30 });
const pad = (n) => String(n).padStart(2, '0');

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/**
 * Seconds per item from the attempt log: the **median** of the last 200
 * attempts of that kind once twenty exist, each attempt capped at two minutes
 * first, the result clamped to 5–120 s. One mean across every kind was wrong in
 * principle (a `recognise` tap is five seconds, a `translate` is minutes) and a
 * single abandoned item pinned every estimate at the clamp (QA M6). Pure.
 */
export function itemSeconds(attempts, { min = PACE_MIN_ATTEMPTS, fallback = DEFAULT_ITEM_S, kind = null } = {}) {
  const timed = (attempts || []).filter((a) => Number(a?.ms) > 0 && (kind == null || a.kind === kind)).slice(-200);
  if (timed.length < min) return fallback;
  const mid = median(timed.map((a) => Math.min(ATTEMPT_CAP_MS, Number(a.ms)))) / 1000;
  return Math.max(ITEM_S_MIN, Math.min(ITEM_S_MAX, Math.round(mid)));
}
/** `secondsFor(kind)` — the kind's own pace where the log has one, the overall pace otherwise, the kind's default until then. Pure. */
export function itemSecondsBy(attempts) {
  const overall = itemSeconds(attempts);
  const memo = new Map();
  return (kind = null) => {
    if (!kind) return overall;
    if (!memo.has(kind)) memo.set(kind, itemSeconds(attempts, { kind, fallback: KIND_SECONDS[kind] ?? overall }));
    return memo.get(kind);
  };
}
const minutesOf = (items, s) => Math.max(1, Math.round((items * s) / 60));
/** Days left in the reading week, today included: Monday 7 … Sunday 1. Pure. */
export function daysLeftInWeek(now = Date.now()) {
  const d = new Date(now).getDay();          // 0 = Sunday
  return 7 - ((d + 6) % 7);
}

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
  const secondsFor = itemSecondsBy(attempts);
  const s = secondsFor();
  const stateOf = (id) => decay(states.get(id) ?? newState(id, now), now);
  const lines = [];
  const today = suggestToday({ states, skills, currentWeek, now });

  // Learn: the week's first unlearned grammar skill (new / learning / lapsed) — one suggested, the rest counted.
  const canDrill = (id) => { const sk = skills.get(id); if (!sk || sk.set) return false; return drillable ? !!drillable(id) : sk.parse_filter != null; };
  const learnable = today.learn.filter(canDrill);
  if (learnable.length) {
    const id = learnable[0];
    const st = stateOf(id);
    // "(new this week)" only when the skill really is new: a lapsed skill re-read "Re-learn · … (new this week)" (m9).
    const more = learnable.length > 1 ? ` (${learnable.length - 1} more this week)` : st.state === 'new' ? ' (new this week)' : '';
    lines.push({ id: 'learn', kind: 'learn', skill: id, label: st.state === 'lapsed' ? 'Re-learn' : st.state === 'learning' ? 'Continue learning' : 'Learn', detail: `${skills.get(id).title}${more}`, minutes: LEARN_LESSON_MIN + minutesOf(LEARN_ITEMS, s), action: { view: 'learn', params: { skill: id } } });
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
    // What a sitting actually holds: a batch of the deck, then the blocked ten — not all 43 questions at once (QA M5).
    if (st.state === 'new' || st.state === 'learning' || st.state === 'lapsed') {
      const n = Math.min(SET_LEARN_BATCH, qs.count);
      lines.push({ id: 'questions', kind: 'questions', skill: qid, label: 'Questions', detail: `${qs.title} · ${n}${qs.count > n ? ` of ${qs.count}` : ''}, first pass`, minutes: minutesOf(n + LEARN_BLOCKED_ITEMS, secondsFor('question')), action: { view: 'learn', params: { skill: qid } } });
    } else if (isDue(st, now)) { const n = Math.min(PRACTICE_ITEMS, qs.count); lines.push({ id: 'questions', kind: 'questions', skill: qid, label: 'Questions', detail: `${qs.title} · ${n} due`, minutes: minutesOf(n, secondsFor('question')), action: { view: 'session', params: { preset: 'one-skill', size: n, oneSkill: qid } } }); }
  }
  // Vocabulary due: every deck in rotation that is due, ten items each; the current week's deck first while new.
  const vid = weekChapter != null ? `vocab-${pad(weekChapter)}` : null;
  const vs = vid && skills.get(vid);
  if (vs && vs.count > 0 && ['new', 'learning', 'lapsed'].includes(stateOf(vid).state)) {
    const n = Math.min(SET_LEARN_BATCH, vs.count);
    lines.push({ id: `vocab:${vid}`, kind: 'vocab', skill: vid, label: 'Vocabulary', detail: `${vs.title} · ${n}${vs.count > n ? ` of ${vs.count}` : ''} words, first pass`, minutes: minutesOf(n + LEARN_BLOCKED_ITEMS, secondsFor('vocab')), action: { view: 'learn', params: { skill: vid } } });
  }
  for (const id of [...skills.keys()].filter((k) => skills.get(k)?.set === 'vocab').sort()) {
    const st = stateOf(id);
    if (!inRotation(st) || !isDue(st, now)) continue;
    const n = Math.min(PRACTICE_ITEMS, skills.get(id).count);
    lines.push({ id: `vocab:${id}`, kind: 'vocab', skill: id, label: 'Vocabulary', detail: `${skills.get(id).title} · ${n} due`, minutes: minutesOf(n, secondsFor('vocab')), action: { view: 'session', params: { preset: 'one-skill', size: n, oneSkill: id } } });
  }
  // Reading: the week's unread sentences at the study log's pace (the reader passes `unread`; the pace may be the rough one).
  if (unread > 0) {
    // A day's share of the week, not the week (QA M5): the card is a suggestion for today, and summing a week's
    // reading into "Today · about 109 min" made it read as a quota.
    const left = Math.max(1, daysLeftInWeek(now));
    const share = Math.max(1, Math.min(unread, Math.ceil(unread / left)));
    const perHour = typeof pace === 'number' ? pace : pace?.perHour;
    const min = perHour > 0 ? Math.max(1, Math.round((share / perHour) * 60)) : null;
    const detail = share < unread ? `${share} of the ${unread} left this week · ${left} day${left === 1 ? '' : 's'} to go` : `${unread} sentence${unread === 1 ? '' : 's'} left this week`;
    lines.push({ id: 'read', kind: 'read', label: 'Read', detail, minutes: min, share, unread, daysLeft: left, action: { view: 'read' } });
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
