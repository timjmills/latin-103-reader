// node --test tests/ — the app-side findings of the 2026-09-11 QA audit, one
// test a finding. Each fails on the code as the audit found it and passes on
// the fix; the live proof is the Chrome pass recorded in the hand-off.
//
//   N-6   a chart's retry keeps the cells that were right, and judges them again
//   N-8   the catalogue's "Up to chapter N" offers every N, skipping none
//   N-13  a bank that could not be fetched is said so, and one that is absent is not
//   N-16  a check lights the whole two-word focus, as the noticing opener does
//   N-20  #/grammar is a route, and leaving it is the learner's Back alone
//   N-21  "All chapters" leaves the chapter page instead of covering it
//   N-22  Stats and Progress each name the population their number counts
//   N-10  §12's catalogue-scaffold decision is written down, not re-litigated
//   N-3   a step's own wording chooses the shape of its recognise check
//   N-15  a chart word resolves to the reading that has the cells asked for
//
// No Latin from the book appears here: the sentences and wordings below are
// invented for the test, and everything else is read from the shipped data at
// run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { catalogueChapters, tallyDenominator, bankUnreachableNote, tapSpan, keptCells } from '../app/js/grammar/ui.js';
import { createTeachDataLoader, indexCatalogue, indexSkills, normaliseSentences, normaliseLesson, askWantsWord } from '../app/js/grammar/lessons.js';
import { isGrammarRoute, GRAMMAR_HASH, parseChapterRoute } from '../app/js/chapters.js';
import { skillsOutOf } from '../app/js/progress.js';
import { focusIndexes } from '../app/js/grammar/sets.js';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { createTeachItems, tableHelpers } from '../app/js/grammar/items.js';

// Line endings normalised: a CRLF checkout must not change what the code says.
const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const read = (name) => JSON.parse(src(name));
const UI = src('app/js/grammar/ui.js');
const MAIN = src('app/js/main.js');
const CSS = src('app/css/grammar.css');
const CONTRACT = src('docs/GRAMMAR-CONTRACT.md');

/* ------------------------------------------------------------------ N-8 */

test('N-8 the catalogue offers every chapter up to the last one a table comes from, skipping none', () => {
  const parts = [
    { id: 'noun', tables: [{ id: 'a', chapter: 1 }, { id: 'b', chapter: 2 }] },
    { id: 'verb', tables: [{ id: 'c', chapter: 6 }, { id: 'd', chapter: null }] },
  ];
  assert.deepEqual(catalogueChapters(parts), [1, 2, 3, 4, 5, 6], 'III, IV and V introduce no table and are offered all the same');
  assert.deepEqual(catalogueChapters([]), []);
  assert.deepEqual(catalogueChapters(null), []);
  assert.deepEqual(catalogueChapters([{ id: 'x', tables: [{ id: 'y' }] }]), [], 'no table names a chapter: no filter to offer');

  // And on the shipped catalogue: contiguous, and reaching the last table's chapter.
  const cat = indexCatalogue(read('app/data/grammar/paradigms.json'));
  const shipped = catalogueChapters(cat.raw.parts);
  const named = cat.raw.parts.flatMap((p) => p.tables.map((t) => t.chapter)).filter((c) => c != null);
  assert.equal(shipped.length, Math.max(...named), 'one option per chapter to the last');
  assert.deepEqual(shipped, shipped.map((_, i) => i + 1), 'I to the last, with no gap');
  for (const gap of [23, 24, 25, 29, 30]) assert.ok(shipped.includes(gap), `chapter ${gap} introduces no table and must still be offered`);
});

/* ------------------------------------------------------------------ N-6 */

/** A three-cell chart item, invented: two cells right, one wrong. */
const chartItem = (given = []) => ({
  input: 'chart',
  chart: {
    given,
    cells: [
      { label: 'one', answer: ['aaa'] },
      { label: 'two', answer: ['bbb'] },
      { label: 'three', answer: ['ccc'] },
    ],
  },
});

