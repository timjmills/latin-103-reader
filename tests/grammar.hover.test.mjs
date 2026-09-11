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
// The machine the rule rides on now lives in app/js/hovergloss.js, shared with
// the reader, which was asked for the same thing ("All Latin text throughout
// should be mouse-overable"). So two of these assertions read that file
// instead: the touch-screen guard is there, and so is the gate that makes
// `skip` mean anything. They are the same facts, in their new home.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointerHovers } from '../app/js/hovergloss.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const HOVER = readFileSync(join(ROOT, 'app/js/hovergloss.js'), 'utf8');

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
    /skip: \(w\) => w\.classList\.contains\('g-w--pick'\) && !answered\(w\)/,
    'the section no longer tells the shared hover which words must keep quiet',
  );
});

test('the shared hover asks before opening, and asks before the word is taken as hovered', () => {
  // The gate itself moved out of ui.js with the rest of the machine. Without it `skip` is a
  // parameter nobody reads and the rule above is dead wiring — and if it were asked *after* the
  // word became the hovered one, a word that stopped being the answer would stay silent until the
  // pointer left it and came back, which is the bug 72a973b's `data-done` half was fixing.
  const fn = /function onIn\(e\) \{([\s\S]*?)\n  \}/.exec(HOVER);
  assert.ok(fn, 'onIn() is gone from hovergloss.js');
  const body = fn[1];
  assert.match(body, /if \(skip\(w\)\) return;/, 'the shared hover no longer consults skip()');
  assert.ok(body.indexOf('if (skip(w)) return;') < body.indexOf('at = w;'), 'skip() is consulted after the word is taken as hovered');
  assert.match(HOVER, /typeof skip !== 'function'\) throw/, 'a section may now attach the hover without saying which words keep quiet');
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

test('the hover opens as a tooltip and takes no keyboard focus', () => {
  assert.match(UI, /if \(!hover\) pop\.querySelector\('\.g-pop__close'\)\.focus/, 'a hover popup would take the caret');
});

test('whether a pointer can hover is asked of the event, not of the device', () => {
  // The first version asked `matchMedia('(hover: hover) and (pointer: fine)')`. Those describe the PRIMARY
  // input only, so a Windows laptop with a touchscreen answered "coarse, cannot hover" with a mouse plugged
  // into it, and the feature was simply off for the reader who asked for it. A pointer event carries what
  // it actually is, so the same machine answers a mouse and ignores a finger.
  assert.equal(pointerHovers({ pointerType: 'mouse' }), true, 'a mouse would no longer hover');
  assert.equal(pointerHovers({ pointerType: 'pen' }), true, 'a pen would no longer hover');
  assert.equal(pointerHovers({ pointerType: 'touch' }), false, 'a finger would open the gloss on the tap that chooses a word');
  assert.equal(pointerHovers({}), true, 'an event that says nothing would lose the hover altogether');
  assert.equal(pointerHovers(), true);
  assert.match(HOVER, /root\.addEventListener\('pointerover', onIn\);/, 'mouseover carries no pointerType, so the guard would be blind');
  assert.match(HOVER, /root\.addEventListener\('pointerout', onOut\);/);
  // The query may appear only inside a comment explaining why it went, never as a live test again.
  const code = HOVER.split(/\r?\n/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  assert.ok(!/matchMedia/.test(code), 'back to asking the device instead of the event');
});
