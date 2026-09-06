// node --test tests/ — wave 3's aggregation (GRAMMAR-CONTRACT.md "Confusion
// analytics and history"): the confusion pairs and their plain-words reason,
// the per-skill history windowing, the stability/stage replay, and the
// printable-chart page split. All pure; nothing here touches a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confusionPairs, confusionReason, confusionsOf, skillHistory, progressTrail, fmtStability } from '../app/js/grammar/stats.js';
import { buildPairSession, applyAnswer, newState } from '../app/js/grammar/scheduler.js';
import { paradigmPages, cellText, focusNote, sheetSubtitle } from '../app/js/grammar/print.js';
import { roman } from '../app/js/sync.js';

const SKILLS = new Map([
  ['dative-indirect-object', { id: 'dative-indirect-object', title: 'Dative: the indirect object', plain: "the dative (the 'to/for' form)", chapter: 7, course: '101', week: 7, category: 'noun-case', kinds: ['recognise', 'chart', 'parse', 'blank'], latin_label: 'cāsus datīvus', summary: 'The receiver.' }],
  ['ablative-means', { id: 'ablative-means', title: 'Ablative of means', plain: "the ablative (the 'by/with' form)", chapter: 8, course: '101', week: 8, category: 'noun-case', kinds: ['recognise', 'chart', 'parse', 'blank'], summary: 'The instrument.' }],
  ['genitive-of', { id: 'genitive-of', title: 'Genitive: of', plain: "the genitive (the 'of' form)", chapter: 2, course: '101', week: 2, category: 'noun-case', kinds: ['recognise'], summary: 'Whose.' }],
]);

const at = (d, h = 10) => new Date(Date.UTC(2026, 7, d, h)).toISOString();
const attempt = (o) => ({ skill: 'dative-indirect-object', kind: 'recognise', mode: 'practice', item_key: 'k', correct: true, hinted: false, self: false, answer: '', expected: '', confused_with: null, ms: 5000, ...o });

/* ------------------------------------------------------------ confusions */

test('confusionPairs merges the two directions into one pair, heavier direction first', () => {
  const rows = [
    { skill_a: 'dative-indirect-object', skill_b: 'ablative-means', count: 3 },
    { skill_a: 'ablative-means', skill_b: 'dative-indirect-object', count: 7 },
    { skill_a: 'genitive-of', skill_b: 'dative-indirect-object', count: 4 },
  ];
  const pairs = confusionPairs(rows, SKILLS);
  assert.equal(pairs.length, 2, 'two pairs, not three rows');
  assert.deepEqual(pairs[0], { a: 'ablative-means', b: 'dative-indirect-object', count: 10, ab: 7, ba: 3 });
  assert.deepEqual(pairs[1], { a: 'genitive-of', b: 'dative-indirect-object', count: 4, ab: 4, ba: 0 });
});

test('confusionPairs: rows the map does not know, zero counts and self-pairs are dropped; limit and min hold', () => {
  const rows = [
    { skill_a: 'dative-indirect-object', skill_b: 'gone-skill', count: 9 },
    { skill_a: 'dative-indirect-object', skill_b: 'dative-indirect-object', count: 9 },
    { skill_a: 'dative-indirect-object', skill_b: 'ablative-means', count: 0 },
    { skill_a: 'genitive-of', skill_b: 'ablative-means', count: 2 },
    null,
  ];
  assert.deepEqual(confusionPairs(rows, SKILLS).map((p) => p.count), [2]);
  assert.deepEqual(confusionPairs(rows, SKILLS, { min: 3 }), []);
  assert.equal(confusionPairs([
    { skill_a: 'genitive-of', skill_b: 'ablative-means', count: 2 },
    { skill_a: 'dative-indirect-object', skill_b: 'ablative-means', count: 5 },
  ], SKILLS, { limit: 1 }).length, 1);
  assert.deepEqual(confusionPairs(null, SKILLS), []);
  assert.deepEqual(confusionPairs([{ skill_a: 'a', skill_b: 'b', count: 1 }], null), []);
});

test('confusionPairs is stable between repaints: equal counts settle on the skill ids', () => {
  const rows = [
    { skill_a: 'genitive-of', skill_b: 'ablative-means', count: 4 },
    { skill_a: 'dative-indirect-object', skill_b: 'ablative-means', count: 4 },
  ];
  const once = confusionPairs(rows, SKILLS).map((p) => [p.a, p.b]);
  const twice = confusionPairs([...rows].reverse(), SKILLS).map((p) => [p.a, p.b]);
  assert.deepEqual(once, twice);
});

