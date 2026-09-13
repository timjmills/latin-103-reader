// node --test tests/ — the mix is chosen chapter by chapter (§26, 2026-09-13):
//
//   "for selecting things for mixed practice- I want a menu with the chapters
//    laid out vertically and horizontablly you can select the pense, practice,
//    vocab, or story questions to include in teh practice."
//
// A grid: the chapters down the side, the four kinds across the top, and a box
// in each cell. What is tested here is the shape behind it — a selection over
// (chapter, kind) pairs that has to survive a stored preference written before
// the grid existed, a library that grows, and a library that loses something.
//
// Every test below fails on the tree before the change: `mixGrid`,
// `normaliseMix`, `mixIn`, `mixWhole`, `mixHolds`, `mixToggle`, `mixCounts`,
// `mixCell`, `mixToken` and `filterMix` did not exist, `mixNote` / `mixTitle`
// took a flat list of populations and could say nothing about a chapter, and
// the Practice setup drew four global toggles with no notion of a row.
//
// No Latin from the book appears here: the words and the sentence below are
// invented for the test, and everything structural is read from the shipped
// code at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  POPULATIONS, mixCell, mixToken, mixGrid, normaliseMix, mixIn, mixWhole, mixHolds,
  filterMix, mixToggle, mixCounts, mixNote, mixTitle, setSkills, groupPensa,
} from '../app/js/grammar/sets.js';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** A file with its comment lines taken out. A source assertion that matches the comment above the code proves nothing. */
const code = (name) => src(name).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const UI = code('app/js/grammar/ui.js');
const CSS = src('app/css/grammar.css');

const skill = (id, chapter) => ({ id, set: null, chapter, title: id, plain: id, category: 'noun-case', kinds: ['recognise'], parse_filter: { case: 'nom' }, confusable_with: [], prereqs: [] });
/** Chapter sets exactly as `setSkills` builds them, from invented material. */
const setsFor = ({ questions = [], vocab = [], pensa = [] }) => setSkills({
  questions: new Map(questions.map((n) => [n, { items: [{ q: 'Ubi?' }, { q: 'Quis?' }], title: null, week_id: null }])),
  vocab: new Map(vocab.map((n) => [n, { words: [{ la: 'gluvia', en: 'a lantern' }, { la: 'marnex', en: 'a ferryman' }] }])),
  pensa: groupPensa(pensa.map((n) => ({ chapter: n, kind: 'A', items: [{ text: 'Gluvi_ clāra est.', blanks: [{ stem: 'gluvi', answers: ['a'] }] }] }))),
  weeks: [],
});

/**
 * The library the grid is drawn from. Chapter I has all four kinds, chapter II
 * has three, chapter III has a vocabulary deck and one grammar skill that
 * cannot be drilled, and chapter IV has nothing at all.
 */
const SETS = setsFor({ questions: [1, 2], vocab: [1, 2, 3], pensa: [1] });
/** The whole library as the app holds it: the grammar skills and the chapter sets in one map, as `ctx.skills` is. */
const libraryOf = (sets) => new Map([
  ['g1a', skill('g1a', 1)], ['g1b', skill('g1b', 1)], ['g2a', skill('g2a', 2)], ['g3a', skill('g3a', 3)],
  ...sets,
]);
const SKILLS = libraryOf(SETS);
const DRILLABLE = (id) => id !== 'g3a';
const GRID = mixGrid({ skills: SKILLS, sets: SETS, drillable: DRILLABLE });
const rowOf = (g, n) => g.rows.find((r) => r.chapter === n) ?? null;

/* ------------------------------------------------ 1 · what is offered */

test('a row appears for a chapter that holds something drillable, and a cell only where a question can actually come from', () => {
  assert.deepEqual(GRID.rows.map((r) => r.chapter), [1, 2, 3], 'chapter IV has nothing, so it has no row — nor do V–XXXIV');
  assert.deepEqual(GRID.kinds, [...POPULATIONS], 'all four kinds are in this library, so all four are columns');

  assert.deepEqual(Object.keys(rowOf(GRID, 1).cells).sort(), ['pensum', 'questions', 'skills', 'vocab']);
  assert.deepEqual(rowOf(GRID, 1).cells.skills, ['g1a', 'g1b'], 'a cell carries the ids it stands for');
  assert.deepEqual(rowOf(GRID, 1).cells.vocab, ['vocab-01', 'vocab-01-rev'], 'the reverse deck is vocabulary, not a fifth column');

  assert.deepEqual(Object.keys(rowOf(GRID, 2).cells).sort(), ['questions', 'skills', 'vocab'], 'chapter II has no pensum, so it has no box there');
  assert.deepEqual(Object.keys(rowOf(GRID, 3).cells), ['vocab'], 'its one grammar skill cannot be drilled, so there is no control to offer');
  assert.equal(rowOf(GRID, 4), null);

  // A column with nothing anywhere is not offered at all: a control that cannot change anything is worse than none.
  const thin = mixGrid({ skills: new Map([['g1a', skill('g1a', 1)]]), sets: new Map() });
  assert.deepEqual(thin.kinds, ['skills']);
  assert.deepEqual(thin.rows.map((r) => r.chapter), [1]);
});

