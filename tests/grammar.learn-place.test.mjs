// node --test tests/ — which teaching steps are finished, and what the lesson
// does with that (GRAMMAR-CONTRACT.md §22; learner, 2026-09-12: "on the
// previous screen it showned me this but wehn I went in I did not know what
// was finished. It shoudl direct me to the unfinsihed parts unless I
// pruposfully want to retry").
//
// Three things were settled and each is held here:
//
//   §22.1  the row's meter names its unit — "3 of 6 parts" — so it can no
//          longer be read as the six teaching steps inside the lesson;
//   §22.2  a finished step carries a tick and is a way back to itself, an
//          unreached one is plain, and neither says so by colour alone;
//   §22.3  "Continue learning" opens the first unfinished step, never the
//          last place the learner stood.
//
// Split the way tests/grammar.progress-sheet.test.mjs splits. The model — the
// stored set, its migration, which step "continue" picks, what a mark says —
// is pure and is run for real, including one walk of a real lesson through the
// real runner so the set is built out of what the runner actually reports.
// The wiring (delegation, class names, the route) needs a DOM and is read out
// of the source instead, with every comment line stripped first: an assertion
// that passes against the prose explaining the rule is worse than none, and
// that has happened in this repo.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseLearn, stepsDone, withSteps, continueAt, stepMark } from '../app/js/grammar/ui.js';
import { skillProgress } from '../app/js/grammar/progress.js';
import { indexSkills, normaliseLesson, normaliseSentences } from '../app/js/grammar/lessons.js';
import { createItems, createTeachItems } from '../app/js/grammar/items.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { createGrammarStore } from '../app/js/grammar/store-grammar.js';
import { createLearn } from '../app/js/grammar/session.js';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'app/css/grammar.css'), 'utf8');

/** Source with every comment line taken out, so no assertion below can pass against prose. */
const code = (src) => src
  .split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');
const UI_CODE = code(UI);
const CSS_CODE = code(CSS);

/* ================================================= the stored set, and the migration */

test('the set is a set: it only grows, and going back to an earlier step keeps the later ones', () => {
  let place = withSteps(null, [0]);
  assert.deepEqual(place.done, [0]);
  place = withSteps(place, [1, 2]);
  assert.deepEqual(place.done, [0, 1, 2]);
  // The whole reason the shape changed: the learner jumps back to step 2 and answers it again.
  place = withSteps(place, [1]);
  assert.deepEqual(place.done, [0, 1, 2], 'a step re-answered unfinished the ones after it');
  assert.deepEqual(withSteps({ done: [3], seen: 4, at: 7 }, [0]), { done: [0, 3], seen: 4, at: 7 }, 'the rest of the place was dropped');
});

test('a stored set is cleaned, never trusted: repeats, gaps, negatives and rubbish', () => {
  assert.deepEqual(stepsDone({ done: [2, 0, 2, 1] }), [0, 1, 2]);
  assert.deepEqual(stepsDone({ done: [-1, 1.7, 'x', null, 3] }), [1, 3]);
  assert.deepEqual(stepsDone(null), []);
  assert.deepEqual(stepsDone({ done: 'all' }), []);
});

test('migration: the single slot for the whole section becomes that skill\'s set', () => {
  // The shape before 5599f09. It must still upgrade, because a learner who has not opened the app
  // since then still has it in localStorage.
  assert.deepEqual(normaliseLearn({ skill: 'gerund', step: 3, at: 1000 }), { gerund: { done: [0, 1, 2], at: 1000 } });
});

test('migration: a position becomes the steps it means, and nobody is reset to zero', () => {
  // `step: n` was the runner's frontier, or the frontier plus one once the item there had been
  // answered. Under either reading the checks of steps 1…n are answered and step n+1 is not.
  assert.deepEqual(normaliseLearn({ gerund: { step: 3, at: 5 } }), { gerund: { done: [0, 1, 2], at: 5 } });
  assert.deepEqual(normaliseLearn({ gerund: { step: 1 } }), { gerund: { done: [0] } });
  // A lesson opened and nothing answered held nothing, and still holds nothing.
  assert.deepEqual(normaliseLearn({ gerund: { step: 0, at: 5 } }), { gerund: { at: 5 } });
  // The steps behind them, the ten on screen: every step, so "continue" still goes to the ten.
  assert.deepEqual(continueAt(normaliseLearn({ gerund: { step: 6 } }).gerund, 6), 6);
});