test("confusionReason: a lesson's own confusion block first, whichever lesson names the other", () => {
  const a = SKILLS.get('dative-indirect-object');
  const b = SKILLS.get('ablative-means');
  const lessonA = { core: [{ type: 'rule', text: 'r' }, { type: 'confusion', with: 'ablative-means', text: 'A dative names a person; an ablative names a thing used.' }] };
  assert.equal(confusionReason(a, b, { lessonA }), 'A dative names a person; an ablative names a thing used.');
  // The other lesson may be the one that names it.
  const lessonB = { core: [{ type: 'confusion', with: 'dative-indirect-object', text: 'The means is never a receiver.' }] };
  assert.equal(confusionReason(a, b, { lessonB }), 'The means is never a receiver.');
  // An empty block is not a reason.
  assert.match(confusionReason(a, b, { lessonA: { core: [{ type: 'confusion', with: 'ablative-means', text: '   ' }] } }), /^Dative: the indirect object is the dative/);
});

test('confusionReason falls back to the two plain glosses, then to something true', () => {
  const a = SKILLS.get('dative-indirect-object');
  const b = SKILLS.get('ablative-means');
  assert.equal(confusionReason(a, b, {}), "Dative: the indirect object is the dative (the 'to/for' form); Ablative of means is the ablative (the 'by/with' form).");
  assert.equal(confusionReason({ title: 'A', summary: 'One.' }, { title: 'B', summary: 'Two.' }, {}), 'A: One. B: Two.');
  assert.match(confusionReason(null, null, {}), /practising them side by side/);
});

test('confusionsOf: one skill\'s confusions either way round, with its own direction counted', () => {
  const rows = [
    { skill_a: 'dative-indirect-object', skill_b: 'ablative-means', count: 3 },
    { skill_a: 'ablative-means', skill_b: 'dative-indirect-object', count: 7 },
    { skill_a: 'genitive-of', skill_b: 'ablative-means', count: 1 },
    { skill_a: 'dative-indirect-object', skill_b: 'gone', count: 5 },
  ];
  assert.deepEqual(confusionsOf('dative-indirect-object', rows, SKILLS), [{ other: 'ablative-means', count: 10, mine: 3 }]);
  assert.deepEqual(confusionsOf('genitive-of', rows, SKILLS), [{ other: 'ablative-means', count: 1, mine: 1 }]);
  assert.deepEqual(confusionsOf('nobody', rows, SKILLS), []);
});

/* ------------------------------------------------------- the pair session */

test('buildPairSession alternates exactly the two skills, no two kinds in a row', () => {
  const plan = buildPairSession({ a: 'dative-indirect-object', b: 'ablative-means', skills: SKILLS, size: 10, seed: 7 });
  assert.equal(plan.length, 10);
  assert.deepEqual([...new Set(plan.map((p) => p.skill))].sort(), ['ablative-means', 'dative-indirect-object']);
  assert.equal(plan[0].skill, 'dative-indirect-object', 'the direction actually answered wrongly leads');
  plan.forEach((p, i) => { if (i) assert.notEqual(p.skill, plan[i - 1].skill, `slot ${i} repeats a skill`); });
  plan.forEach((p, i) => { if (i) assert.notEqual(p.kind, plan[i - 1].kind, `slot ${i} repeats a kind`); });
  assert.ok(plan.every((p) => p.pair === true && p.currentWeek === false));
});

test('buildPairSession takes each skill\'s own stage, and refuses a pair it cannot build', () => {
  const states = new Map([['dative-indirect-object', { skill: 'dative-indirect-object', stage: 3 }], ['ablative-means', { skill: 'ablative-means', stage: 1 }]]);
  const plan = buildPairSession({ a: 'dative-indirect-object', b: 'ablative-means', states, skills: SKILLS, size: 6, seed: 3 });
  assert.deepEqual(plan.filter((p) => p.skill === 'dative-indirect-object').map((p) => p.stage), [3, 3, 3]);
  assert.deepEqual(plan.filter((p) => p.skill === 'ablative-means').map((p) => p.stage), [1, 1, 1]);
  assert.deepEqual(buildPairSession({ a: 'dative-indirect-object', b: 'nobody', skills: SKILLS }), []);
  assert.deepEqual(buildPairSession({ a: 'dative-indirect-object', b: 'dative-indirect-object', skills: SKILLS }), []);
  // A skill with one kind at its stage (genitive-of: recognise only) still may not sit beside the same kind.
  const one = buildPairSession({ a: 'genitive-of', b: 'ablative-means', skills: SKILLS, size: 6, seed: 11 });
  one.forEach((p, i) => { if (i) assert.notEqual(p.kind, one[i - 1].kind); });
  assert.equal(buildPairSession({ a: 'genitive-of', b: 'ablative-means', skills: SKILLS, size: 1, seed: 1 }).length, 2, 'a pair session is never shorter than one of each');
});