test('a thing no chapter owns is named rather than lost', () => {
  const loose = mixGrid({ skills: new Map([['odd', skill('odd', null)], ['g1a', skill('g1a', 1)]]), sets: new Map() });
  assert.deepEqual(loose.rows.map((r) => r.chapter), [1], 'it has no row, because it belongs to no chapter');
  assert.deepEqual(loose.loose.skills, ['odd']);
  // It can only ever ride in on a whole column — the one honest answer when there is no cell to tick.
  assert.equal(mixHolds(['skills'], skill('odd', null)), true);
  assert.equal(mixHolds(['skills:1'], skill('odd', null)), false);
});

/* -------------------------------- 2 · the shape, and the old setting */

test('a token is either a whole column or one cell, and nothing else reads as one', () => {
  assert.deepEqual(mixToken('vocab'), { kind: 'vocab', chapter: null });
  assert.deepEqual(mixToken('vocab:26'), { kind: 'vocab', chapter: 26 });
  assert.equal(mixCell('vocab', 26), 'vocab:26');
  assert.equal(mixToken('nonsense'), null);
  assert.equal(mixToken('vocab:'), null);
  assert.equal(mixToken('vocab:nought'), null);
  assert.equal(mixToken('vocab:0'), null, 'there is no chapter zero');
  assert.equal(mixToken(null), null);
});

test('the stored preference moves forward as it stands: "Pensa only" goes on meaning Pensa only', () => {
  // What a learner has in settings.grammar.populations today, written before the grid existed.
  const sel = normaliseMix(['pensum'], GRID);
  assert.deepEqual(sel, ['pensum'], 'the old value is already a selection in the new shape — nothing is rewritten');
  assert.notEqual(sel, null, 'and it is emphatically not read as "everything"');
  assert.deepEqual([...filterMix(SKILLS, sel).keys()], ['pensum-01']);
  assert.equal(mixTitle(sel, GRID), 'Pensa only');

  // The other shapes a stored value can have.
  assert.equal(normaliseMix(null, GRID), null, 'never chosen is everything');
  assert.deepEqual(normaliseMix([], GRID), [], 'the empty choice is a real choice and is not "everything"');
  assert.deepEqual([...filterMix(SKILLS, []).keys()], []);
  // All four, which is what a learner who left every toggle on has stored, is everything and says so.
  assert.equal(normaliseMix(['skills', 'questions', 'vocab', 'pensum'], GRID), null);
  // A column the library did not hold when the choice was saved (the pensa, before sign-in) is not shut out for good.
  const noPensaSets = setsFor({ questions: [1, 2], vocab: [1, 2, 3] });
  const noPensa = mixGrid({ skills: libraryOf(noPensaSets), sets: noPensaSets, drillable: DRILLABLE });
  assert.deepEqual(noPensa.kinds, ['skills', 'questions', 'vocab']);
  assert.equal(normaliseMix(['skills', 'questions', 'vocab'], noPensa), null, 'everything there was is everything there is');
});

test('a cell is in when its own box is ticked or its whole column is, and "the whole column" is a different claim from "every chapter ticked"', () => {
  assert.equal(mixIn(null, 'vocab', 26), true);
  assert.equal(mixIn(['vocab'], 'vocab', 26), true);
  assert.equal(mixIn(['vocab:26'], 'vocab', 26), true);
  assert.equal(mixIn(['vocab:26'], 'vocab', 27), false);
  assert.equal(mixIn(['vocab:26'], 'pensum', 26), false);
  assert.equal(mixIn([], 'vocab', 26), false);

  assert.equal(mixWhole(['vocab'], 'vocab'), true);
  assert.equal(mixWhole(['vocab:1', 'vocab:2', 'vocab:3'], 'vocab'), false, 'three chapters is three chapters, however many there happen to be');
  const counts = mixCounts(['vocab:1', 'vocab:2', 'vocab:3'], GRID);
  assert.deepEqual(counts.kinds.vocab, { whole: false, on: 3, of: 3 }, 'the heading says "3 of 3" and is still not the column itself');
  assert.deepEqual(mixCounts(['vocab'], GRID).kinds.vocab, { whole: true, on: 3, of: 3 }, '…which the heading says as "all 3"');
  assert.deepEqual(counts.rows.get(1), { on: 1, of: 4 });
  assert.deepEqual(counts.rows.get(3), { on: 1, of: 1 });
});

