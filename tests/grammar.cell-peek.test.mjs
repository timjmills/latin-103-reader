// node --test tests/ — a typed cell's hint answers inside the cell, and never counts as an answer.
//
// The complaint this holds: pressing "?" beside a cell opened a panel under the input, the page grew, and
// the table, the question and the learner's own hands slid downward — at the exact moment they were reading
// a cell. A typed cell now shows its own form *in the box* and takes it away on the next press.
//
// The behaviour is DOM and pointer work, verified in a real browser. What is held here is the wiring it
// depends on, and above all the one rule that would be silent and expensive if it broke: **a form only
// being looked at is not an answer**. It is not graded, it does not make an empty chart gradeable, and it
// does not paint a cell green. Everything that reads a cell reads `valueOf`, and if a single reader goes
// back to reading the box, the learner is handed marks they did not earn.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'app/css/grammar.css'), 'utf8');

/** One builder's body, so an assertion about the chart cannot be satisfied by the pensum and back. */
const fn = (name) => {
  const at = UI.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name}() is gone`);
  const next = UI.indexOf('\n  function ', at + 1);
  return UI.slice(at, next > 0 ? next : UI.length);
};
/** Comments explain; they must never be what a test matched. */
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');

test('a typed cell\'s hint is a toggle, and opens no panel under the input', () => {
  const panel = fn('boxHintPanel');
  assert.match(panel, /const control = \(id, \{ label = false, onOpen = null, given = false, peek = null \} = \{\}\)/, 'the control no longer takes a peek');
  assert.match(panel, /if \(peek && !always\) \{\s*\n\s*row\.remove\(\);/, 'the panel row is no longer removed — the page would grow again');
  assert.match(panel, /'aria-pressed': 'false'/, 'the control no longer says it is a toggle');
  assert.match(panel, /peek\(on\);/, 'the press no longer shows or hides the form');
  assert.match(panel, /if \(on\) \{ onHint\?\.\(\); onOpen\?\.\(\); \}/, 'a form asked for and given no longer counts as hinted');
});

test('*Always show* hands out the reasons, never the answers', () => {
  // `always` opens every box's hint from the start. If a peek honoured it, every cell of a table would be
  // filled with its own answer before the learner had written a word — which is not what that setting means.
  assert.match(code(fn('boxHintPanel')), /peek && !always/, 'Always show would now print the whole answer key');
});

test('the chart keeps the learner\'s writing while a cell shows its form', () => {
  const chart = code(fn('chartInput'));
  assert.match(chart, /const peeked = new Map\(\);/, 'there is nowhere to keep what the learner had written');
  assert.match(chart, /const valueOf = \(i\) => \(peeked\.has\(i\) \? peeked\.get\(i\) : inputs\.get\(i\)\?\.value \?\? ''\);/, 'reading a cell no longer prefers the learner’s own text');
  assert.match(chart, /peeked\.set\(i, inp\.value\); inp\.value = answer; inp\.readOnly = true; inp\.classList\.add\('is-peek'\)/, 'showing the form no longer stashes what was there');
  assert.match(chart, /inp\.value = peeked\.get\(i\) \?\? ''; peeked\.delete\(i\); inp\.readOnly = false; inp\.classList\.remove\('is-peek'\)/, 'hiding it no longer gives the writing back');
  // readOnly, not disabled: a disabled box leaves the tab order, and Alt+H could no longer put the form away.
  assert.ok(!/inp\.disabled = true; inp\.classList\.add\('is-peek'\)/.test(chart), 'a peeked box must stay reachable from the keyboard');
});

test('a form only being looked at is never graded, and never fills an empty chart', () => {
  const chart = code(fn('chartInput'));
  assert.match(chart, /const filledAny = \(\) => \[\.\.\.inputs\.keys\(\)\]\.some\(\(i\) => String\(valueOf\(i\)\)/, 'a shown answer would make an empty chart gradeable — the whole answer key for one press (M-5)');
  assert.match(chart, /v\[i\] = inputs\.has\(i\) \? valueOf\(i\) : c\.answer\[0\]/, 'the graded table no longer reads the learner’s own writing');
  assert.match(chart, /mark: \(i\) => paintCells\.mark\(i, valueOf\(i\)/, 'Enter would judge the cell against the answer it is showing');
  assert.match(chart, /if \(!inp\.disabled && !peeked\.has\(i\)\) paintCells\.mark/, 'leaving a cell that is showing its form would paint it green');
  assert.match(chart, /const v = collect\(\); closePeeks\(\);/, 'the graded table would keep showing forms the learner never wrote');
  assert.match(chart, /const closePeeks = \(\) => \{ for \(const btnEl of hints\.values\(\)\)/, 'nothing puts the shown forms back');
});

test('a pensum ending does the same, and shows the ending alone', () => {
  const pensum = code(fn('inlineInput'));
  assert.match(pensum, /const valueOf = \(i\) => \(peeked\.has\(i\) \? peeked\.get\(i\) : inputs\.get\(i\)\?\.value \?\? ''\);/);
  // The stem is already printed in the sentence in front of the box; the box holds what the box asks for.
  assert.match(pensum, /const ending = b\.answers\?\.\[0\] \?\? null;/, 'the blank no longer shows its own ending');
  assert.ok(!/inp\.value = `\$\{b\.stem/.test(pensum), 'the stem would be printed twice, as it was in C1');
  assert.match(pensum, /const anyEnding = \(\) => \[\.\.\.inputs\.keys\(\)\]\.some\(\(i\) => String\(valueOf\(i\)\)/);
  assert.match(pensum, /v\[i\] = valueOf\(i\); \}\); closePeeks\(\);/, 'the graded sentence no longer reads the learner’s own writing');
  assert.match(pensum, /if \(!inp\.disabled && !peeked\.has\(i\)\) cells\.mark/);
  assert.match(pensum, /mark: \(i\) => cells\.mark\(i, valueOf\(i\)/);
});

test('the key help says what the key now does', () => {
  // Alt+H used to open a panel; it toggles the form in the box, and the same key puts it away.
  assert.match(fn('inlineInput'), /Alt\+H shows that ending and hides it again/, 'the help still promises a hint that opens');
});

test('a shown form cannot be mistaken for the learner\'s own writing', () => {
  assert.match(CSS, /\.g-input\.is-peek \{ border-style: dashed;/, 'the shown form looks exactly like a typed one');
  assert.match(CSS, /\.g-hintb--peek\[aria-pressed="true"\]/, 'the pressed control gives no sign it is on');
});
