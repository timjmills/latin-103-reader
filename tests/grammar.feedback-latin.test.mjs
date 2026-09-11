// node --test tests/ — "All Latin text throughout should be mouse-overable for
// the meaning" (the reader, 2026-09-11, circling the feedback line), and the
// two things that came with it.
//
// The feedback line used to be one interpolated string — English and Latin
// welded together — so the Latin inside it carried no `lang="la"` and the
// pointer-dictionary could not find it. It is now built from parts: a plain
// string is English, `{ la }` is Latin and is drawn as its own `lang="la"`
// span, which `wordsOnDemand` cuts into hoverable words on first hover.
//
// Two things these tests hold, because both are easy to break:
//
//   - the line **reads** exactly as it did. `ctx.say` speaks the rendered
//     `.g-fb__line` textContent, so the parts joined back together must equal
//     the string the interpolated code produced, to the character. Each case
//     below spells that string out literally rather than deriving it.
//   - English is **never** marked. A marked English word would pop the
//     dictionary open on itself and be read out as Latin.
//
// Also here: the vocabulary item's sentence in context (the reader asked for a
// sentence showing the word in use, right or wrong), and the second guess in
// place on a wrong answer.
//
// No Latin from the book appears here. Every sentence and form below is
// invented for the test; everything else is read from the shipped data at run
// time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackParts, answerIsLatin, vocabExample, secondGuess, SECOND_GUESS_INPUTS } from '../app/js/grammar/ui.js';
import { la, partsText } from '../app/js/grammar/items.js';
import { createSetItems } from '../app/js/grammar/sets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8').replace(/\r\n/g, '\n');

/** The line as the learner hears it, and the Latin fragments in it. */
const text = (parts) => partsText(parts);
const latinOf = (parts) => parts.filter((p) => p && typeof p === 'object').map((p) => p.la);
const englishOf = (parts) => parts.filter((p) => typeof p === 'string').join('');

/* --------------------------------------------------------------- parts */

test('partsText joins the line back into exactly the string it prints', () => {
  const parts = ['You tapped ', la('fēlēs'), '; the word that fits is ', la('mēnsā'), '.'];
  assert.equal(text(parts), 'You tapped fēlēs; the word that fits is mēnsā.');
  assert.deepEqual(latinOf(parts), ['fēlēs', 'mēnsā']);
});

/* ------------------------------------------------- every branch, in turn */

// A feedback whose `short` is itself built from parts: the lead-in English, the sentence Latin.
const SHORT = { short: 'The chapter says: Fēlēs in mēnsā dormit.', parts: ['The chapter says: ', la('Fēlēs in mēnsā dormit.')] };
const PLAIN_SHORT = { short: 'A dative is the to/for form.' };

