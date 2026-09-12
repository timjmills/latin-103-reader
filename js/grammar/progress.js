// How far through a skill the learner is, as parts (learner, 2026-09-12: "use
// a bit of color to show how many parts of a lesson skill extra have been
// practice … so that it becomes like a progress sheet"). Pure helpers only, no
// DOM and no storage: everything a part is decided by arrives as an argument,
// which is what makes the whole thing testable and is how chapter.js next door
// already works. The selection page paints these; it does not compute them.
//
// The vocabulary is chapter.js's: `total` is what there is, `done` what is
// finished, `rotation` means in mixed practice, and a summary line states
// counts and never praises. Colour is not decided here — `level` says which of
// four bands a row is in and the CSS owns what that looks like.
//
// **A part a skill cannot have is not a part it is failing.** A metre skill has
// nothing to drill and no table; a vocabulary deck has no paradigm; a pensum is
// practised and never learned in a sitting (ui.js: "pensa are practised, never
// learned in a sitting"). `total` counts only the parts that skill can have, so
// those rows can still reach the end of their own sheet. Counting the whole
// list every time would leave a quarter of the map permanently unfinishable,
// which is the opposite of what was asked for.

import { STATES, learnCriterion, LEARN_NEEDED, LEARN_WINDOW, MASTERED_SUCCESSES, DAY_MS } from './scheduler.js';
import { fmtStability } from './stats.js';

/**
 * The states that mean "this is in mixed practice". Lapsed is one of them, and
 * deliberately: chapter.js counts it the same way. The learner did put the
 * skill into the rotation, and a fortnight away from the app must not untick a
 * part they finished — a progress sheet whose ticks come off by themselves is
 * a nag, not a record. The lapse shows in that part's `detail` instead.
 */
const ROTATION = new Set(['practising', 'mastered', 'lapsed']);

/**
 * What "practised" means: the blocked set of §10 — "ten items on that skill
 * only" — so the bar is the contract's own number rather than one invented for
 * this sheet. Held here and not imported from session.js, which would drag the
 * whole item engine into a module that must stay a page of arithmetic.
 */
export const PRACTICE_ITEMS = 10;

/**
 * The parts a skill can have, in the order they should be shown: the order a
 * learner meets them, from opening the lesson to the scheduler calling it
 * mastered. `key` is stable and is what the view keys its markup off; `blurb`
 * is the one-line "what this part is" the hover shows beside the label.
 *
 * Three things that look like parts are deliberately absent, because nothing
 * durable records them and a part that can never tick is worse than no part:
 *
 *   the same-session re-test   the offer is a list in localStorage that is
 *                              *deleted* when the re-test is taken, and its
 *                              three items land in the log as ordinary
 *                              practice attempts — so "taken" is unreadable
 *   the confusable pair        a pair session's attempts carry no marker; the
 *                              confusion rows say what was mixed up, which is
 *                              the opposite of having sorted it out
 *   the reading tie-in         nothing is written down when the learner opens
 *                              the chapter with the occurrences lit
 *
 * Each would sit on all 88 rows as a permanent blank. They are worth having;
 * they want a marker written first, and that is not this file's to add.
 */
export const PARTS = Object.freeze([
  Object.freeze({ key: 'lesson', label: 'Lesson', blurb: 'the teaching steps, read through' }),
  Object.freeze({ key: 'learn', label: 'Learn passed', blurb: `${LEARN_NEEDED} right of the last ${LEARN_WINDOW} at the end of Learn, across two kinds` }),
  Object.freeze({ key: 'practice', label: 'Practised', blurb: `a blocked set of ${PRACTICE_ITEMS} on this skill alone` }),
  Object.freeze({ key: 'chart', label: 'Chart', blurb: 'its paradigm table filled in, cell by cell' }),
  Object.freeze({ key: 'generated', label: 'Made-up sentences', blurb: 'practice past the written twelve' }),
  Object.freeze({ key: 'rotation', label: 'In mixed practice', blurb: 'in the rotation, coming back on its own schedule' }),
  Object.freeze({ key: 'mastered', label: 'Mastered', blurb: `${MASTERED_SUCCESSES} spaced successes and three weeks of stability` }),
]);