/* ------------------------------ 3 · a library that grows, and shrinks */

test('a chapter that arrives later joins a column taken whole, and stays out of one picked chapter by chapter', () => {
  const laterSets = setsFor({ questions: [1, 2], vocab: [1, 2, 3, 4], pensa: [1] });
  const laterSkills = new Map([...SKILLS, ...laterSets, ['g4a', skill('g4a', 4)]]);
  const after = mixGrid({ skills: laterSkills, sets: laterSets, drillable: DRILLABLE });
  assert.deepEqual(after.rows.map((r) => r.chapter), [1, 2, 3, 4], 'chapter IV has material now, so it has a row now');

  const whole = normaliseMix(['vocab'], GRID);
  assert.equal(mixIn(whole, 'vocab', 4), true, '"all the vocabulary" goes on meaning all the vocabulary');
  assert.ok([...filterMix(laterSkills, whole).keys()].includes('vocab-04'));

  const picked = normaliseMix(['vocab:1', 'vocab:2', 'vocab:3'], GRID);
  assert.equal(mixIn(picked, 'vocab', 4), false, 'three chapters chosen on purpose are not quietly widened to four');
  assert.equal([...filterMix(laterSkills, picked).keys()].includes('vocab-04'), false);
  // Being out is not silent: the row is drawn, and the column's own figure says how many of how many.
  assert.deepEqual(mixCounts(picked, after).kinds.vocab, { whole: false, on: 3, of: 4 });
  assert.deepEqual(mixCounts(picked, after).rows.get(4), { on: 0, of: 2 });

  // Everything, never narrowed, takes the new chapter too.
  assert.equal(mixIn(null, 'vocab', 4), true);
});

test('material that has gone leaves its tick where it was: the token names nothing, and nothing here ever turns a cell on', () => {
  const goneSets = setsFor({ questions: [1, 2], vocab: [1, 3], pensa: [1] });
  const goneLibrary = libraryOf(goneSets);
  const gone = mixGrid({ skills: goneLibrary, sets: goneSets, drillable: DRILLABLE });
  const sel = normaliseMix(['vocab:2', 'pensum:1'], gone);
  assert.deepEqual(sel, ['vocab:2', 'pensum:1'], 'the tick for chapter II is kept, not pruned');
  assert.equal(rowOf(gone, 2).cells.vocab, undefined, 'the grid draws no box where there is nothing to drill');
  assert.deepEqual(mixCounts(sel, gone).kinds.vocab, { whole: false, on: 0, of: 2 }, 'and the tick counts for nothing while the deck is away');
  assert.deepEqual([...filterMix(goneLibrary, sel).keys()], ['pensum-01'], 'a token naming nothing filters nothing in');

  // When the deck comes back, so does the tick — which is the whole reason for keeping it.
  assert.equal(mixIn(sel, 'vocab', 2), true);
  assert.deepEqual(mixCounts(sel, GRID).kinds.vocab, { whole: false, on: 1, of: 3 });
  assert.deepEqual([...filterMix(SKILLS, sel).keys()], ['vocab-02', 'vocab-02-rev', 'pensum-01']);

  // A library that loses a chapter can never widen the mix: a narrowed column stays narrowed.
  assert.equal(mixWhole(sel, 'vocab'), false);
  assert.equal(mixIn(sel, 'vocab', 3), false);
});

/* ---------------------------------------------- 4 · pressing a control */

test('a column heading takes the whole kind, and pressing it again empties the column', () => {
  let sel = mixToggle([], { kind: 'vocab' }, GRID);
  assert.deepEqual(sel, ['vocab'], 'the column itself, not the three chapters that happen to exist today');
  assert.equal(mixWhole(sel, 'vocab'), true);
  assert.deepEqual(mixToggle(sel, { kind: 'vocab' }, GRID), []);
  // From a part-picked column the heading takes the whole of it, rather than toggling what is there.
  assert.deepEqual(mixToggle(['vocab:1'], { kind: 'vocab' }, GRID), ['vocab']);
  // Turning a column off clears its cells too, including any the grid cannot see today, and leaves the rest alone.
  sel = mixToggle(['vocab:1', 'vocab:9', 'pensum:1'], { kind: 'vocab' }, GRID);
  assert.deepEqual(sel, ['vocab', 'pensum:1']);
  assert.deepEqual(mixToggle(sel, { kind: 'vocab' }, GRID), ['pensum:1']);
});