test('N-6 a chart retry keeps the boxes that were right and clears only the wrong ones', () => {
  const item = chartItem();
  const keep = keptCells(item, { 0: 'aaa', 1: 'zzz', 2: 'ccc' });
  assert.deepEqual(keep, { 0: 'aaa', 2: 'ccc' }, 'the two that were right come back; the wrong one comes back empty');
  assert.equal(keep[1], undefined);

  // Kept means "put back in the box", never "counted right": the boxes are graded
  // again from the same cellResults on the next submit, so a kept cell that is
  // changed to something wrong is marked wrong.
  const again = keptCells(item, { 0: 'aaa', 1: 'bbb', 2: 'nonsense' });
  assert.deepEqual(again, { 0: 'aaa', 1: 'bbb' }, 'a box that was right and is now wrong is not kept');

  // Whitespace is not writing, and a scaffold's given cells are printed, not filled.
  assert.deepEqual(keptCells(item, { 0: '  ', 1: 'bbb', 2: 'ccc' }), { 1: 'bbb', 2: 'ccc' });
  assert.deepEqual(keptCells(chartItem([0]), { 1: 'bbb', 2: 'ccc' }), { 1: 'bbb', 2: 'ccc' }, 'cell 0 is given, so it is not a cell the learner keeps');

  // A cell the table did not render (a phone shows one) is never handed back filled.
  assert.deepEqual(keptCells(item, { 0: 'aaa', 1: 'bbb', 2: 'ccc' }, new Set([1])), { 1: 'bbb' });

  // And the input really does carry them: the value is written onto the box, the
  // first empty box takes the focus, and the item remembers them like `given`.
  assert.match(UI, /chart\.keep = keptCells\(item, v, new Set\(inputs\.keys\(\)\)\)/, 'the attempt memoises what it kept on the item');
  assert.match(UI, /placeholder: '…', value: kept\(i\)/, 'a rebuilt box is printed with what it kept');
  assert.match(UI, /find\(\(el\) => !String\(el\.value \?\? ''\)\.trim\(\)\)/, 'the focus goes to the first box still empty');
});

/* ----------------------------------------------------------------- N-16 */

test('N-16 a tap on one word of a two-word focus names both, as the noticing opener does', () => {
  // Invented for this test: a two-word ablative absolute, and a one-word focus.
  const pair = { prompt: { la: 'Fenestra aperta ancilla cantat.' }, written: { focus: 'Fenestra aperta' }, accept: [1] };
  assert.deepEqual(focusIndexes(pair.prompt.la, pair.written.focus), [0, 1], 'the declaration covers two words');
  assert.deepEqual(tapSpan(pair, 1), [0, 1], 'tapping the second word names the pair');
  assert.deepEqual(tapSpan(pair, 0), [0, 1], 'and so does tapping the first');
  assert.deepEqual(tapSpan(pair, 3), [3], 'a word outside the pair is only itself');

  const one = { prompt: { la: 'Ancilla fenestram aperit.' }, written: { focus: 'fenestram' }, accept: [1] };
  assert.deepEqual(tapSpan(one, 1), [1], 'a one-word focus lights one word');

  // A drawn library item carries no written sentence, so there is nothing declared to widen to.
  assert.deepEqual(tapSpan({ prompt: { la: 'Ancilla fenestram aperit.' }, accept: [1] }, 1), [1]);
  assert.deepEqual(tapSpan(null, 0), [0]);
  assert.deepEqual(tapSpan({}, -1), []);

  // The real lesson the audit found it in: every sentence of the ablative
  // absolute declares a pair, and every pair is found in its own sentence.
  const sents = read('app/data/grammar/sentences/ablative-absolute.json').sentences;
  const pairs = sents.filter((s) => String(s.focus ?? '').trim().split(/\s+/).length === 2);
  assert.ok(pairs.length >= 10, 'the lesson is built on two-word focuses');
  for (const s of pairs) {
    const span = focusIndexes(s.la, s.focus);
    assert.equal(span.length, 2, `${s.id}: both words of the focus are in the sentence`);
    for (const i of span) assert.deepEqual(tapSpan({ prompt: { la: s.la }, written: s }, i), span, `${s.id}: a tap on either word names both`);
  }

  // The two lit words must also look the same: `is-picked` is the more specific
  // selector, so the tapped half went grey beside a gold partner without this.
  assert.match(UI, /const span = \(item\.accept \?\? \[\]\)\.map\(Number\)\.includes\(Number\(i\)\) \? tapSpan\(item, i\) : \[\]/);
  assert.match(UI, /classList\.add\('g-w--target', 'is-right'\)/);
  assert.equal((UI.match(/tap: tapMode \? tapPick : null/g) ?? []).length, 2, 'both tap renderers go through the same pick');
  assert.match(CSS, /\.g-la--tap \.g-w\.is-picked\.g-w--target \{ background: var\(--underline\); \}/);
});

