// node --test tests/ — the Latin in an explanation is marked as Latin, so the pointer can answer on it.
//
// "All Latin text throughout should be mouse-overable for the meaning." Two places were still missing:
//
//   - **a hint.** "This cell wants the accusative of īnsula" was one plain string, so the word was not a
//     word the dictionary could be asked about. Hints now carry `levelParts` beside `levels`.
//   - **bold in teaching prose.** Italic has always been Latin (`inline` marks it), but bold carries a
//     Latin word or ending (*legere*, *-erit*, *quī*) **and** an English grammar term ("the dative (the
//     'to/for' form)") with the same mark. The dictionary decides — which is the same question as
//     "would hovering this say anything?".
//
// The invariant that matters most here is not the marking; it is that `levels` stays a list of plain
// strings. `hintTexts`, the no-leak sweep and several tests read it as one, and that is what keeps an
// answer from reaching the screen inside a hint. `levelParts` may never become the only copy of the line.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxHints } from '../app/js/grammar/session.js';
import { partsText } from '../app/js/grammar/items.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const LESSONS = readFileSync(join(ROOT, 'app/js/grammar/lessons.js'), 'utf8');

/** A chart item on an invented word, so nothing here is the book's. */
const chartItem = () => ({
  kind: 'chart', input: 'chart', skill: 'x', lemma: 'fīcta -ae f',
  prompt: { question: 'Fill in the cases of fīcta' },
  chart: {
    head: 'fīcta',
    cells: [{ label: 'accusative singular', answer: ['fīctam'], row: 0, col: 0 }],
    target: { row: 0, col: 0 },
  },
});

test('a hint level is still a plain string — the sweep reads it, and must keep reading it', () => {
  const boxes = boxHints(chartItem(), {});
  assert.ok(boxes.length, 'the chart gives no hints at all');
  for (const b of boxes) for (const l of b.levels) assert.equal(typeof l, 'string', 'a level stopped being a string: the no-leak sweep now reads an object');
});

test('a hint carries the same line with its Latin marked, and the two cannot drift', () => {
  const [box] = boxHints(chartItem(), {});
  assert.ok(Array.isArray(box.levelParts), 'the marked line is gone');
  assert.equal(box.levelParts.length, box.levels.length, 'a level and its marked line are no longer aligned');
  const parts = box.levelParts[0];
  assert.ok(Array.isArray(parts), 'the first level is not marked, though it names a word');
  // The string is derived from the parts, never written twice — this is what makes the sweep honest.
  assert.equal(partsText(parts), box.levels[0], 'what is swept and what is drawn have come apart');
  const latin = parts.filter((p) => p && typeof p === 'object').map((p) => p.la);
  assert.deepEqual(latin, ['fīcta'], 'the word the cell belongs to is not marked as Latin');
});

test('a hint that names no word is left plain, and one that says "this word" never calls it Latin', () => {
  // `safe()` answers "this word" where naming the head would give the answer away. That is English.
  const item = chartItem();
  item.chart.cells = [{ label: 'nominative singular', answer: ['fīcta'], row: 0, col: 0 }];
  const [box] = boxHints(item, {});
  const marked = (box.levelParts ?? []).filter(Boolean).flat().filter((p) => p && typeof p === 'object').map((p) => p.la);
  assert.ok(!marked.includes('this word'), '"this word" is being read aloud as Latin');
  assert.ok(!marked.includes('fīcta'), 'the head is the answer to this cell and must not be printed at all');
});

test('the view draws the marked line where there is one, and the plain string where there is not', () => {
  assert.match(UI, /const hintRule = \(box, i, cls = 'g-hint__rule'\) => h\('p', \{ class: cls \},\s*\n\s*box\.levelParts\?\.\[i\] \? partsNodes\(box\.levelParts\[i\]\) : String\(box\.levels\[i\] \?\? ''\)\);/, 'the hint line no longer draws its marked form');
  assert.ok(!/'g-hint__rule', text: b\.levels\[0\]/.test(UI), 'a hint is drawn as flat text again, so its Latin is not a word');
  assert.ok(!/'g-hint__rule', text: box\.levels\[0\]/.test(UI), 'a hint is drawn as flat text again, so its Latin is not a word');
});

test('bold in teaching prose is Latin only when the dictionary knows every word of it', () => {
  assert.match(LESSONS, /export function inline\(text, \{ latin = null \} = \{\}\)/, 'inline no longer asks anyone whether a bold is Latin');
  assert.match(LESSONS, /if \(latin\?\.\(b\.textContent\)\) b\.lang = 'la';/, 'bold is marked without asking, or not marked at all');
  // Italic has always been Latin in this prose and stays so unconditionally.
  assert.match(LESSONS, /const i = document\.createElement\('i'\); i\.lang = 'la';/);
  assert.match(UI, /const laKnown = \(t\) => \{/, 'the dictionary is no longer what decides');
  assert.match(UI, /return words\.every\(\(w\) => dict\.lookup\(w\)\.entries\.length > 0\);/, 'a bold with one unknown word would be called Latin');
  assert.match(UI, /const prose = \(text\) => inline\(text, \{ latin: laKnown \}\);/);
  // Every piece of teaching prose goes through it: a bare `inline(` here is a surface that lost the rule.
  assert.ok(!/[^a-zA-Z]inline\(/.test(UI.replace(/inline\(text, \{ latin: laKnown \}\)/, '')), 'some prose still renders without the Latin rule');
});

test('the pointer says nothing about a word the dictionary has never heard of', () => {
  // A box reading "Not in the dictionary" under the pointer is what the learner met as "it is not showing
  // the Latin when hovering". A click still answers: there they asked a direct question.
  assert.match(UI, /if \(hover && !r\.entries\.length\) return;/, 'a hover over an unknown word opens an empty box again');
});