test('taking one cell out of a column that was taken whole writes the column out, chapter by chapter', () => {
  const sel = mixToggle(['vocab'], { kind: 'vocab', chapter: 2 }, GRID);
  assert.deepEqual(sel, ['vocab:1', 'vocab:3'], 'the other chapters stay in by name');
  assert.equal(mixWhole(sel, 'vocab'), false, 'and the column stops speaking for chapters that have not arrived');
  // Putting it back is the exact undo — as three chapters, which is what it now is, and not as the column again.
  assert.deepEqual(mixToggle(sel, { kind: 'vocab', chapter: 2 }, GRID), ['vocab:1', 'vocab:2', 'vocab:3']);
});

test('a chapter name takes its whole row, and presses out again', () => {
  let sel = mixToggle([], { chapter: 2 }, GRID);
  assert.deepEqual(sel, ['skills:2', 'questions:2', 'vocab:2'], 'its three kinds, and no box where it has nothing');
  assert.deepEqual(mixCounts(sel, GRID).rows.get(2), { on: 3, of: 3 });
  sel = mixToggle(sel, { chapter: 2 }, GRID);
  assert.deepEqual(sel, []);
  // A row pressed out of "everything" leaves every other row behind, spelled out.
  const rest = mixToggle(null, { chapter: 3 }, GRID);
  assert.equal(mixIn(rest, 'vocab', 3), false);
  assert.equal(mixIn(rest, 'vocab', 1), true);
  assert.equal(mixIn(rest, 'pensum', 1), true, 'a column the row does not touch is left whole');
  assert.equal(mixWhole(rest, 'vocab'), false);
});

test('All is everything, now and later; None is nothing, and survives as a real choice', () => {
  assert.equal(mixToggle(['vocab:1'], 'all', GRID), null);
  assert.equal(mixIn(mixToggle(['vocab:1'], 'all', GRID), 'vocab', 99), true, 'All is everything there will be, not a snapshot of everything there is');
  assert.deepEqual(mixToggle(null, 'none', GRID), []);
  assert.deepEqual(normaliseMix(mixToggle(null, 'none', GRID), GRID), [], 'and it is not read back as "not chosen yet"');
});

/* --------------------------------------------------------- 5 · the copy */

test('the note says which kinds are in and, when it is not all of their chapters, how many of them', () => {
  assert.equal(mixNote(null, GRID), "Everything: the grammar skills, the chapters' questions, the vocabulary decks and the pensa.");
  assert.equal(mixNote(['vocab', 'pensum'], GRID), "Only the vocabulary decks and the pensa — the grammar skills and the chapters' questions left out.");
  assert.equal(mixNote(['vocab:1'], GRID), "Only the vocabulary decks (1 of 3 chapters) — the grammar skills, the chapters' questions and the pensa left out.");
  assert.equal(mixNote(['skills', 'questions', 'pensum', 'vocab:1', 'vocab:3'], GRID),
    "Only the grammar skills, the chapters' questions, the vocabulary decks (2 of 3 chapters) and the pensa.",
    'every kind is in, so nothing is "left out" — but two chapters of three is not "Everything"');
  assert.match(mixNote([], GRID), /^Nothing is in the mix\./);
  // The note is read aloud by the live region, so it is sentences and never a fragment.
  for (const sel of [null, [], ['vocab'], ['vocab:1'], ['skills', 'vocab:2']]) {
    const s = mixNote(sel, GRID);
    assert.match(s, /^[A-Z]/, `"${s}" starts a sentence`);
    assert.match(s, /\.$/, `"${s}" ends one`);
  }
});

test('the session header names the narrowing, chapters included, and says nothing when there is none', () => {
  assert.equal(mixTitle(null, GRID), '');
  assert.equal(mixTitle(['skills', 'questions', 'vocab', 'pensum'], GRID), '', 'every column is no narrowing at all');
  assert.equal(mixTitle(['vocab', 'pensum'], GRID), 'Vocabulary + Pensa only');
  assert.equal(mixTitle(['vocab:1'], GRID), 'Vocabulary · Cap. I', 'one chapter is named, not counted');
  assert.equal(mixTitle(['vocab:1', 'vocab:3'], GRID), 'Vocabulary · 2 chapters');
  assert.equal(mixTitle(['skills:1', 'questions:1', 'vocab:1', 'pensum:1'], GRID), 'Cap. I', 'all four kinds in one chapter: the chapter is the whole of the narrowing');
  assert.equal(mixTitle([], GRID), '', 'an empty mix starts no session, so it titles none');
});