/* ----------------------------------------------------------------- N-13 */

test('N-13 a bank that could not be reached is said so; one that is simply absent is not', async () => {
  assert.equal(bankUnreachableNote(0, true).trim().length > 0, true);
  assert.match(bankUnreachableNote(0, true), /not downloaded yet/);
  assert.doesNotMatch(bankUnreachableNote(0, true), /\d+ sentences/, 'nothing is promised by the number');
  assert.equal(bankUnreachableNote(400, true), '', 'a bank that arrived says its own size instead');
  assert.equal(bankUnreachableNote(0, false), '', 'a skill with no bank has nothing to download and nothing to say');

  // The loader tells the two apart: a 404 is an answer ("no bank"), a refused
  // connection is not ("not downloaded yet"), and a refusal is asked again later.
  let asked = 0;
  const loader = createTeachDataLoader({
    fetchJson: async (name) => {
      asked += 1;
      if (name === 'generated/index.json') throw new Error('Failed to fetch');
      if (name === 'generated/absent.json') throw new Error('generated/absent.json: 404');
      throw new Error('Failed to fetch');
    },
  });
  assert.equal(await loader.loadGenerated('absent'), null);
  assert.equal(loader.bankUnreachable('absent'), false, 'a 404 says the skill has no bank');
  assert.equal(await loader.loadGenerated('offline'), null);
  assert.equal(loader.bankUnreachable('offline'), true, 'a refused request says the bank is not here yet');
  const before = asked;
  await loader.loadGenerated('offline');
  assert.ok(asked > before, 'and it is asked for again, because the network may be back');

  // Both headers carry the line, and neither carries it when the bank is there.
  assert.equal((UI.match(/bankUnreachableNote\(drill\.bank, generatedUnreachable\(id\)\)/g) ?? []).length, 2, 'the drill and unlimited practice both say it');
});

/* ----------------------------------------------------------------- N-20 */

