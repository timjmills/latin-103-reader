// node --test tests/ — the wave-3 fixes (qa/grammar/CODE-REVIEW-G3.md and
// qa/grammar/QA-REPORT-G3.md). Everything here is pure: the drillable memo is
// exported from index.js precisely so the sequence that broke it can be
// reproduced without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrillableMemo } from '../app/js/grammar/index.js';
import { skillHistory, progressTrail, dayList, perDay } from '../app/js/grammar/stats.js';
import { requeue, buildPairSession, newState, passLearn, applyAnswer } from '../app/js/grammar/scheduler.js';
import { sessionCeiling } from '../app/js/grammar/session.js';
import { captionFor } from '../app/js/grammar/print.js';

/* ------------------------------------------------- QA-1: the drillable memo */

const SKILLS = new Map([
  ['dative-indirect-object', { id: 'dative-indirect-object', kinds: ['recognise', 'chart', 'parse', 'blank'] }],
  ['ablative-time', { id: 'ablative-time', kinds: ['recognise', 'chart', 'parse', 'blank'] }],
  ['genitive-possession', { id: 'genitive-possession', kinds: ['recognise', 'chart'] }],
  ['vocab-07', { id: 'vocab-07', set: 'vocab', kinds: ['vocab'] }],
]);

test('QA-1: the light Today-card path cannot poison the memo — a miss with no generator is never cached', () => {
  // The exact sequence: the learner was last reading, the weeks menu is opened (lightInit builds a `ui`
  // with ctx.items still null), setSection('grammar') repaints the map from it, and only then does
  // init() build the generator. Before the fix every row the light paint touched was cached `false`
  // and stayed false for the rest of the session — 83 of 87 skills lost every action but Lesson.
  let items = null;
  const asked = [];
  const memo = createDrillableMemo({ items: () => items, skills: () => SKILLS });

  // 1. the weeks menu opens: no generator yet.
  for (const id of SKILLS.keys()) assert.equal(memo.drillable(id), false, `${id} answers false while there is no generator`);
  assert.equal(memo.size, 0, 'and nothing at all is remembered');

  // 2. init() finishes and the real generator arrives.
  items = { drillable: (id) => { asked.push(id); return id !== 'ablative-time'; } };
  assert.equal(memo.drillable('dative-indirect-object'), true, 'the map now paints the truth');
  assert.equal(memo.drillable('genitive-possession'), true);
  assert.equal(memo.drillable('ablative-time'), false, 'a real miss is still a miss');

  // 3. …and the truth is what is remembered from here on.
  const before = asked.length;
  memo.drillable('dative-indirect-object');
  assert.equal(asked.length, before, 'a cached hit does not scan the library again');
});

test('QA-1: a chapter set is never memoised, and buildSets clears the memo', () => {
  let drillable = true;
  const memo = createDrillableMemo({ items: () => ({ drillable: () => drillable }), skills: () => SKILLS });
  assert.equal(memo.drillable('vocab-07'), true);
  drillable = false;
  assert.equal(memo.drillable('vocab-07'), false, 'a deck is asked afresh: its pool changes as the learner works');
  assert.equal(memo.size, 0);

  drillable = true;
  assert.equal(memo.drillable('dative-indirect-object'), true);
  assert.equal(memo.size, 1);
  drillable = false;
  assert.equal(memo.drillable('dative-indirect-object'), true, 'a grammar skill is memoised…');
  memo.clear();   // what buildSets() does when the generator is rebuilt
  assert.equal(memo.drillable('dative-indirect-object'), false, '…until the generator is rebuilt');
});

/* ------------------------------------ QA-B2: the history counts add up */

const at = (d, h = 10) => new Date(Date.UTC(2026, 7, d, h)).toISOString();
const attempt = (o) => ({ skill: 'dative-indirect-object', kind: 'recognise', mode: 'practice', item_key: 'k', correct: true, hinted: false, self: false, answer: '', expected: '', ms: 5000, ...o });

test('QA-B2: the lifetime total is passed in, so the parts sum to the window and the note can appear', () => {
  const rows = Array.from({ length: 400 }, (_, i) => attempt({ at: at(1 + (i % 20)), correct: i % 3 !== 0, hinted: i % 7 === 0 }));
  const h = skillHistory(rows, { max: 400, total: 3035 });
  assert.equal(h.total, 3035, 'the store knows the lifetime count; the trimmed list does not');
  assert.equal(h.read, 400);
  assert.equal(h.windowed, true, 'so the explaining sentence is reachable at last');
  assert.equal(h.counts.right + h.counts.hinted + h.counts.wrong, h.read, 'the parts sum to what they count');

  // Without a total it still behaves as before, and a stale total is never allowed to under-count.
  assert.equal(skillHistory(rows, { max: 400 }).total, 400);
  assert.equal(skillHistory(rows, { max: 400 }).windowed, false);
  assert.equal(skillHistory(rows, { max: 400, total: 12 }).total, 400, 'never fewer than the rows in hand');
});

