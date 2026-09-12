// node --test tests/ — the noticing opener asks both of its examples, not one.
//
// The opener shows two sentences and asks what their focus words share. A correct tap used to light the
// focus words in **both** columns and finish, so the learner answered one example and was handed the
// other (2026-09-12: "I clicked on the first circled word which was correct but it revealed both
// examples so I did not have a hcance to guess the second"). Two examples are two chances to notice;
// the shared pattern is the reward for having found both, not a reason to give the second away.
//
// The behaviour is DOM work, verified in a browser. What is held here is the wiring it rests on, each
// piece being easy to undo while editing nearby — above all that the lighting is scoped to the column
// that was tapped, which is the whole of the fix.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
/** Comments explain; they must never be the thing a test matched. */
const code = UI.split(/\r?\n/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

test('a right tap lights only the sentence it was made in', () => {
  assert.match(code, /for \(const idx of fi\) p\.querySelector\(`\.g-w\[data-index="\$\{idx\}"\]`\)\?\.classList\.add\('g-w--target', 'is-right'\);/,
    'the tap no longer lights its own sentence, or lights it by some other route');
  // The old form walked every column from inside one column's handler. That is the giveaway.
  assert.ok(!/columns\.forEach\(\(c, k\) => \{ for \(const idx of focusSpanOf\(pair\[k\]\)\)/.test(code),
    'a tap in one sentence is lighting every sentence again');
});

test('the opener keeps count, and finishes only when every example has been found', () => {
  assert.match(code, /const found = new Set\(\);/, 'nothing records which examples the learner has found');
  assert.match(code, /const columns = pair\.map\(\(w, ci\) => \{/, 'the handler cannot tell which column it is in');
  assert.match(code, /found\.add\(ci\);/);
  assert.match(code, /if \(found\.size < pair\.length\) \{/, 'the opener no longer waits for the other example');
  // Finishing is inside the "all found" branch — never on the first tap.
  assert.match(code, /found\.size < pair\.length[\s\S]{0,400}?finish\(\{ found: true \}\)/,
    'finish() has escaped the all-found branch, so one tap ends the opener again');
});

test('the line names what was found and points at what is left, without naming it', () => {
  assert.match(code, /Now find it in the other sentence\./, 'the learner is not told there is another one to do');
  // What is named is only what they have already found — naming the other one would be the giveaway again.
  assert.match(code, /const named = pair\.map\(\(x, k\) => \(found\.has\(k\) \? x\.focus \|\| '' : ''\)\)\.filter\(Boolean\);/,
    'the running line names focus words the learner has not found yet');
});

test('a single-example opener still finishes on its one answer', () => {
  // `found.size < pair.length` is false at once when there is one column, so the all-found branch runs.
  // Guard against a future rewrite that hard-codes two.
  // Scoped to the opener: a whole-file scan matched `startPair` in the confusable-pair session, which
  // legitimately does deal in exactly two, and failed on it. A guard that fires on unrelated code is noise.
  const at = UI.indexOf('function noticeNode(');
  const next = UI.indexOf('\n  function ', at + 1);
  const opener = UI.slice(at, next > 0 ? next : UI.length);
  assert.ok(opener.includes('found.size < pair.length'), 'the opener no longer counts against its own examples');
  assert.ok(!/found\.size < 2\b/.test(opener), 'the opener assumes exactly two examples');
  assert.ok(!/pair\.length === 2/.test(opener), 'the opener assumes exactly two examples');
});