test('migration: an old record opens the step it opened before the change, for every position', () => {
  // The promise in one line. Before: `showSteps({ at: min(savedStep, nSteps - 1) })`, or the ten at
  // `savedStep >= nSteps`. After: the first unfinished step. For a record written by the old code —
  // which only ever moved forward — those are the same step.
  const nSteps = 6;
  for (let step = 0; step <= nSteps; step++) {
    const before = step >= nSteps ? nSteps : Math.min(step, nSteps - 1);
    const after = continueAt(normaliseLearn({ gerund: { step } }).gerund, nSteps);
    assert.equal(after, before, `an old record at step ${step} would open somewhere new`);
  }
});

test('migration: a deck\'s place is a different count and is left alone; rubbish is dropped', () => {
  assert.deepEqual(normaliseLearn({ 'vocab-07': { seen: 4, at: 9 } }), { 'vocab-07': { seen: 4, at: 9 } });
  assert.deepEqual(normaliseLearn(null), {});
  assert.deepEqual(normaliseLearn([1, 2]), {});
  assert.deepEqual(normaliseLearn({ gerund: 'x', gerund2: null }), {});
  // Already migrated: a second read changes nothing (the writer's own output must round-trip).
  const once = normaliseLearn({ gerund: { step: 4 } });
  assert.deepEqual(normaliseLearn(once), once);
});

/* ================================================= which step "continue" picks */

test('continue opens the first unfinished step, and the ten when there is none', () => {
  assert.equal(continueAt(null, 6), 0, 'a lesson never opened starts at step 1');
  assert.equal(continueAt({ done: [0, 1, 2] }, 6), 3);
  assert.equal(continueAt({ done: [0, 1, 2, 3, 4, 5] }, 6), 6, 'all six answered: the ten');
  assert.equal(continueAt({ done: [0, 1, 2, 3, 4, 5, 6, 7] }, 6), 6, 'a set longer than the lesson is still the ten');
});

test('continue picks the gap, not the furthest — which is the fault the learner reported', () => {
  // They had done 1, 2, 4 and 5 and left from a jump back to 2. The old code restored the position
  // and opened step 2 with nothing on the page saying 4 and 5 were behind them.
  assert.equal(continueAt({ done: [0, 1, 3, 4] }, 6), 2);
  assert.equal(continueAt({ done: [1, 2, 3] }, 6), 0, 'step 1 skipped is still the first unfinished one');
});

test('a lesson with no steps asks for step 0, which the view reads as "no steps"', () => {
  assert.equal(continueAt({ done: [] }, 0), 0);
  assert.equal(continueAt(null, 0), 0);
});

/* ================================================= what a mark says, and in what */

test('the three states differ in shape, not only in colour, and each says the whole thing in words', () => {
  const opts = { title: 'The ending', steps: 6 };
  const done = stepMark(1, { ...opts, state: 'done', go: true });
  const now = stepMark(2, { ...opts, state: 'now' });
  const todo = stepMark(3, { ...opts, state: 'todo' });
  assert.equal(done.glyph, '✓');
  assert.equal(now.glyph, '3');
  assert.equal(todo.glyph, '4');
  const glyphs = [done.glyph, now.glyph, todo.glyph];
  assert.equal(new Set(glyphs).size, 3, 'two states print the same glyph, so greyscale and print cannot tell them apart');
  assert.equal(done.label, 'Step 2 of 6, The ending: done. Go back to it.');
  assert.equal(now.label, 'Step 3 of 6, The ending: in progress.');
  assert.equal(todo.label, 'Step 4 of 6, The ending: not started.');
});

