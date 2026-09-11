// node --test tests/ — the behaviour findings of the 2026-09-11 QA audit, one
// test a finding. Each fails on the code as the audit found it and passes on
// the fix; the live proof is the Playwright pass in qa/logic-fix/.
//
//   M-5  an empty table is not gradeable: Check waits for one cell and says why
//   M-6  a lemma axis (gender) never reaches narrowCells, which filters cell ids
//   N-4  and the chosen word does not lead a drill the lemma axis excludes
//   M-3  a written sentence drawn into a drill is redoable, a generated one is
//        not, and the empty state never claims more than the log supports
//   M-2  Learn resumes on the step the learner left
//   M-4  a blank's four options carry the same capital, so the shape says nothing
//   SW   the service worker is registered before the sign-in gate, not after it
//   N-5  the scaffold note reports the table on screen, not the switch
//   N-9  the catalogue lede counts the tables listed under the filter
//   M-9  the hint copy says what the shipped hint does
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills, indexCatalogue, normaliseSentences, normaliseGenerated, normaliseLesson } from '../app/js/grammar/lessons.js';
import {
  createItems, createTeachItems, createCatalogueItems, matchCapital, writtenKey, isWrittenKey, bareKey, WRITTEN_PREFIX,
} from '../app/js/grammar/items.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { createGrammarStore } from '../app/js/grammar/store-grammar.js';
import { createLearn, createDrill, createRedo, cellResults } from '../app/js/grammar/session.js';

