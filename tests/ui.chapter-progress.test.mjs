// node --test tests/ — Progress across every chapter (GRAMMAR-CONTRACT.md
// "Progress across every chapter"): the per-chapter aggregation, the timings
// derived from the study log's pace and the drill medians, and the totals over
// the book. app/js/progress.js is pure; this is all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProgressRoute, progressHash, fmtEstimate, fmtMeasured, paceNote, estimateNote,
  readingMs, setRow, skillLeftMs, chapterGrammar, chapterRow, chapterRows, chapterLine,
  timingLine, bookTotals, SKILL_STATES, SET_KINDS,
} from '../app/js/progress.js';
import { chapterRows as readingRowModels } from '../app/js/settings.js';
import { chapters, chapter as chapterOf } from '../app/js/chapters.js';
import { ROUGH_PACE } from '../app/js/settings.js';
import { DEFAULT_ITEM_S, KIND_SECONDS, LEARN_ITEMS, LEARN_LESSON_MIN, LEARN_BLOCKED_ITEMS } from '../app/js/grammar/today.js';

const MIN = 60000;
const HOUR = 3600000;

/* ------------------------------------------------------------- fixtures */
const skill = (id, chapter, title = id) => ({ id, chapter, title, set: null });
const set = (id, kind, chapter, count, extra = {}) => ({ id, set: kind, chapter, count, title: id, ...extra });

/** A chapter VII reading row as settings.chapterRows() produces one. */
function reading(n, { read = 0, total = 0, inLibrary = true, audio = false } = {}) {
  const c = chapterOf(n);
  return { n, roman: c.roman, title: c.title, readings: c.readings, weeks: c.weeks, inLibrary, meta: '', total, read, audio };
}

const stateMap = (obj) => (id) => obj[id] ?? 'new';
const seenMap = (obj) => (id) => obj[id] ?? { done: 0, attempts: 0 };

/* ------------------------------------------------------------- the route */
test('#/progress is the page; #/progress/7 opens a chapter; nothing else is this page', () => {
  assert.deepEqual(parseProgressRoute('#/progress'), { n: null });
  assert.deepEqual(parseProgressRoute('#/progress/'), { n: null });
  assert.deepEqual(parseProgressRoute('#/progress/7'), { n: 7 });
  assert.deepEqual(parseProgressRoute('#/progress/34'), { n: 34 });
  assert.deepEqual(parseProgressRoute('#/progress/99'), { n: null }, 'a chapter outside I–XXXIV opens the whole list, never an empty page');
  assert.equal(parseProgressRoute('#/chapter/7'), null);
  assert.equal(parseProgressRoute(''), null);
  assert.equal(parseProgressRoute(null), null);
  assert.equal(progressHash(), '#/progress');
  assert.equal(progressHash(7), '#/progress/7');
  assert.equal(progressHash(99), '#/progress');
});

/* --------------------------------------------------------- the estimates */
test('fmtEstimate always hedges, and rounds the way the week estimates do', () => {
  assert.equal(fmtEstimate(0), '');
  assert.equal(fmtEstimate(-5), '');
  assert.equal(fmtEstimate(null), '');
  assert.equal(fmtEstimate(20000), 'under a minute');
  assert.equal(fmtEstimate(8 * MIN), 'about 8 min');
  assert.equal(fmtEstimate(22 * MIN), 'about 20 min');
  assert.equal(fmtEstimate(46 * MIN), 'about 45 min');
  assert.equal(fmtEstimate(60 * MIN), 'about 1 h');
  assert.equal(fmtEstimate(75 * MIN), 'about 1½ h');
  assert.equal(fmtEstimate(120 * MIN), 'about 2 h');
  for (const ms of [MIN, 30 * MIN, 3 * HOUR]) assert.match(fmtEstimate(ms), /^about /, 'every derived span says "about"');
});

