// node --test tests/ — the four measured wins of the teaching rebuild
// (GRAMMAR-CONTRACT.md "Teaching rebuild (2026-09-09)" §3 and §7):
//
//   1  **the learner's chapter is the ceiling on every session**, not on the
//      ~20 % of slots that already asked for this week (§7.2: 85 % of every
//      skill's pool was sentences from later chapters, and at chapter 5 48.4 %
//      of the words a learner met in drills were beyond them). Learn, the
//      preset session, "Practise this skill", a confusion pair and a redo all
//      draw under it; a skill with nothing at or before the chapter still
//      reaches outward, and the item says so.
//   2  **"shorter first" counts words** (§7.1: `SHORT_LA = 180` counted
//      characters, 98.1 % of candidates passed it, and its "short" sentences
//      ran to 36 words). Eight words — what the learner asked for, and the
//      library's own median is seven.
//   3  **every answer box is judged on its own** (§3): the per-cell truth
//      `judge` already had is now a function of its own, one entry per box, and
//      a chart is still exactly one attempt for the scheduler.
//   4  the two defects §7.5 found in that code: the "Tell me more" paradigm on
//      a `blank` item printed the answer, and Tab from a cell landed on that
//      cell's own hint button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems, SHORT_WORDS } from '../app/js/grammar/items.js';
import { createStage3, LONG_WORDS, wordsIn } from '../app/js/grammar/stage3.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { scopeSentence } from '../app/js/grammar/ui.js';
import { scopeByChapter, scopeNote, SCOPE_MODES } from '../app/js/grammar/chapter.js';
import { buildSession, newState, addToPractice } from '../app/js/grammar/scheduler.js';
import { createLearn, createPractice, createBlockedFive, createRedo, judge, judgeCell, cellResults, paradigmLeak, maskParadigm, acceptedAnswers } from '../app/js/grammar/session.js';

const RAW = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const INDEX = indexSkills(RAW);
const SKILL = 'dative-indirect-object';   // the book introduces it in chapter VII
const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');