test('N-20 #/grammar is a route of its own, and only the learner\'s Back leaves it', () => {
  assert.equal(GRAMMAR_HASH, '#/grammar');
  assert.equal(isGrammarRoute('#/grammar'), true);
  assert.equal(isGrammarRoute('#/grammar/'), true);
  assert.equal(isGrammarRoute('/grammar'), true);
  assert.equal(isGrammarRoute(' #/grammar '), true);
  assert.equal(isGrammarRoute('#/grammars'), false);
  assert.equal(isGrammarRoute('#/chapter/7/grammar'), false);
  assert.equal(isGrammarRoute('#/progress'), false);
  assert.equal(isGrammarRoute(''), false);
  assert.equal(isGrammarRoute(null), false);
  // The two route tables do not overlap: #/grammar is not a chapter.
  assert.equal(parseChapterRoute(GRAMMAR_HASH), null);

  // The shell reads it, and every hash it sets itself is marked as its own, so a
  // chapter page opened from inside the section does not close the section it
  // goes back to.
  assert.match(MAIN, /if \(isGrammarRoute\(location\.hash\)\) \{ openGrammarSection\(\); return; \}/);
  assert.match(MAIN, /if \(grammarRouted && !ours && routed\)/);
  assert.equal((MAIN.match(/^\s*(?!const routeTo)(?!.*catch \{ routeTo).*location\.hash = /gm) ?? []).length, 1,
    'routeTo is the one place the shell writes the hash');
});

/* ----------------------------------------------------------------- N-21 */

test('N-21 "All chapters" leaves the chapter page rather than covering it', () => {
  const at = MAIN.indexOf("mk('button', 'chapter__back'");
  assert.ok(at > 0, 'main.js builds the back control');
  const handler = MAIN.slice(at, MAIN.indexOf('const head =', at));
  assert.match(handler, /goHome\(\);\s*openMenu\('chapters'\)/, 'the page closes and the route goes with it, then the list opens');
  assert.doesNotMatch(handler, /addEventListener\('click', \(\) => openMenu\('chapters'\)\)/, 'the menu is no longer raised over the page it says it leaves');
});

/* ----------------------------------------------------------------- N-22 */

test('N-22 Stats and Progress each say which population their number counts', () => {
  const line = tallyDenominator(88, 8);
  assert.match(line, /96/, 'the tally names the number it is actually over');
  assert.match(line, /88 grammar skills/);
  assert.match(line, /8 chapter sets/);
  assert.match(line, /Progress counts the 88 grammar skills alone/, 'and reconciles itself with the other page');
  assert.equal(tallyDenominator(1, 1), '2 in all — 1 grammar skill and 1 chapter set, counted together. Progress counts the 1 grammar skills alone, so its "of 1" and this 2 are two different tallies.');
  assert.match(tallyDenominator(88, 0), /^All 88 grammar skills, counted here\.$/, 'with no sets there is one population and nothing to reconcile');

  assert.equal(skillsOutOf(88), 'of 88 grammar skills', 'the Progress figure names its own population');
  assert.equal(skillsOutOf(0), '', 'and says nothing when the grammar could not be read');
  assert.equal(skillsOutOf(null), '');

  assert.match(UI, /text: ctx\.sets\?\.size \? 'Skills and chapter sets' : 'Skills'/, 'the heading names both populations');
  assert.match(UI, /tallyDenominator\(index\.skills\.size, ctx\.sets\?\.size \?\? 0\)/);
  assert.match(MAIN, /progFigure\('Skills mastered', figures \? String\(t\.skillsMastered\) : '—', figures \? skillsOutOf\(t\.skillsTotal\) : ''\)/);
});

/* ----------------------------------------------------------------- N-10 */

/* ------------------------------------------------------------ N-3, N-15 */

// The real lessons, built the way Learn builds them. Loaded once: the glossary
// is large, and both tests want every skill.
setGlossary(read('app/data/glossary.json'), read('app/data/function-words.json'), read('app/data/glosses.json'));
const INDEX = indexSkills(read('app/data/grammar/skills.json'));
const CAT = indexCatalogue(read('app/data/grammar/paradigms.json'));
const HEADWORDS = read('app/data/glossary-headwords.json').headwords;
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const lessonIds = readdirSync(new URL('../app/data/grammar/lessons/', import.meta.url))
  .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => INDEX.skills.has(id));
const teachFor = (id) => createTeachItems({
  skill: INDEX.skills.get(id), sentences: normaliseSentences(read(`app/data/grammar/sentences/${id}.json`), id).sentences,
  lookup, paradigm, catalogue: CAT, skills: INDEX.skills, headwords: HEADWORDS, storage: mem(), rand: () => 0.3,
});
const lessonOf = (id) => normaliseLesson(read(`app/data/grammar/lessons/${id}.json`));

test('N-3 a step\'s own wording chooses the shape of its recognise check, over the coin toss', () => {
  // The wording, read on its own. Invented questions, in the two shapes the lessons use.
  assert.equal(askWantsWord('Tap the verb that has not happened yet.'), true);
  assert.equal(askWantsWord('Which word here is the one being spoken to?'), true);
  assert.equal(askWantsWord('Which two words carry the construction?'), true);
  assert.equal(askWantsWord('Which one of the two is the plural?'), true);
  assert.equal(askWantsWord('Which of the three verbs is the odd one out?'), true);
  assert.equal(askWantsWord('What kind of clause is this?'), false);
  assert.equal(askWantsWord('Which tense of the subjunctive is it?'), false);
  assert.equal(askWantsWord('What does this ending do here?'), false);
  assert.equal(askWantsWord('Does it mean one thing here, or the other?'), false);
  assert.equal(askWantsWord('Is it still a folded question?'), false);
  // A question that asks for a word and contains a "what" clause inside it is still a word question.
  assert.equal(askWantsWord('Which two words say what had already happened?'), true);
  assert.equal(askWantsWord(''), null, 'no wording of its own: the generator\'s coin toss stands');
  assert.equal(askWantsWord(null), null);

  // A step may declare the shape, and that outranks the wording.
  const declared = normaliseLesson({ skill: 'x', teach: [{ title: 't', say: 's', check: { kind: 'recognise', ask: 'Tap the verb that has not happened yet.', tap: false } }] });
  assert.equal(declared.teach[0].check.tap, false, 'a declared shape is kept, against the wording');
  const derived = normaliseLesson({ skill: 'x', teach: [{ title: 't', say: 's', check: { kind: 'recognise', ask: 'Tap the verb that has not happened yet.' } }] });
  assert.equal(derived.teach[0].check.tap, true, 'and derived from the wording when it is not declared');

  // And over every shipped lesson: every self-worded recognise check gets the shape it asks for.
  let decided = 0;
  let tossed = 0;
  for (const id of lessonIds) {
    const items = teachFor(id);
    for (const [i, step] of lessonOf(id).teach.entries()) {
      const c = step.check;
      if (c?.kind !== 'recognise') continue;
      if (c.tap == null) { tossed += 1; assert.equal(c.ask, null, `${id} step ${i}: a step that words its own question must decide its own shape`); continue; }
      decided += 1;
      const item = items.sentenceItem({ kind: 'recognise', stage: 1, sentence: c.sentence, tap: c.tap });
      if (!item || item.kind !== 'recognise') continue;   // a sentence that can carry no recognise item at all is another matter
      assert.equal(item.input, c.tap ? 'tap' : 'choice', `${id} step ${i}: "${c.ask}" asks for ${c.tap ? 'a word' : 'a name'}`);
    }
  }
  assert.ok(decided >= 110, `the wording decides most of them (${decided} decided, ${tossed} left to the toss)`);
  assert.ok(tossed > 0, 'a check with no wording of its own still lets the generator word and shape itself');
});

