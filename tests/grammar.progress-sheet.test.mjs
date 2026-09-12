// node --test tests/ — the skill map's progress row: the surface half of
// progress.js (learner, 2026-09-12: "use a bit of color to show how many parts
// of a lesson skill extra have been practice. maybe have it mouse over it
// popsup with whats done or not").
//
// progress.js's own arithmetic is held by tests/grammar.progress.test.mjs.
// What is held here is what the *page* does with it, and it splits in two:
//
//   Real logic. The three pure helpers the panel is built out of — the wording
//   of one part's line, where the panel is placed, and the meter's label — are
//   exported from ui.js and exercised for real, because each carries a rule
//   that is easy to break while editing something else: "not yet" must survive
//   a detail, the panel must flip rather than open off-screen, and the label
//   must carry the whole count for a reader who cannot see the ticks.
//
//   Wiring. The meter's markup and the builder it hands the panel cannot be
//   run without a DOM, so they are read out of the source — with every comment
//   line stripped first, because a test that passes against the comment
//   explaining the rule is worse than no test (it has happened in this repo).
//   The **panel** machinery this file used to hold is no longer the meter's
//   own: §23 gave it to the chapter line and the state word as well, and its
//   rules (the pointer guard, the seven listeners, one tap opening it, the
//   fixed body-mounted panel and its clamp) moved to
//   tests/grammar.explainers.test.mjs with it.
//
// One of these is a regression, not a precaution: `.g-prog` was already the
// `<progress>` bar of a chapter set's Learn pass, and the meter took that class
// name, so all 88 rows grew a 26rem grey stripe. Caught in the browser, held
// here.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partLine, panelPlace, meterLabel } from '../app/js/grammar/ui.js';
import { PARTS } from '../app/js/grammar/progress.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'app/css/grammar.css'), 'utf8');
const SW = readFileSync(join(ROOT, 'app/sw.js'), 'utf8');

/** Source with every comment line taken out, so no assertion below can pass against prose. */
const code = (src) => src
  .split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');
const UI_CODE = code(UI);
const CSS_CODE = code(CSS);

/* ------------------------------------------------- one part's line */

test('a part that is done shows its evidence', () => {
  assert.deepEqual(partLine({ done: true, detail: '22 items, 22 right', blurb: 'b' }), { mark: '✓', notYet: false, text: '22 items, 22 right' });
});

test('a part that is done with nothing to report still says so', () => {
  assert.deepEqual(partLine({ done: true, detail: null, blurb: 'b' }), { mark: '✓', notYet: false, text: 'done' });
});

test('"not yet" survives a detail — the mark, the word and the colour say one thing', () => {
  // The live bug this holds: a lapsed skill's `mastered` part is NOT done and still carries
  // "1 of 3 spaced successes", which read as an achievement under a tick whose colour the
  // reader may not see. The word now comes first and is separate, so the panel cannot lie.
  const line = partLine({ done: false, detail: '1 of 3 spaced successes', blurb: 'three spaced successes' });
  assert.equal(line.mark, '–');
  assert.equal(line.notYet, true, 'a part that is not done stopped saying so in words');
  assert.equal(line.text, ' — 1 of 3 spaced successes');
});

test('a part not yet begun falls back to what the part is, never to a bare line', () => {
  const line = partLine({ done: false, detail: null, blurb: 'its paradigm table filled in, cell by cell' });
  assert.deepEqual(line, { mark: '–', notYet: true, text: ' — its paradigm table filled in, cell by cell' });
  assert.notEqual(partLine({ done: false }).mark, partLine({ done: true }).mark, 'done and not-done share a mark, so the shape signal is gone');
});

test('every shipped part has a blurb, so the fallback above is never empty', () => {
  for (const p of PARTS) {
    assert.ok(p.blurb && p.blurb.trim().length > 3, `${p.key} has no blurb for the panel to fall back to`);
    assert.equal(partLine({ ...p, done: false }).text, ` — ${p.blurb}`);
  }
});

/* --------------------------------------------------- where it goes */

const box = (top, h = 24, left = 540) => ({ top, bottom: top + h, left });

test('the panel opens below its meter when there is room', () => {
  const { y } = panelPlace(box(200), { h: 300, w: 320, vw: 1440, vh: 900 });
  assert.equal(y, 232, 'not 8px under the meter any more');
});

test('a row near the foot of a long map flips its panel above, not off the screen', () => {
  // 88 rows: the last of them is always near the bottom edge, and a panel that opened downward
  // there would be a panel the learner could not read.
  const { y } = panelPlace(box(700), { h: 300, w: 320, vw: 1440, vh: 900 });
  assert.equal(y, 392, 'the panel no longer flips above a meter with no room below it');
  assert.ok(y + 300 < 900, 'the flipped panel still runs off the bottom');
});