test('fmtMeasured is the plain voice — measured minutes never say "about"', () => {
  assert.equal(fmtMeasured(0), 'none yet');
  assert.equal(fmtMeasured(14 * MIN), '14 min');
  assert.equal(fmtMeasured(HOUR + 12 * MIN), '1 h 12 min');
  assert.doesNotMatch(fmtMeasured(14 * MIN), /about/);
});

test('the page says which figure is measured and which is worked out', () => {
  const rough = paceNote(null);
  assert.match(rough, /only measured figure/);
  assert.match(rough, new RegExp(`assumed ${ROUGH_PACE} sentences an hour`));
  assert.match(rough, /estimates/);
  const real = paceNote({ perHour: 64, basis: 'recent' });
  assert.match(real, /your own pace of 64 sentences an hour/);
  assert.match(real, /only measured figure/);
  assert.match(estimateNote({ perHour: 64, basis: 'recent' }), /^Estimated from your pace of 64 .*not measured\.$/);
  assert.match(estimateNote({ perHour: ROUGH_PACE, basis: 'rough' }), /assumed .* not measured\./);
  assert.match(estimateNote(null), /not measured/);
});

test('timings: pace absent falls back to the rough rate, and a real pace is used as given', () => {
  // Pace absent (nothing recorded): the app's assumed 60/h, as the week estimates do.
  assert.equal(readingMs(60, null), HOUR);
  assert.equal(readingMs(30, { perHour: ROUGH_PACE, basis: 'rough' }), 0.5 * HOUR);
  // A pace from very little data still has a basis and is used; the *wording* is what marks it rough.
  const few = { perHour: 40, basis: 'overall', days: 1, ms: 3 * MIN, sentences: 2 };
  assert.equal(readingMs(20, few), 0.5 * HOUR);
  assert.match(estimateNote(few), /pace of 40 sentences an hour/);
  assert.equal(readingMs(0, few), 0);
  assert.equal(readingMs(-3, few), 0);
});

/* ------------------------------------------------------------- the sets */
test('a set row counts what has been met of its total, with the minutes left at the kind\'s own pace', () => {
  const secondsFor = (kind) => ({ question: 30, vocab: 10, pensum: 40 })[kind] ?? DEFAULT_ITEM_S;
  const row = setRow(set('questions-07', 'questions', 7, 43), {
    seenOf: seenMap({ 'questions-07': { done: 12, attempts: 20 } }),
    stateOf: stateMap({ 'questions-07': 'practising' }),
    secondsFor,
  });
  assert.equal(row.label, 'Questions');
  assert.equal(row.verb, SET_KINDS.questions.verb);
  assert.equal(row.total, 43);
  assert.equal(row.done, 12);
  assert.equal(row.left, 31);
  assert.equal(row.state, 'practising');
  assert.equal(row.leftMs, 31 * 30 * 1000);
  assert.equal(row.spentMs, 20 * 30 * 1000);

  const vocab = setRow(set('vocab-07-rev', 'vocab', 7, 62, { rev: true }), { secondsFor });
  assert.equal(vocab.label, 'Vocabulary · English → Latin');
  assert.equal(vocab.done, 0);
  assert.equal(vocab.left, 62);
  assert.equal(vocab.leftMs, 62 * 10 * 1000);

  // More met than the deck holds (a deck that shrank) never reads as more than its total.
  const over = setRow(set('vocab-07', 'vocab', 7, 5), { seenOf: () => ({ done: 9, attempts: 9 }), secondsFor });
  assert.equal(over.done, 5);
  assert.equal(over.left, 0);
  assert.equal(over.leftMs, 0);

  // Without a measured drill pace the kind's own default stands in (today.js KIND_SECONDS).
  const bare = setRow(set('pensum-07', 'pensum', 7, 4));
  assert.equal(bare.leftMs, 4 * KIND_SECONDS.pensum * 1000);
  assert.equal(setRow(null), null);
});