test('N-15 a chart word resolves to the reading that has the cells the step asked for', () => {
  // A headword can be two words. `entryFor` used to take the first reading that
  // rendered any table; with a test of what the caller needs, it keeps looking.
  const { entryFor } = tableHelpers({ lookup, paradigm });
  const plain = entryFor('mare');
  assert.ok(plain, 'the word is in the glossary');
  const wantsPlural = entryFor('mare', { fits: (g) => [...g.cells.keys()].some((k) => /(^|\.)nom\.pl$/.test(k)) });
  assert.ok(wantsPlural, 'and a reading that answers the test is found');
  assert.ok([...wantsPlural.cells.keys()].some((k) => /(^|\.)nom\.pl$/.test(k)), 'the reading chosen has the cell asked for');
  const none = entryFor('mare', { fits: () => false });
  assert.equal(none?.entry?.pos, plain.entry.pos, 'with nothing fitting, the old first-table answer stands');
  assert.notEqual(wantsPlural.entry.pos, plain.entry.pos, 'and the reading the chart needs is not the one that came first');

  // Over every shipped lesson: no chart check declares a word it then builds nothing for.
  const bare = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let charts = 0;
  for (const id of lessonIds) {
    const items = teachFor(id);
    for (const [i, step] of lessonOf(id).teach.entries()) {
      const c = step.check;
      if (c?.kind !== 'chart' || !c.words?.length) continue;
      charts += 1;
      const item = items.chartItem({ key: c.key ?? null, cells: c.cells, words: c.words });
      assert.ok(item, `${id} step ${i}: the chart check builds an item`);
      const built = new Set(item.chart.cells.map((b) => bare(b.word)));
      for (const w of c.words) {
        assert.ok(built.has(bare(String(w).split(/[\s,]/)[0])), `${id} step ${i}: the step names ${w}, so the chart must ask it`);
      }
    }
  }
  assert.ok(charts >= 100, `every chart check with declared words was checked (${charts})`);

  // A word that still builds nothing is named on the console rather than dropped in silence.
  assert.match(src('app/js/grammar/items.js'), /if \(dropped\.length\) console\.warn\(/);
});

test('N-10 §12 records the catalogue-scaffold decision, so it is not re-litigated', () => {
  const from = CONTRACT.indexOf('## 12. Feedback everywhere');
  const to = CONTRACT.indexOf('## 13. Every skill');
  assert.ok(from > 0 && to > from, 'the contract still has a §12');
  const twelve = CONTRACT.slice(from, to);
  assert.match(twelve, /A catalogue table has no taught cell, and withholds none/, 'the decision is stated');
  assert.match(twelve, /N-10/, 'and carries the finding it answers');
  assert.match(twelve, /taught: \[\]/, 'and names the code it describes');
  // The code it describes is still what it describes.
  assert.match(UI, /taught: item\.catalogue \? \[\] :/);
});