/* ----------------------------------------- 6 · the controls themselves */

test('the Practice setup draws a real grid: a heading per column and per row, and a box that says what it toggles', () => {
  const setup = UI.slice(UI.indexOf('function renderSetup'), UI.indexOf('function renderPracticeStart'));
  assert.ok(setup.includes("h('table', { class: 'g-mixg' }"), 'a table, not a pile of divs');
  assert.ok(setup.includes("h('th', { scope: 'col', class: 'g-mixg__colh' }"), 'a heading per column');
  assert.ok(setup.includes("h('th', { scope: 'row', class: 'g-mixg__rowh' }"), 'a heading per row');
  assert.ok(setup.includes('`${POPULATION_LABEL[k]}, chapter ${r.roman}, ') && setup.includes(', in the mix`'),
    'a box names its kind, its chapter and what ticking it does — never a bare checkbox');
  assert.ok(setup.includes('press({ kind: k })') && setup.includes('press({ chapter: r.chapter })') && setup.includes('press({ kind: k, chapter: r.chapter })'),
    'column heading, chapter name and box all go through the one pure toggle');
  assert.ok(setup.includes("press('all')") && setup.includes("press('none')"), 'and so do All / None');
  assert.ok(setup.includes('mixCounts(sel, grid)'), 'the figures on the headings are counted, not guessed');
  // An empty cell carries no control at all and says so, so it can never read as a box that is merely off.
  const noneCell = setup.slice(setup.indexOf('if (!ids) return'), setup.indexOf("text: 'nothing here' }));") + 25);
  assert.ok(noneCell.includes("class: 'g-mixg__td g-mixg__td--none'"), 'an empty cell is its own kind of cell');
  assert.ok(noneCell.includes('nothing here'), 'and says so in words rather than by being an unticked box');
  assert.equal(noneCell.includes("h('button'"), false, 'it carries no control at all');
  // The arrow keys walk it, and the boxes are ordinary buttons, so Tab still reaches every one of them.
  assert.ok(setup.includes('ArrowUp') && setup.includes('ArrowDown') && setup.includes('ArrowLeft') && setup.includes('ArrowRight'), 'the grid is walked by the arrow keys');
  assert.equal(setup.includes('tabindex'), false, 'nothing is taken out of the tab order to make that work');
});

test('the touch rules for the grid are at the end of the stylesheet, where a coarse rule is the one that wins', () => {
  // The section header itself, not the sentence a hundred rules above that points at it.
  const marker = CSS.indexOf('====== touch last');
  const coarse = CSS.indexOf('.g-mixg__cell, .g-mixg__col, .g-mixg__row { min-height: var(--tap); }');
  assert.ok(marker > 0 && coarse > marker, 'the 44px targets are in the "touch last" section (§21.1)');
  const block = CSS.slice(CSS.lastIndexOf('@media (pointer: coarse)', coarse));
  assert.ok(block.includes('.g-mixg__cell { min-width: var(--tap); }'), 'both of them inside one coarse query');
  assert.ok(CSS.indexOf('.g-mixg { border-collapse') < marker, 'while the ordinary rules stay up in the setup section');
  // A plain `.g-mixg` rule after the coarse ones would win on source order and the targets would be dead again.
  assert.ok(CSS.lastIndexOf('.g-mixg') >= coarse, 'nothing plain follows them');
  // Colour is never the only signal (§3): in is a tick, out is an empty outline, and the tick is a mark not a hue.
  assert.ok(CSS.includes('.g-mixg__cell[aria-pressed="true"] .g-mixg__box::after { content: "\\2713"; }'));
  assert.equal(/\.g-mixg[^{]*\{[^}]*#[0-9a-fA-F]{3}/.test(CSS), false, 'and no hard-coded colour anywhere in the grid');
  // The grid scrolls inside its own box rather than widening the page (QA M-7), and its hidden labels with it.
  assert.ok(CSS.includes('.g-mixg__scroll { max-width: 100%; overflow-x: auto;'));
  assert.ok(/#grammar [^\n]*\.g-mixg__scroll \{ position: relative; \}/.test(CSS));
});
