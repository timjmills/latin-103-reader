/**
 * The study plan (2026-10-27: "I have until December 15 to master this grammar material — help me design a plan and
 * work it into the program"; all 88 skills and their tables, 45–60 minutes a day, six days a week). Pure: what today
 * holds, from the course order, what is learnt, today's date and the plan's dates.
 *
 *   learn   (start → learnBy)  every skill not yet learnt, spread over the study days left, in course order
 *   master  (after learnBy → goal)  no new skill: review, mixed practice, the weakest tables, until all is mastered
 *   rest    the weekday kept free (Sunday unless chosen otherwise)
 *
 * A day missed spreads its skills over the days left, so the plan is always the remaining work over the remaining days.
 */
// `classWeek1`: the day of the first class (Saturday 5 September 2026: week 9, Cap. XXXI, is Saturday 31 October).
export const DEFAULT_PLAN = Object.freeze({ goal: '2026-12-15', learnBy: '2026-11-24', rest: 0, classWeek1: '2026-09-05' });

/** 'YYYY-MM-DD' of a date, in local time. */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

/** The study days from `from` to `to`, both included, the rest weekday left out. */
export function studyDays(from, to, rest = DEFAULT_PLAN.rest) {
  const out = [];
  const d = parse(from);
  const end = parse(to);
  for (let i = 0; d <= end && i < 400; i++, d.setDate(d.getDate() + 1)) if (d.getDay() !== Number(rest)) out.push(isoDay(d));
  return out;
}

const COURSE_WEEKS = 14;
/**
 * The class this week (2026-10-30: "weave in the week's new learning as well so that I am prepared for class"): the
 * course week whose class is today or next, counted from the first class, and that class's day. Pure.
 */
export function classWeekOf(today = isoDay(), week1 = DEFAULT_PLAN.classWeek1) {
  const days = Math.round((parse(today) - parse(week1)) / 864e5);
  const n = Math.min(COURSE_WEEKS, Math.max(1, Math.floor((days + 6) / 7) + 1));
  const d = parse(week1);
  d.setDate(d.getDate() + 7 * (n - 1));
  return { n, classDay: isoDay(d), over: days > 7 * (COURSE_WEEKS - 1) };
}

/**
 * Today's part of the plan.
 * `order`: every skill in course order; `learned`: a Set of those learnt; `today`: 'YYYY-MM-DD';
 * `plan`: { goal, learnBy, rest, start } (start: the day the plan began, for the pace).
 */
export function planToday({ order = [], learned = new Set(), today = isoDay(), plan = DEFAULT_PLAN, classSkills = [] } = {}) {
  const p = { ...DEFAULT_PLAN, ...(plan ?? {}) };
  const total = order.length;
  const remaining = order.filter((id) => !learned.has(id));
  const done = total - remaining.length;
  const daysLeft = today > p.goal ? 0 : studyDays(today, p.goal, p.rest).length;
  const learnDaysLeft = today > p.learnBy ? 0 : studyDays(today, p.learnBy, p.rest).length;
  const isRest = parse(today).getDay() === Number(p.rest);
  // The pace: how many should be learnt by the start of today, on a straight line from the plan's start to learnBy.
  const start = p.start && p.start <= today ? p.start : today;
  const all = studyDays(start, p.learnBy, p.rest).length || 1;
  const gone = today <= start ? 0 : studyDays(start, isoDay(new Date(parse(today).getTime() - 864e5)), p.rest).length;
  const startDone = Math.max(0, Math.min(total, Number(p.startDone) || 0));
  const expected = Math.min(total, startDone + Math.round(((total - startDone) * gone) / all));
  const status = remaining.length === 0 ? 'learnt' : done >= expected + 2 ? 'ahead' : done + 2 < expected ? 'behind' : 'on-track';
  let kind;
  let newToday = [];
  if (today > p.goal) kind = 'past';
  else if (isRest) kind = 'rest';
  else if (learnDaysLeft > 0 && remaining.length) {
    kind = 'learn';
    newToday = remaining.slice(0, Math.ceil(remaining.length / learnDaysLeft));
  } else {
    kind = 'master';
    // Past learnBy with skills still to learn: two a day until none are left, beside the mastery work.
    newToday = remaining.slice(0, 2);
  }
  // This week's class first: its skills not yet learnt are spread over the days before the class (all of them on the
  // class day itself), ahead of the course order, and count towards the day's share.
  const cls = classWeekOf(today, p.classWeek1);
  const classLeft = classSkills.filter((id) => order.includes(id) && !learned.has(id));
  let classNew = [];
  if (classLeft.length && kind !== 'past' && !cls.over) {
    const before = new Date(parse(cls.classDay).getTime() - 864e5);
    const daysTo = Math.max(1, today < cls.classDay ? studyDays(today, isoDay(before), p.rest).length : 1);
    classNew = isRest ? [] : classLeft.slice(0, Math.ceil(classLeft.length / daysTo));
    if (classNew.length) {
      if (kind === 'rest') kind = 'learn';
      const share = newToday.length;
      newToday = [...classNew, ...newToday.filter((id) => !classNew.includes(id)).slice(0, Math.max(0, share - classNew.length))];
    }
  }
  return { kind, newToday, classNew, classWeek: cls.n, classDay: cls.classDay, classLeft: classLeft.length, total, done, remaining: remaining.length, daysLeft, learnDaysLeft, expected, status, plan: p, isRest };
}
