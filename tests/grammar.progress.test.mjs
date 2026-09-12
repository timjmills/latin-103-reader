// node --test tests/ — the progress model (app/js/grammar/progress.js): what
// the parts of a skill are, which of them a given skill can have at all, and
// the one line the selection page shows above the list. Behaviour only — every
// assertion here is a fact about the numbers and the sentences the model
// returns, so a rewrite that keeps the contract keeps these passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARTS, PRACTICE_ITEMS, skillProgress, progressSummary } from '../app/js/grammar/progress.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { setSkills } from '../app/js/grammar/sets.js';
import { newState, addToPractice, passLearn, DAY_MS } from '../app/js/grammar/scheduler.js';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const RAW = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const INDEX = indexSkills(RAW);
const skill = (id) => { const s = INDEX.skills.get(id); assert.ok(s, `${id} is in the map`); return s; };

// A table skill (its own catalogue tables), a construction (no table of its own),
// and the two ends of the "cannot have" rule: a metre skill with nothing to drill.
const TABLE = skill('nominative-subject');
const SENTENCE = skill('purpose-clause');
const METRE = skill('elegiac-couplet');

// Chapter sets built the way the section builds them, on our own invented words —
// no deck of the book's is needed to test how a set's parts are counted.
const SETS = setSkills({
  questions: new Map([[7, { chapter: 7, week_id: 'r07', title: '', items: Array.from({ length: 12 }, (_, i) => ({ id: `q-${i}` })) }]]),
  vocab: new Map([[7, { chapter: 7, words: [{ lemma: 'pirata' }, { lemma: 'remus' }, { lemma: 'harena' }] }]]),
  pensa: new Map([[7, { chapter: 7, A: [{}, {}], B: [{}], C: [{}] }]]),
  weeks: [{ n: 107, id: 'r07', chapter: '7' }],
});
const set = (id) => { const s = SETS.get(id); assert.ok(s, `${id} is a chapter set`); return s; };

/** `n` attempts on a skill, oldest first — the shape store-grammar.js normalises to. */
const attempts = (id, n, { mode = 'practice', kind = 'parse', correct = true, from = NOW - 30 * DAY_MS, step = 60000, meta = null } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    skill: id, kind: typeof kind === 'function' ? kind(i) : kind, mode,
    correct: typeof correct === 'function' ? correct(i) : correct,
    hinted: false, at: new Date(from + i * step).toISOString(), item_key: `k-${i}`, ...(meta ? { meta } : {}),
  }));

/** The part of a result by key, or undefined when the skill cannot have it. */
const part = (res, key) => res.parts.find((p) => p.key === key);
const keys = (res) => res.parts.map((p) => p.key);

/* ------------------------------------------------------------------ PARTS */

test('PARTS is an ordered list of { key, label, blurb }, each key used once', () => {
  assert.ok(PARTS.length >= 5, 'a progress sheet with fewer than five parts is a tick-box');
  const seen = new Set();
  for (const p of PARTS) {
    assert.equal(typeof p.key, 'string');
    assert.ok(p.key && !seen.has(p.key), `${p.key} appears once`);
    seen.add(p.key);
    assert.ok(p.label && typeof p.label === 'string');
    assert.ok(p.blurb && typeof p.blurb === 'string');
  }
  // The order the sheet shows is the order a learner meets them: the lesson before the drill before mastery.
  assert.ok(seen.has('lesson') && seen.has('practice') && seen.has('mastered'));
  assert.ok(PARTS.findIndex((p) => p.key === 'lesson') < PARTS.findIndex((p) => p.key === 'practice'));
  assert.ok(PARTS.findIndex((p) => p.key === 'practice') < PARTS.findIndex((p) => p.key === 'mastered'));
});

test('`parts` comes back in PARTS order whatever order the evidence arrives in', () => {
  const res = skillProgress(TABLE, { now: NOW, drillable: true });
  const want = PARTS.map((p) => p.key).filter((k) => keys(res).includes(k));
  assert.deepEqual(keys(res), want);
});

/* ------------------------------------------------ a skill with nothing done */

