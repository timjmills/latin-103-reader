// node --test tests/ — the wave-2 fix pass, session mix and pace
// (qa/grammar/QA-REPORT-G2.md M2, M5, M6, CR M4, CR m7, CR m4):
// the chapter-set floor as well as the ceiling, no two consecutive slots of one
// kind when both are chapter sets, requeue windows checked on both sides,
// mastery counted on spaced successes, the Today card's day-share arithmetic,
// and the capped resumable Learn batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, setFloorSlots, setSlotFits, requeue, applyAnswer, addToPractice, newState, rng, SET_MAX, SET_MIN, SET_WINDOW, MASTERED_SUCCESSES, DAY_MS } from '../app/js/grammar/scheduler.js';
import { buildToday, daysLeftInWeek, itemSecondsBy, SET_LEARN_BATCH, KIND_SECONDS } from '../app/js/grammar/today.js';
import { SET_LEARN_BATCH as SESSION_BATCH } from '../app/js/grammar/session.js';

/* --------------------------------------------------------------- fixtures */
const grammarSkill = (id) => ({ id, set: null, title: id, plain: id, kinds: ['recognise', 'chart', 'parse', 'blank'], parse_filter: { case: 'nom' }, confusable_with: [], prereqs: [] });
const setSkill = (id, set, kind) => ({ id, set, chapter: 1, title: id, plain: id, kinds: [kind], count: 30, confusable_with: [], prereqs: [] });
// Eighty-three grammar skills before six chapter sets: the book order that starved the sets in review-heavy.
const SKILLS = new Map([
  ...Array.from({ length: 20 }, (_, i) => [`g${String(i).padStart(2, '0')}`, grammarSkill(`g${String(i).padStart(2, '0')}`)]),
  ['questions-01', setSkill('questions-01', 'questions', 'question')],
  ['questions-07', setSkill('questions-07', 'questions', 'question')],
  ['vocab-01', setSkill('vocab-01', 'vocab', 'vocab')],
  ['vocab-02', setSkill('vocab-02', 'vocab', 'vocab')],
  ['pensum-01', setSkill('pensum-01', 'pensum', 'pensum')],
]);
const NOW = Date.parse('2026-09-06T12:00:00Z');
// Everything equally due, so nothing but the ordering decides — the shape of QA M2's repro.
const STATES = new Map([...SKILLS.keys()].map((id) => [id, { ...addToPractice(newState(id, NOW), NOW), due_at: new Date(NOW - 1000).toISOString(), stability_days: 2, stage: 1 }]));
const isSet = (id) => !!SKILLS.get(id)?.set;
const countSets = (plan) => plan.filter((s) => isSet(s.skill)).length;
const worstWindow = (plan) => { let worst = 0; for (let i = 0; i < plan.length; i++) { let n = 0; for (let j = i; j < Math.min(plan.length, i + SET_WINDOW); j++) if (isSet(plan[j].skill)) n += 1; worst = Math.max(worst, n); } return worst; };

/* ------------------------------------------------------------------ tests */

test('QA M2 — chapter sets have a floor as well as a ceiling: a mixed ten holds one to three of them, over many seeds and both presets', () => {
  for (const preset of ['review-heavy', 'even']) {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = buildSession({ states: STATES, skills: SKILLS, preset, size: 10, now: NOW, seed });
      const n = countSets(plan);
      assert.equal(plan.length, 10);
      assert.ok(n >= SET_MIN, `${preset} seed ${seed}: ${n} set items, the floor is ${SET_MIN}`);
      assert.ok(n <= SET_MAX, `${preset} seed ${seed}: ${n} set items, the ceiling is ${SET_MAX}`);
    }
  }
});

test('QA M2 — a fifteen-item session reserves a set slot in each window, and no window of ten ever holds four', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const plan = buildSession({ states: STATES, skills: SKILLS, preset: 'review-heavy', size: 15, now: NOW, seed });
    assert.equal(plan.length, 15);
    assert.ok(countSets(plan) >= 2, `seed ${seed}: ${countSets(plan)} set items in fifteen`);
    assert.ok(worstWindow(plan) <= SET_MAX, `seed ${seed}: a window of ten held ${worstWindow(plan)}`);
  }
});