/* --------------------------------------- G3-07: the day strip across a DST change */

test('G3-07: the day strip is calendar arithmetic, so no day is lost or doubled across a clock change', () => {
  // Every window, at every hour of a year, must hold `days` distinct consecutive local dates.
  for (const days of [7, 21]) {
    for (let d = 0; d < 365; d += 1) {
      const now = new Date(2026, 0, 1, 1, 30).getTime() + d * 24 * 60 * 60 * 1000;
      const list = dayList(days, now);
      assert.equal(list.length, days);
      assert.equal(new Set(list).size, days, `duplicate day in the strip at day ${d}`);
    }
  }
  const list = dayList(3, new Date(2026, 2, 10, 9).getTime());
  assert.deepEqual(list, ['2026-03-08', '2026-03-09', '2026-03-10'], 'oldest first, ending today');
  // perDay buckets into that same list.
  const rows = perDay([{ at: new Date(2026, 2, 9, 12).toISOString(), correct: true }], { days: 3, now: new Date(2026, 2, 10, 9).getTime() });
  assert.deepEqual(rows.map((r) => r.items), [0, 1, 0]);
});

/* ------------------------- G3-05: the replayed curve starts from the right state */

test('G3-05: Learn’s own pass is replayed, so the first practice answer is judged early, not due', () => {
  // A real Learn sitting: five guided, ten blocked, eight of them right across two kinds — the
  // criterion the flow tests. Then the learner practises the same evening.
  const learn = [
    ...Array.from({ length: 5 }, (_, i) => attempt({ at: at(1, 9), mode: 'learn', kind: 'recognise', correct: i < 4 })),
    ...Array.from({ length: 10 }, (_, i) => attempt({ at: at(1, 10), mode: 'learn', kind: i % 2 ? 'chart' : 'recognise', correct: i < 8 })),
  ];
  const rows = [...learn, attempt({ at: at(1, 11), correct: true, ms: 3000 })];
  const { trail, stageChanges, learnPasses } = progressTrail(rows);
  assert.equal(learnPasses, 1, 'the criterion passed once, at the end of the blocked ten');
  assert.equal(trail[trail.length - 2].stability, 1, 'passLearn leaves one day of stability');
  assert.ok(stageChanges.some((c) => c.from === 1 && c.to === 2), 'and stage 2');

  // The point after it is what the live scheduler would have written, not a due review's ×1.7/×2.2.
  const real = applyAnswer(passLearn(newState('dative-indirect-object', Date.parse(at(1, 10))), Date.parse(at(1, 10))), { correct: true, ms: 3000, now: Date.parse(at(1, 11)) });
  assert.equal(trail[trail.length - 1].stability, real.stability_days);
  assert.equal(trail[trail.length - 1].stability, 1.2, 'answered before it was due: the hinted factor at most');
});

test('G3-05: a run of Learn attempts that misses the criterion changes nothing', () => {
  const rows = Array.from({ length: 10 }, (_, i) => attempt({ at: at(1), mode: 'learn', kind: 'recognise', correct: i < 3 }));
  const { trail, learnPasses } = progressTrail(rows);
  assert.equal(learnPasses, 0);
  assert.equal(trail[trail.length - 1].stability, newState('x').stability_days);
  assert.equal(trail[trail.length - 1].stage, 1);
});

test('G3-05: a self-graded "partly" replays as the hold the scheduler applied, not as a hinted correct', () => {
  const base = { at: at(2), kind: 'translate', correct: true, hinted: true, ms: 9000 };
  const partly = progressTrail([attempt({ ...base, self: 'partly' })]).trail[0].stability;
  const right = progressTrail([attempt({ ...base, self: 'right' })]).trail[0].stability;
  assert.equal(partly, newState('x').stability_days, '"partly" holds the stability where it is (× 1)');
  assert.ok(right > partly, 'a self-graded "right" still grows it (× 1.2)');
});

/* --------------------------- G3-04: a pair session re-queues a miss on either skill */

const PAIR_SKILLS = new Map([
  ['ablative-place', { id: 'ablative-place', kinds: ['recognise', 'chart', 'parse', 'blank'] }],
  ['ablative-time', { id: 'ablative-time', kinds: ['recognise', 'chart', 'parse', 'blank'] }],
]);
const alternates = (plan) => plan.every((s, i) => i === 0 || s.skill !== plan[i - 1].skill);
const onlyThese = (plan, a, b) => plan.every((s) => s.skill === a || s.skill === b);