test('a skill costs its lesson before it is started, the blocked ten while it is, nothing once in rotation', () => {
  assert.equal(skillLeftMs('new', 20), LEARN_LESSON_MIN * MIN + LEARN_ITEMS * 20 * 1000);
  assert.equal(skillLeftMs('learning', 20), LEARN_BLOCKED_ITEMS * 20 * 1000);
  assert.equal(skillLeftMs('lapsed', 20), LEARN_BLOCKED_ITEMS * 20 * 1000);
  assert.equal(skillLeftMs('practising', 20), 0);
  assert.equal(skillLeftMs('mastered', 20), 0);
});

/* ----------------------------------------------------------- the grammar */
test('a chapter\'s grammar: skills by state, sets in order, the reverse deck only once touched', () => {
  const g = chapterGrammar({
    skills: [skill('dative-indirect-object', 7), skill('dative-possession', 7), skill('third-decl-dative', 7)],
    sets: [
      set('pensum-07', 'pensum', 7, 18),
      set('vocab-07-rev', 'vocab', 7, 62, { rev: true }),
      set('vocab-07', 'vocab', 7, 62),
      set('questions-07', 'questions', 7, 43),
    ],
    stateOf: stateMap({ 'dative-indirect-object': 'mastered', 'dative-possession': 'practising', 'questions-07': 'learning' }),
    seenOf: seenMap({ 'questions-07': { done: 12, attempts: 15 }, 'vocab-07': { done: 30, attempts: 44 } }),
    secondsFor: () => 20,
  });
  assert.equal(g.total, 3);
  assert.deepEqual(g.counts, { new: 1, learning: 0, practising: 1, mastered: 1, lapsed: 0 });
  assert.deepEqual(Object.keys(g.counts), [...SKILL_STATES]);
  assert.equal(g.mastered, 1);
  assert.equal(g.started, 2);
  assert.deepEqual(g.sets.map((r) => r.id), ['questions-07', 'vocab-07', 'vocab-07-rev', 'pensum-07'], 'Questions · Vocabulary · the reverse deck · Pensa');
  assert.deepEqual(g.visibleSets.map((r) => r.id), ['questions-07', 'vocab-07', 'pensum-07'], 'the optional reverse deck stays out until it is touched');
  assert.equal(g.setsDone, 42);
  assert.equal(g.setsTotal, 43 + 62 + 62 + 18);
  assert.equal(g.anyDone, true);
  assert.equal(g.any, true);
  assert.equal(g.known, true);
  // One skill new (lesson + fifteen), one learning set, and the unmet items of every set.
  const skillsLeft = skillLeftMs('new', 20) + skillLeftMs('practising', 20) + skillLeftMs('mastered', 20);
  const setsLeft = g.sets.reduce((n, r) => n + r.leftMs, 0);
  assert.equal(g.leftMs, skillsLeft + setsLeft);
  assert.ok(g.spentMs > 0);
});

test('a chapter with nothing done reads as untouched, and one with no grammar as none — never zeros', () => {
  const none = chapterGrammar({ skills: [], sets: [] });
  assert.equal(none.any, false);
  assert.equal(none.anyDone, false);
  assert.equal(none.total, 0);
  assert.deepEqual(none.visibleSets, []);
  assert.equal(none.leftMs, 0);

  const fresh = chapterGrammar({ skills: [skill('a', 3)], sets: [set('vocab-03', 'vocab', 3, 20)], secondsFor: () => 20 });
  assert.equal(fresh.anyDone, false, 'nothing met yet');
  assert.equal(fresh.any, true, 'but there is grammar to do');
  assert.deepEqual(fresh.counts, { new: 1, learning: 0, practising: 0, mastered: 0, lapsed: 0 });
  assert.equal(fresh.spentMs, 0);
  assert.ok(fresh.leftMs > 0);

  // Before the grammar section has been read the view says so; it never prints a row of zeros.
  const unknown = chapterGrammar({ known: false });
  assert.equal(unknown.known, false);
  assert.equal(unknown.any, false);
});