test('nothing done: every part false, ratio 0, level none — and the summary never says "started"', () => {
  const res = skillProgress(TABLE, { now: NOW, drillable: true });
  assert.equal(res.done, 0);
  assert.ok(res.total > 0);
  assert.equal(res.ratio, 0);
  assert.equal(res.level, 'none');
  assert.ok(res.parts.every((p) => p.done === false));
  assert.match(res.summary, /^not started/, 'zero is "not started" and never rounded up to "started"');
});

test('no attempts passed at all is "unknown", not "none": nothing is claimed in `detail`', () => {
  const unknown = skillProgress(TABLE, { now: NOW, drillable: true });
  assert.equal(part(unknown, 'practice').detail, null, 'with no log there is nothing to say about it');
  const empty = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [] });
  assert.equal(empty.done, 0, 'an empty log is still nothing done');
});

/* ---------------------------------------------------------- part-way through */

test('part-done: Learn passed and a drill begun — done counts only what is finished', () => {
  const learn = attempts(TABLE.id, 8, { mode: 'learn', kind: (i) => (i % 2 ? 'chart' : 'recognise') });
  const drill = attempts(TABLE.id, 4, { from: NOW - 2 * DAY_MS });
  const res = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [...learn, ...drill], state: newState(TABLE.id, NOW) });
  assert.equal(part(res, 'lesson').done, true);
  assert.equal(part(res, 'learn').done, true, 'six right of the last ten across two kinds');
  assert.equal(part(res, 'practice').done, false, `four items is short of ${PRACTICE_ITEMS}`);
  assert.match(part(res, 'practice').detail, /4 of 10/);
  assert.equal(part(res, 'mastered').done, false);
  assert.ok(res.done >= 2 && res.done < res.total);
  assert.equal(res.level, res.done / res.total > 0.5 ? 'most' : 'started');
  assert.ok(res.ratio > 0 && res.ratio < 1);
});

test('a Learn run that missed the criterion is not a pass, and the detail says how short it fell', () => {
  const learn = attempts(TABLE.id, 10, { mode: 'learn', correct: (i) => i < 3 });
  const res = skillProgress(TABLE, { now: NOW, drillable: true, attempts: learn });
  assert.equal(part(res, 'lesson').done, true, 'the steps were worked through either way');
  assert.equal(part(res, 'learn').done, false);
  assert.match(part(res, 'learn').detail, /3\b/);
});

test('the lesson alone, still open, reads as its step and not as a pass', () => {
  const res = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [], learn: { step: 3 }, steps: 7 });
  assert.equal(part(res, 'lesson').done, false);
  assert.match(part(res, 'lesson').detail, /step 3 of 7/);
  assert.equal(res.level, 'none', 'opening a lesson is not a part done');
});

test('level: more than half is "most", all of it is "all"', () => {
  const learn = attempts(TABLE.id, 10, { mode: 'learn', kind: (i) => (i % 2 ? 'chart' : 'recognise') });
  const drill = attempts(TABLE.id, 20, { kind: 'chart', from: NOW - 5 * DAY_MS });
  const state = { ...addToPractice(passLearn(newState(TABLE.id, NOW), NOW), NOW), stability_days: 30, successes_spaced: 4 };
  const most = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [...learn, ...drill], state });
  assert.ok(most.done / most.total > 0.5);
  assert.equal(most.level, 'most');
  assert.notEqual(most.level, 'all', 'mastery has not been reached, so it is not all of it');
});

/* ------------------------------------------------------- a skill fully done */

