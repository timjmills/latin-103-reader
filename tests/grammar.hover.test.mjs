// node --test tests/ — the pointer-dictionary's one rule, held at the source.
//
// The behaviour itself is DOM and pointer work, verified in a real browser (a
// tap item's word stays silent before it is answered, and answers afterwards).
// What can be held here is the wiring that behaviour depends on, because each
// piece is easy to delete by accident while editing something else nearby:
//
//   - a tap item's words carry `g-w--pick`, which is the only thing that tells
//     "this word is the answer" apart from "this word is a word";
//   - the hover consults it, and consults `answered()` rather than opening;
//   - `answered()` knows all three ways the section says an item is over —
//     the run's `data-result`, the noticing opener's `data-done`, and a
//     teaching step, which stamps neither and shows a feedback node instead;
//   - the noticing opener actually sets `data-done`, which is the half that
//     was missing when this was first written: suppression worked and the
//     word then stayed silent for ever.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');

test('a tap item marks its words as the answer, so the dictionary can tell them apart', () => {
  assert.match(UI, /g-w--pick/, 'the marker class is gone');
  assert.match(
    UI,
    /class: `g-w\$\{[^`]*\}\$\{tap \? ' g-w--pick' : ''\}`/,
    'the marker is no longer put on by `latin()` when the words are the answer',
  );
});

test('the pointer-dictionary holds off on an unanswered tap word', () => {
  assert.match(
    UI,
    /if \(w\.classList\.contains\('g-w--pick'\) && !answered\(w\)\) return;/,
    'the hover no longer checks the marker before opening',
  );
});

test('answered() knows every way this section says an item is over', () => {
  const fn = /function answered\(w\)\s*\{([\s\S]*?)\n  \}/.exec(UI);
  assert.ok(fn, 'answered() is gone');
  const body = fn[1];
  assert.match(body, /data-result/, "the run's stamp is not consulted");
  assert.match(body, /data-done/, "the noticing opener's stamp is not consulted");
  assert.match(body, /g-fb/, 'a teaching step stamps neither, and its feedback node is not consulted');
});

test('the noticing opener says in the DOM that it is over', () => {
  // Without this the suppression is one-way: the words go quiet and never come back.
  assert.match(
    UI,
    /if \(done\) return; done = true;\s*\n(?:\s*\/\/[^\n]*\n)*\s*node\.dataset\.done = '1';/,
    'the opener no longer records that it has finished',
  );
});

test('the hover opens as a tooltip: no keyboard focus, and only where hovering is real', () => {
  assert.match(UI, /if \(!hover\) pop\.querySelector\('\.g-pop__close'\)\.focus/, 'a hover popup would take the caret');
  assert.match(UI, /\(hover: hover\) and \(pointer: fine\)/, 'a touch screen would fire the hover on the tap that chooses a word');
});