const dataDir = new URL('../app/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const INDEX = indexSkills(read('grammar/skills.json'));
const SKILLS = INDEX.skills;
const RAW_CAT = read('grammar/paradigms.json');
const CAT = indexCatalogue(RAW_CAT);
const HEADWORDS = read('glossary-headwords.json').headwords;
const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');

const DIO = 'dative-indirect-object';
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const store = () => createGrammarStore({ mode: 'local', storage: mem() });
const sentencesOf = (id) => normaliseSentences(read(`grammar/sentences/${id}.json`), id);
const lessonOf = (id) => normaliseLesson(read(`grammar/lessons/${id}.json`));
const teachFor = (id, rand = () => 0.3) => createTeachItems({ skill: SKILLS.get(id), sentences: sentencesOf(id).sentences, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand });
const UNITS = [
  { id: 'r07:1.1', la: 'Iūlius puerō rosam dat.', en: '' }, { id: 'r07:1.2', la: 'Mēdus dominō pecūniam nōn dat.', en: '' },
  { id: 'r03:1.1', la: 'Mārcus puellae librum dat.', en: '' }, { id: 'r03:1.2', la: 'Puer puellam videt.', en: '' },
];
const gen = (rand = () => 0.3) => { const items = createItems({ units: UNITS, lookup, paradigm, skills: SKILLS, storage: mem(), rand }); return createGenerator({ items, stage3: createStage3({ items, paradigm, rand }), sets: null, skills: SKILLS }); };
const catItems = (rand = () => 0.3) => createCatalogueItems({ catalogue: CAT, lookup, paradigm, headwords: HEADWORDS, skills: SKILLS, rand });
/** A slice of ui.js between two markers, so an assertion is about one control and not the whole module. */
const slice = (from, to) => { const a = UI.indexOf(from); const b = UI.indexOf(to, a + 1); assert.ok(a >= 0 && b > a, `ui.js has ${from} … ${to}`); return UI.slice(a, b); };

/* ==================================================== M-5 · an empty table is not an attempt */

test('M-5: Check waits until a cell has something in it, and the reason is on screen', () => {
  // A chart is one attempt (§3), so the whole answer key must not be printable by a stray click on Check.
  // ui.js is DOM and these tests are pure, so the wiring is read off the source that builds the form —
  // the same way tests/grammar.teach-core.test.mjs reads the Tab order. Live proof: qa/logic-fix/.
  const chart = slice('function chartInput(item, submit', 'function formLabel(form)');
  assert.match(chart, /const filledAny = \(\) => \[\.\.\.inputs\.values\(\)\]\.some/, 'the guard asks whether any editable cell has a value');
  assert.match(chart, /syncCheck = \(\) => \{ const on = filledAny\(\); check\.disabled = !on;/, 'and Check is disabled until one has');
  assert.match(chart, /needOne\.hidden = on/, 'the note is shown exactly while the button is unavailable');
  assert.match(chart, /aria-describedby', 'g-chart-needone'/, 'and the button names it, so a screen reader is told why');
  const need = /const needText = [^;]+;/.exec(chart)?.[0] ?? '';
  assert.match(need, /one attempt/, 'the note says what an empty check would cost');
  // The submit itself refuses, not only the button: Enter, an assistive technology or a script submits too.
  assert.match(chart, /onsubmit: \(e\) => \{ e\.preventDefault\(\); if \(!filledAny\(\)\)/, 'an empty chart cannot be graded however the form is submitted');
  // Pensum A is the same shape and had the same hole.
  const pensum = slice('function inlineInput(item, submit', '/**\n   * The keys of a box of typed answers');
  assert.match(pensum, /check\.disabled = !on/, 'a pensum waits for one ending too');
  assert.match(pensum, /aria-describedby', 'g-pensum-needone'/);
  assert.match(pensum, /onsubmit: \(e\) => \{ e\.preventDefault\(\); if \(!anyEnding\(\)\)/);
  // Why it matters, in the grader's own terms: an all-empty table is twelve wrong cells, scored as one attempt.
  const items = teachFor(DIO);
  const chartItem = items.chartItem({ key: SKILLS.get(DIO).paradigms?.[0] ?? null, cells: null, words: ['puella', 'servus'] })
    ?? items.chartItem({ key: 'decl1', cells: ['dat.sg'], words: ['puella', 'servus'] });
  assert.ok(chartItem, 'the skill has a chart to reason about');
  const empty = Object.fromEntries(chartItem.chart.cells.map((c, i) => [i, '']));
  const res = cellResults(chartItem, empty);
  assert.ok(res.length && res.every((r) => !r.ok), 'every blank box grades wrong — which is why the button may not offer it');
});

/* ==================================================== M-6 / N-4 · lemma axes and cell axes */

test('M-6: splitAxes keeps a lemma axis out of narrowCells, so gender no longer empties "practise one cell"', () => {
  const gc = catItems();
  const noun = CAT.table('decl1');
  assert.ok(noun, 'the 1st declension table is in the catalogue');
  assert.equal(RAW_CAT.id_scheme.noun_gender_in_cell_id, false, 'a noun cell id carries no gender slot — the reason the bug bit');
  const all = gc.cellIdsOf(noun, 'cases');
  assert.ok(all.length >= 12);
  // The audit's step: choose masculine on a noun table.
  const axes = { gender: ['m'] };
  const picked = gc.splitAxes(noun, axes);
  assert.deepEqual(picked.cell, {}, 'gender is not a cell axis here');
  assert.deepEqual(picked.lemma, { gender: ['m'] }, 'it selects words');
  assert.deepEqual(gc.narrowCells(all, picked.cell), all, 'so every cell still stands');
  assert.deepEqual(gc.narrowCells(all, axes), [], 'while the old call — the whole axes object — drops them all');
  // And it still narrows the words, which is its job.
  const words = gc.stockWords('decl1', axes);
  assert.ok(words.length && words.every((w) => w.gender === 'm'), 'the stock words are the masculine ones');
  assert.ok(gc.stockWords('decl1', {}).length > words.length, 'and without the axis there are more');
  // A cell axis still narrows cells.
  const cellPicked = gc.splitAxes(noun, { case: ['dat'], number: ['sg'] });
  assert.deepEqual(cellPicked.lemma, {});
  assert.deepEqual(gc.narrowCells(all, cellPicked.cell), ['dat.sg']);
  // On a table where gender really is a cell axis (an adjective declines for it) it stays a cell axis.
  const adj = (RAW_CAT.parts.find((p) => p.id === 'adjective')?.tables ?? []).find((t) => (t.axes ?? []).some((a) => a.id === 'gender' && a.scope === 'cell'));
  if (adj) {
    const split = gc.splitAxes(CAT.table(adj.id), { gender: ['f'] });
    assert.deepEqual(split.lemma, {}, `${adj.id} declines for gender, so the axis picks cells`);
    const ids = gc.cellIdsOf(CAT.table(adj.id));
    assert.ok(gc.narrowCells(ids, split.cell).length && gc.narrowCells(ids, split.cell).length < ids.length);
  }
  // The view passes only the cell-scoped half to narrowCells, and nothing else.
  const table = slice('function renderTable(got, tableId', '/* --------------------------------------------------------- practice */');
  const calls = [...table.matchAll(/gen\.narrowCells\([\s\S]{0,90}/g)].map((m) => m[0]);
  assert.ok(calls.length >= 2, 'both routes narrow cells');
  for (const c of calls) assert.match(c, /picked\.cell/, `narrowCells is given the cell axes only: ${c}`);
});

test('N-4: the chosen word does not lead a drill the lemma axis has excluded', () => {
  const gc = catItems();
  const noun = CAT.table('decl1');
  const feminine = gc.stockWords('decl1', {}).find((w) => w.gender === 'f');
  const masculine = gc.stockWords('decl1', {}).find((w) => w.gender === 'm');
  assert.ok(feminine && masculine, 'the table has both');
  assert.equal(gc.lemmaFits(noun, { gender: ['m'] }, feminine), false, 'īnsula does not answer "masculine"');
  assert.equal(gc.lemmaFits(noun, { gender: ['m'] }, masculine), true);
  assert.equal(gc.lemmaFits(noun, {}, feminine), true, 'with no axis chosen every word fits');
  // A word the axis cannot judge is kept rather than dropped: a library word carries no gender on the chip.
  assert.equal(gc.lemmaFits(noun, { gender: ['m'] }, { h: 'poeta' }), true);
  const table = slice('function renderTable(got, tableId', '/* --------------------------------------------------------- practice */');
  assert.match(table, /const wholeWords = \(\) => \{ const list = drillWords\(\); return chosenWord && gen\.lemmaFits/, 'the whole-table drill checks the chosen word against the axes');
  assert.match(table, /const join = chosenWord && !base\.some[^;]*&& gen\.lemmaFits/, 'and so does the one-cell drill');
});

/* ==================================================== M-3 · the redo shelf */

test('M-3: an item drawn from a written sentence carries a w: key; a step\'s check and a generated one do not', () => {
  const items = teachFor(DIO);
  const step = items.sentenceItem({ kind: 'recognise', stage: 1 });
  assert.ok(step, 'the skill has written sentences');
  assert.equal(step.key, null, 'a step\'s check is a moment in the step, not an item to come back to');
  assert.ok(step.teachKey, 'the generator\'s own key is kept for the tests');
  const drawn = items.sentenceItem({ kind: 'recognise', stage: 1, keyed: true });
  assert.ok(isWrittenKey(drawn.key), `a drawn written item is redoable: ${drawn.key}`);
  assert.equal(bareKey(drawn.key), drawn.teachKey, 'the key is the generator\'s, with the pool in front');
  assert.equal(writtenKey('blank:dio-01:x:0'), `${WRITTEN_PREFIX}blank:dio-01:x:0`);
  assert.equal(isWrittenKey('blank:r07:1.1:x:0'), false, 'a library key is not a written one');
  // §11b: a bank is re-drawn, not re-addressed, so a generated sentence stays keyless even when drawn.
  const raw = read(`grammar/generated/${DIO}.json`);
  const bank = normaliseGenerated({ ...raw, sentences: raw.sentences.slice(0, 12) }, DIO);
  const banked = createTeachItems({ skill: SKILLS.get(DIO), sentences: bank.sentences, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand: () => 0.3, poolKey: 'test.qa.generated' });
  const g = banked.sentenceItem({ kind: 'recognise', stage: 1, keyed: true });
  assert.ok(g && g.generated, 'a generated item');
  assert.equal(g.key, null, 'and it names nothing to come back to');
});

test('M-3: itemByKey rebuilds the very item the key names, and answers null when it has gone', () => {
  const items = teachFor(DIO);
  const drawn = items.sentenceItem({ kind: 'blank', stage: 1, keyed: true }) ?? items.sentenceItem({ kind: 'recognise', stage: 1, keyed: true });
  assert.ok(drawn?.key);
  const back = items.itemByKey(drawn.key, { kind: drawn.kind, stage: drawn.stage });
  assert.ok(back, 'the item comes back');
  assert.equal(back.unit_id, drawn.unit_id, 'the same sentence');
  assert.equal(back.target?.text, drawn.target?.text, 'and the same word in it');
  assert.equal(back.kind, drawn.kind);
  assert.equal(back.key, drawn.key, 'under the same name');
  assert.equal(items.itemByKey('w:blank:not-a-sentence:x:0', { kind: 'blank' }), null, 'a key that names nothing is null, never a substitute');
  assert.equal(items.itemByKey(null), null);
});

test('M-3: a redo of a written miss is built from the skill\'s own sentences, not from the library', async () => {
  const gstore = store();
  await gstore.ready();
  const items = teachFor(DIO);
  const drawn = items.sentenceItem({ kind: 'recognise', stage: 1, keyed: true });
  assert.ok(drawn?.key);
  const misses = [{ skill: DIO, kind: drawn.kind, item_key: drawn.key, at: new Date().toISOString() }];
  const world = { skills: new Map([[DIO, SKILLS.get(DIO)]]) };
  // Without the hook the library generator is asked for a key it has never heard of, and the slot builds nothing.
  const blind = createRedo({ misses, gstore, items: gen(), skillsIndex: world, size: 5, oneSkill: DIO, rand: () => 0.3 });
  assert.equal(blind.plan.length, 1, 'the miss became a slot');
  assert.equal(blind.start(), null, 'but nothing could be rebuilt for it');
  // With it the item comes back as it was.
  const back = teachFor(DIO);
  const redo = createRedo({ misses, gstore, items: gen(), skillsIndex: world, size: 5, oneSkill: DIO, rand: () => 0.3, rebuild: (slot) => (isWrittenKey(slot.itemKey) ? back.itemByKey(slot.itemKey, { kind: slot.kind, stage: slot.stage }) : null) });
  const first = redo.start();
  assert.ok(first?.item, 'the redo has an item');
  assert.equal(first.item.unit_id, drawn.unit_id, 'and it is the sentence that was missed');
  assert.equal(first.item.key, drawn.key);
});

test('M-3: the store counts the wrong answers that name no item, so the empty state can say so', async () => {
  const gstore = store();
  await gstore.ready();
  const at = (n) => new Date(Date.UTC(2026, 8, 11, 12, n)).toISOString();
  await gstore.addAttempt({ skill: DIO, kind: 'recognise', item_key: '', mode: 'practice', correct: false, at: at(1) });
  await gstore.addAttempt({ skill: DIO, kind: 'blank', item_key: '', mode: 'practice', correct: false, at: at(2) });
  await gstore.addAttempt({ skill: DIO, kind: 'blank', item_key: '', mode: 'practice', correct: true, at: at(3) });
  assert.equal(gstore.countMissed({ skill: DIO }), 0, 'none of them can be offered back');
  assert.equal(gstore.countUnnamedMissed({ skill: DIO }), 2, 'but two answers were got wrong all the same');
  assert.equal(gstore.countUnnamedMissed({ skills: ['some-other-skill'] }), 0, 'and the count is scoped like every other');
  await gstore.addAttempt({ skill: DIO, kind: 'blank', item_key: 'w:blank:dio-01:x:0', mode: 'practice', correct: false, at: at(4) });
  assert.equal(gstore.countMissed({ skill: DIO }), 1, 'a keyed miss is redoable');
  assert.equal(gstore.countUnnamedMissed({ skill: DIO }), 2, 'and does not change the other count');
  await gstore.addAttempt({ skill: DIO, kind: 'blank', item_key: 'w:blank:dio-01:x:0', mode: 'practice', correct: true, at: at(5) });
  assert.equal(gstore.countMissed({ skill: DIO }), 0, 'put right, it leaves the shelf');
});

test('M-3: the view routes a w: key to the skill\'s own generator, and imports what it uses', () => {
  // There is no linter here, and a free identifier in a DOM module only throws when the learner reaches it:
  // the first live run of the redo died on `isWrittenKey is not defined`. The import is asserted.
  const imports = /import \{([^}]*)\} from '\.\/items\.js';/.exec(UI)?.[1] ?? '';
  assert.match(imports, /\bisWrittenKey\b/, 'ui.js imports the key test it uses');
  const redo = slice('async function renderRedo(', '/**\n   * Nothing to redo: said quietly');
  assert.match(redo, /async function renderRedo/, 'the view can await the generators it needs');
  assert.match(redo, /teachItemsOf\(skills\.get\(id\)\)/, 'the skill\'s own written-sentence generator is loaded');
  assert.match(redo, /rebuild = \(slot\) => \(isWrittenKey\(slot\.itemKey\) \? teachFor\.get\(slot\.skill\)\?\.itemByKey/);
  assert.match(redo, /const redo = createRedo\(\{[\s\S]*?onChange, rebuild \}\);/, 'and handed to the session');
});

test('M-3: no empty state claims everything was put right when nothing could be offered back', () => {
  // The audit read "Nothing to redo — everything you have missed has since been answered right" after 122
  // wrong answers. Three emptinesses, three lines, and the claim is made only where the log supports it.
  assert.match(UI, /const unnamedMissedCount = /, 'the view can count the answers that name no item');
  const setup = slice('const missedTotal = missedCount();', 'const pick = h(\'div\', { class: \'g-preset__pick\'');
  assert.match(setup, /const missedUnnamed = missedTotal \? 0 : unnamedMissedCount\(\)/);
  assert.match(setup, /missedUnnamed\s*\n?\s*\? `Nothing to redo — \$\{missedUnnamed === 1 \? 'the one answer you got wrong was'/, 'it says what really happened');
  assert.match(setup, /on a generated sentence, a catalogue table or a step inside a lesson, which are re-drawn rather than offered back/);
  assert.match(setup, /: answeredHere\(\)/, 'only then may it say "answered right"');
  assert.match(setup, /Nothing to redo — nothing has been missed yet/, 'and a clean profile is told the truth too');
  const nothing = slice('function renderNothingToRedo(', '/** "Practise this skill": a view of its own');
  assert.match(nothing, /const unnamed = gone \? 0 : unnamedMissedCount/);
  assert.match(nothing, /has no item to come back to/, 'the page says why, in the learner\'s words');
  assert.match(nothing, /Nothing has been missed in \$\{where\} yet/);
  // The one remaining unconditional "answered right" is the one that is now guarded by `ever`.
  const claims = [...UI.matchAll(/has since been answered right/g)];
  assert.equal(claims.length, 3, 'three places say it; each is behind a check that it is true');
});

/* ==================================================== M-2 · Learn resumes where it was */

test('M-2: startSteps opens on the step it is given and reports the one on screen', async () => {
  const gstore = store();
  await gstore.ready();
  const skill = SKILLS.get(DIO);
  const teach = lessonOf(DIO).teach;
  assert.ok(teach.length >= 3, 'the skill has steps to be part-way through');
  const seen = [];
  const learn = createLearn({ skill, gstore, items: gen(), teach, teachItems: teachFor(DIO), currentWeekN: 107, rand: () => 0.3 });
  await learn.begin();
  const fresh = learn.startSteps();
  assert.equal(fresh?.slot.step, 0, 'with nothing to resume it opens at step one');

  const gstore2 = store();
  await gstore2.ready();
  const later = createLearn({ skill, gstore: gstore2, items: gen(), teach, teachItems: teachFor(DIO), currentWeekN: 107, rand: () => 0.3 });
  await later.begin();
  const at2 = later.startSteps({ at: 2, onStep: (pr) => seen.push(pr) });
  assert.equal(at2?.slot.step, 2, 'and on the step the learner left when there is');
  assert.ok(seen.length, 'the place is reported as it is reached');
  assert.deepEqual(seen[0], { skill: DIO, step: 2, steps: teach.length });
  // Past the end is clamped rather than left to build nothing.
  const gstore3 = store();
  await gstore3.ready();
  const over = createLearn({ skill, gstore: gstore3, items: gen(), teach, teachItems: teachFor(DIO), currentWeekN: 107, rand: () => 0.3 });
  await over.begin();
  assert.equal(over.startSteps({ at: 99 })?.slot.step, teach.length - 1);
});

test('M-2: the view keeps the step beside the skill and reopens there', () => {
  const learnView = slice('async function renderLearnStart(', '/* --------------------------------------------- "Just drill it" (§10) */');
  assert.match(learnView, /const savedStep = !skill\.set && savedLearn\?\.skill === id/, 'the saved place is read for a teach-step skill too');
  assert.match(learnView, /const noteStep = \(n\) => writeJSON\(LS_LEARN, \{ skill: id, step: n/, 'and written as the learner moves');
  assert.match(learnView, /learn\.startSteps\(\{ at, onStep: \(pr\) => noteStep\(pr\.step\) \}\)/);
  assert.match(learnView, /else if \(nSteps && savedStep >= nSteps\) showBlocked\(\);/, 'past the last step the ten is where they were');
  assert.match(learnView, /else showSteps\(\{ at: nSteps \? Math\.min\(savedStep, nSteps - 1\) : 0 \}\)/);
});

/* ==================================================== M-4 · the options say nothing by their shape */

test('M-4: every option of a blank carries the answer\'s own capital', () => {
  assert.equal(matchCapital('Mīlite')('mīlitibus'), 'Mīlitibus');
  assert.equal(matchCapital('mīlite')('Mīlitibus'), 'mīlitibus');
  assert.equal(matchCapital('Iūlium')('Iūliō'), 'Iūliō', 'a proper noun is already capital and stays so');
  assert.equal(matchCapital('')('puella'), 'puella', 'nothing to match: the form is left alone');
  assert.equal(matchCapital('x')(''), '');
  // The real thing: a sentence whose focus word opens it.
  const units = [{ id: 'q1', la: 'Servus puellae librum dat.' }, { id: 'q2', la: 'Puellae servus librum dat.' }];
  let sawInitial = false;
  for (const skillId of ['nominative-subject', DIO, 'genitive-possession']) {
    const items = createItems({ units, lookup, paradigm, skills: SKILLS, storage: mem(), rand: () => 0.4 });
    for (let i = 0; i < 6; i++) {
      const it = items.generate({ skill: skillId, kind: 'blank', stage: 1 });
      if (!it?.choices?.length) continue;
      const caps = it.choices.map((c) => /^\p{Lu}/u.test(c.label));
      assert.ok(caps.every(Boolean) || !caps.some(Boolean), `the four options of "${it.prompt.la}" share a shape: ${it.choices.map((c) => c.label).join(' / ')}`);
      const answer = it.choices.find((c) => c.correct).label;
      assert.equal(/^\p{Lu}/u.test(answer), caps[0] === true ? true : /^\p{Lu}/u.test(answer), 'the answer is shaped like the rest');
      if (/^\p{Lu}/u.test(answer)) sawInitial = true;
    }
  }
  assert.ok(sawInitial, 'the sweep really met a sentence-initial blank — the case the audit found');
});

/* ==================================================== the service worker */

test('SW: the shell is cached without waiting for a sign-in, and the fixture still registers none', () => {
  const reg = MAIN.indexOf('registerServiceWorker?.()');
  const gate = MAIN.indexOf('auth.ensureSignedIn()');
  assert.ok(reg > 0 && gate > 0, 'both are in boot');
  assert.ok(reg < gate, 'the worker is registered before the sign-in gate, not after it');
  assert.match(MAIN, /if \(!fixture\) registerServiceWorker\?\.\(\)/, 'and the fixture harness registers none');
  assert.equal((MAIN.match(/registerServiceWorker\?\.\(\)/g) ?? []).length, 1, 'registered once, in one place');
  assert.doesNotMatch(MAIN, /await registerServiceWorker/, 'never awaited: it must not hold up the first paint');
});

/* ==================================================== the smaller ones */

test('N-5: the scaffold note on a table reports the cells that table was given', () => {
  const chart = slice('function chartInput(item, submit', 'function formLabel(form)');
  assert.match(chart, /scaffoldSwitch\(tableId, \{ current: level, percent: chart\.cells\.length \? Math\.round\(\(given\.length \/ chart\.cells\.length\) \* 100\) : 0 \}\)/,
    'the note is drawn from the given cells, not from the switch — after a retry the two differ');
});

test('N-9: the catalogue lede counts what the filter left on screen', () => {
  const cat = slice('async function renderCatalogue(', 'function renderTable(got, tableId');
  assert.match(cat, /const listed = parts\.reduce/, 'the tables listed are counted');
  assert.match(cat, /listed === allTables \? `\$\{allTables\} tables` : `\$\{listed\} of \$\{allTables\} tables under this filter`/);
});

test('M-9: the hint copy says what the shipped hint does', () => {
  assert.doesNotMatch(UI, /A hint never spells the answer/, 'the promise the per-box hint breaks is gone');
  assert.match(UI, /Its last step, "Show this form", gives that one box its answer and marks the box hinted/, 'and the copy says what it costs');
});