/* ------------------------------------------------------------- history */

test('skillHistory counts right / hinted / wrong and fills the day strip', () => {
  const now = Date.parse(at(20, 12));
  const rows = [
    attempt({ at: at(18), correct: true }),
    attempt({ at: at(19), correct: true, hinted: true }),
    attempt({ at: at(19, 12), correct: false, answer: 'puellae', expected: 'puellīs' }),
    attempt({ at: at(20), correct: true }),
  ];
  const h = skillHistory(rows, { now, days: 5 });
  assert.equal(h.total, 4);
  assert.equal(h.read, 4);
  assert.equal(h.windowed, false);
  assert.deepEqual(h.counts, { right: 2, hinted: 1, wrong: 1 });
  assert.equal(h.perDay.length, 5);
  assert.equal(h.perDay.reduce((n, d) => n + d.items, 0), 4);
  const last = h.perDay[h.perDay.length - 1];
  assert.equal(last.items, 1);
  assert.equal(last.right, 1);
});

test('skillHistory windows a long log to its tail and says so', () => {
  const rows = Array.from({ length: 900 }, (_, i) => attempt({ at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), correct: i % 3 !== 0 }));
  const h = skillHistory(rows, { max: 400, now: Date.parse(rows[rows.length - 1].at) });
  assert.equal(h.total, 900, 'the count is honest about the whole log…');
  assert.equal(h.read, 400, '…while only the tail is read');
  assert.equal(h.windowed, true);
  assert.equal(h.counts.right + h.counts.hinted + h.counts.wrong, 400);
  assert.equal(h.recent.length, 20);
  assert.equal(h.recent[0].at, rows[rows.length - 1].at, 'newest first');
  assert.equal(h.trail.length, 400, 'the replay never walks more than the window either');
});

test('skillHistory.recent carries the learner\'s answer beside the right one; a self grade is named as one', () => {
  const rows = [
    attempt({ at: at(18), correct: false, kind: 'blank', answer: 'puellae', expected: 'puellīs' }),
    attempt({ at: at(19), correct: true, kind: 'translate', self: true, hinted: true, answer: 'self: right', expected: 'The girl gives the boy a rose.' }),
  ];
  const h = skillHistory(rows, { now: Date.parse(at(19, 12)) });
  assert.deepEqual(h.recent.map((r) => [r.kind, r.given, r.expected, r.correct]), [
    ['translate', 'graded right', 'The girl gives the boy a rose.', true],
    ['blank', 'puellae', 'puellīs', false],
  ]);
  assert.equal(h.recent[0].self, true);
  assert.deepEqual(skillHistory([], {}).recent, []);
  assert.equal(skillHistory(null, {}).total, 0);
});

test('progressTrail replays stability and stage with the scheduler that wrote them; Learn attempts do not move it', () => {
  const rows = [
    attempt({ at: at(1), mode: 'learn', correct: true }),
    attempt({ at: at(2), correct: true, ms: 3000 }),
    attempt({ at: at(3), correct: true, ms: 3000 }),
    attempt({ at: at(4), correct: false }),
  ];
  const { trail, stageChanges } = progressTrail(rows);
  assert.equal(trail.length, 4, 'every attempt is a point, learn included');
  assert.equal(trail[0].stability, trail[0].stability, 'the learn attempt leaves the state where it found it');
  // The learn point equals a fresh state's stability, i.e. the replay skipped it.
  assert.equal(trail[0].stability, newState('x').stability_days);
  assert.ok(trail[2].stability > trail[1].stability, 'two right answers grow it');
  assert.ok(trail[3].stability < trail[2].stability, 'a wrong answer cuts it');
  assert.ok(Array.isArray(stageChanges));
  // The replay is the scheduler's own arithmetic, not a copy of it.
  let s = newState('dative-indirect-object', Date.parse(at(1)));
  for (const r of rows.filter((x) => x.mode !== 'learn')) s = applyAnswer(s, { correct: r.correct, hinted: r.hinted, ms: r.ms, now: Date.parse(r.at) });
  assert.equal(trail[3].stability, s.stability_days);
  assert.equal(trail[3].stage, s.stage);
  assert.deepEqual(progressTrail([]), { trail: [], stageChanges: [] });
});

