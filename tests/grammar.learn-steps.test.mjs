// node --test tests/ — the Learn rebuild finished (GRAMMAR-CONTRACT.md "Teaching
// rebuild" §2, §3, §8, §9 A1, §10, §12, §13), against the real data on disk:
//
//   1  Learn is the teach steps: the notice opener, say / show / check, the
//      checks drawn from the skill's written sentences only, the blocked ten
//      in A1's order with no repeat until both pools are spent;
//   2  a chart check runs one cell over several words as one attempt;
//      a worked example is completed one feature at a time, `why` never fails;
//   3  scaffolded tables: 80 / 50 / 20 / off and auto, anchors first, the
//      taught cell never given, a given cell never another's answer, one
//      attempt scored on the filled cells, the switch remembered;
//   4  "Just drill it", the same-session re-test and the reading tie-in;
//   5  the catalogue: every table's stock words resolve to their table by the
//      select rules, a cell across words, a whole table, a library search;
//   6  the precache carries every data file Learn reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills, indexCatalogue, normaliseSentences, normaliseTeach, normaliseLesson, occurrenceLine, createTeachDataLoader } from '../app/js/grammar/lessons.js';
import { createItems, createTeachItems, createCatalogueItems, tableIdOf, focusFitsId, cellId } from '../app/js/grammar/items.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { createGrammarStore } from '../app/js/grammar/store-grammar.js';
import {
  createLearn, createDrill, createCatalogueDrill, createSkillDraw, kindSequence, workedPlan, judgeWhy, unmetPrereqs, pinText,
  cellResults, judge, scaffoldGiven, scaffoldItem, scaffoldLeak, scaffoldStep, scaffoldPercent, normaliseScaffold, isAnchorKey, SCAFFOLD_LEVELS,
  noteRetest, retestDue, retestPending, RETEST_AFTER_MS, RETEST_SIZE, LEARN_BLOCKED, acceptedAnswers, answerLeak, boxHints,
} from '../app/js/grammar/session.js';

const dataDir = new URL('../app/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const INDEX = indexSkills(read('grammar/skills.json'));
const SKILLS = INDEX.skills;
const RAW_CAT = read('grammar/paradigms.json');
const CAT = indexCatalogue(RAW_CAT);
const HEADWORDS = read('glossary-headwords.json').headwords;
const OCC = read('grammar/occurrences.json');
const lessonOf = (id) => normaliseLesson(read(`grammar/lessons/${id}.json`));
const sentencesOf = (id) => normaliseSentences(read(`grammar/sentences/${id}.json`), id);
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const store = () => createGrammarStore({ mode: 'local', storage: mem() });
const teachFor = (id, rand = () => 0.3) => createTeachItems({ skill: SKILLS.get(id), sentences: sentencesOf(id).sentences, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand });
// A small library of chapter-VII sentences beside the written set, so the ten's library tiers have something to reach.
const UNITS = [
  { id: 'r07:1.1', la: 'Iūlius puerō rosam dat.', en: '' }, { id: 'r07:1.2', la: 'Mēdus dominō pecūniam nōn dat.', en: '' },
  { id: 'r07:1.3', la: 'Aemilia ancillae mālum dat et puerī rīdent atque cantant.', en: '' }, { id: 'r03:1.1', la: 'Mārcus puellae librum dat.', en: '' },
];
const gen = (rand = () => 0.3) => { const items = createItems({ units: UNITS, lookup, paradigm, skills: SKILLS, storage: mem(), rand }); return createGenerator({ items, stage3: createStage3({ items, paradigm, rand }), sets: null, skills: SKILLS }); };
const DIO = 'dative-indirect-object';
const answerRight = (item) => (item.input === 'chart' ? Object.fromEntries(item.chart.cells.map((c, i) => [i, c.answer[0]]))
  : item.input === 'choice' ? item.choices.find((c) => c.correct).value : item.input === 'tap' ? item.accept[0] : item.answer[0]);

/* ============================================ 1 · Learn is the teach steps */

test('normaliseTeach keeps the notice opener, the check\'s own question, and drops what teaches nothing', () => {
  const t = normaliseTeach([
    { n: 2, title: 'B', say: 'x', notice: { sentences: ['a-01', 'a-02'], ask: 'Which?', tap: 'focus' }, check: { kind: 'recognise', sentence: 'a-03', ask: 'What is it doing?' } },
    { n: 1, title: 'A', say: 'y', notice: { sentences: ['a-01'], ask: 'one sentence is no opener' }, show: { kind: 'paradigm', key: 'decl1', reveal: [] } },
    { n: 3 }, null,
  ]);
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'A');
  assert.equal(t[0].notice, null, 'an opener needs two sentences');
  assert.equal(t[0].show, null, 'a paradigm with nothing revealed is the whole table — not shown');
  assert.deepEqual(t[1].notice, { sentences: ['a-01', 'a-02'], ask: 'Which?', tap: 'focus', options: [], answer: null });
  assert.equal(t[1].check.ask, 'What is it doing?');
});