test('fully done: every part true, ratio 1, level all, and the summary says so', () => {
  const learn = attempts(TABLE.id, 10, { mode: 'learn', kind: (i) => (i % 2 ? 'chart' : 'recognise') });
  const drill = attempts(TABLE.id, 24, { kind: 'chart', from: NOW - 40 * DAY_MS, step: DAY_MS });
  const state = { ...addToPractice(newState(TABLE.id, NOW), NOW), state: 'mastered', stage: 3, stability_days: 30, successes: 24, successes_spaced: 5, due_at: new Date(NOW + 20 * DAY_MS).toISOString() };
  const res = skillProgress(TABLE, {
    now: NOW, drillable: true, hasBank: true, state, attempts: [...learn, ...drill.map((a, i) => (i < 3 ? { ...a, meta: { generated: true } } : a))],
    metCells: ['nom.sg', 'gen.sg', 'acc.sg', 'abl.sg'], cellCount: 4,
  });
  assert.equal(res.done, res.total);
  assert.equal(res.ratio, 1);
  assert.equal(res.level, 'all');
  assert.ok(res.parts.every((p) => p.done === true), `all done: ${res.parts.filter((p) => !p.done).map((p) => p.key)}`);
  assert.match(res.summary, /all \d+ parts done/i);
  assert.match(part(res, 'chart').detail, /4 of 4 cells/);
});

test('a half-filled chart is a part not yet done, and says which fraction', () => {
  const res = skillProgress(TABLE, { now: NOW, drillable: true, metCells: new Set(['nom.sg', 'gen.sg', 'acc.sg']), cellCount: 12 });
  assert.equal(part(res, 'chart').done, false);
  assert.match(part(res, 'chart').detail, /3 of 12 cells/);
});

/* ------------------------------------------ a skill that cannot have a part */

test('a metre skill with nothing drillable is not held to the parts it cannot have', () => {
  const res = skillProgress(METRE, { now: NOW, drillable: false });
  assert.deepEqual(keys(res), ['lesson'], 'the lesson is the whole of it');
  assert.equal(res.total, 1);
  assert.equal(part(res, 'practice'), undefined);
  assert.equal(part(res, 'mastered'), undefined);
  assert.equal(part(res, 'chart'), undefined, 'no catalogue table is named');
  // And it can reach 'all' — the point of the rule. A metre skill never produces a drill item, so it never
  // produces a Learn attempt either; reaching the last step is the whole of what there is to finish.
  const read = skillProgress(METRE, { now: NOW, drillable: false, attempts: [], learn: { step: 5 }, steps: 5 });
  assert.equal(read.level, 'all');
  assert.equal(read.ratio, 1);
  assert.equal(read.done, 1);
  assert.match(read.summary, /all 1 part done/i);
});

test('a construction has no chart part, and no generated part until it has a bank', () => {
  const bare = skillProgress(SENTENCE, { now: NOW, drillable: true });
  assert.equal(part(bare, 'chart'), undefined, 'it names no catalogue table of its own');
  assert.equal(part(bare, 'generated'), undefined, 'no bank, so nothing to have practised');
  const banked = skillProgress(SENTENCE, { now: NOW, drillable: true, hasBank: true });
  assert.ok(part(banked, 'generated'), 'the bank exists, so the part is one it can have');
  assert.equal(banked.total, bare.total + 1);
  const used = skillProgress(SENTENCE, { now: NOW, drillable: true, hasBank: true, attempts: attempts(SENTENCE.id, 3, { meta: { generated: true } }) });
  assert.equal(part(used, 'generated').done, true);
  assert.match(part(used, 'generated').detail, /3\b/);
});

test('a table skill that also has a bank owes both parts — the two supplies are not alternatives', () => {
  const res = skillProgress(TABLE, { now: NOW, drillable: true, hasBank: true });
  assert.ok(part(res, 'chart') && part(res, 'generated'));
});

/* ------------------------------------------------------------ a chapter set */

test('a chapter set has the parts a deck can have and none of the ones it cannot', () => {
  const vocab = set('vocab-07');
  const res = skillProgress(vocab, { now: NOW, drillable: true });
  assert.equal(part(res, 'chart'), undefined, 'a deck has no paradigm table');
  assert.equal(part(res, 'generated'), undefined, 'a deck has no sentence generator');
  assert.ok(part(res, 'lesson') && part(res, 'practice') && part(res, 'mastered'));
  // Walking the deck reads off the set's own size, which the pseudo-skill carries.
  const half = skillProgress(vocab, { now: NOW, drillable: true, learn: { seen: 2 } });
  assert.match(part(half, 'lesson').detail, /2 of 3/);
});