test('with room neither above nor below it stays on the screen, top and bottom', () => {
  // It used to answer `below` unclamped here, which on a phone put 68 measured px of the panel past the
  // bottom of the screen with no way to reach it. Preferring below is still right; running off the edge
  // never was. A panel taller than the screen starts at the top margin and scrolls (the CSS caps it).
  const gap = 8;
  for (const [ph, vh] of [[800, 900], [401, 727], [300, 390]]) {
    const { y } = panelPlace(box(300), { h: ph, w: 320, vw: 1440, vh });
    assert.ok(y >= gap, `h=${ph} vh=${vh}: y=${y} is off the top`);
    assert.ok(y + ph <= vh - gap || y === gap, `h=${ph} vh=${vh}: y=${y} runs ${y + ph - vh} past the bottom`);
  }
  // And it still prefers below whenever below actually fits.
  assert.equal(panelPlace(box(300), { h: 200, w: 320, vw: 1440, vh: 900 }).y, 332);
});

test('the panel is pulled back inside a 375px phone', () => {
  const w = Math.min(320, 375 - 16);
  assert.equal(panelPlace(box(200, 24, 300), { h: 300, w, vw: 375, vh: 812 }).x, 375 - w - 8, 'a panel opened near the right edge hangs off it');
  assert.equal(panelPlace(box(200, 24, 2), { h: 300, w, vw: 375, vh: 812 }).x, 8, 'a panel opened near the left edge hangs off it');
  assert.equal(panelPlace(box(200, 24, 20), { h: 300, w, vw: 375, vh: 812 }).x, 20, 'a panel that fits was moved anyway');
});

/* ------------------------------------------------------- the label */

test('the meter says its whole count in words, for a reader who cannot see the ticks', () => {
  assert.equal(meterLabel('Adjective agreement', { done: 3, total: 6 }), '3 of 6 parts of Adjective agreement practised — show which');
  assert.equal(meterLabel('A metre skill', { done: 1, total: 1 }), '1 of 1 part of A metre skill practised — show which', 'a one-part skill reads "1 parts"');
  assert.equal(meterLabel('X', {}), '0 of 0 parts of X practised — show which');
});

/* ------------------------------------------------------ the wiring */