/* --------------------------------------------------------------- fixture */
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind: null });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const DO = ['dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat']];
const G = {
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],
  regi: [N('rēx, rēgis m', 'rex', [3, 1], 'm', ['rēx', 'rēg'], [nk('dat', 'sg', 'm')], ['king'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  rosam: [N('rosa -ae f', 'rosa', [1, 1], 'f', ['ros', 'ros'], [nk('acc', 'sg', 'f')], ['rose'])],
  dat: [V(...DO, [{ tense: 'pres', voice: 'act', mood: 'ind', person: 3, number: 'sg' }], ['give'])],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

// A long tail of filler that carries no candidate of its own, so a sentence can be made any length
// without changing what the skill matches. 30 words of it is longer than anything the old character
// bar excluded; 4 words is the shape the learner asked for.
const PAD = (n) => ` ${Array.from({ length: n }, () => 'et').join(' ')}`;
const UNITS = [
  { id: 'r07:1.1', la: `Puerō rosam dat.` },                    // 3 words, chapter VII
  { id: 'r07:1.2', la: `Rēgī librum dat.${PAD(30)}` },          // 33 words, chapter VII
  { id: 'r03:1.1', la: `Puerō librum dat.` },                   // 3 words, chapter III
  { id: 'w13:1.1', la: `Rēgī rosam dat.${PAD(30)}`, en: 'He gives the king a rose.' },   // chapter XXXIV
];
const CHAPTER_OF = { 'r03:1.1': 3, 'r07:1.1': 7, 'r07:1.2': 7, 'w13:1.1': 34 };

const build = (units = UNITS) => {
  const items = createItems({ units, lookup, paradigm, skills: INDEX.skills, storage: mem(), rand: () => 0.5 });
  const stage3 = createStage3({ items, paradigm, rand: () => 0.5 });
  return createGenerator({ items, stage3, sets: null, skills: INDEX.skills });
};
const draw = (gen, opts, n = 6) => {
  const out = [];
  for (let i = 0; i < n; i++) { const it = gen.generate({ skill: SKILL, kind: 'recognise', stage: 1, ...opts }); if (it) out.push(it); }
  return out;
};

/* ============================================ 1 · the chapter as a ceiling */

test('the ceiling is one tier of everything at or before the chapter, and each item still says which chapter it came from', () => {
  assert.deepEqual([...SCOPE_MODES], ['own-first', 'ceiling']);
  const list = [{ week_n: 107 }, { week_n: 103 }, { week_n: 13 }, { week_n: 999 }];
  const cap = scopeByChapter(list, 7, undefined, { mode: 'ceiling' });
  assert.equal(cap.scope, 'at-or-before');
  assert.deepEqual(cap.list, [{ week_n: 107 }, { week_n: 103 }], 'chapter VII and chapter III together, later and unknown left out');
  // A chapter's own practice is unchanged: its own Latin first, so the session reads like the chapter.
  assert.equal(scopeByChapter(list, 7).scope, 'own');
  assert.deepEqual(scopeByChapter(list, 7).list, [{ week_n: 107 }]);
  // The note is per sentence, so an item drawn under a ceiling still says 'own' or 'earlier' as it always did.
  assert.deepEqual(scopeNote(7, 'at-or-before', { week_n: 107 }), { chapter: 7, from: 7, scope: 'own', beyond: false, ceiling: true });
  assert.deepEqual(scopeNote(7, 'at-or-before', { week_n: 103 }), { chapter: 7, from: 3, scope: 'earlier', beyond: false, ceiling: true });
  assert.deepEqual(scopeNote(7, 'earlier', { week_n: 103 }), { chapter: 7, from: 3, scope: 'earlier', beyond: false }, "a chapter's own practice carries no ceiling flag");
  // And the two say different things: under a ceiling an earlier chapter is not news about this chapter.
  assert.equal(scopeSentence({ chapter: 7, from: 3, scope: 'earlier', beyond: false, ceiling: true }), 'From chapter III — Latin you have already read.');
  assert.match(scopeSentence({ chapter: 7, from: 3, scope: 'earlier', beyond: false }), /no sentence in chapter VII itself/);
});

test('a ceiling reaches outward only when a skill has nothing at or before it — and never silently', () => {
  const cap = scopeByChapter([{ week_n: 13 }, { week_n: 999 }], 7, undefined, { mode: 'ceiling' });
  assert.equal(cap.scope, 'beyond');
  assert.equal(cap.list.length, 2, 'the wider library rather than an empty session');
  assert.equal(scopeNote(7, 'beyond', { week_n: 13 }).beyond, true, 'the item carries the reach forward');
  // Nothing to cap with (a learner who has read nothing) leaves the draw alone.
  assert.equal(scopeByChapter([{ week_n: 13 }], null, undefined, { mode: 'ceiling' }).scope, null);
});

test('a session under the ceiling draws the chapter it is at and the ones behind it, never one ahead', () => {
  const gen = build();
  const items = draw(gen, { chapter: 7, chapterMode: 'ceiling' }, 8);
  assert.ok(items.length >= 3, 'the ceiling does not starve the skill');
  for (const it of items) assert.ok(CHAPTER_OF[it.unit_id] <= 7, `${it.unit_id} is at or before chapter VII`);
  assert.ok(new Set(items.map((it) => it.unit_id)).size >= 3, 'all three sentences at or before it are in play, not just the chapter\'s own two');
  // The same draw as a chapter's own practice keeps to that chapter alone.
  const own = draw(build(), { chapter: 7 }, 8);
  assert.deepEqual([...new Set(own.map((it) => CHAPTER_OF[it.unit_id]))], [7]);
});

test('a skill with nothing at or before the learner still produces items, and each says it reached forward', () => {
  const gen = build();
  const items = draw(gen, { chapter: 1, chapterMode: 'ceiling' }, 4);
  assert.ok(items.length, 'no skill that had material loses all of it');
  for (const it of items) {
    assert.equal(it.scope.beyond, true);
    assert.equal(it.scope.chapter, 1);
    assert.ok(it.scope.from > 1);
  }
});

/** Every option handed to the generator, in order, so a session type can be asked what it scoped by. */
function recorder() {
  const calls = [];
  return {
    calls,
    drillable: () => true,
    pool: { reset() {} },
    generate: (opts) => {
      calls.push(opts);
      return { skill: opts.skill, kind: opts.kind ?? 'blank', stage: opts.stage ?? 1, key: `${opts.skill}:${calls.length}`, input: 'type', answer: ['right'], choices: null,
        unit_id: null, target: null, entry: null, meanings: [], confuse: { values: {}, indexes: {}, forms: {} },
        prompt: { la: 'Puerō rosam dat.', question: 'q', gloss: '', hint: '' }, feedback: { short: 'x', label: null, table: null } };
    },
  };
}
function memStore(inRotation = []) {
  const states = new Map(inRotation.map((id) => [id, addToPractice(newState(id, Date.now() - 86400000))]));
  const attempts = [];
  return {
    states, attempts,
    getStates: () => states, getState: (id) => states.get(id) ?? null, setState: async (s) => { states.set(s.skill, s); return s; },
    getConfusions: () => [], getAttempts: () => attempts, addAttempt: async (a) => { attempts.push(a); }, bumpConfusion: async () => {},
  };
}
const SKILL_ROW = { id: 'a', set: null, title: 'A', plain: 'the a', summary: 'a: the rule.', kinds: ['blank'], parse_filter: { case: 'dat' }, confusable_with: [], prereqs: [], feature: 'case' };
const SKILLS = new Map([['a', SKILL_ROW], ['b', { ...SKILL_ROW, id: 'b' }]]);
const WEEK = 4;        // library week 4 reads chapter XXVII (app/js/chapters.js)
const CEILING = 27;

test('every session type draws under the learner\'s chapter: Learn, the preset session, one skill, a pair, a redo', () => {
  const capped = (calls) => calls.length && calls.every((o) => o.chapter === CEILING && o.chapterMode === 'ceiling');

  const learnItems = recorder();
  const learn = createLearn({ skill: SKILL_ROW, gstore: memStore(), items: learnItems, currentWeekN: WEEK, rand: () => 0.4 });
  learn.startGuided();
  assert.ok(capped(learnItems.calls), 'Learn');

  const practiceItems = recorder();
  createPractice({ gstore: memStore(['a', 'b']), items: practiceItems, skillsIndex: { skills: SKILLS }, currentWeekN: WEEK, size: 5, rand: () => 0.4 }).start();
  assert.ok(capped(practiceItems.calls), 'the preset practice session');

  const fiveItems = recorder();
  createBlockedFive({ skill: SKILL_ROW, gstore: memStore(), items: fiveItems, skillsIndex: { skills: SKILLS }, currentWeekN: WEEK, rand: () => 0.4 }).start();
  assert.ok(capped(fiveItems.calls), '"Practise this skill"');

  // A confusion pair is handed in as a finished plan, so its slots carry no chapter of their own.
  const pairItems = recorder();
  const pairPlan = [{ skill: 'a', kind: 'blank', stage: 1, currentWeek: false, pair: true }, { skill: 'b', kind: 'blank', stage: 1, currentWeek: false, pair: true }];
  createPractice({ plan: pairPlan, gstore: memStore(), items: pairItems, skillsIndex: { skills: SKILLS }, currentWeekN: WEEK, size: 2, fill: null, pair: ['a', 'b'], rand: () => 0.4 }).start();
  assert.ok(capped(pairItems.calls), 'a confusion pair');

  const redoItems = recorder();
  const misses = [{ skill: 'a', kind: 'blank', item_key: 'blank:x', at: new Date().toISOString() }];
  createRedo({ misses, gstore: memStore(), items: redoItems, skillsIndex: { skills: SKILLS }, size: 1, currentWeekN: WEEK, rand: () => 0.4 }).start();
  assert.ok(capped(redoItems.calls), 'a redo');
  assert.equal(redoItems.calls[0].itemKey, 'blank:x', 'and it is still the item that was missed');

  // A chapter session outranks the learner's position, and keeps its own-first rule.
  const chapterItems = recorder();
  createPractice({ gstore: memStore(['a', 'b']), items: chapterItems, skillsIndex: { skills: SKILLS }, currentWeekN: WEEK, chapter: 7, size: 3, rand: () => 0.4 }).start();
  assert.ok(chapterItems.calls.every((o) => o.chapter === 7 && o.chapterMode === 'own-first'));
});

test('a learner with no position read yet is not capped at all', () => {
  const items = recorder();
  createPractice({ gstore: memStore(['a', 'b']), items, skillsIndex: { skills: SKILLS }, size: 3, rand: () => 0.4 }).start();
  assert.ok(items.calls.length);
  assert.ok(items.calls.every((o) => o.chapter === null));
});

/* ================================================ 2 · shorter first, in words */

test('"short" is eight words, not 180 characters', () => {
  assert.equal(SHORT_WORDS, 8);
  // The bar the old one let through: 33 words is 172 characters of this fixture's Latin.
  const long = UNITS[1].la;
  assert.ok(long.length <= 180, 'the old character bar called this sentence short');
  assert.ok(wordsIn(long) > SHORT_WORDS, 'the word bar does not');
});

test('a drill draws the short sentences of a tier before its long ones, and only then the long ones', () => {
  const gen = build();
  const first = gen.generate({ skill: SKILL, kind: 'recognise', stage: 1, chapter: 7, chapterMode: 'ceiling' });
  assert.ok(wordsIn(first.prompt.la) <= SHORT_WORDS, 'the first sentence a learner sees is a short one');
  const seen = [first];
  for (let i = 0; i < 5; i++) { const it = gen.generate({ skill: SKILL, kind: 'recognise', stage: 1, chapter: 7, chapterMode: 'ceiling' }); if (it) seen.push(it); }
  const lengths = seen.map((it) => wordsIn(it.prompt.la));
  const firstLong = lengths.findIndex((n) => n > SHORT_WORDS);
  assert.ok(firstLong === -1 || lengths.slice(0, firstLong).every((n) => n <= SHORT_WORDS), 'the long sentence comes only once the short ones are spent');
  assert.ok(seen.some((it) => wordsIn(it.prompt.la) <= SHORT_WORDS), 'and short sentences really were drawn');
});

test('the production kinds keep the same bar, and widen rather than lose a skill that has nothing that short', () => {
  assert.ok(LONG_WORDS > SHORT_WORDS);
  // A course week (w05), because `translate` never draws from the Latin-only review shelf.
  const onlyLong = build([{ id: 'w05:1.2', la: `Rēgī librum dat.${PAD(30)}`, en: 'He gives the king a book.' }]);
  const t = onlyLong.generate({ skill: SKILL, kind: 'translate', stage: 3 });
  assert.notEqual(t?.kind, 'translate', '33 words is past LONG_WORDS too, so the slot falls back to another kind rather than asking for a paragraph');
  const mid = build([{ id: 'w05:1.3', la: `Rēgī librum dat.${PAD(8)}`, en: 'He gives the king a book.' }]);
  const it = mid.generate({ skill: SKILL, kind: 'translate', stage: 3 });
  assert.ok(it && it.kind === 'translate', '11 words: past the short bar, inside the long one, so the kind survives');
  assert.ok(wordsIn(it.prompt.la) <= LONG_WORDS);
});

/* ============================================ 3 · every box judged on its own */

const CHART_ITEM = {
  skill: 'a', kind: 'chart', input: 'chart', key: 'chart:soror:0.1.0', stage: 1, answer: ['sorōrī'],
  lemma: 'soror sorōris f', chart: { table: null, section: 0, col: 0, target: { row: 1, col: 0 }, full: true, head: 'soror',
    cells: [{ row: 0, col: 0, label: 'nominative singular', answer: ['soror'] }, { row: 1, col: 0, label: 'dative singular', answer: ['sorōrī'] }, { row: 2, col: 0, label: 'ablative singular', answer: ['sorōre'] }] },
  meanings: [], confuse: { values: {}, indexes: {}, forms: {} }, prompt: { la: null, question: 'Fill in the singular of soror', gloss: 'soror', hint: '' },
  feedback: { short: 'x', label: null, table: null },
};

test('a chart is judged cell by cell, and each cell can be judged on its own as the learner leaves it', () => {
  const cells = cellResults(CHART_ITEM, { 0: 'soror', 1: 'sorori', 2: 'wrong' });
  assert.deepEqual(cells.map((c) => c.ok), [true, true, false]);
  assert.deepEqual(cells.map((c) => c.i), [0, 1, 2]);
  assert.equal(cells[1].given, 'sorori', 'macrons stay optional');
  assert.equal(cells[2].expected, 'sorōre', 'and a red cell carries what it wanted');
  assert.ok(cells.every((c) => c.label), 'each result names its own box, for the live region and the feedback');
  // One box, judged alone — what the UI asks for on blur, tab and Enter.
  assert.equal(judgeCell(CHART_ITEM, 1, 'sorōrī').ok, true);
  assert.equal(judgeCell(CHART_ITEM, 1, 'sorōre').ok, false);
  assert.equal(judgeCell(CHART_ITEM, 2, 'sorōre').ok, true, 'a cell is judged against its own answer, not the item\'s');
  assert.equal(judgeCell(CHART_ITEM, 9, 'x'), null, 'a box the item does not have');
});

test('the whole chart is still one attempt, right only when every cell was', () => {
  const all = judge(CHART_ITEM, { 0: 'soror', 1: 'sorōrī', 2: 'sorōre' });
  assert.equal(all.correct, true);
  assert.equal(all.cells.length, 3, 'the per-cell results ride along for the feedback and for "redo what was wrong"');
  const one = judge(CHART_ITEM, { 0: 'soror', 1: 'sorōrī', 2: 'wrong' });
  assert.equal(one.correct, false, 'one red cell is a wrong chart');
  assert.deepEqual(one.cells.map((c) => c.ok), [true, true, false], 'and the two that were right are still known to be right');
  assert.equal(typeof one.expected, 'string', 'the prose recap is unchanged');
});

test('a twelve-cell chart writes exactly one row to the scheduler', async () => {
  const gstore = memStore();
  const items = { drillable: () => true, generate: () => CHART_ITEM };
  const p = createPractice({ plan: [{ skill: 'a', kind: 'chart', stage: 1, currentWeek: false }], gstore, items, skillsIndex: { skills: SKILLS }, size: 1, rand: () => 0.4 });
  p.start();
  const r = await p.runner.answer({ 0: 'soror', 1: 'sorōrī', 2: 'wrong' });
  assert.equal(r.correct, false);
  assert.equal(gstore.attempts.length, 1, 'one drill_attempts row for the chart, not one per cell');
  assert.equal(gstore.attempts[0].item_key, CHART_ITEM.key);
  assert.equal(r.cells.length, 3);
});

test('the pensum inputs are judged the same way, blank by blank', () => {
  const inline = { input: 'inline', exact: true, blanks: [{ stem: 'Itali', answers: ['ā'], note: 'after in' }, { stem: 'Rōm', answers: ['a'], note: '' }] };
  const cells = cellResults(inline, { 0: 'a', 1: 'a' });
  assert.equal(cells[0].ok, false, 'a macron-sensitive blank is not fooled by the short vowel');
  assert.equal(cells[0].macron, true, 'and it says the macron is the whole difference');
  assert.equal(cells[1].ok, true);
  assert.equal(judgeCell(inline, 0, 'ā').ok, true);
  const match = { input: 'match', pairs: [{ la: 'puer', en: 'boy' }, { la: 'rosa', en: 'rose' }], right: [{ text: 'rose', pair: 1 }, { text: 'boy', pair: 0 }] };
  assert.deepEqual(cellResults(match, { 0: 1, 1: 0 }).map((c) => c.ok), [true, true]);
  assert.deepEqual(cellResults(match, { 0: 0, 1: 1 }).map((c) => c.ok), [false, false]);
  assert.deepEqual(cellResults({ input: 'type', answer: ['x'] }, 'x'), [], 'a single-box item has no boxes to bind');
});

/* ======================================== 4 · the two defects in the same code */

test('the leak sweep reads a rendered paradigm, not only strings', () => {
  const table = { title: 'soror sorōris f', sections: [{ title: 'singular', headers: ['sg', 'pl'], rows: [
    { label: 'nominative', cells: [{ text: 'soror' }, { text: 'sorōrēs' }] },
    { label: 'dative', cells: [{ text: 'sorōrī' }, { text: 'sorōribus' }] },
    { label: 'genitive', cells: [{ stem: 'sorōr', ending: 'is' }, { text: '—', empty: true }] },
  ] }] };
  assert.deepEqual(paradigmLeak(table, ['sorōrī', 'sorori']), ['sorōrī', 'sorori'], 'the dative cell is the answer');
  assert.deepEqual(paradigmLeak(table, ['sorōris']), ['sorōris'], 'a cell printed as stem + ending is read as the word it prints');
  assert.deepEqual(paradigmLeak(table, ['puerō']), [], 'a table that gives nothing away passes');

  const masked = maskParadigm(table, ['sorōrī', 'sorori']);
  assert.deepEqual(paradigmLeak(masked, ['sorōrī', 'sorori']), [], 'and the masked table gives nothing away');
  assert.equal(masked.sections[0].rows[1].cells[0].text, '…', 'the answer cell prints an ellipsis');
  assert.equal(masked.sections[0].rows[1].cells[0].masked, true);
  assert.equal(masked.sections[0].rows[0].cells[0].text, 'soror', 'every other cell is untouched, so the shape still teaches');
  assert.equal(masked.sections[0].rows[2].cells[1].empty, true, 'an empty cell stays empty');
  assert.equal(table.sections[0].rows[1].cells[0].text, 'sorōrī', 'the table itself is not changed: the feedback still prints it in full');
  assert.equal(maskParadigm(table, ['puerō']), table, 'a table with nothing to hide is handed back as it is');
});

test('a blank item\'s own paradigm no longer prints the form the item is asking for', () => {
  const gen = build();
  let checked = 0;
  for (let i = 0; i < 8; i++) {
    const it = gen.generate({ skill: SKILL, kind: 'blank', stage: 2, chapter: 7, chapterMode: 'ceiling' });
    if (!it?.entry) continue;
    const answers = acceptedAnswers(it);
    const table = paradigm(it.entry, []);
    assert.ok(paradigmLeak(table, answers).length, 'the unmasked table really did spell the answer (§7.5)');
    assert.deepEqual(paradigmLeak(maskParadigm(table, answers), answers), [], 'and the one the disclosure renders does not');
    checked += 1;
  }
  assert.ok(checked, 'the sweep saw at least one blank item');
});

test('Tab runs cell to cell: a box\'s own hint control is out of the sequence, the labelled row keeps its place', () => {
  // ui.js is DOM, and these tests are pure, so the rule is read off the source that builds the control.
  // The live proof is the Playwright pass in qa/teach-core/.
  const control = UI.slice(UI.indexOf('const control = (id, {'), UI.indexOf('/** For order and match, whose boxes are buttons'));
  assert.match(control, /tabindex: label \? null : '-1'/, 'the inline "?" is out of the tab sequence; the labelled row form is not');
  assert.match(control, /aria-label.{0,3}: `Hint for/, 'and it is still a control a screen reader can find');
  // The key help says what Tab now does, and how a keyboard still reaches the hint.
  const keys = [...UI.matchAll(/class: 'g-keys', text: '([^']+)'/g)].map((m) => m[1]);
  const cellKeys = keys.filter((t) => /next (cell|ending)/.test(t));
  assert.equal(cellKeys.length, 2, 'the chart and Pensum A both state the model');
  for (const t of cellKeys) {
    assert.match(t, /marks/, 'Tab marks the box it leaves');
    assert.match(t, /Alt\+H/, 'and names the key that opens that box\'s hint');
  }
});

test('a cell is judged when it is left, and grading paints every box from the same truth', () => {
  // The wiring, read off the source for the same reason as above: §7.5 measured **zero** blur handlers
  // in the module, which is why nothing was ever bound to a box.
  assert.ok(/addEventListener\('blur'/.test(UI), 'a box is judged when the learner leaves it');
  assert.equal((UI.match(/addEventListener\('blur', \(\) => \{ if \(!inp\.disabled\)/g) ?? []).length, 2, 'the chart and Pensum A both do it');
  assert.match(UI, /const cells = cellResults\(item, v\);/, 'grading paints from the same per-cell truth the runner judges with');
  assert.match(UI, /aria-invalid/, 'and the colour is never the only signal');
});
