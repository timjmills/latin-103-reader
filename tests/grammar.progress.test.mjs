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

test('a detail line never fills its slot with a dash', () => {
  // `fmtStability` answers "—" when there is nothing to report, which is right in a table of figures and
  // wrong inside a sentence: the panel read "stable for —". A part that is done says so on its own.
  const none = skillProgress({ id: 'vocab-01', set: 'vocab' }, { state: { state: 'mastered' } });
  assert.equal(none.parts.find((p) => p.key === 'mastered').detail, null, 'the panel says "stable for —"');
  const some = skillProgress({ id: 'vocab-01', set: 'vocab' }, { state: { state: 'mastered', stability_days: 21 } });
  assert.equal(some.parts.find((p) => p.key === 'mastered').detail, 'stable for 21 days');
  // Nothing anywhere may hand the view a sentence that trails off in punctuation.
  for (const st of [{ state: 'mastered' }, { state: 'practising' }, { state: 'lapsed' }, { state: 'new' }]) {
    for (const p of skillProgress({ id: 'vocab-01', set: 'vocab' }, { state: st }).parts) {
      if (p.detail != null) assert.ok(!/[—–-]\s*$/.test(p.detail), `"${p.detail}" trails off`);
    }
  }
});

test('the chart part says what was actually written down, not what it wishes it knew', () => {
  // session.js logs one attempt per ITEM and keeps no per-box record, and a chart item is a whole table on
  // a wide screen and a single cell on a phone or in "practise one cell". So the log can count charts
  // answered and nothing finer. The first wording said "1 cell answered right" for a whole table.
  const s = { id: 'k', paradigm: ['decl1'] };
  const p = skillProgress(s, { attempts: [{ kind: 'chart', correct: true, mode: 'practice' }], drillable: true });
  const chart = p.parts.find((x) => x.key === 'chart');
  if (chart) {
    assert.match(chart.detail ?? '', /chart/, 'the detail no longer says what it counted');
    assert.ok(!/\bcells?\b/.test(chart.detail ?? ''), 'the detail claims to count cells, which nothing records');
  }
  // A wrong chart is not a chart answered right.
  const miss = skillProgress(s, { attempts: [{ kind: 'chart', correct: false, mode: 'practice' }], drillable: true });
  const chartMiss = miss.parts.find((x) => x.key === 'chart');
  if (chartMiss) assert.equal(chartMiss.done, false, 'a chart got wrong ticks the chart part');
});

/* ------------------------------------- which level a chart was completed at */
// §18.1 ticked the chart part on the first complete table "at whatever scaffolding was up", so a table
// finished with 80 % of its cells already printed read exactly like one finished from memory. A chart
// attempt now says how much of the table was given (`meta.given`, a percentage GIVEN: 80 is the easiest
// rung of §12's ladder, 0 the blank table), and the part reports the hardest rung it was completed at.

/** One chart attempt on TABLE. `given` null writes no meta at all — an old attempt, or one whose level says nothing. */
const chartAttempt = (given, o = {}) => ({
  skill: TABLE.id, kind: 'chart', mode: 'practice', correct: true, hinted: false,
  at: new Date(NOW - DAY_MS).toISOString(), item_key: 'c-1',
  ...(given == null ? null : { meta: { given } }), ...o,
});
/** The chart part of TABLE's sheet, read off a log. */
const chartPart = (rows) => {
  const p = skillProgress(TABLE, { now: NOW, drillable: true, attempts: rows });
  const c = part(p, 'chart');
  assert.ok(c, 'the skill names a catalogue table, so it has a chart part');
  return c;
};

test('a chart completed at each rung of the ladder is reported at that rung, and the four do not read alike', () => {
  for (const g of [80, 50, 20, 0]) {
    const c = chartPart([chartAttempt(g)]);
    assert.equal(c.done, true, `a table completed with ${g}% given is a table completed`);
    assert.equal(c.given, g, `completed with ${g}% given`);
  }
  const said = [80, 50, 20, 0].map((g) => chartPart([chartAttempt(g)]).given);
  assert.equal(new Set(said).size, 4, 'a learner who has only ever finished one at 80% must not read the same line as one who finished it unaided');
});

test('the hardest level completed is what is reported, not the most recent', () => {
  const later = new Date(NOW - 60000).toISOString();
  assert.equal(chartPart([chartAttempt(0), chartAttempt(80, { at: later })]).given, 0, 'a later easy table does not take away the one done from memory');
  assert.equal(chartPart([chartAttempt(80), chartAttempt(50), chartAttempt(20)]).given, 20);
  assert.equal(chartPart([chartAttempt(20), chartAttempt(80, { at: later })]).given, 20);
});

test('a chart attempt with no level recorded is unknown: neither an achievement nor a failure', () => {
  const c = chartPart([chartAttempt(null)]);
  assert.equal(c.done, true, 'an attempt from before the level was written down still ticks the part');
  assert.equal(c.given, null, 'unknown is null — never 0, which would claim it was done unaided, and never 80');
  assert.match(c.detail, /chart/, 'and the line says only what was written down');
  assert.equal(chartPart([chartAttempt(null), chartAttempt(50)]).given, 50, 'a known rung beside an unknown one is still reported');
  assert.equal(chartPart([chartAttempt(null), chartAttempt(null)]).given, null);
  for (const junk of [-1, 101, 'lots', NaN, true, null]) {
    assert.equal(chartPart([{ ...chartAttempt(0), meta: { given: junk } }]).given, null, `"${junk}" is not a level`);
  }
});

test('a chart got wrong is a completion at no level', () => {
  const wrong = chartPart([chartAttempt(0, { correct: false })]);
  assert.equal(wrong.done, false, 'a chart got wrong does not tick the part');
  assert.equal(wrong.given, null, 'and a table that was not completed was not completed unaided either');
  assert.equal(chartPart([chartAttempt(0, { correct: false }), chartAttempt(80)]).given, 80, 'the right one decides, however hard the wrong one was');
});

test('a table completed with its cells peeked sets no level', () => {
  // §17.1: a form only being looked at is not an answer, and §12's ladder only fades on `correct && !hinted`.
  // So "completed unaided" may not be said of a blank table whose cells were shown.
  assert.equal(chartPart([chartAttempt(0, { hinted: true })]).done, true, 'it is still a chart answered right');
  assert.equal(chartPart([chartAttempt(0, { hinted: true })]).given, null);
  assert.equal(chartPart([chartAttempt(0, { hinted: true }), chartAttempt(80)]).given, 80);
});

test('the level never moves the count, the ratio or the band', () => {
  const bare = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [chartAttempt(null)] });
  const known = skillProgress(TABLE, { now: NOW, drillable: true, attempts: [chartAttempt(0)] });
  assert.equal(bare.done, known.done);
  assert.equal(bare.total, known.total);
  assert.equal(bare.level, known.level);
  assert.equal(bare.summary, known.summary);
});