test('G3-04: a miss on the second skill comes back — the pair is re-queued, and the alternation holds', () => {
  const plan = buildPairSession({ a: 'ablative-place', b: 'ablative-time', skills: PAIR_SKILLS, size: 10, seed: 7 });
  assert.equal(plan.length, 10);
  assert.ok(alternates(plan));

  // Slot 1 is the *second* skill: before the fix `requeue` refused every spot and dropped it, always.
  const missed = plan[1];
  assert.equal(missed.skill, 'ablative-time');
  const played = plan.slice(0, 2);
  const rest = requeue(plan.slice(2), { skill: missed.skill, kind: missed.kind, stage: 1, skills: PAIR_SKILLS, rand: () => 0, fill: null, played, pair: 'ablative-place' });
  const out = [...played, ...rest];
  assert.equal(out.length, 12, 'the missed skill and its partner both come back');
  assert.equal(out.filter((s) => s.requeued).length, 2);
  assert.ok(out.some((s) => s.requeued && s.skill === 'ablative-time'), 'the skill actually missed is one of them');
  assert.ok(alternates(out), 'and the plan is still an alternation');
  assert.ok(onlyThese(out, 'ablative-place', 'ablative-time'), 'nothing else is ever let in');
  assert.ok(out.every((s, i) => i === 0 || s.kind !== out[i - 1].kind), 'no two consecutive slots of one kind');
});

test('G3-04: a miss on the first skill comes back too, and a nearly finished plan is extended', () => {
  const plan = buildPairSession({ a: 'ablative-place', b: 'ablative-time', skills: PAIR_SKILLS, size: 10, seed: 3 });
  const rest = requeue(plan.slice(1), { skill: 'ablative-place', kind: plan[0].kind, stage: 1, skills: PAIR_SKILLS, rand: () => 0, fill: null, played: plan.slice(0, 1), pair: 'ablative-time' });
  const out = [plan[0], ...rest];
  assert.equal(out.length, 12);
  assert.ok(alternates(out));

  // The last item of all: nothing to splice into, so the pair is appended in the order that keeps it alternating.
  const tail = requeue([], { skill: plan[9].skill, kind: plan[9].kind, stage: 1, skills: PAIR_SKILLS, rand: () => 0, fill: null, played: plan, pair: plan[8].skill });
  assert.deepEqual(tail.map((s) => s.skill), [plan[8].skill, plan[9].skill]);
});

test('G3-04: without a pair, requeue is what it was — nothing is added where nothing fits', () => {
  const plan = buildPairSession({ a: 'ablative-place', b: 'ablative-time', skills: PAIR_SKILLS, size: 10, seed: 7 });
  const rest = requeue(plan.slice(2), { skill: 'ablative-time', kind: plan[1].kind, stage: 1, skills: PAIR_SKILLS, rand: () => 0, fill: null, played: plan.slice(0, 2) });
  assert.equal(rest.length, 8, 'the old behaviour, kept for every other session type');
});

/* ------------------------------------ QA-I1: a session has a ceiling */

test('QA-I1: a session may grow by half of what was asked for, and no further', () => {
  assert.equal(sessionCeiling(10), 15);
  assert.equal(sessionCeiling(5), 8);
  assert.equal(sessionCeiling(15), 23);
  assert.equal(sessionCeiling(1), 3, 'at least two items of room, whatever the size');

  // Answering everything wrong used to run a ten-item session to 84 and counting. The cap is what
  // `requeue` is handed, so the growth stops at the ceiling rather than at the learner's patience.
  const skills = new Map([['a', { id: 'a', kinds: ['recognise', 'chart', 'parse', 'blank'] }], ['b', { id: 'b', kinds: ['recognise', 'chart', 'parse', 'blank'] }]]);
  let queue = Array.from({ length: 10 }, (_, i) => ({ skill: i % 2 ? 'a' : 'b', kind: i % 2 ? 'chart' : 'recognise', stage: 1 }));
  for (let i = 0; i < 40 && i < queue.length; i++) {
    const played = queue.slice(0, i + 1);
    queue = [...played, ...requeue(queue.slice(i + 1), { skill: queue[i].skill, kind: queue[i].kind, stage: 1, skills, rand: () => 0, fill: (n) => Array.from({ length: n }, () => ({ skill: 'a', kind: 'parse', stage: 1 })), played, cap: sessionCeiling(10) })];
  }
  assert.ok(queue.length <= 15, `a ten-item session answered wrongly throughout stayed at ${queue.length}`);
  assert.ok(queue.length > 10, 'but errors did feed back');
});

/* ---------------------------------------------------- G3-10: the printed caption */

test('G3-10: a one-section table drops a caption that only repeats the sheet', () => {
  assert.equal(captionFor('cases', 1), '', 'a noun chart is not captioned "cases"');
  assert.equal(captionFor('Cases', 1), '');
  assert.equal(captionFor('cases', 2), 'cases', 'with more than one section the title tells them apart');
  assert.equal(captionFor('Singular', 1), 'Singular');
  assert.equal(captionFor('', 1), '');
  assert.equal(captionFor(null, 1), '');
});