/* ------------------------------------------------------ the chapter rows */
test('a part-read chapter: its reading figures, its grammar, and both timings derived from the pace', () => {
  const pace = { perHour: 60, basis: 'recent' };
  const g = chapterGrammar({
    skills: [skill('a', 7), skill('b', 7)],
    sets: [set('questions-07', 'questions', 7, 40)],
    stateOf: stateMap({ a: 'mastered', b: 'mastered', 'questions-07': 'practising' }),
    seenOf: seenMap({ 'questions-07': { done: 10, attempts: 10 } }),
    secondsFor: () => 30,
  });
  const row = chapterRow(reading(7, { read: 30, total: 93, audio: true }), { grammar: g, pace });
  assert.equal(row.n, 7);
  assert.equal(row.roman, 'VII');
  assert.equal(row.title, 'Puella et Rosa');
  assert.equal(row.state, 'part');
  assert.equal(row.read, 30);
  assert.equal(row.unread, 63);
  assert.equal(row.audio, true);
  assert.equal(row.finished, false);
  assert.equal(row.readSpentMs, 30 * MIN, '30 sentences at 60 an hour');
  assert.equal(row.readLeftMs, 63 * MIN);
  assert.equal(row.spentMs, row.readSpentMs + g.spentMs);
  assert.equal(row.leftMs, row.readLeftMs + g.leftMs);
  assert.equal(chapterLine(row), `30 of 93 read · 2 of 2 skills mastered · ${fmtEstimate(row.leftMs)} left`);
  // 30 min of reading plus the ten questions answered at 30 s each — both derived, both hedged.
  assert.match(timingLine(row), /^About 35 min spent · about .* to come$/);
});

test('a chapter with nothing done says so; a finished one says it is read through', () => {
  const pace = { perHour: 60, basis: 'recent' };
  const untouched = chapterRow(reading(3, { read: 0, total: 40 }), { grammar: chapterGrammar({ skills: [skill('a', 3)], secondsFor: () => 20 }), pace });
  assert.equal(untouched.state, 'untouched');
  assert.equal(chapterLine(untouched), 'Nothing done yet', 'not a row of zeros (GRAMMAR-CONTRACT.md)');
  assert.equal(untouched.spentMs, 0);
  assert.ok(untouched.leftMs > 40 * MIN, 'the reading still to come, plus its grammar');

  const done = chapterRow(reading(3, { read: 40, total: 40 }), { grammar: chapterGrammar({ skills: [], sets: [] }), pace });
  assert.equal(done.state, 'done');
  assert.equal(done.finished, true);
  assert.equal(done.leftMs, 0);
  assert.equal(chapterLine(done), 'Read through');
  assert.equal(timingLine(done), 'About 40 min spent');

  const absent = chapterRow(reading(20, { read: 0, total: 0, inLibrary: false }), { grammar: chapterGrammar({ known: false }), pace });
  assert.equal(absent.state, 'absent');
  assert.equal(chapterLine(absent), 'Not added yet');
  assert.equal(timingLine(absent), '');
});

test('the readings a chapter actually has: XXV on has no dialogue, and a supplement week brings its own stories', () => {
  // The mapping is chapters.js's; the Progress row only carries it through.
  const seven = chapterRow(reading(7, { read: 5, total: 20 }), { pace: null });
  assert.deepEqual(seven.readings.map((r) => r.kind), ['fr', 'collo'], 'I–XXIV: the chapter and its colloquium');

  const twentyFive = chapterRow(reading(25, { read: 0, total: 60 }), { pace: null });
  assert.deepEqual(twentyFive.readings.map((r) => r.kind), ['fr'], 'XXV has no Colloquium — the row simply has no dialogue');
  assert.ok(!twentyFive.readings.some((r) => r.kind === 'collo'));

  const twentySeven = chapterRow(reading(27, { read: 0, total: 60 }), { pace: null });
  assert.deepEqual(twentySeven.readings.map((r) => r.kind), ['fr', 'fs', 'fs', 'fl', 'fl', 'fl']);
  assert.equal(twentySeven.readings.filter((r) => r.supplement).length, 5);
});