const PART_BY_KEY = new Map(PARTS.map((p) => [p.key, p]));

/** A skill row from a row or a bare id — an id alone is a skill nothing is known about, not a broken one. Pure. */
const asSkill = (s) => (typeof s === 'string' ? { id: s } : (s && typeof s === 'object' ? s : {}));

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ms = (v) => { if (!v) return 0; const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/** How many cells of a table are known to be answered right, from whichever shape the caller has to hand. */
const cellsMet = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return int(v);
  if (v instanceof Set) return v.size;
  return Array.isArray(v) ? new Set(v).size : 0;
};

/** "now" / "tomorrow" / "in 6 days" / "3 days ago" — the next review said the way a person would. Pure. */
function whenDue(at, now) {
  const t = ms(at);
  if (!t) return 'now';
  const days = Math.round((t - now) / DAY_MS);
  if (days <= 0) return days < -1 ? `${Math.abs(days)} days ago` : 'now';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/**
 * What the attempt log says about one skill, counted in a single pass.
 * `null` when the caller did not hand one in: *unknown* and *none* are
 * different, and a part must never be described from evidence nobody supplied.
 *
 * The Learn pass is replayed exactly as stats.js's `progressTrail` replays it —
 * consecutive learn-mode attempts are a run, and a run is judged by
 * `learnCriterion` when practice resumes or when the log ends — because
 * `skill_state` keeps only today's row and a pass leaves no other trace.
 */
function readLog(attempts) {
  if (!Array.isArray(attempts)) return null;
  const out = { learn: 0, learnPasses: 0, lastRun: null, practice: 0, practiceRight: 0, generated: 0, cells: 0 };
  let run = [];
  const close = () => {
    if (!run.length) return;
    const judged = learnCriterion(run);
    if (judged.passed) out.learnPasses += 1;
    out.lastRun = judged;
    run = [];
  };
  for (const a of attempts) {
    if (!a) continue;
    if (a.meta?.generated) out.generated += 1;
    // A cell answered right is a cell answered right whichever mode asked it: §12's own `metCells`
    // is filled by any chart submitted, and Learn's chart checks are the same boxes.
    if (a.kind === 'chart' && a.correct) out.cells += 1;
    if (a.mode === 'learn') { out.learn += 1; run.push(a); continue; }
    close();
    out.practice += 1;
    if (a.correct) out.practiceRight += 1;
  }
  close();
  return out;
}

/**
 * Which parts this skill can have at all, and why each is or is not one of
 * them. Everything here is a fact about the skill and its material, never
 * about what the learner has done.
 */
function partKeys(skill, { drillable, hasBank }) {
  const set = skill.set ?? null;
  const keys = [];
  // A pensum is the one thing with no Learn of any shape; everything else has a lesson or a deck to walk.
  if (set !== 'pensum') keys.push('lesson');
  // The checks at the end of Learn are drill items. A skill that cannot produce one — the two metre skills,
  // which are taught and read and never parsed — has no criterion to meet, so it is not short of one.
  if (set !== 'pensum' && drillable) keys.push('learn');
  if (drillable) keys.push('practice');
  // A table is a part only for a skill that names one in the catalogue. A construction and a chapter deck
  // have no chart to fill, and asking them for one would hold them to somebody else's sheet.
  if (Array.isArray(skill.paradigms) && skill.paradigms.length) keys.push('chart');
  // §11's endless supply of made-up sentences, where a bank has been built for the skill.
  if (hasBank) keys.push('generated');
  if (drillable) keys.push('rotation', 'mastered');
  return PARTS.filter((p) => keys.includes(p.key)).map((p) => p.key);
}

/**
 * How far through a skill the learner is.
 *
 * @param {object|string} skill  the skill row (or a chapter-set pseudo-skill from sets.js);
 *                               a bare id is read as a skill nothing is known about
 * @param {object} o  every field optional, and the defaults are the honest ones:
 *   now        {number}   the clock, for "due in 3 days" (default Date.now())
 *   state      {object}   the skill_state row, already decayed — `decay(gstore.getState(id) ?? …)`.
 *                         null means never touched, which is not the same as `new` with a history.
 *   attempts   {Array}    this skill's attempt rows oldest first (`gstore.getAttempts({ skill })`).
 *                         **null means unknown**, `[]` means none: unknown suppresses a `detail`
 *                         rather than asserting a part is unstarted on no evidence.
 *   learn      {object}   where the learner is in Learn: `{ step }` for a skill, `{ seen }` for a deck.
 *                         The app clears it on a pass, so it only ever describes an unfinished one.
 *   steps      {number}   how many teach steps the lesson has, when the caller has the lesson to hand.
 *                         Without it a half-read lesson still says which step, just not out of how many —
 *                         and a skill with nothing drillable needs it to show its lesson finished at all.
 *   drillable  {boolean}  whether the skill can produce a drill item (`ctx.drillable`). Default true.
 *   hasBank    {boolean}  whether a generated bank exists for it (§11b). Default false.
 *   metCells   {Set|Array|number}  cells of its table(s) answered right. null = unknown.
 *   cellCount  {number}   how many cells those tables hold. 0 = unknown, and the chart part then falls
 *                         back to the durable evidence (chart items answered right) instead of a fraction.
 *
 * @returns {{ parts: Array<{key,label,blurb,done,detail}>, done: number, total: number,
 *            ratio: number, level: 'none'|'started'|'most'|'all', summary: string }}
 *          `parts` holds only the parts this skill can have, in PARTS order, so
 *          `parts.length === total`. `detail` is the sentence the hover shows
 *          for that part, or null when there is honestly nothing to say.
 */
export function skillProgress(skill, o = {}) {
  const s = asSkill(skill);
  const {
    now = Date.now(), state = null, attempts = null, learn = null, steps = 0,
    drillable = true, hasBank = false, metCells = null, cellCount = 0,
  } = o ?? {};

  const log = readLog(attempts);
  const nSteps = int(steps);
  const place = learn && typeof learn === 'object' ? learn : null;
  const atStep = int(place?.step);
  const seen = int(place?.seen);
  const deck = int(s.count);
  const named = STATES.includes(state?.state) ? state.state : null;
  const met = cellsMet(metCells);
  const cells = int(cellCount);

  /** One part: whether it is done, and the sentence that says what there is to say about it. */
  const decide = (key) => {
    switch (key) {
      case 'lesson': {
        // Reaching the checks is proof the steps were read: Learn only asks them once the steps are behind
        // the learner. "Just drill it" skips the lesson entirely (§10), so a practice attempt proves nothing here.
        if (log?.learn) return [true, `${plural(log.learn, 'item')} answered in Learn`];
        // The app writes the last step down as the learner leaves the steps for the ten, so a place that has
        // reached the end is a lesson read even when the ten was never taken — which is the only way a skill
        // with nothing drillable can finish this part at all.
        if (nSteps && atStep >= nSteps) return [true, `all ${plural(nSteps, 'step')} read`];
        if (atStep) return [false, `at step ${atStep}${nSteps ? ` of ${nSteps}` : ''}`];
        if (seen) return [false, `${seen} of ${deck || '?'} seen`];
        return [false, null];
      }
      case 'learn': {
        if (log?.learnPasses) return [true, log.learnPasses > 1 ? `passed ${log.learnPasses} times` : 'passed'];
        const r = log?.lastRun;
        if (r?.total) return [false, `${r.correct} right of the last ${r.total} — ${LEARN_NEEDED} of ${LEARN_WINDOW} needed, across two kinds`];
        return [false, null];
      }
      case 'practice': {
        if (!log) return [false, null];
        if (log.practice >= PRACTICE_ITEMS) return [true, `${plural(log.practice, 'item')}, ${log.practiceRight} right`];
        if (log.practice) return [false, `${log.practice} of ${PRACTICE_ITEMS} items so far`];
        return [false, null];
      }
      case 'chart': {
        // With the table's size known this is the real thing: every cell answered right at least once.
        if (cells) return [met >= cells, `${met} of ${plural(cells, 'cell')} answered right`];
        // Without it, the log still knows how many chart cells were answered right, which is durable where the
        // app's own `metCells` is not — it is rebuilt each sitting. Weaker, and it says only what it knows.
        if (log?.cells) return [true, `${plural(log.cells, 'cell')} answered right`];
        return [false, null];
      }
      case 'generated': {
        if (log?.generated) return [true, `${plural(log.generated, 'made-up sentence')} answered`];
        return [false, null];
      }
      case 'rotation': {
        if (!named || !ROTATION.has(named)) return [false, null];
        if (named === 'lapsed') return [true, 'in mixed practice, but lapsed — it is overdue'];
        return [true, `next review ${whenDue(state.due_at, now)}`];
      }
      case 'mastered': {
        if (named === 'mastered') return [true, `stable for ${fmtStability(state.stability_days)}`];
        const k = int(state?.successes_spaced);
        if (k) return [false, `${k} of ${MASTERED_SUCCESSES} spaced successes`];
        return [false, null];
      }
      default: return [false, null];
    }
  };

  const parts = partKeys(s, { drillable: !!drillable, hasBank: !!hasBank }).map((key) => {
    const { label, blurb } = PART_BY_KEY.get(key);
    const [done, detail] = decide(key);
    return { key, label, blurb, done: !!done, detail: detail ?? null };
  });

  const total = parts.length;
  const done = parts.filter((p) => p.done).length;
  const ratio = total ? done / total : 0;
  // Four bands, and "most" means what the word means — more than half of them. Nothing rounds up: a skill
  // with none of its parts done is 'none', however much of the lesson has been read.
  const level = !total || !done ? 'none' : done === total ? 'all' : ratio > 0.5 ? 'most' : 'started';
  return { parts, done, total, ratio, level, summary: summaryOf(parts, done, total) };
}

/** How many of what is left to name in the summary before it stops being a line and becomes a list. */
const NAME_LIMIT = 2;

/** One quiet line for a row: counts, and what is still to do. No praise — chapterSummary's register. Pure. */
function summaryOf(parts, done, total) {
  if (!total) return 'nothing here to work through';
  if (!done) return `not started · ${plural(total, 'part')}`;
  if (done === total) return `all ${plural(total, 'part')} done`;
  const left = parts.filter((p) => !p.done).map((p) => p.label);
  const named = left.slice(0, NAME_LIMIT);
  const rest = left.length - named.length;
  const list = rest ? `${named.join(', ')} and ${rest} more` : named.length === 2 ? named.join(' and ') : named[0];
  return `${done} of ${total} parts · still to do: ${list}`;
}

/**
 * One line for a whole list of skills, for the top of the selection page.
 * `rows` are results of `skillProgress` (anything carrying numeric `done` and
 * `total` will do). A row with no parts at all is left out of the denominator —
 * it has nothing to work through, so counting it would make the page's own
 * total disagree with the rows under it. Pure.
 */
export function progressSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && Number(r.total) > 0);
  if (!list.length) return 'nothing here to work through yet';
  const full = list.filter((r) => Number(r.done) >= Number(r.total)).length;
  const started = list.filter((r) => Number(r.done) > 0).length;
  const line = `${full} of ${plural(list.length, 'skill')} fully worked through`;
  // Only when it adds something: with every started skill also finished, the count would repeat itself.
  return started > full ? `${line} · ${started} started` : line;
}