test('QA M2 — the floor lifts when nothing is in rotation but grammar skills, and "This week" keeps its higher share', () => {
  const grammarOnly = new Map([...STATES].filter(([id]) => !isSet(id)));
  const plan = buildSession({ states: grammarOnly, skills: SKILLS, preset: 'review-heavy', size: 10, now: NOW, seed: 5 });
  assert.equal(countSets(plan), 0, 'no set is due: nothing is forced');
  // "This week" is uncapped by design, and its week list is the chapter's own sets.
  const week = ['questions-01', 'vocab-01', 'pensum-01'];
  const thisWeek = buildSession({ states: STATES, skills: SKILLS, preset: 'this-week', currentWeek: week, size: 10, now: NOW, seed: 5 });
  assert.ok(countSets(thisWeek) > SET_MAX, `this-week held only ${countSets(thisWeek)}`);
});

test('CR M4 — two chapter-set slots side by side never share a kind: a set forces its one kind, so vocab may not follow vocab', () => {
  for (const preset of ['review-heavy', 'even', 'this-week']) {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = buildSession({ states: STATES, skills: SKILLS, preset, currentWeek: ['questions-01', 'vocab-01', 'vocab-02', 'pensum-01'], size: 15, now: NOW, seed });
      for (let i = 1; i < plan.length; i++) {
        assert.notEqual(plan[i].skill, plan[i - 1].skill, `${preset} seed ${seed} at ${i}: the same skill twice`);
        assert.notEqual(plan[i].kind, plan[i - 1].kind, `${preset} seed ${seed} at ${i}: two ${plan[i].kind} items in a row`);
      }
    }
  }
});

test('setFloorSlots reserves one position per window of ten and ignores a tail of four or fewer', () => {
  const r = rng(7);
  assert.equal(setFloorSlots(10, r).size, 1);
  assert.equal(setFloorSlots(15, r).size, 2, 'a tail of five takes its own reservation');
  assert.equal(setFloorSlots(14, r).size, 1, 'a tail of four does not');
  assert.equal(setFloorSlots(13, r).size, 1);
  assert.equal(setFloorSlots(5, r).size, 1);
  assert.equal(setFloorSlots(4, r).size, 0);
  for (const i of setFloorSlots(10, r)) assert.ok(i >= 0 && i < 10);
});

test('CR m7 / QA m6 — requeue checks the chapter-set window on both sides of the insertion, since the splice shifts what follows', () => {
  const setSlot = { skill: 'vocab-01', kind: 'vocab', stage: 1 };
  const g = (i) => ({ skill: `g${String(i).padStart(2, '0')}`, kind: 'recognise', stage: 1 });
  // Three set items sit just after the insertion point: inserting a fourth would put four in one window of ten.
  const plan = [g(1), g(2), g(3), { ...setSlot, skill: 'questions-01', kind: 'question' }, g(4), { ...setSlot, skill: 'vocab-02' }, g(5), { ...setSlot, skill: 'pensum-01', kind: 'pensum' }, g(6), g(7), g(8), g(9), g(10), g(11)];
  assert.equal(setSlotFits(plan, isSet, 0), false, 'a fourth set item at the head overflows the window that follows');
  assert.equal(setSlotFits(plan, isSet, 12), false, 'and inside the window they open, still none');
  assert.equal(setSlotFits(plan, isSet, 13), true, 'past that window there is room');
  const out = requeue(plan, { skill: 'vocab-01', kind: 'vocab', stage: 1, skills: SKILLS, rand: () => 0, played: [] });
  let worst = 0;
  for (let i = 0; i < out.length; i++) { let n = 0; for (let j = i; j < Math.min(out.length, i + SET_WINDOW); j++) if (isSet(out[j].skill)) n += 1; worst = Math.max(worst, n); }
  assert.ok(worst <= SET_MAX, `a window held ${worst} set items after the re-queue`);
  assert.ok(out.some((s) => s.requeued), 'the missed item does come back');
});

