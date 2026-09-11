// node --test tests/ — the learner controls what mixed practice mixes
// (2026-09-11, four messages from the app's only user):
//
//   1  every population can be turned on or off — the grammar skills, the
//      chapters' questions, their vocabulary, their pensa
//   2  anything can go in whether or not it has been studied
//   3  add all, or none, at the level the list is shown
//
// Each test below fails on the tree before the change: the population helpers
// and `removeFromPractice` did not exist, `buildSession` had no way to reach a
// skill outside the rotation, and the Practice setup had no control for any
// of it.
//
// No Latin from the book appears here. The two words and the one sentence
// below are invented for the test; everything structural is read from the
// shipped code at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POPULATIONS, POPULATION_LABEL, populationOf, normalisePopulations, filterPopulations, mixNote, mixTitle, setSkills, groupPensa } from '../app/js/grammar/sets.js';
import { buildSession, orderCandidates, addToPractice, removeFromPractice, newState, applyAnswer, inRotation, DAY_MS } from '../app/js/grammar/scheduler.js';
import { dueText } from '../app/js/grammar/ui.js';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const UI = src('app/js/grammar/ui.js');
const CSS = src('app/css/grammar.css');

const NOW = Date.parse('2026-09-11T12:00:00Z');
const grammarSkill = (id) => ({ id, set: null, title: id, plain: id, category: 'noun-case', kinds: ['recognise', 'chart', 'parse', 'blank'], parse_filter: { case: 'nom' }, confusable_with: [], prereqs: [] });
/** The three chapter-set shapes exactly as `setSkills` builds them, from invented material. */
const SETS = setSkills({
  questions: new Map([[1, { items: [{ q: 'Ubi?' }, { q: 'Quis?' }], title: 'Fābula prīma', week_id: null }]]),
  vocab: new Map([[1, { words: [{ la: 'gluvia', en: 'a lantern' }, { la: 'marnex', en: 'a ferryman' }] }]]),
  pensa: groupPensa([
    { chapter: 1, kind: 'A', items: [{ text: 'Gluvi_ clāra est.', blanks: [{ stem: 'gluvi', answers: ['a'] }] }] },
    { chapter: 1, kind: 'B', items: [{ text: 'Marnex _ portat.', blanks: [{ answers: ['gluviam'] }] }] },
    { chapter: 1, kind: 'C', items: [{ q: 'Quis gluviam portat?', answers: ['marnex'] }] },
  ]),
  weeks: [],
});
const SKILLS = new Map([
  ...['g1', 'g2', 'g3', 'g4'].map((id) => [id, grammarSkill(id)]),
  ...SETS,
]);
const stateMap = (ids, patch = {}) => new Map(ids.map((id) => [id, { ...addToPractice(newState(id, NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString(), stability_days: 2, ...patch }]));
const popsOf = (plan) => [...new Set(plan.map((s) => populationOf(SKILLS.get(s.skill))))].sort();

/* ------------------------------------------------- 1 · the populations */

test('the four populations are the app\'s own, and every shipped skill shape lands in exactly one', () => {
  assert.deepEqual([...POPULATIONS], ['skills', 'questions', 'vocab', 'pensum']);
  assert.equal(populationOf(grammarSkill('g1')), 'skills');
  assert.equal(populationOf(SETS.get('questions-01')), 'questions');
  assert.equal(populationOf(SETS.get('vocab-01')), 'vocab');
  assert.equal(populationOf(SETS.get('vocab-01-rev')), 'vocab', 'the English → Latin deck is vocabulary, not a fifth population');
  assert.equal(populationOf(SETS.get('pensum-01')), 'pensum');
  // The names on screen are the map's own words for the same rows, not invented ones.
  assert.deepEqual(POPULATIONS.map((p) => POPULATION_LABEL[p]), ['Skills', 'Questions', 'Vocabulary', 'Pensa']);
  for (const label of ['Questions', 'Vocabulary', 'Pensa']) assert.ok(UI.includes(`'${label}'`), `${label} is the row label the map already uses`);
});

test('the choice is cleaned, ordered and honest about "none": null is everything, [] is nothing, and a population the library lacks is never offered', () => {
  assert.deepEqual(normalisePopulations(null), ['skills', 'questions', 'vocab', 'pensum']);
  assert.deepEqual(normalisePopulations(undefined), ['skills', 'questions', 'vocab', 'pensum']);
  assert.deepEqual(normalisePopulations([]), [], 'an empty choice is a real choice and survives');
  assert.deepEqual(normalisePopulations(['pensum', 'skills']), ['skills', 'pensum'], 'canonical order, whatever order it was stored in');
  assert.deepEqual(normalisePopulations(['skills', 'nonsense']), ['skills']);
  assert.deepEqual(normalisePopulations(null, ['skills', 'vocab']), ['skills', 'vocab'], 'only what this library holds');
  assert.deepEqual(normalisePopulations(['skills', 'pensum'], ['skills', 'vocab']), ['skills']);
  // The object form a settings blob could arrive in.
  assert.deepEqual(normalisePopulations({ skills: true, vocab: false, pensum: true }), ['skills', 'pensum']);
});

test('turning a population off takes it out of the map the session is built from, and out of the plan', () => {
  const ids = [...SKILLS.keys()];
  const states = stateMap(ids);
  const whole = buildSession({ states, skills: SKILLS, size: 20, now: NOW, seed: 7 });
  assert.deepEqual(popsOf(whole), ['pensum', 'questions', 'skills', 'vocab'], 'everything on: all four turn up');

  const noSkills = filterPopulations(SKILLS, ['questions', 'vocab', 'pensum']);
  assert.equal([...noSkills.keys()].some((id) => populationOf(SKILLS.get(id)) === 'skills'), false);
  const without = buildSession({ states, skills: noSkills, size: 20, now: NOW, seed: 7 });
  assert.ok(without.length, 'a mix of three populations still builds');
  assert.equal(popsOf(without).includes('skills'), false, 'no grammar skill reaches a plan that excludes them');

  const onlyVocab = buildSession({ states, skills: filterPopulations(SKILLS, ['vocab']), size: 10, now: NOW, seed: 7 });
  assert.deepEqual(popsOf(onlyVocab), ['vocab'], 'mixing can be turned off entirely: one kind and nothing else');
});

test('the header says what is really in the set, and says nothing extra when the set is everything', () => {
  assert.equal(mixTitle(POPULATIONS), '', 'a whole mix needs no qualifier');
  assert.equal(mixTitle(['vocab', 'pensum']), 'Vocabulary + Pensa only');
  assert.equal(mixTitle(['skills'], ['skills']), '', 'the only population there is is not a narrowing');
  assert.match(mixNote(POPULATIONS), /^Everything: the grammar skills, the chapters' questions, the vocabulary decks and the pensa\.$/);
  assert.equal(mixNote(['vocab', 'pensum']), "Only the vocabulary decks and the pensa — the grammar skills and the chapters' questions left out.");
  assert.match(mixNote([]), /Nothing is in the mix/);
  // One sentence, one full stop in the middle of nothing: the note is read aloud by the live region too.
  assert.equal(mixNote(['vocab']).includes('. the'), false, 'no sentence starts lower-case');
});

/* ----------------------------------- 2 · anything, studied or not */

test('a skill never opened cannot reach a mixed session by default, and does once the learner asks for it', () => {
  const studied = ['g1', 'g2'];
  const states = stateMap(studied);
  const shut = buildSession({ states, skills: SKILLS, size: 20, now: NOW, seed: 3 });
  assert.deepEqual([...new Set(shut.map((s) => s.skill))].sort(), ['g1', 'g2'], 'the old rule: only what is in the rotation');

  const open = buildSession({ states, skills: SKILLS, size: 20, now: NOW, seed: 3, unstudied: true });
  const reached = new Set(open.map((s) => s.skill));
  assert.ok(reached.has('g3') || reached.has('g4'), 'a grammar skill with no history at all comes up');
  assert.ok([...reached].some((id) => SKILLS.get(id)?.set), 'so does a chapter set that was never opened');
});

test('material with no history sorts after everything in the rotation, and a run of Learn is left alone', () => {
  const states = new Map([
    ['g1', { ...addToPractice(newState('g1', NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString(), stability_days: 4 }],
    ['g2', { ...newState('g2', NOW), state: 'learning' }],
    ['g3', { ...newState('g3', NOW), state: 'lapsed', due_at: new Date(NOW - 30 * DAY_MS).toISOString(), stability_days: 1 }],
  ]);
  const ordered = orderCandidates({ states, skills: SKILLS, preset: 'review-heavy', now: NOW, unstudied: true });
  assert.equal(ordered[0].skill, 'g1', 'the overdue row still leads');
  const ids = ordered.map((s) => s.skill);
  assert.ok(ids.indexOf('g4') > ids.indexOf('g1'), 'untouched material comes after what is due');
  assert.equal(ids.includes('g2'), false, 'a skill part-way through Learn keeps its run and is not swept in');
  assert.equal(ids.includes('g3'), false, 'a lapsed skill is asked for by name through Re-learn, not dragged into a mix');
  for (const row of ordered.filter((s) => s.skill !== 'g1')) assert.equal(row.state, 'new');
});

test('answering an untouched item is what puts it into practice — nothing is written before the learner answers', () => {
  const fresh = newState('g4', NOW);
  assert.equal(inRotation(fresh), false);
  const after = applyAnswer(fresh, { correct: true, now: NOW });
  assert.equal(after.state, 'practising');
  assert.equal(inRotation(after), true);
});

/* --------------------------------------------- 3 · add all, or none */

test('"None" is the exact undo of "Add all": the row leaves the rotation and keeps every bit of its history', () => {
  let row = addToPractice(newState('g1', NOW), NOW);
  row = applyAnswer(row, { correct: true, now: NOW });
  row = applyAnswer(row, { correct: false, now: NOW + 1000 });
  const before = { ...row };
  const out = removeFromPractice(row, NOW + 2000);
  assert.equal(inRotation(out), false, 'it stops coming round');
  assert.equal(out.state, 'new');
  for (const k of ['stage', 'stability_days', 'due_at', 'last_at', 'streak', 'successes', 'successes_spaced', 'failures']) {
    assert.equal(out[k], before[k], `${k} is kept — nothing is deleted here`);
  }
  const back = addToPractice(out, NOW + 3000);
  assert.equal(back.state, 'practising');
  assert.equal(back.stability_days, before.stability_days, 'adding it back picks up the spacing it had');
  assert.equal(back.stage, before.stage);
});

test('taking out something that is not in the rotation changes nothing — a Learn run is not thrown away by a bulk "None"', () => {
  const learning = { ...newState('g2', NOW), state: 'learning', streak: 3 };
  assert.deepEqual(removeFromPractice(learning, NOW + 1000), learning);
  const virgin = newState('g4', NOW);
  assert.deepEqual(removeFromPractice(virgin, NOW + 1000), virgin);
});

test('a row taken out of the mix does not claim to be untouched', () => {
  const virgin = newState('g4', NOW);
  assert.equal(dueText(virgin, NOW), 'not started');
  let row = applyAnswer(addToPractice(newState('g1', NOW), NOW), { correct: true, now: NOW });
  row = applyAnswer(row, { correct: false, now: NOW + 1000 });
  const out = removeFromPractice(row, NOW + 2000);
  assert.equal(dueText(out, NOW + 2000), 'out of the mix · 2 answers kept');
  assert.equal(dueText(removeFromPractice(applyAnswer(addToPractice(newState('g1', NOW), NOW), { correct: true, now: NOW }), NOW + 1), NOW + 1), 'out of the mix · 1 answer kept');
});

/* ------------------------------------------- the controls themselves */

test('the Practice setup carries the chooser, in the section\'s own control vocabulary', () => {
  const setup = UI.slice(UI.indexOf('function renderSetup'), UI.indexOf('function renderPracticeStart'));
  assert.ok(setup.includes("text: 'What goes in'"), 'the row is labelled');
  assert.ok(/class: 'g-filter'[^\n]*aria-label': 'What goes in the mix'/.test(setup), 'the population toggles reuse the map\'s filter pattern, not a new one');
  assert.ok(setup.includes("'g-filter__btn'"), 'and its button class');
  assert.ok(/g-seg g-seg--allnone/.test(setup) && setup.includes("btn('All'") && setup.includes("btn('None'"), 'All / None is one segmented control');
  assert.ok(setup.includes("class: 'switch g-all-switch'") && setup.includes('Include what you have not studied'), 'the switch is the section\'s own switch');
  assert.equal(setup.includes('Nothing is in mixed practice yet. Learn a skill, or add one straight to practice from the skill map.'), false, 'the Practice tab is no longer a dead end on a fresh device');
  // The choice rides in the settings blob beside the rest, and is written the moment it changes.
  assert.ok(setup.includes('ctx.savePrefs({ populations: pops, unstudied'), 'saved the way every other practice setting is');
  assert.ok(src('app/js/grammar/index.js').includes('populations') && src('app/js/grammar/index.js').includes('unstudied'), 'and read back by prefs()');
});

test('the map and each chapter carry the same add-all / none pair, and the session header repeats the mix', () => {
  assert.ok(UI.includes("btn('Add all', { onclick: () => bulkAdd(inFilter, filterName)"), 'the map\'s pair is scoped to the category filter on screen');
  assert.ok(UI.includes('function chapterAllNone'), 'a chapter has the same pair');
  assert.ok(UI.includes('bulkNone'), 'and "none" is a real action, not a label');
  assert.ok(UI.includes('mixTitle(pops, offered)') && UI.includes('mixNote(pops, offered)'), 'the running session names the mix in its title and its note');
  assert.ok(CSS.includes('.g-seg--allnone'), 'the pair has its own rule and does not hard-code anything');
  assert.equal(/\.g-mix[^{]*\{[^}]*#[0-9a-fA-F]{3}/.test(CSS), false, 'no hard-coded colour in the new rules');
});