test('a pensum is practised, never learned in a sitting, so Learn is not counted against it', () => {
  const res = skillProgress(set('pensum-07'), { now: NOW, drillable: true });
  assert.equal(part(res, 'lesson'), undefined);
  assert.equal(part(res, 'learn'), undefined);
  assert.ok(part(res, 'practice'), 'it is still practised');
  const questions = skillProgress(set('questions-07'), { now: NOW, drillable: true });
  assert.ok(questions.total > res.total, 'a question set can be learned, so it owes more');
});

test('a chapter set with nothing drillable is left with nothing to fail', () => {
  const res = skillProgress(set('pensum-07'), { now: NOW, drillable: false });
  assert.equal(res.total, 0);
  assert.equal(res.ratio, 0);
  assert.equal(res.level, 'none');
  assert.equal(res.done, 0);
  assert.ok(res.summary.length, 'it still says something rather than an empty string');
});

/* ------------------------------------------- rotation, lapsing and mastery */

test('a lapse does not untick "in mixed practice" — the skill was still put there', () => {
  const lapsed = { ...addToPractice(newState(TABLE.id, NOW), NOW), state: 'lapsed', due_at: new Date(NOW - 20 * DAY_MS).toISOString(), stability_days: 2 };
  const res = skillProgress(TABLE, { now: NOW, drillable: true, state: lapsed });
  assert.equal(part(res, 'rotation').done, true);
  assert.equal(part(res, 'mastered').done, false);
  assert.match(part(res, 'rotation').detail, /lapsed/i);
});

test('mastery is the scheduler\'s own, not a guess: only state "mastered" ticks it', () => {
  const near = { ...addToPractice(newState(TABLE.id, NOW), NOW), stability_days: 25, successes_spaced: 2 };
  const res = skillProgress(TABLE, { now: NOW, drillable: true, state: near });
  assert.equal(part(res, 'mastered').done, false);
  assert.match(part(res, 'mastered').detail, /2 of 3/);
});

/* -------------------------------------------------------- progressSummary */

test('progressSummary counts skills fully worked through, over the rows that have parts', () => {
  const full = { done: 4, total: 4 };
  const partial = { done: 1, total: 4 };
  const nothing = { done: 0, total: 4 };
  const noParts = { done: 0, total: 0 };
  const line = progressSummary([full, full, partial, nothing, noParts]);
  assert.match(line, /2 of 4 skills fully worked through/, 'the row with no parts is not in the denominator');
  assert.doesNotMatch(line, /\b5\b/);
});

test('progressSummary never rounds nothing up, and says plainly when the list is empty', () => {
  assert.match(progressSummary([{ done: 0, total: 3 }, { done: 0, total: 3 }]), /0 of 2/);
  assert.doesNotMatch(progressSummary([{ done: 0, total: 3 }]), /started/i);
  assert.match(progressSummary([{ done: 1, total: 3 }]), /1 started/);
  assert.ok(progressSummary([]).length);
  assert.ok(progressSummary(null).length);
});

test('progressSummary is pure: it reads its rows and changes none of them', () => {
  const rows = [{ done: 2, total: 4 }, { done: 4, total: 4 }];
  const before = JSON.stringify(rows);
  progressSummary(rows);
  assert.equal(JSON.stringify(rows), before);
});

test('skillProgress is pure: the same inputs twice give the same answer, and the state row is untouched', () => {
  const state = addToPractice(newState(TABLE.id, NOW), NOW);
  const before = JSON.stringify(state);
  const a = skillProgress(TABLE, { now: NOW, drillable: true, state, attempts: attempts(TABLE.id, 12) });
  const b = skillProgress(TABLE, { now: NOW, drillable: true, state, attempts: attempts(TABLE.id, 12) });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(state), before);
});

test('a bare skill id is tolerated: it reads as a skill nothing is known about', () => {
  const res = skillProgress('made-up-skill', { now: NOW, drillable: true });
  assert.ok(res.total > 0);
  assert.equal(res.done, 0);
  assert.equal(part(res, 'chart'), undefined, 'nothing says it has a table');
});