test('the meter is not the class of the progress bar that was already there', () => {
  // `.g-prog` is the `<progress>` element of a chapter set's Learn pass: `width: 100%; max-width: 26rem;
  // height: 6px`. The meter took that name and every one of the 88 rows grew a grey stripe.
  assert.match(CSS_CODE, /\.g-prog \{[^}]*appearance: none/, 'the progress bar this collided with has moved or gone; re-check the name');
  // `g-prog` belongs to that <progress> element and to nothing else in the section.
  const progUses = [...UI_CODE.matchAll(/class: 'g-prog'/g)].length;
  assert.equal(progUses, 1, `'g-prog' is on ${progUses} elements — one of them is not the Learn progress bar`);
  assert.match(UI_CODE, /h\('progress', \{ class: 'g-prog'/, 'the one g-prog is no longer the <progress> element');
  assert.match(UI_CODE, /class: 'g-parts', 'data-level'/, 'the meter no longer carries its own class and its level');
});

test('every class the meter draws is styled', () => {
  const used = new Set([...UI_CODE.matchAll(/'(g-parts(?:__[a-z]+)?)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 4, `only ${used.size} meter classes found in ui.js — the markup moved`);
  for (const cls of used) assert.match(CSS_CODE, new RegExp(`\\.${cls}[\\s,:[{]`), `.${cls} is drawn but never styled`);
  // The panel's own classes are no longer the meter's: §23 gave the panel to three labels, so it is
  // `.g-tip*` and is styled and held next door. Nothing may go on drawing the old ones.
  assert.ok(!/g-parts__panel/.test(UI_CODE), 'the meter is drawing the old panel class again');
  assert.ok(!/g-parts__panel/.test(CSS_CODE), 'the old panel class is still styled — two panels, or a dead rule');
});

test('colour is never the only signal: a count and a tick shape carry it too', () => {
  // The count is text and the tick heights differ, so the row reads in greyscale and to a
  // colour-blind reader. The colour ramp is keyed off `level`, never off `ratio`.
  // §22.1 named the unit in that count: a bare "3 of 6" beside a six-step lesson was read as steps.
  assert.match(UI_CODE, /class: 'g-parts__count'[^)]*text: `\$\{p\.done\} of \$\{p\.total\} part\$\{p\.total === 1 \? '' : 's'\}`/, 'the row stopped printing its count, or stopped naming its unit');
  assert.match(CSS_CODE, /\.g-parts__tick \{[^}]*height: 4px/, 'an unfinished tick is no longer a short stub');
  assert.match(CSS_CODE, /\.g-parts__tick\[data-done="1"\] \{[^}]*height: 10px/, 'a finished tick is no longer a full stroke');
  for (const level of ['most', 'all']) assert.match(CSS_CODE, new RegExp(`\\.g-parts\\[data-level="${level}"\\]`), `the ${level} band lost its colour`);
  assert.ok(!/data-ratio/.test(UI_CODE), 'the row is colouring itself from the raw ratio instead of the band');
});

/* --------------------------- the meter's end of the shared panel */
// §18 built the panel machinery here for the meter; §23 generalised it — one panel node, one delegated
// set of listeners, one `[data-tip]` selector — and gave it to the chapter line and the state word too.
// The machinery's own rules (the pointer guard, the seven listeners, one tap opening it, the fixed
// body-mounted panel, the clamp, the dictionary keeping quiet) moved with it to
// tests/grammar.explainers.test.mjs. What is the *meter's* is still held here.

test('the meter is a trigger of the shared panel, and hands it a builder', () => {
  assert.match(UI_CODE, /type: 'button', class: 'g-parts', 'data-level': p\.level, 'data-tip': 'parts'/, 'the meter is no longer a button, or no longer opens the shared panel');
  assert.match(UI_CODE, /tipData\.set\(b, \(\) => partsTip\(title, p\)\);/, 'the meter no longer registers what its panel should say');
  assert.match(UI_CODE, /'aria-label': meterLabel\(title, p\)/, 'the meter stopped carrying its whole count for a screen reader');
  assert.match(UI_CODE, /tipCheck\(\);/, 'a panel left open against a row a redraw replaced is no longer closed');
  // Built when it opens, not at paint: the map draws ~88 meters and three triggers a row.
  assert.match(UI_CODE, /const d = tipData\.get\(el\)\?\.\(\);/, 'the panel content is no longer a thunk, so every row formats one at every paint');
});

test('nothing in the meter changes size under the hand reaching for it', () => {
  // §17.3: a control the learner reaches from inside the row must not move when the row is judged.
  assert.ok(!/\.g-parts:hover \{[^}]*(padding|font-size|border-width)/.test(CSS_CODE), 'the meter changes size on hover, so it moves under the hand');
});

test('the map asks progress.js, and asks it per row', () => {
  assert.match(UI_CODE, /import \{ PARTS, skillProgress \} from '\.\/progress\.js';/, 'the surface is computing progress itself');
  const fn = /function progressOf\(s, known = true\) \{([\s\S]*?)\n  \}/.exec(UI_CODE);
  assert.ok(fn, 'progressOf() is gone');
  for (const key of ['state', 'attempts', 'learn', 'drillable', 'hasBank']) {
    assert.match(fn[1], new RegExp(`${key}:`), `${key} is no longer handed to skillProgress, so that part can never tick`);
  }
  assert.match(fn[1], /if \(!known\) return null;/, 'a row with no generator yet claims a denominator it cannot know');
  // Both kinds of row on the selection page carry it: a skill and a chapter set.
  assert.match(UI_CODE, /partsMeter\(s\.title, progressOf\(s, known\)\)/, 'the skill rows lost their meter');
  assert.match(UI_CODE, /partsMeter\(SET_ROW_LABEL\[s\.set\] \?\? s\.id, progressOf\(s, known\)\)/, 'the chapter-set rows lost their meter');
});

test('the learn store is read once a paint, not 88 times', () => {
  // `learnPlace` is one of progressOf's inputs, so the map now asks it per row.
  assert.match(UI_CODE, /if \(text === learnMemo\.text\) return learnMemo\.value;/, 'learnAll() parses localStorage afresh for every row again');
  assert.match(UI_CODE, /learnMemo = \{ text, value: normaliseLearn\(raw\) \};/, 'the memo is never filled, so it never hits — or the migration moved out of the one read');
});

test('progress.js is precached and the cache version moved with it', () => {
  assert.match(SW, /'\.\/js\/grammar\/progress\.js',/, 'a module the section imports is missing from the install');
  const v = /const CACHE_VERSION = 'v(\d+)';/.exec(SW);
  assert.ok(v && Number(v[1]) >= 54, `CACHE_VERSION is v${v?.[1]} — a new precached file needs a bump`);
});