test('every chapter of the book gets a row, in order, straight from settings.chapterRows()', () => {
  const totals = new Map([[107, 93], [207, 12], [1, 120]]);
  const read = new Map([[107, 40], [207, 12]]);
  const rows = chapterRows(readingRowModels({ library: new Set([107, 207, 1]), totals, read }), { pace: { perHour: 60, basis: 'recent' } });
  assert.equal(rows.length, chapters().length);
  assert.deepEqual(rows.map((r) => r.n), chapters().map((c) => c.n));
  const seven = rows.find((r) => r.n === 7);
  assert.equal(seven.total, 105, '93 of the chapter and 12 of its colloquium');
  assert.equal(seven.read, 52);
  assert.equal(seven.state, 'part');
  const one = rows.find((r) => r.n === 1);
  assert.equal(one.state, 'absent', 'chapter I is not in this library — week 1 belongs to chapter XXV');
  assert.equal(rows.find((r) => r.n === 25).total, 120);
});

/* ------------------------------------------------------------ the totals */
test('the totals across the book: sentences read, chapters finished, skills mastered, minutes measured', () => {
  const pace = { perHour: 60, basis: 'recent' };
  const g = (mastered, total) => chapterGrammar({
    skills: Array.from({ length: total }, (_, i) => skill(`s${i}`, 7)),
    stateOf: stateMap(Object.fromEntries(Array.from({ length: mastered }, (_, i) => [`s${i}`, 'mastered']))),
    secondsFor: () => 20,
  });
  const rows = [
    chapterRow(reading(1, { read: 40, total: 40 }), { grammar: g(2, 2), pace }),
    chapterRow(reading(2, { read: 10, total: 50 }), { grammar: g(1, 3), pace }),
    chapterRow(reading(3, { read: 0, total: 30 }), { grammar: g(0, 4), pace }),
    chapterRow(reading(4, { read: 0, total: 0, inLibrary: false }), { grammar: chapterGrammar({ known: false }), pace }),
  ];
  const t = bookTotals(rows, { measuredMs: 6 * HOUR + 12 * MIN });
  assert.equal(t.sentencesRead, 50);
  assert.equal(t.sentencesTotal, 120);
  assert.equal(t.chapters, 4);
  assert.equal(t.chaptersFinished, 1);
  assert.equal(t.chaptersStarted, 2);
  assert.equal(t.inLibrary, 3);
  assert.equal(t.skillsMastered, 3);
  assert.equal(t.skillsTotal, 9, 'the chapters\' own skills when the whole map is not given');
  assert.equal(t.measuredMs, 6 * HOUR + 12 * MIN);
  assert.equal(fmtMeasured(t.measuredMs), '6 h 12 min');
  assert.equal(t.spentMs, rows.reduce((n, r) => n + r.spentMs, 0));
  assert.equal(t.leftMs, rows.reduce((n, r) => n + r.leftMs, 0));

  // The book's whole grammar, when the skill map is known, beats the chapters' own sum.
  const whole = bookTotals(rows, { measuredMs: 0, skillsTotal: 88, skillsMastered: 11 });
  assert.equal(whole.skillsTotal, 88);
  assert.equal(whole.skillsMastered, 11);
  assert.equal(whole.measuredMs, 0);
  assert.equal(fmtMeasured(whole.measuredMs), 'none yet');

  const empty = bookTotals([], {});
  assert.equal(empty.chapters, 0);
  assert.equal(empty.sentencesRead, 0);
  assert.equal(empty.measuredMs, 0);
  assert.equal(bookTotals(null, {}).chapters, 0);
});