test('migration 0017 — mastery counts spaced successes: answering a fresh skill all evening no longer masters it', () => {
  // Every answer given early (before due): stability grows slowly and successes_spaced never moves.
  let s = { ...addToPractice(newState('g00', NOW), NOW), due_at: new Date(NOW + 30 * DAY_MS).toISOString(), stability_days: 30 };
  for (let i = 0; i < 10; i++) s = applyAnswer(s, { correct: true, now: NOW + i * 1000 });
  assert.equal(s.successes, 10);
  assert.equal(s.successes_spaced, 0, 'not one of them was a review');
  assert.notEqual(s.state, 'mastered', 'a long stability alone is not mastery');
  // The same skill answered when it was actually due.
  let t = { ...addToPractice(newState('g01', NOW), NOW), stability_days: 30 };
  for (let i = 0; i < MASTERED_SUCCESSES; i++) t = applyAnswer(t, { correct: true, now: Date.parse(t.due_at) + 1000 });
  assert.equal(t.successes_spaced, MASTERED_SUCCESSES);
  assert.equal(t.state, 'mastered');
  // A wrong answer clears the count, as a lapse should.
  assert.equal(applyAnswer(t, { correct: false, now: NOW }).successes_spaced, 0);
  // A hinted or self-graded "partly" answer is weaker evidence and does not count either.
  let u = { ...addToPractice(newState('g02', NOW), NOW), stability_days: 30 };
  u = applyAnswer(u, { correct: true, hinted: true, now: NOW });
  assert.equal(u.successes_spaced, 0);
});

/* --------------------------------------------------------- the Today card */
const S = new Map([...SKILLS]);
const learnState = new Map();

test('QA M5 — the Read line offers a day’s share of the week, not the week', () => {
  const monday = Date.parse('2026-09-07T12:00:00');    // local Monday
  assert.equal(daysLeftInWeek(monday), 7);
  assert.equal(daysLeftInWeek(Date.parse('2026-09-13T12:00:00')), 1, 'Sunday is the last day');
  const plan = buildToday({ states: learnState, skills: S, unread: 93, pace: { perHour: 60 }, now: monday });
  const read = plan.lines.find((l) => l.kind === 'read');
  assert.equal(read.share, 14, '93 sentences over seven days');
  assert.equal(read.unread, 93);
  assert.ok(read.minutes < 20, `the line costs ${read.minutes} min, not the week’s 93`);
  assert.match(read.detail, /14 of the 93 left this week/);
  // On the last day of the week the share is the remainder, and the wording says so plainly.
  const sunday = buildToday({ states: learnState, skills: S, unread: 8, pace: { perHour: 60 }, now: Date.parse('2026-09-13T12:00:00') });
  assert.equal(sunday.lines.find((l) => l.kind === 'read').share, 8);
  assert.match(sunday.lines.find((l) => l.kind === 'read').detail, /8 sentences left this week/);
});

test('QA M5 — a Questions or Vocabulary "first pass" line costs what a sitting holds, not the whole deck', () => {
  const big = new Map([...S, ['questions-07', { ...setSkill('questions-07', 'questions', 'question'), count: 43 }], ['vocab-07', { ...setSkill('vocab-07', 'vocab', 'vocab'), count: 52 }]]);
  const plan = buildToday({ states: new Map(), skills: big, weekChapter: 7, now: NOW });
  const q = plan.lines.find((l) => l.kind === 'questions');
  const v = plan.lines.find((l) => l.kind === 'vocab');
  assert.match(q.detail, new RegExp(`${SET_LEARN_BATCH} of 43, first pass`));
  assert.match(v.detail, new RegExp(`${SET_LEARN_BATCH} of 52 words, first pass`));
  // …and the estimate is the batch plus the blocked ten, at the kind's own pace — not 53 items at 25 s.
  assert.ok(q.minutes <= Math.ceil(((SET_LEARN_BATCH + 10) * KIND_SECONDS.question) / 60), `questions: ${q.minutes} min`);
  assert.ok(v.minutes < 10, `vocabulary: ${v.minutes} min for ${SET_LEARN_BATCH} words plus ten`);
  assert.equal(SESSION_BATCH, SET_LEARN_BATCH, 'the card and the Learn runner agree on the batch');
});

test('QA M6 — the pace is per kind: a recognition tap and a translation are not costed the same', () => {
  const secondsFor = itemSecondsBy([]);
  assert.equal(secondsFor('vocab'), KIND_SECONDS.vocab);
  assert.equal(secondsFor('translate'), KIND_SECONDS.translate);
  assert.ok(secondsFor('translate') > secondsFor('vocab') * 3);
  // Once the log holds twenty of a kind, that kind's own median wins; other kinds keep their own.
  const log = [...Array.from({ length: 25 }, () => ({ kind: 'vocab', ms: 4000 })), ...Array.from({ length: 25 }, () => ({ kind: 'translate', ms: 110000 }))];
  const learned = itemSecondsBy(log);
  assert.equal(learned('vocab'), 5, 'clamped at the five-second floor');
  assert.equal(learned('translate'), 110);
});