test('a mark is only invited to be pressed when it is one; the ten is named, never ticked', () => {
  assert.equal(stepMark(0, { title: 'A', state: 'done', steps: 6, go: false }).label, 'Step 1 of 6, A: done.');
  const ten = stepMark(6, { title: 'Ten items', state: 'todo', steps: 6, go: true });
  assert.equal(ten.glyph, 'Ten');
  assert.equal(ten.label, 'The ten items: not started. Go to it.');
  assert.equal(stepMark(6, { state: 'now', steps: 6 }).label, 'The ten items: in progress.');
  // A lesson whose step has no title still says which step it is.
  assert.equal(stepMark(0, { state: 'todo', steps: 4 }).label, 'Step 1 of 4: not started.');
});

/* ================================================= the set, built from a real run */

const dataDir = new URL('../app/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const SKILLS = indexSkills(read('grammar/skills.json')).skills;
const CAT = read('grammar/paradigms.json');
const HEADWORDS = read('glossary-headwords.json').headwords;
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const DIO = 'dative-indirect-object';
// Invented sentences, so the library the ten reaches into is this file's own and no book text is here.
const UNITS = [
  { id: 'x01:1.1', la: 'Nauta puellae pōculum dat.', en: '' },
  { id: 'x01:1.2', la: 'Coquus dominō piscem parat.', en: '' },
  { id: 'x01:1.3', la: 'Magister discipulō tabulam mōnstrat et discipulī cantant.', en: '' },
];
const answerRight = (item) => (item.input === 'chart' ? Object.fromEntries(item.chart.cells.map((c, i) => [i, c.answer[0]]))
  : item.input === 'choice' ? item.choices.find((c) => c.correct).value : item.input === 'tap' ? item.accept[0] : item.answer[0]);

/** A real Learn over a real lesson, with the same `onStep` → `withSteps` wiring the view uses. */
async function walk({ at = 0, answers = Infinity, place = null, right = true } = {}) {
  const skill = SKILLS.get(DIO);
  const gstore = createGrammarStore({ mode: 'local', storage: mem() });
  await gstore.ready();
  const items = createItems({ units: UNITS, lookup, paradigm, skills: SKILLS, storage: mem(), rand: () => 0.3 });
  const teachItems = createTeachItems({ skill, sentences: normaliseSentences(read(`grammar/sentences/${DIO}.json`), DIO).sentences, lookup, paradigm, catalogue: null, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand: () => 0.3 });
  const learn = createLearn({
    skill, gstore, teach: normaliseLesson(read(`grammar/lessons/${DIO}.json`)).teach, teachItems, currentWeekN: 107, rand: () => 0.3,
    items: createGenerator({ items, stage3: createStage3({ items, paradigm, rand: () => 0.3 }), sets: null, skills: SKILLS }),
  });
  await learn.begin();
  let held = place;
  // Exactly the view's rule: everything from where this run began up to the runner's reported position
  // has had its check answered. Nothing before `at` is touched.
  let cur = learn.startSteps({ at, onStep: (pr) => { const list = []; for (let i = at; i < pr.step; i++) list.push(i); held = withSteps(held, list); } });
  let n = 0;
  while (cur && n < answers) {
    n += 1;
    await learn.runner.answer(right ? answerRight(cur.item) : '');
    cur = learn.runner.forward();
  }
  return { place: held, steps: learn.steps.length, answered: n };
}

test('a walk of a real lesson writes down the steps it answered, and only those', async () => {
  const three = await walk({ answers: 3 });
  assert.equal(three.steps, 6, 'the lesson this test walks stopped having six steps');
  assert.deepEqual(stepsDone(three.place), [0, 1, 2]);
  assert.equal(continueAt(three.place, three.steps), 3, 'continue would not open the next one');
  const all = await walk({});
  assert.deepEqual(stepsDone(all.place), [0, 1, 2, 3, 4, 5]);
  assert.equal(continueAt(all.place, all.steps), all.steps, 'every step answered and continue does not go to the ten');
});

test('a check answered wrong is a step done: the mark is a place-keeper, not a score', async () => {
  // §18 settled that a mark must not come off by itself, and §17.1 that a form only looked at is not an
  // answer — so the threshold is the answer, and getting it wrong is what learning is. What comes back
  // because of a wrong check is the scheduler's business and the blocked ten's, not this row's.
  const wrong = await walk({ answers: 2, right: false });
  assert.deepEqual(stepsDone(wrong.place), [0, 1]);
});

test('a jump back and a walk forward from there keeps what was already answered', async () => {
  const all = await walk({});
  const again = await walk({ at: 2, answers: 1, place: all.place });
  assert.deepEqual(stepsDone(again.place), [0, 1, 2, 3, 4, 5], 'the jump back unfinished the steps after it');
  assert.equal(continueAt(again.place, again.steps), again.steps);
});

test('a run resumed part way marks nothing it did not see', async () => {
  const part = await walk({ at: 4, answers: 1 });
  assert.deepEqual(stepsDone(part.place), [4], 'resuming at step 5 claimed the four before it');
  assert.equal(continueAt(part.place, part.steps), 0, 'the first unfinished step is still step 1');
});

test('a teach-step Learn reports seen: 0 before anything is answered — so a deck\'s writer must not touch it', async () => {
  // The live device pass caught this and no test did. `createLearn` reports progress the moment
  // `startSteps` (and `startBlocked`) begins, and for a skill with teach steps `seen` is 0 at every
  // report — so the view's deck writer, `seen > 0 ? {seen} : null`, deleted that skill's whole place
  // each time a lesson was opened. It was invisible while the place was a position, because `onStep`
  // wrote one back a moment later; a set has nothing to rewrite, and the lesson forgot itself.
  const skill = SKILLS.get(DIO);
  const gstore = createGrammarStore({ mode: 'local', storage: mem() });
  await gstore.ready();
  const items = createItems({ units: UNITS, lookup, paradigm, skills: SKILLS, storage: mem(), rand: () => 0.3 });
  const reports = [];
  const learn = createLearn({
    skill, gstore, teach: normaliseLesson(read(`grammar/lessons/${DIO}.json`)).teach, currentWeekN: 107, rand: () => 0.3,
    teachItems: createTeachItems({ skill, sentences: normaliseSentences(read(`grammar/sentences/${DIO}.json`), DIO).sentences, lookup, paradigm, catalogue: null, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand: () => 0.3 }),
    items: createGenerator({ items, stage3: createStage3({ items, paradigm, rand: () => 0.3 }), sets: null, skills: SKILLS }),
    onProgress: (pr) => reports.push(pr),
  });
  await learn.begin();
  learn.startSteps({ at: 2 });
  learn.startBlocked();
  assert.ok(reports.length >= 2, 'createLearn stopped reporting progress');
  for (const pr of reports) assert.equal(pr.seen, 0, 'a skill with teach steps started counting a deck');
  assert.ok(!learn.isSet, 'this skill became a deck; the test is no longer about anything');
});

test('the view\'s deck writer is fenced off from a skill with teach steps', () => {
  assert.match(UI_CODE, /const onProgress = \(pr\) => \{ if \(skill\.set\) setLearnPlace\(pr\.skill, pr\.seen > 0 && pr\.seen < pr\.total \? \{ seen: pr\.seen \} : null\); \};/,
    'onProgress writes a lesson\'s place from a deck count again, which deletes it');
});

/* ================================================= the sheet reads the set */

test('the progress sheet reads the set: every step answered is the lesson part done', () => {
  const skill = { id: 'x', title: 'X', paradigms: [] };
  const half = skillProgress(skill, { attempts: [], learn: { done: [0, 1, 2] }, steps: 6, drillable: false });
  const lesson = (r) => r.parts.find((p) => p.key === 'lesson');
  assert.equal(lesson(half).done, false);
  assert.match(lesson(half).detail, /step 3 of 6/);
  const full = skillProgress(skill, { attempts: [], learn: { done: [0, 1, 2, 3, 4, 5] }, steps: 6, drillable: false });
  assert.equal(lesson(full).done, true);
  // The shape it replaced still reads, so a caller holding an unmigrated record is not told a lie.
  assert.equal(lesson(skillProgress(skill, { attempts: [], learn: { step: 6 }, steps: 6, drillable: false })).done, true);
});

/* ================================================= the wiring, read out of the source */

test('§22.1: the row\'s count names its unit, and the label and the panel already did', () => {
  assert.match(UI_CODE, /g-parts__count[^\n]*\$\{p\.done\} of \$\{p\.total\} part/, 'the meter still prints a bare "3 of 6"');
  assert.match(UI_CODE, /export function meterLabel[\s\S]{0,200}of \$\{title\} practised/, 'the aria-label stopped saying parts');
});

test('§22.2: the stepper draws three states, and a done pip is a button that jumps to that step', () => {
  const stepper = UI_CODE.slice(UI_CODE.indexOf('const stepper = (at) =>'), UI_CODE.indexOf('const finishQueue'));
  assert.ok(stepper.length > 200, 'the stepper moved; this test is reading the wrong lines');
  assert.match(stepper, /'data-state': state/, 'the mark does not carry its state');
  assert.match(stepper, /stepMark\(/, 'the mark is not built by the tested helper');
  assert.match(stepper, /'aria-current': at === j \? 'step' : null/, 'the step on screen stopped being aria-current');
  assert.match(stepper, /showSteps\(\{ at: j, back: true \}\)/, 'a pip no longer jumps to its step');
  assert.match(stepper, /go \? btn\(/, 'a pip that can be pressed is not a button');
  assert.match(stepper, /'aria-label': go \? null : m\.label/, 'a pip is named twice, or not at all');
  assert.match(stepper, /const go = at !== j && \(ten \? allDone : doneSteps\.has\(j\)\)/, 'an unanswered step can be jumped to, which is a way round the teaching');
});

test('§22.3: continue routes by the set, and nothing reads a saved position any more', () => {
  assert.match(UI_CODE, /else if \(nSteps && continueAt\(savedLearn, nSteps\) >= nSteps\) showBlocked\(\);/);
  assert.match(UI_CODE, /else showSteps\(\{ at: nSteps \? continueAt\(savedLearn, nSteps\) : 0 \}\);/);
  assert.ok(!/savedStep/.test(UI_CODE), 'the last-position variable is still there');
  assert.ok(!/noteStep\(/.test(UI_CODE), 'something still writes a bare position');
  assert.ok(!/writeJSON\(LS_LEARN, \{ skill:/.test(UI_CODE), 'something still writes LS_LEARN as a single slot');
  assert.match(UI_CODE, /learnMemo = \{ text, value: normaliseLearn\(raw\) \}/, 'the reader does not migrate');
});

test('§3: the done state is told by a glyph in the DOM, so the stylesheet only has to add the colour', () => {
  assert.match(CSS_CODE, /\.g-steps__s\[data-state="done"\] \{ color: var\(--success\); \}/);
  assert.match(CSS_CODE, /\.g-steps__g \{[^}]*border-radius: 50%/, 'the mark lost its own box');
  assert.match(CSS_CODE, /\.g-steps--n \.g-steps__s::before \{ display: none/, 'the CSS counter still draws over the DOM glyph');
  assert.match(CSS_CODE, /\.g-steps__go:focus-visible \{ outline:/, 'a pip takes the keyboard with no focus ring');
});

test('§21.1: the pip\'s touch target is a coarse rule, and it is in the "touch last" section', () => {
  const marker = CSS.indexOf('touch last');
  assert.ok(marker > 0, 'the "touch last" section is gone');
  const rule = CSS.indexOf('.g-steps--n .g-steps__go { min-height: var(--tap); min-width: var(--tap); }');
  assert.ok(rule > marker, 'the pip\'s 44px target is written above "touch last", where a coarse rule silently loses');
  // And the section is still the only place any of them live.
  for (const m of CSS.matchAll(/@media[^{]*pointer:\s*coarse/g)) {
    assert.ok(m.index > marker, `a (pointer: coarse) block at ${m.index} sits above "touch last"`);
  }
});
