// node --test tests/ — how much of a chart's table was printed before the
// learner started, from the attempt that records it to the line the selection
// page's parts panel shows (GRAMMAR-CONTRACT.md §12's ladder, §18.1's
// limitation). The ladder is a percentage GIVEN — 80 is the easiest rung and 0
// is the table from memory — so every assertion here is about that direction
// as much as about the number.
//
// Behaviour only: the recording is proved by running a chart item through a
// real session and reading the attempt it wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGiven, createCatalogueDrill, SCAFFOLD_STEPS } from '../app/js/grammar/session.js';
import { givenNote } from '../app/js/grammar/ui.js';

/**
 * A whole-table chart item over invented Latin — three cells of a made-up
 * paradigm, which is all the judge and the scaffold need. `given` is the cells
 * printed for the learner; `shown` is how many the view put on screen, which is
 * what tells a blank table from a phone's single cell.
 */
const table = ({ given = [], shown = 3, byWord = false, cells = 3 } = {}) => {
  const answers = ['nūvela', 'nūvelae', 'nūvelam'].slice(0, cells);
  return {
    skill: 'made-up-skill', kind: 'chart', input: 'chart', lemma: 'nūvela, nūvelae f',
    prompt: { question: 'Fill in the table.' },
    chart: {
      byWord,
      given: [...given],
      shown,
      section: 0,
      target: { row: 0, col: 0 },
      cells: answers.map((a, i) => ({ answer: [a], label: `cell ${i + 1}`, row: i, col: 0 })),
      table: { kind: 'noun', sections: [{ title: 'singular', headers: [], rows: [] }] },
    },
  };
};

/* --------------------------------------------- what the item itself says */

test('a whole table reports the percentage given, and a blank one reports 0 rather than nothing', () => {
  assert.equal(chartGiven(table({ given: [], shown: 3 })), 0, 'the table from memory is a level, and the best one');
  assert.equal(chartGiven(table({ given: [0, 1], shown: 3 })), 67);
  assert.equal(chartGiven(table({ given: [0], shown: 3 })), 33);
});

test('every rung of the ladder is a percentage given, 80 the easiest and 0 unaided', () => {
  assert.deepEqual([...SCAFFOLD_STEPS], [80, 50, 20, 0], 'the app\'s own numbers, in order of difficulty');
  const ten = table({ shown: 10, cells: 3 });
  ten.chart.cells = Array.from({ length: 10 }, (_, i) => ({ answer: [`nūvel${i}`], label: `cell ${i}`, row: i, col: 0 }));
  for (const pct of SCAFFOLD_STEPS) {
    ten.chart.given = Array.from({ length: pct / 10 }, (_, i) => i);
    assert.equal(chartGiven(ten), pct);
  }
});

test('a question that was not a whole table records no level at all', () => {
  // A phone shows ONE cell of the table and hands the other two to the grader, which is the opposite of
  // an unaided table: writing that down as 0 would be the worst reading available.
  assert.equal(chartGiven(table({ given: [], shown: 1 })), null, 'a phone\'s single cell');
  assert.equal(chartGiven(table({ given: [], shown: 3, byWord: true })), null, 'a step\'s chart over words gives nothing and withholds nothing');
  assert.equal(chartGiven(table({ given: [], shown: 1, cells: 1 })), null, 'a one-cell item has no table to scaffold');
  const never = table();
  delete never.chart.shown;
  assert.equal(chartGiven(never), null, 'an item no view has drawn says nothing about what was on screen');
  assert.equal(chartGiven({ skill: 's', kind: 'parse', input: 'type' }), null, 'nothing that is not a chart');
  assert.equal(chartGiven(null), null);
});

/* ------------------------------------ what the attempt carries, end to end */

/** Answer one prepared item in a real session and hand back the attempt it wrote. */
const answered = async (item, value) => {
  const drill = createCatalogueDrill({ items: [item], gstore: null, skillId: null });
  const cur = drill.start();
  assert.ok(cur, 'the item is on screen');
  const res = await drill.runner.answer(value);
  assert.ok(res.attempt, 'the first answer to an item is logged');
  return res;
};
const rightAnswers = (item) => Object.fromEntries(item.chart.cells.map((c, i) => [i, c.answer[0]]));

test('a chart attempt carries the level it was completed at; a table from memory says 0, not nothing', async () => {
  const blank = table({ given: [], shown: 3 });
  const res = await answered(blank, rightAnswers(blank));
  assert.equal(res.correct, true);
  assert.equal(res.attempt.meta.given, 0, 'the level is written down, and 0 is a level');
});

test('a scaffolded table says how much of it was printed', async () => {
  const easy = table({ given: [0, 1], shown: 3 });
  const res = await answered(easy, rightAnswers(easy));
  assert.equal(res.attempt.meta.given, 67, 'two of three cells given');
});

test('a question with no level to report carries no meta at all', async () => {
  const phone = table({ given: [], shown: 1 });
  const res = await answered(phone, rightAnswers(phone));
  assert.equal(res.attempt.meta, undefined, 'an unknown level is absent, never 0');
});

test('a chart got wrong still records the level it was attempted at, and the model ignores it', async () => {
  const blank = table({ given: [], shown: 3 });
  const res = await answered(blank, { 0: 'wrong', 1: 'wrong', 2: 'wrong' });
  assert.equal(res.correct, false);
  assert.equal(res.attempt.meta.given, 0, 'what was on screen is a fact about the attempt either way');
});

/* --------------------------------------- how the parts panel says it */

test('the panel names the rung, and the two ends of the ladder never read alike', () => {
  assert.equal(givenNote({ done: true, given: 0 }), 'completed unaided');
  assert.equal(givenNote({ done: true, given: 20 }), 'completed with 20% given');
  assert.equal(givenNote({ done: true, given: 50 }), 'completed with 50% given');
  assert.equal(givenNote({ done: true, given: 80 }), 'completed with 80% given');
  const lines = SCAFFOLD_STEPS.map((g) => givenNote({ done: true, given: g }));
  assert.equal(new Set(lines).size, SCAFFOLD_STEPS.length);
  // Which way round it is has to be unmistakable: "at 80%" would read as nearly finished.
  for (const l of lines.filter(Boolean)) assert.ok(!/^completed at /.test(l), `"${l}" does not say what the percentage is of`);
});

test('nothing is said when there is nothing written down, and nothing is said about a part not done', () => {
  assert.equal(givenNote({ done: true, given: null }), null, 'unknown is silent — not an achievement and not a failure');
  assert.equal(givenNote({ done: true }), null);
  assert.equal(givenNote({ done: false, given: 0 }), null, 'a part not done was not completed at any level');
  assert.equal(givenNote({ done: true, given: 'lots' }), null);
  assert.equal(givenNote(null), null);
});

test('a level line never trails off in punctuation', () => {
  // §18.2: a detail exists to add something, and nothing may hand the view a sentence that trails away.
  for (const g of SCAFFOLD_STEPS) assert.ok(!/[—–\-·:,;]\s*$/.test(givenNote({ done: true, given: g })));
});
