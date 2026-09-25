// node --test tests/ — the pure helpers behind the side panel's sentence stack
// (tablet + desktop): row identity, ordering and the sentence header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowKey, stackWith, stackWithout, sentenceTitle, firstLine } from '../app/js/wordpanel.js';

const note = { kind: 'note', unit: { id: 'w01:4.2', note: 'A note.' } };
const hl = (text, label = 'deponent perfect') => ({ kind: 'hl', hl: { text, label, note: 'n' } });
const word = (form, text = form) => ({ kind: 'word', form, text, unitId: 'w01:4.2', hl: null, result: { entries: [] }, index: 0 });

test('rowKey: one note, one row per highlight (label + text), one per form', () => {
  assert.equal(rowKey(note), 'note');
  assert.equal(rowKey(hl('profectus est')), rowKey(hl('profectus est')));
  assert.notEqual(rowKey(hl('profectus est')), rowKey(hl('loquī')));
  assert.notEqual(rowKey(hl('loquī', 'a')), rowKey(hl('loquī', 'b')));
  assert.equal(rowKey(word('lupus', 'Lupus')), 'word:lupus');
});

test('stackWith: note on top, then highlights, then words in sentence order (by position, not tap order)', () => {
  const at = (row, pos) => ({ ...row, pos });
  const hlAt = (text, start) => ({ kind: 'hl', hl: { text, label: 'deponent perfect', note: 'n', start } });
  let rows = [];
  rows = stackWith(rows, at(word('rīvum'), 40));      // tapped first, stands last
  rows = stackWith(rows, at(word('agnus'), 17));
  rows = stackWith(rows, hlAt('loquī', 30));
  rows = stackWith(rows, note);
  rows = stackWith(rows, at(word('lupus'), 8));
  rows = stackWith(rows, hlAt('profectus est', 3));
  assert.deepEqual(rows.map(rowKey), ['note', rowKey(hlAt('profectus est', 3)), rowKey(hlAt('loquī', 30)), 'word:lupus', 'word:agnus', 'word:rīvum']);
});

test('stackWith: rows without a position go after positioned ones, in tap order', () => {
  let rows = stackWith([], word('sine'));
  rows = stackWith(rows, { ...word('morā'), pos: 5 });
  rows = stackWith(rows, word('ūlla'));
  assert.deepEqual(rows.map(rowKey), ['word:morā', 'word:sine', 'word:ūlla']);
});

test('stackWith: a row already present keeps its place and the same array comes back; inputs are not mutated', () => {
  const a = stackWith(stackWith([], word('lupus')), word('agnus'));
  const again = stackWith(a, word('lupus', 'LUPUS'));
  assert.equal(again, a);
  assert.deepEqual(a.map((r) => r.text), ['lupus', 'agnus']);
  const b = stackWith(a, note);
  assert.equal(a.length, 2);                       // the old array is untouched
  assert.deepEqual(b.map(rowKey), ['note', 'word:lupus', 'word:agnus']);
});

test('stackWithout drops one row and keeps the rest in order', () => {
  const rows = [note, hl('loquī'), word('lupus'), word('agnus')];
  assert.deepEqual(stackWithout(rows, 'word:lupus').map(rowKey), ['note', rowKey(hl('loquī')), 'word:agnus']);
  assert.deepEqual(stackWithout(rows, 'nope').map(rowKey), rows.map(rowKey));
});

test('sentenceTitle: part · line, sentence with line numbers; the id tail for block ids; a fallback without a unit', () => {
  assert.equal(sentenceTitle({ id: 'w01:4.2', line_no: 4, part: 'Pars I' }), 'Pars I · line 4, sentence 2');
  assert.equal(sentenceTitle({ id: 'w01:25.3', part: 'Pars II' }), 'Pars II · line 25, sentence 3');   // the line from the id when line_no is missing
  assert.equal(sentenceTitle({ id: 'w07:b3.2', part: 'Capitulum XXV' }), 'Capitulum XXV · b3.2');
  assert.equal(sentenceTitle({ id: 'w01:4.2', line_no: 4, part: 'Pars I' }, { hasLineNumbers: false }), 'Pars I · 4.2');
  assert.equal(sentenceTitle({ id: 'x', order: 6 }), 'sentence 7');
  assert.equal(sentenceTitle(null), 'This sentence');
});

test('firstLine: the first non-empty line, trimmed', () => {
  assert.equal(firstLine('  One.\n\nTwo. '), 'One.');
  assert.equal(firstLine('\n  \nOnly this'), 'Only this');
  assert.equal(firstLine(null), '');
});

/* ======== 2026-09-25: a press shows the word; the underline is a + / − ======== */
import { readFileSync } from 'node:fs';
const PANEL = readFileSync(new URL('../app/js/wordpanel.js', import.meta.url), 'utf8');
const READER = readFileSync(new URL('../app/js/reader.js', import.meta.url), 'utf8');
const PANEL_CSS = readFileSync(new URL('../app/css/panels.css', import.meta.url), 'utf8');

test('a press on a word only shows it: it no longer underlines, learns or un-learns the word', () => {
  const start = PANEL.indexOf('async showWord(');
  const body = PANEL.slice(start, PANEL.indexOf('showNote(', start));
  assert.ok(body.length > 200, 'showWord moved; this test is reading the wrong lines');
  assert.doesNotMatch(body, /store\.(addLookup|markLearned|unlearn|removeLookup)/, 'a press still changes the word\'s underline');
  assert.doesNotMatch(body, /onLookupsChanged\(/, 'a press still rewrites the page\'s underlines');
  assert.match(body, /pressedKey = rowKey\(item\)/, 'the pressed word is no longer marked for its box');
});

test('the underline has its own small button: + underlines, − moves it to the learned words', () => {
  const fn = PANEL.slice(PANEL.indexOf('function markButton('), PANEL.indexOf('function actions('));
  assert.match(fn, /on \? 'learned' : rec \? 'unlearn' : 'add'/, 'the button no longer picks add / learned / unlearn from the word\'s state');
  assert.match(fn, /on \? '\u2212' : '\+'/, 'the button no longer reads + or −');
  assert.match(PANEL, /add: \(\) => store\.addLookup\(form/, '+ does not add the word to the learning list');
  assert.match(PANEL, /markButton\(row\.form, row\.text\)/, 'the panel row has lost its + / −');
});

test('the word just pressed is boxed in the panel — a frame and a tint, not colour alone', () => {
  assert.match(PANEL, /key === pressedKey/);
  assert.match(PANEL_CSS, /\.stack__row\.is-pressed \{[^}]*box-shadow: inset 0 0 0 2px/, 'the pressed row lost its frame');
  assert.match(PANEL_CSS, /\.stack__row\.is-pressed \{[^}]*background:/, 'the pressed row lost its tint');
});

test('reading a sentence aloud leaves the text where it is', () => {
  const fn = READER.slice(READER.indexOf('setPlayingUnit(unitId) {'), READER.indexOf('setPlayingWord('));
  assert.ok(fn.length > 200, 'setPlayingUnit moved; this test is reading the wrong lines');
  assert.doesNotMatch(fn, /block: 'center'/, 'the sentence being read is pulled to the middle of the screen again');
  assert.match(fn, /r\.bottom <= 0 \|\| r\.top >= window\.innerHeight/, 'the only scroll left is for a sentence wholly out of sight');
});