test('progressTrail reports a stage change when one happens', () => {
  const rows = Array.from({ length: 5 }, (_, i) => attempt({ at: at(2 + i), correct: true, ms: 3000 }));
  const { stageChanges } = progressTrail(rows);
  assert.equal(stageChanges.length, 1, 'four right in a row at a stage moves it up, once');
  assert.deepEqual([stageChanges[0].from, stageChanges[0].to], [1, 2]);
  assert.equal(stageChanges[0].at, rows[3].at);
});

test('fmtStability says a stability in words', () => {
  assert.equal(fmtStability(0), '—');
  assert.equal(fmtStability(0.02), 'under an hour');
  assert.equal(fmtStability(0.5), '12 hours');
  assert.equal(fmtStability(1), '1 day');
  assert.equal(fmtStability(3.4), '3 days');
  assert.equal(fmtStability(90), '3 months');
});

/* -------------------------------------------------------- printed charts */

const PARADIGM = {
  title: 'puella, -ae f.',
  note: 'First declension.',
  sections: [
    { title: 'Singular', headers: ['form'], rows: [
      { label: 'nominative', cells: [{ stem: 'puell', ending: 'a' }] },
      { label: 'dative', cells: [{ stem: 'puell', ending: 'ae', hit: true }] },
    ] },
    { title: 'Plural', headers: ['form'], rows: [
      { label: 'nominative', cells: [{ text: 'puellae' }] },
      { label: 'dative', cells: [{ stem: 'puell', ending: 'īs', hit: true, alt: 'puellābus' }] },
      { label: 'locative', cells: [{ empty: true }] },
    ] },
  ],
};

test('paradigmPages: one page per section, cells flattened to text, marked cells counted', () => {
  const pages = paradigmPages(PARADIGM);
  assert.equal(pages.length, 2, 'one table a page');
  assert.deepEqual(pages.map((p) => [p.title, p.hits]), [['Singular', 1], ['Plural', 1]]);
  assert.deepEqual(pages[0].rows.map((r) => [r.label, r.cells[0].text, r.cells[0].hit]), [['nominative', 'puella', false], ['dative', 'puellae', true]]);
  assert.equal(pages[1].rows[1].cells[0].text, 'puellīs / puellābus', 'an alternative form prints beside the main one');
  assert.equal(pages[1].rows[2].cells[0].text, '—');
  assert.equal(pages[1].rows[2].cells[0].empty, true);
  assert.deepEqual(paradigmPages(null), []);
  assert.deepEqual(paradigmPages({ sections: [] }), []);
});

test('cellText keeps the macrons it was given and never invents a form', () => {
  assert.equal(cellText({ stem: 'puell', ending: 'īs' }), 'puellīs');
  assert.equal(cellText({ text: 'sunt' }), 'sunt');
  assert.equal(cellText({ text: 'eō', alt: 'eā' }), 'eō / eā');
  assert.equal(cellText({ empty: true }), '—');
  assert.equal(cellText(null), '—');
});

test('focusNote names the marks in the skill\'s own plain words, and says nothing when nothing is marked', () => {
  const skill = SKILLS.get('dative-indirect-object');
  assert.equal(focusNote(skill, 0), null, 'no marks, no key');
  assert.match(focusNote(skill, 2), /^Boxed cells are the forms this skill is about — the dative \(the 'to\/for' form\)\.$/);
  assert.equal(focusNote({}, 1), 'Boxed cells are the forms this skill is about.');
});

test('sheetSubtitle: chapter, course week and the Latin label, macrons kept', () => {
  assert.equal(sheetSubtitle(SKILLS.get('dative-indirect-object'), { roman }), 'Cap. VII · 101 week 7 · cāsus datīvus');
  assert.equal(sheetSubtitle({ chapter: 3, course: '103' }, { roman }), 'Cap. III · 103 week —');
  assert.equal(sheetSubtitle(null, { roman }), '');
});