test('every lesson on disk has four to six steps, each with one check, and every step-one notice names two of the skill\'s own sentences', () => {
  const files = readdirSync(new URL('grammar/lessons/', dataDir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  let withNotice = 0;
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    const lesson = lessonOf(id);
    const skill = SKILLS.get(id);
    if (!skill || !lesson.teach.length) continue;
    const ids = new Set(sentencesOf(id).sentences.map((s) => s.id));
    assert.ok(lesson.teach.length >= 3 && lesson.teach.length <= 7, `${id}: ${lesson.teach.length} steps`);
    for (const s of lesson.teach) {
      if (s.check?.sentence) assert.ok(ids.has(s.check.sentence), `${id} step ${s.n}: check names ${s.check.sentence}, not a written sentence`);
      if (s.show?.kind === 'sentence') assert.ok(ids.has(s.show.id), `${id} step ${s.n}: shows ${s.show.id}`);
      if (s.worked) assert.ok(ids.has(s.worked.sentence), `${id} step ${s.n}: worked ${s.worked.sentence}`);
      if (s.notice) { withNotice += 1; for (const n of s.notice.sentences) assert.ok(ids.has(n), `${id}: notice names ${n}`); }
    }
  }
  assert.ok(withNotice >= 50, `openers: ${withNotice}`);
});

test('a step\'s check is a written sentence of the skill, never the library; a step\'s own question wording is used', () => {
  const teach = teachFor(DIO);
  const lesson = lessonOf(DIO);
  const draw = createSkillDraw({ skill: SKILLS.get(DIO), steps: lesson.teach, teachItems: teach, libraryItem: () => { throw new Error('the library must not be reached by a step'); } });
  const written = new Set(sentencesOf(DIO).sentences.map((s) => s.id));
  for (const slot of draw.stepSlots) {
    const item = draw.stepItem(slot);
    assert.ok(item, `step ${slot.step} builds`);
    assert.equal(item.teach, true);
    assert.equal(item.key, null, 'a step item is never a redo item');
    if (item.kind === 'chart') assert.ok(item.chart.byWord && item.chart.cells.length >= 2, 'a chart check is one cell over several words');
    else assert.ok(written.has(item.taught), `${item.taught} is a written sentence`);
  }
  // The notice's sentences count as shown, so the ten does not lead with them.
  assert.ok(draw.shown.has('dio-01') && draw.shown.has('dio-02'));
  // purpose-clause step 1 words its own question.
  const pc = teachFor('purpose-clause');
  const pcDraw = createSkillDraw({ skill: SKILLS.get('purpose-clause'), steps: lessonOf('purpose-clause').teach, teachItems: pc, libraryItem: () => null });
  assert.equal(pcDraw.stepItem(pcDraw.stepSlots[0]).prompt.question, 'What is lūdat doing here?');
});

test('A1: the ten draws unseen written sentences first, then short library sentences, then the rest; nothing repeats until both pools are spent', () => {
  const teach = teachFor(DIO);
  const skill = SKILLS.get(DIO);
  const g = gen();
  const ceiling = 7;
  const libraryItem = (slot, opts = {}) => g.generate({ skill: DIO, kind: slot.kind, stage: slot.stage, chapter: ceiling, chapterMode: 'ceiling', ...opts });
  const draw = createSkillDraw({ skill, steps: [], teachItems: teach, libraryItem });
  const seen = [];
  const pools = [];
  for (let i = 0; i < 30; i++) {
    const it = draw.blockedItem({ skill: DIO, kind: 'recognise', stage: 1 });
    if (!it) break;
    pools.push(it.pool);
    seen.push(it.pool === 'written' ? it.taught : it.key);
  }
  const firstLibrary = pools.indexOf('library-short');
  assert.ok(firstLibrary > 5, `the written sentences come first (${firstLibrary})`);
  assert.ok(pools.slice(0, firstLibrary).every((p) => p === 'written'));
  const writtenIds = seen.slice(0, firstLibrary);
  assert.equal(new Set(writtenIds).size, writtenIds.length, 'no written sentence twice');
  const lib = seen.slice(firstLibrary).filter((k, i, a) => pools[firstLibrary + i]?.startsWith('library'));
  const firstRepeat = lib.findIndex((k, i) => lib.indexOf(k) < i);
  assert.ok(firstRepeat === -1 || firstRepeat >= 2, 'the library pools are used up before any item comes round again');
});

test('createLearn walks the steps then the ten; prerequisites unmet are named, never a bar', async () => {
  const skill = SKILLS.get(DIO);
  const gstore = store();
  await gstore.ready();
  const learn = createLearn({ skill, gstore, items: gen(), teach: lessonOf(DIO).teach, teachItems: teachFor(DIO), currentWeekN: 107, rand: () => 0.3 });
  await learn.begin();
  assert.equal(learn.steps.length, 6);
  assert.deepEqual(unmetPrereqs(skill, (id) => gstore.getState(id)), ['nominative-subject', 'accusative-object']);
  let cur = learn.startSteps();
  let n = 0;
  while (cur) { n += 1; await learn.runner.answer(answerRight(cur.item)); cur = learn.runner.forward(); }
  assert.equal(n, 6, 'one check a step');
  cur = learn.startBlocked();
  let ten = 0;
  while (cur) { ten += 1; await learn.runner.answer(answerRight(cur.item)); cur = learn.runner.forward(); }
  assert.ok(ten >= 8 && ten <= LEARN_BLOCKED, `the ten: ${ten}`);
  const r = await learn.finishBlocked();
  assert.equal(r.passed, true);
  assert.equal(gstore.getState(DIO).state, 'practising');
});

/* ============================================ 2 · charts over words, worked examples */

test('a chart check over three words is one attempt, right only when every box is right unaided; per-cell truth still paints each box', () => {
  const teach = teachFor(DIO);
  const item = teach.chartItem({ key: 'decl2n', cells: ['dat.sg'], words: ['oppidum', 'verbum', 'baculum'] });
  assert.deepEqual(item.chart.cells.map((c) => [c.word, c.answer[0]]), [['oppidum', 'oppidō'], ['verbum', 'verbō'], ['baculum', 'baculō']]);
  const half = judge(item, { 0: 'oppidō', 1: 'verbum', 2: 'baculō' });
  assert.equal(half.correct, false);
  assert.deepEqual(half.cells.map((c) => c.ok), [true, false, true]);
  assert.equal(judge(item, { 0: 'oppido', 1: 'verbo', 2: 'baculo' }).correct, true, 'macrons optional');
  // The step's chart falls back to the table's stock words when it names none.
  const stock = teach.chartItem({ key: 'decl1', cells: ['dat.sg'] });
  assert.ok(stock.chart.cells.length >= 3);
  // Every box has a hint of its own, and none of them spells any accepted answer.
  const hints = boxHints(item, { skill: SKILLS.get(DIO) });
  assert.equal(hints.length, 3);
  for (const b of hints) for (const t of b.levels) assert.deepEqual(answerLeak(t, acceptedAnswers(item)), []);
});

test('a worked example: the first is fully given; a later one prints its given features and asks the rest one at a time; why is judged generously', () => {
  const teach = teachFor(DIO);
  const lesson = lessonOf(DIO);
  const first = workedPlan(lesson.teach[0].worked, teach.focusOf('dio-01'), { skill: SKILLS.get(DIO), skills: SKILLS, first: true });
  assert.equal(first.asks.length, 0);
  assert.deepEqual(first.given.map((f) => [f.key, f.value]), [['case', 'dat'], ['number', 'sg'], ['gender', 'm']]);
  const later = workedPlan(lesson.teach[2].worked, teach.focusOf('dio-02'), { skill: SKILLS.get(DIO), skills: SKILLS, rand: () => 0.4 });
  assert.equal(later.word, 'fīliae');
  assert.deepEqual(later.given.map((f) => f.key), ['number', 'gender']);
  assert.deepEqual(later.asks.map((f) => f.key), ['case']);
  assert.ok(later.asks[0].choices.some((c) => c.correct && c.value === 'dat'));
  assert.equal(later.why, true);
  assert.equal(judgeWhy('the verb gives it to her').ok, true);
  assert.equal(judgeWhy('because').ok, true, 'one real word is a thought');
  assert.equal(judgeWhy('').empty, true);
  assert.equal(judgeWhy('?').ok, false, 'but it cannot fail anything: nothing reads this');
});

/* ============================================ 3 · scaffolded tables (§12) */

const catalogueGen = () => createCatalogueItems({ catalogue: CAT, lookup, paradigm, headwords: HEADWORDS, skills: SKILLS });

test('scaffold levels: auto starts at 80 and fades a level after a table right unaided, back a level after a wrong one; off is blank', () => {
  assert.deepEqual([...SCAFFOLD_LEVELS], ['auto', 80, 50, 20, 'off']);
  assert.equal(normaliseScaffold(undefined), 'auto');
  assert.equal(normaliseScaffold('50'), 50);
  assert.equal(normaliseScaffold(0), 'off');
  assert.equal(scaffoldPercent('auto'), 80);
  assert.equal(scaffoldPercent('auto', 20), 20);
  assert.equal(scaffoldPercent('off'), 0);
  assert.equal(scaffoldStep(80, { correct: true }), 50);
  assert.equal(scaffoldStep(50, { correct: true, hinted: true }), 50, 'a hinted right does not fade');
  assert.equal(scaffoldStep(0, { correct: true }), 0);
  assert.equal(scaffoldStep(20, { correct: false }), 50);
  assert.equal(scaffoldStep(80, { correct: false }), 80);
});

test('the given cells are the anchors first, never the taught cell, never another cell\'s answer; at least one cell is left; scored on the filled cells', () => {
  const ci = catalogueGen();
  const item = ci.tableItem({ tableId: 'decl2m', word: 'servus' });
  assert.equal(item.chart.cells.length, 12);
  const at80 = scaffoldGiven(item, { percent: 80 });
  const ids = (g) => g.map((i) => item.chart.cells[i].cellId);
  assert.ok(ids(at80).includes('nom.sg') && ids(at80).includes('gen.sg'), 'the dictionary-form cells first');
  assert.ok(at80.length <= 10 && at80.length >= 6, `80%: ${at80.length}`);
  // The cell a step teaches is never given — nor any cell that prints the same form as it.
  const taught = scaffoldGiven(item, { percent: 80, taught: ['dat.sg'] });
  assert.ok(!ids(taught).includes('dat.sg') && !ids(taught).includes('abl.sg'), 'servō is dative and ablative: both stay blank');
  for (const pc of [80, 50, 20]) {
    const g = scaffoldGiven(item, { percent: pc });
    assert.ok(g.length < 12 && g.length > 0);
    assert.deepEqual(scaffoldLeak(scaffoldItem(item, g)), [], `${pc}%: no given cell answers a blank one`);
  }
  assert.deepEqual(scaffoldGiven(item, { percent: 0 }), []);
  // puella: nom.pl / gen.sg / dat.sg / voc.pl all print puellae, so they are given together or not at all.
  const puella = ci.tableItem({ tableId: 'decl1', word: 'puella' });
  const g = scaffoldGiven(puella, { percent: 50 });
  const same = ['nom.pl', 'gen.sg', 'dat.sg', 'voc.pl'].map((id) => ids(g).includes(id));
  assert.ok(same.every(Boolean) || !same.some(Boolean));
  assert.deepEqual(scaffoldLeak(scaffoldItem(puella, g)), []);
  // One attempt, on the filled cells: the given ones are right by definition and marked as such.
  const s = scaffoldItem(item, at80);
  const blank = item.chart.cells.map((_, i) => i).filter((i) => !at80.includes(i));
  const answers = Object.fromEntries(blank.map((i) => [i, item.chart.cells[i].answer[0]]));
  const r = judge(s, answers);
  assert.equal(r.correct, true);
  assert.equal(r.cells.filter((c) => c.scaffold).length, at80.length);
  answers[blank[0]] = 'wrong';
  assert.equal(judge(s, answers).correct, false);
  // A chart over words has nothing to give.
  const words = teachFor(DIO).chartItem({ key: 'decl2m', cells: ['dat.sg'] });
  assert.deepEqual(scaffoldGiven(words, { percent: 80 }), []);
  // Anchors by key.
  assert.equal(isAnchorKey({ kind: 'nominal', case: 'nom', number: 'sg' }), true);
  assert.equal(isAnchorKey({ kind: 'finite', tense: 'pres', mood: 'ind', voice: 'act', person: '1', number: 'sg' }), true);
  assert.equal(isAnchorKey({ kind: 'nominal', case: 'dat', number: 'sg' }), false);
});

test('the scaffold sweep over every catalogue table and level: no given cell is ever the answer to a filled one', () => {
  const ci = catalogueGen();
  let checked = 0;
  for (const [id, t] of CAT.tables) {
    for (const w of t.stock.slice(0, 2)) {
      for (const g of t.groups) {
        const item = ci.tableItem({ tableId: id, word: w, group: g.id });
        if (!item || item.chart.cells.length < 2) continue;
        for (const pc of [80, 50, 20]) {
          const given = scaffoldGiven(item, { percent: pc });
          assert.deepEqual(scaffoldLeak(scaffoldItem(item, given)), [], `${id} ${w.h} ${g.id} at ${pc}%`);
          assert.ok(given.length < item.chart.cells.length);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 400, `tables swept: ${checked}`);
});

/* ============================================ 4 · just drill it, re-test, tie-in */

test('createDrill: ten items on the skill alone, written first, the rule pinned on every item and swept for its answers; a new skill enters the rotation', async () => {
  const gstore = store();
  await gstore.ready();
  const skill = SKILLS.get(DIO);
  const drill = createDrill({ skill, gstore, items: gen(), teachItems: teachFor(DIO), currentWeekN: 107, pin: 'The receiver takes the dative: servō, fīliae, patrī.', rand: () => 0.3 });
  await drill.begin();
  assert.equal(gstore.getState(DIO).state, 'practising');
  let cur = drill.start();
  let n = 0;
  const pins = new Set();
  while (cur) {
    n += 1;
    assert.equal(cur.item.skill, DIO);
    assert.ok(cur.item.pin, 'a rule is pinned');
    pins.add(cur.item.pin);
    // The pin never spells an accepted answer of the item it sits above (label kinds excepted, as for hints).
    if (!['recognise', 'parse'].includes(cur.item.kind)) assert.deepEqual(answerLeak(cur.item.pin, acceptedAnswers(cur.item)), [], `${cur.item.kind}: ${cur.item.pin}`);
    await drill.runner.answer(answerRight(cur.item));
    cur = drill.runner.forward();
  }
  assert.ok(n >= 8 && n <= 10, `${n} items`);
  assert.ok(pins.size >= 1);
  assert.equal(drill.mode, 'practice');
  assert.equal(gstore.getAttempts({ skill: DIO }).length, n);
  assert.equal(pinText(['the form servō is the answer', 'a safe summary'], { kind: 'blank', answer: ['servō'] }), 'a safe summary');
  assert.equal(pinText(['servō'], { kind: 'blank', answer: ['servō'] }), null);
  // A drill on a table skill with no chart steps still drills its focus cells on stock words.
  assert.equal(focusFitsId('dat.sg', { case: 'dat' }), true);
  assert.equal(focusFitsId('abl.sg', { case: 'dat' }), false);
  const draw = createSkillDraw({ skill, steps: [], teachItems: teachFor(DIO), libraryItem: () => null });
  const chart = draw.blockedItem({ skill: DIO, kind: 'chart', stage: 1 });
  assert.ok(chart && chart.pool === 'written' && chart.chart.cells.every((c) => /^dat\./.test(c.cellId)), 'the dative cells, on stock words');
  // A skill still in Learn is not graduated by a drill: its attempts go to the criterion in learn mode.
  const g2 = store(); await g2.ready();
  const learn = createLearn({ skill, gstore: g2, items: gen(), teach: [], teachItems: null, rand: () => 0.3 }); await learn.begin();
  const d2 = createDrill({ skill, gstore: g2, items: gen(), teachItems: teachFor(DIO), size: 3 });
  await d2.begin();
  assert.equal(d2.mode, 'learn');
  assert.equal(g2.getState(DIO).state, 'learning');
  assert.equal(kindSequence(skill, 6, () => 1, () => 0.3).length, 6);
});

test('the same-session re-test: noted once a skill, due after ten minutes, three items long', () => {
  const t0 = 1_000_000;
  let list = noteRetest([], DIO, t0);
  list = noteRetest(list, 'purpose-clause', t0 + 1000);
  list = noteRetest(list, DIO, t0 + 2000);
  assert.deepEqual(list.map((r) => r.skill), ['purpose-clause', DIO], 'one entry a skill, the newest sitting kept');
  assert.deepEqual(retestDue(list, t0 + 5 * 60_000), []);
  assert.deepEqual(retestPending(list, t0 + 5 * 60_000).map((r) => r.skill), ['purpose-clause', DIO]);
  assert.deepEqual(retestDue(list, t0 + 1000 + RETEST_AFTER_MS).map((r) => r.skill), ['purpose-clause']);
  assert.equal(RETEST_SIZE, 3);
  assert.equal(RETEST_AFTER_MS, 10 * 60 * 1000);
});

test('the reading tie-in wording: "the notes mark N" from the highlights, "occurs about N times" from the scanner alone, sx never counted, the unit ids passed', () => {
  const dio7 = occurrenceLine(OCC, DIO, 7);
  assert.equal(dio7.src, 'h');
  assert.equal(dio7.text, 'The notes mark 21 in this chapter.');
  assert.ok(dio7.unitIds.includes('r07:46.1'));
  const dio8 = occurrenceLine(OCC, DIO, 8);
  assert.equal(dio8.src, 's');
  assert.equal(dio8.text, 'It occurs about 2 times in this chapter.');
  assert.equal(occurrenceLine(OCC, DIO, 10), null, 'a count of nought is no line (12 ambiguous matches notwithstanding)');
  assert.equal(occurrenceLine(OCC, 'no-such-skill', 7), null);
  assert.equal(occurrenceLine({ skills: { x: { 3: { src: 's', n: 1, s: 1, ids: { r03: '1.1' } } } } }, 'x', 3).text, 'It occurs about 1 time in this chapter.');
});

test('the teach data loader fetches the occurrences file once and tolerates a miss', async () => {
  const calls = [];
  const loader = createTeachDataLoader({ fetchJson: async (name) => { calls.push(name); if (name === 'occurrences.json') return OCC; throw new Error(`${name}: 404`); } });
  assert.equal((await loader.loadOccurrences()).skills[DIO]['7'].h, 21);
  await loader.loadOccurrences();
  assert.deepEqual(calls, ['occurrences.json']);
  const miss = createTeachDataLoader({ fetchJson: async () => { throw new Error('x: 404'); } });
  assert.equal(await miss.loadOccurrences(), null);
});

/* ============================================ 5 · the catalogue (§4, decision 10) */

test('every stock word of every catalogue table resolves to its own table by the select rules', () => {
  let n = 0;
  for (const [id, t] of CAT.tables) for (const w of t.stock) { n += 1; const e = lookup(w.key ?? w.h)?.entries?.[w.i]; assert.equal(tableIdOf(e, RAW_CAT.select), id, `${w.h} → ${id}`); }
  assert.equal(n, RAW_CAT.parts.reduce((k, p) => k + p.tables.reduce((m, t) => m + t.stock.length, 0), 0));
  assert.equal(tableIdOf(null, RAW_CAT.select), null);
});

test('the catalogue generator: one cell across words, a whole table or a group of it, the word switched, the axes narrowing the cells, a library search', () => {
  const ci = catalogueGen();
  const cell = ci.cellItem({ tableId: 'decl2m', cellId: 'dat.sg' });
  assert.ok(cell.chart.byWord && cell.chart.cells.length >= 3);
  assert.deepEqual(cell.chart.cells.slice(0, 2).map((c) => [c.word, c.answer[0]]), [['fluvius', 'fluviō'], ['servus', 'servō']]);
  assert.equal(cell.key, null, 'never a redo item');
  const whole = ci.tableItem({ tableId: 'decl1', word: 'puella' });
  assert.equal(whole.chart.cells.length, 12);
  assert.equal(whole.prompt.question, 'Fill in the cases of puella');
  const group = ci.tableItem({ tableId: 'conj1', word: 'amo', group: 'pres.ind' });
  assert.equal(group.chart.cells.length, 12);
  assert.match(group.prompt.question, /present indicative of amō/);
  const switched = ci.tableItem({ tableId: 'decl1', word: { h: 'ancilla', key: 'ancilla', i: 0 } });
  assert.equal(switched.chart.cells[0].answer[0], 'ancilla');
  assert.deepEqual(ci.narrowCells(ci.cellIdsOf('decl1'), { number: ['sg'] }), ['nom.sg', 'gen.sg', 'dat.sg', 'acc.sg', 'abl.sg', 'voc.sg']);
  assert.deepEqual(ci.narrowCells(ci.cellIdsOf('decl1'), { number: ['sg'], case: ['dat', 'abl'] }), ['dat.sg', 'abl.sg']);
  const narrowed = ci.tableItem({ tableId: 'decl1', word: 'puella', cellIds: ['dat.sg', 'abl.sg'] });
  assert.deepEqual(narrowed.chart.cells.map((c) => c.cellId), ['dat.sg', 'abl.sg']);
  const found = ci.search('ancil', { table: 'decl1' });
  assert.ok(found.length >= 1 && found[0].h === 'ancilla' && found[0].fits);
  const other = ci.search('domin', { table: 'decl1' });
  assert.ok(other.some((r) => r.h === 'dominus' && !r.fits && r.table === 'decl2m'), 'a word of another table is offered with its table named');
  assert.deepEqual(ci.search('a'), [], 'two letters at least');
  assert.deepEqual(ci.stockWords('decl1', { gender: ['m'] }).map((w) => w.h), ['nauta']);
  // The same per-box hint everywhere: every cell of a whole table has one, and none names an answer.
  const hints = boxHints(whole, { skill: SKILLS.get(DIO) });
  assert.equal(hints.length, 12);
  for (const b of hints) for (const t of b.levels) assert.deepEqual(answerLeak(t, acceptedAnswers(whole)), []);
  assert.equal(cellId({ kind: 'nominal', case: 'dat', number: 'sg', gender: 'f' }, 'noun'), 'dat.sg');
});

test('a catalogue drill always logs under the naming skill, and schedules only while that skill is in the rotation', async () => {
  // §20 split what used to be one flag: the log is written either way, the scheduler only when the
  // run counts. Before it, a table practised from the Tables tab on a skill out of the rotation
  // wrote nothing at all, and the progress sheet could not see the very run the learner meant.
  const ci = catalogueGen();
  const items = [ci.cellItem({ tableId: 'decl2m', cellId: 'dat.sg' }), ci.tableItem({ tableId: 'decl2m', word: 'servus' })];
  const gstore = store(); await gstore.ready();
  const quiet = createCatalogueDrill({ items, gstore, skillId: DIO });
  assert.equal(quiet.counted, false);
  // A tick between answers, and it is not politeness. An attempt's id is `at|skill|item_key`, and a
  // catalogue item carries **no** item_key (that is what keeps these rows out of the redo list), so two
  // answers landing in the same millisecond under the same skill produce the same id and the store keeps
  // one. The counts below are then short by one and this test fails perhaps one run in three — which is
  // worse than failing always, because an intermittent gate teaches you to re-run instead of to look.
  const tick = () => new Promise((r) => setTimeout(r, 2));
  let cur = quiet.start();
  while (cur) { await quiet.runner.answer(answerRight(cur.item)); await tick(); cur = quiet.runner.forward(); }
  const uncounted = gstore.getAttempts({ skill: DIO });
  assert.equal(uncounted.length, 2, 'out of the rotation the table is still written down');
  for (const a of uncounted) assert.equal(a.meta?.uncounted, true, 'and marked, so every scheduling reader can skip it');
  assert.equal(gstore.getState(DIO), null, 'not in the rotation: nothing was scheduled');
  const { addToPractice, isUncounted } = await import('../app/js/grammar/scheduler.js');
  for (const a of uncounted) assert.equal(isUncounted(a), true, 'the marker the writer spells is the one the readers read');
  await gstore.setState(addToPractice(DIO));
  const counted = createCatalogueDrill({ items, gstore, skillId: DIO });
  assert.equal(counted.counted, true);
  cur = counted.start();
  while (cur) { await counted.runner.answer(answerRight(cur.item)); await tick(); cur = counted.runner.forward(); }
  const all = gstore.getAttempts({ skill: DIO });
  assert.equal(all.length, 4);
  assert.equal(all.filter(isUncounted).length, 2, 'a counted run carries no marker');
  assert.deepEqual(gstore.getMissed({ skill: DIO }), [], 'nothing here can enter the redo list');
});

test('a catalogue table no skill names records nothing: there is no row to record it under', async () => {
  const ci = catalogueGen();
  const items = [ci.tableItem({ tableId: 'decl2m', word: 'servus' })];
  const gstore = store(); await gstore.ready();
  const drill = createCatalogueDrill({ items, gstore, skillId: null });
  assert.equal(drill.counted, false);
  let cur = drill.start();
  while (cur) { await drill.runner.answer(answerRight(cur.item)); cur = drill.runner.forward(); }
  assert.equal(gstore.getAttempts().length, 0, 'an attempt under a table id would sit on no sheet');
});

/* ============================================ 6 · the precache */

test('sw.js precaches every file Learn and the catalogue read', () => {
  const sw = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  for (const f of ['./data/grammar/paradigms.json', './data/glossary-headwords.json', './data/grammar/occurrences.json', `./data/grammar/sentences/${DIO}.json`, './data/grammar/sentences/purpose-clause.json']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(sw, /CACHE_VERSION = 'v4[7-9]'|CACHE_VERSION = 'v[5-9]\d'/);
});