test('a right answer: the line is unchanged, and the sentence inside it is marked as Latin', () => {
  const item = { input: 'type', kind: 'question' };
  const parts = feedbackParts(item, { correct: true }, SHORT);
  assert.equal(text(parts), 'Right. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(parts), ['Fēlēs in mēnsā dormit.']);
});

test('a self-graded translate keeps its three openings, and marks nothing English', () => {
  const item = { input: 'self', kind: 'translate' };
  for (const [given, lead] of [['right', 'Right, by your own account. '], ['partly', 'Partly — worth another look. '], ['wrong', 'Not this time. ']]) {
    const parts = feedbackParts(item, { given, correct: given !== 'wrong' }, SHORT);
    assert.equal(text(parts), `${lead}The chapter says: Fēlēs in mēnsā dormit.`);
    assert.equal(englishOf(parts), lead + 'The chapter says: ');
  }
});

test('a tap: the tapped word and the word that fits are Latin, the parse between them is not', () => {
  const item = { input: 'tap', kind: 'recognise' };
  const result = { correct: false, given: 'fēlēs', expected: 'mēnsā' };
  const parts = feedbackParts(item, result, SHORT, { parse: 'nominative singular' });
  assert.equal(text(parts), 'You tapped fēlēs — nominative singular; the word that fits is mēnsā. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(parts), ['fēlēs', 'mēnsā', 'Fēlēs in mēnsā dormit.']);
  assert.ok(!englishOf(parts).includes('fēlēs'), 'the tapped word is not left in the English run');
  // With no reading for the word the dash and the parse simply go, as they always did.
  assert.equal(text(feedbackParts(item, result, SHORT)), 'You tapped fēlēs; the word that fits is mēnsā. The chapter says: Fēlēs in mēnsā dormit.');
});

test('a choice: a Latin label is marked, an English one is not', () => {
  const laItem = { input: 'choice', kind: 'blank' };
  const laResult = { correct: false, expected: 'mēnsae', choice: { label: 'mēnsā', plain: null } };
  const laParts = feedbackParts(laItem, laResult, SHORT);
  assert.equal(text(laParts), 'You chose mēnsā; the answer is mēnsae. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(laParts), ['mēnsā', 'mēnsae', 'Fēlēs in mēnsā dormit.']);

  // A parse item is answered in English: nothing in the line but the feedback's own sentence is Latin.
  const enItem = { input: 'choice', kind: 'parse' };
  const enParts = feedbackParts(enItem, { correct: false, expected: 'dative singular', choice: { label: 'ablative singular', plain: "the by/with/from form" } }, PLAIN_SHORT);
  assert.equal(text(enParts), 'You chose ablative singular (the by/with/from form); the answer is dative singular. A dative is the to/for form.');
  assert.deepEqual(latinOf(enParts), [], 'an English answer is never marked as Latin');
});

test('a chart, a pensum and a bank name the boxes that went wrong, each form its own Latin', () => {
  const item = { input: 'chart', kind: 'chart' };
  const one = feedbackParts(item, { correct: false, cells: [{ i: 0, ok: false, given: 'mēnsa', expected: 'mēnsae' }, { i: 1, ok: true, given: 'mēnsam', expected: 'mēnsam' }] }, SHORT);
  assert.equal(text(one), 'One blank off: mēnsa → mēnsae. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(one), ['mēnsa', 'mēnsae', 'Fēlēs in mēnsā dormit.']);

  const two = feedbackParts(item, { correct: false, cells: [{ i: 0, ok: false, given: '', expected: 'mēnsae' }, { i: 1, ok: false, given: 'fēlem', expected: 'fēlēs' }] }, SHORT);
  assert.equal(text(two), '2 blanks off: — → mēnsae, fēlem → fēlēs. The chapter says: Fēlēs in mēnsā dormit.');
  assert.ok(!latinOf(two).includes('—'), 'an empty box is a dash, and a dash is not Latin');
});

test('a macron-only miss names both forms, and only the forms are Latin', () => {
  const item = { input: 'bank', kind: 'pensum' };
  const cells = [{ i: 0, ok: false, macron: true, given: 'mēnsa', expected: 'mēnsā', note: '' }];
  const label = (f) => (f === 'mēnsa' ? 'nominative singular' : 'ablative singular');
  const parts = feedbackParts(item, { correct: false, cells }, PLAIN_SHORT, { formLabel: label });
  assert.equal(text(parts), 'mēnsa is the nominative singular; here the blank wants the ablative singular, mēnsā — they differ only in the macron, and that macron is the ending. A dative is the to/for form.');
  assert.deepEqual(latinOf(parts), ['mēnsa', 'mēnsā']);
  // With no reading for either form the line falls back to "You wrote …", as it always did.
  const bare = feedbackParts(item, { correct: false, cells }, PLAIN_SHORT);
  assert.equal(text(bare), 'You wrote mēnsa; the blank wants mēnsā — they differ only in the macron, and that macron is the ending. A dative is the to/for form.');
  assert.deepEqual(latinOf(bare), ['mēnsa', 'mēnsā']);
});

test('a match pair: the word is Latin, the meaning it wanted is English', () => {
  const item = { input: 'match', kind: 'vocab' };
  const parts = feedbackParts(item, { correct: false, cells: [{ i: 0, ok: false, la: 'fēlēs', expected: 'cat' }, { i: 1, ok: true, la: 'mēnsa', expected: 'table' }] }, PLAIN_SHORT);
  assert.equal(text(parts), 'One pair off: fēlēs is cat.');
  assert.deepEqual(latinOf(parts), ['fēlēs'], 'the English meaning is not marked as Latin');
});

test('an order item reads back the learner\'s own Latin, and keeps its full stop rule', () => {
  const item = { input: 'order', kind: 'reorder' };
  const open = feedbackParts(item, { correct: false, given: 'In mēnsā fēlēs dormit' }, SHORT);
  assert.equal(text(open), 'Not quite — you had: In mēnsā fēlēs dormit. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(open), ['In mēnsā fēlēs dormit', 'Fēlēs in mēnsā dormit.']);
  const closed = feedbackParts(item, { correct: false, given: 'In mēnsā fēlēs dormit.' }, SHORT);
  assert.equal(text(closed), 'Not quite — you had: In mēnsā fēlēs dormit. The chapter says: Fēlēs in mēnsā dormit.');
});

test('the fallback line marks a typed Latin answer and leaves a typed English one alone', () => {
  const blank = feedbackParts({ input: 'type', kind: 'blank' }, { correct: false, given: 'mēnsa', expected: 'mēnsae' }, SHORT);
  assert.equal(text(blank), 'You answered mēnsa; the answer is mēnsae. The chapter says: Fēlēs in mēnsā dormit.');
  assert.deepEqual(latinOf(blank), ['mēnsa', 'mēnsae', 'Fēlēs in mēnsā dormit.']);

  const parse = feedbackParts({ input: 'type', kind: 'parse' }, { correct: false, given: 'ablative singular', expected: 'dative singular' }, PLAIN_SHORT);
  assert.equal(text(parse), 'You answered ablative singular; the answer is dative singular. A dative is the to/for form.');
  assert.deepEqual(latinOf(parse), []);

  // Nothing typed at all: a dash, and a dash is not Latin.
  const empty = feedbackParts({ input: 'type', kind: 'blank' }, { correct: false, given: '', expected: 'mēnsae' }, PLAIN_SHORT);
  assert.equal(text(empty), 'You answered —; the answer is mēnsae. A dative is the to/for form.');
  assert.deepEqual(latinOf(empty), ['mēnsae']);
});

test('a feedback whose short has no parts still prints, unmarked, exactly as before', () => {
  const parts = feedbackParts({ input: 'type', kind: 'parse' }, { correct: true }, { short: 'A dative is the to/for form.' });
  assert.equal(text(parts), 'Right. A dative is the to/for form.');
  assert.deepEqual(latinOf(parts), []);
});

test('which answers are Latin is the rule the input box itself already uses', () => {
  for (const kind of ['blank', 'transform', 'question', 'pensum']) assert.equal(answerIsLatin({ kind }), true, kind);
  for (const kind of ['parse', 'recognise', 'chart', 'translate']) assert.equal(answerIsLatin({ kind }), false, kind);
  assert.equal(answerIsLatin({ kind: 'vocab' }), false, 'Latin → English is answered in English');
  assert.equal(answerIsLatin({ kind: 'vocab' }, { rev: true }), true, 'the reverse deck is answered in Latin');
  // The very rule `itemNode` writes on the box, so the two can never disagree.
  assert.match(UI, /const latinTyped = item\.kind === 'blank' \|\| item\.kind === 'transform' \|\| item\.kind === 'question' \|\| item\.kind === 'pensum' \|\| \(item\.kind === 'vocab' && skill\?\.rev\)/);
});

/* ------------------------------------------- the producers of `short` */

test('a set item\'s own feedback carries its Latin as parts, not welded into the string', () => {
  const deck = { chapter: 4, words: [
    { lemma: 'fēlēs', dict: 'fēlēs, fēlis f', pos: 'N', meaning: 'cat', parts: null, unit_id: null },
    { lemma: 'mēnsa', dict: 'mēnsa, mēnsae f', pos: 'N', meaning: 'table', parts: null, unit_id: null },
    { lemma: 'columna', dict: 'columna, columnae f', pos: 'N', meaning: 'column', parts: null, unit_id: null },
    { lemma: 'tabula', dict: 'tabula, tabulae f', pos: 'N', meaning: 'board', parts: null, unit_id: null },
  ] };
  const skill = { id: 'vocab-04', set: 'vocab', chapter: 4, plain: 'chapter IV words', kinds: ['vocab'], rev: false, data: deck };
  const sets = new Map([[skill.id, skill]]);
  const pool = { chooseInfo: (_s, _k, keys) => ({ key: keys[0], wrapped: false }) };
  const gen = createSetItems({ sets, units: [], pool, rand: () => 0.9 });
  const item = gen.generate({ skill: 'vocab-04', kind: 'vocab', stage: 1, match: false });
  assert.ok(item, 'the deck makes an item');
  assert.ok(Array.isArray(item.feedback.parts), 'the feedback carries parts');
  assert.equal(partsText(item.feedback.parts), item.feedback.short, 'and they say the very same thing as `short`');
  assert.ok(item.feedback.parts.some((p) => p && typeof p === 'object' && p.la === 'fēlēs'), 'the headword is marked as Latin');
  assert.ok(item.feedback.parts.some((p) => typeof p === 'string' && p.includes('cat')), 'the meaning is left as English');
});

test('the question line marks the word it asks about, and nothing else', () => {
  const deck = { chapter: 4, words: [
    { lemma: 'fēlēs', dict: 'fēlēs, fēlis f', pos: 'N', meaning: 'cat', parts: null, unit_id: null },
    { lemma: 'mēnsa', dict: 'mēnsa, mēnsae f', pos: 'N', meaning: 'table', parts: null, unit_id: null },
    { lemma: 'columna', dict: 'columna, columnae f', pos: 'N', meaning: 'column', parts: null, unit_id: null },
  ] };
  const skill = { id: 'vocab-04', set: 'vocab', chapter: 4, plain: 'chapter IV words', kinds: ['vocab'], rev: false, data: deck };
  const gen = createSetItems({ sets: new Map([[skill.id, skill]]), units: [], pool: { chooseInfo: (_s, _k, keys) => ({ key: keys[0], wrapped: false }) }, rand: () => 0.9 });
  const item = gen.generate({ skill: 'vocab-04', kind: 'vocab', stage: 1, match: false });
  assert.equal(item.prompt.question, 'What does fēlēs mean?', 'the question still reads as it always did');
  assert.deepEqual(latinOf(item.prompt.questionParts), ['fēlēs'], 'and only the headword in it is Latin');
  assert.equal(englishOf(item.prompt.questionParts), 'What does  mean?');
  // The view draws the parts where a generator gave them, and the string where it did not.
  assert.match(UI, /question\(item\.prompt\.questionParts \?\? item\.prompt\.question\)/);
});

/* ---------------------------------------- the sentence in context (task 2) */

const SENTENCES = [
  { la: 'Fēlēs in mēnsā dormit.', en: 'The cat sleeps on the table.', chapter: 4 },
  { la: 'Columna alba in hortō stat.', en: 'A white column stands in the garden.', chapter: 9 },
];
// Crude on purpose: the real one asks the dictionary, so a form need not equal the headword.
const isForm = (token, lemma) => token.replace(/[.,]/g, '').toLowerCase().startsWith(lemma.slice(0, 4).toLowerCase());

test('a vocabulary word is shown in a sentence that uses it, with the word lit', () => {
  const got = vocabExample({ lemma: 'mēnsa', chapter: 9, isForm, pools: [{ source: 'written', sentences: SENTENCES }] });
  assert.ok(got, 'a sentence is found');
  assert.equal(got.la, 'Fēlēs in mēnsā dormit.');
  assert.equal(got.en, 'The cat sleeps on the table.');
  assert.deepEqual(got.lit, [2], 'the inflected form is lit, matched on the dictionary and not on the spelling');
  assert.equal(got.ahead, false);
});

test('the sources are preferred in order, and a sentence with no lightable form is passed over', () => {
  const pools = [
    { source: 'written', sentences: [{ la: 'Tabula nigra est.', en: 'The board is black.', chapter: 4 }] },
    { source: 'book', sentences: SENTENCES },
  ];
  assert.equal(vocabExample({ lemma: 'tabula', chapter: 9, isForm, pools }).source, 'written', 'the written sentences come first');
  // Nothing written uses this word, so the book's own sentence answers instead.
  const book = vocabExample({ lemma: 'columna', chapter: 9, isForm, pools });
  assert.equal(book.source, 'book');
  assert.equal(book.la, 'Columna alba in hortō stat.');
  assert.equal(vocabExample({ lemma: 'nāvis', chapter: 9, isForm, pools }), null, 'a word no sentence uses shows nothing at all');
});

test('a sentence further on than the learner has read is shown, and says so', () => {
  const got = vocabExample({ lemma: 'columna', chapter: 5, isForm, pools: [{ source: 'written', sentences: SENTENCES }] });
  assert.ok(got, 'better a later sentence than none');
  assert.equal(got.ahead, true);
  assert.equal(got.sentenceChapter, 9);
  // A sentence at or before the chapter always wins over a later one, whatever order the pool is in.
  const both = vocabExample({ lemma: 'in', chapter: 4, isForm, pools: [{ source: 'written', sentences: [SENTENCES[1], SENTENCES[0]] }] });
  assert.equal(both.la, 'Fēlēs in mēnsā dormit.');
  assert.equal(both.ahead, false);
});

test('the vocabulary example is drawn with the same block a question\'s sentence uses', () => {
  assert.match(UI, /vocabExampleNode/, 'the view has a node for it');
  assert.match(UI, /g-fb__ctx/, 'and it is the question feedback\'s own block');
  // The English is behind the same disclosure a question's is, never shown first.
  assert.match(UI, /vocabExampleNode[\s\S]{0,1400}?class: 'g-q-en'/, 'the English is offered, not given');
  assert.match(UI, /further on than you have read/, 'and a later sentence says so in the section\'s own words');
});

/* ------------------------------------------- the second guess (task 3) */

test('a wrong answer leaves the item live where a second guess is worth making', () => {
  // Typed and filled-in answers are the ones with work in them worth adjusting.
  for (const input of ['type', 'chart', 'inline', 'bank', 'order']) {
    assert.equal(secondGuess({ input }, { correct: false }), true, input);
    assert.ok(SECOND_GUESS_INPUTS.has(input));
  }
  // A right answer is finished; a replay behind the frontier is read, never re-graded.
  assert.equal(secondGuess({ input: 'type' }, { correct: true }), false);
  // Where the feedback has already handed over the answer by marking it on screen, or where there is
  // nothing to adjust, the item closes as it always did.
  for (const input of ['choice', 'tap', 'match', 'self']) assert.equal(secondGuess({ input }, { correct: false }), false, input);
});

test('the second guess is re-judged and never re-logged', () => {
  // The runner already refuses to write a second answer down; this is the half that must not be lost.
  const SESSION = readFileSync(join(ROOT, 'app/js/grammar/session.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(SESSION, /if \(index < frontier \|\| results\[index\]\) return \{ \.\.\.result, retry: true/);
  // The item re-opens only on the say-so of the answer handler, which is what knows how it went.
  assert.match(UI, /const again = await onAnswer\(v\);/);
  assert.match(UI, /if \(!again\) return;/);
  assert.match(UI, /submitted = false;/, 'and the item takes answers again');
  // The feedback node stays on screen while the item is live: the pointer-dictionary reads it to know
  // the words have stopped being the answer (`answered()`), and the learner reads it to fix the answer.
  assert.ok(UI.includes("querySelector(':scope > .g-fb')?.remove()"), 'the old feedback is replaced, so only one verdict is ever on screen');
  // Named for what they do, now that changing your answer is the third thing you can do.
  assert.match(UI, /'Start again'/);
  assert.match(UI, /'Skip'/);
});

test('a chart\'s second guess keeps the cells that were right, as its rebuild already does', () => {
  assert.match(UI, /reopenCells/, 'the live chart clears the wrong boxes and keeps the right ones');
  assert.match(UI, /chart\.keep = keptCells\(item, v, new Set\(inputs\.keys\(\)\)\)/, 'from the same memo the rebuild uses');
});
