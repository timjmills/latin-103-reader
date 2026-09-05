// node --test tests/ — drill item generators (GRAMMAR-CONTRACT.md "Drill items")
// over a fixture unit set and a mocked lookup, plus answer matching and
// parse normalisation. The real paradigm builder is used (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import {
  createItems, scanUnit, normaliseAnswer, matchesForm, parseFeatures, matchParse, createPool, featureLabel, lemmaGloss,
} from '../app/js/grammar/items.js';
import { judge, confusedWith } from '../app/js/grammar/session.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const index = indexSkills(raw);

// A small glossary in the build's shape (forms → entries with parses).
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null });
const G = {
  ariadna: [N('Ariadna -ae f', 'ariadna', [1, 1], 'f', ['Ariadn', 'Ariadn'], [{ case: 'nom', number: 'sg', gender: 'f' }], ['Ariadne'])],
  theseo: [N('Thēseus -ī m', 'theseus', [2, 1], 'm', ['Thēse', 'Thēse'], [{ case: 'dat', number: 'sg', gender: 'm' }, { case: 'abl', number: 'sg', gender: 'm' }], ['Theseus'])],
  filum: [N('fīlum -ī n', 'filum', [2, 2], 'n', ['fīl', 'fīl'], [{ case: 'nom', number: 'sg', gender: 'n' }, { case: 'acc', number: 'sg', gender: 'n' }], ['thread, string'])],
  longum: [{ lemma: 'longus -a -um', h: 'longus', pos: 'ADJ', cat: [1, 1], roots: ['long', 'long'], parses: [{ case: 'acc', number: 'sg', gender: 'n' }], senses: ['long'], enc: null }],
  dedit: [V('dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat'], [{ tense: 'perf', voice: 'act', mood: 'ind', person: 3, number: 'sg' }], ['give'])],
  puellae: [N('puella -ae f', 'puella', [1, 1], 'f', ['puell', 'puell'], [{ case: 'gen', number: 'sg', gender: 'f' }, { case: 'dat', number: 'sg', gender: 'f' }, { case: 'nom', number: 'pl', gender: 'f' }], ['girl'])],
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [{ case: 'dat', number: 'sg', gender: 'm' }], ['boy'])],
  regi: [N('rēx, rēgis m', 'rex', [3, 1], 'm', ['rēx', 'rēg'], [{ case: 'dat', number: 'sg', gender: 'm' }], ['king'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [{ case: 'acc', number: 'sg', gender: 'm' }], ['book'])],
  dat: [V('dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat'], [{ tense: 'pres', voice: 'act', mood: 'ind', person: 3, number: 'sg' }], ['give'])],
  gladio: [N('gladius -ī m', 'gladius', [2, 1], 'm', ['gladi', 'gladi'], [{ case: 'dat', number: 'sg', gender: 'm' }, { case: 'abl', number: 'sg', gender: 'm' }], ['sword'])],
  mitteret: [V('mittō, mittere, mīsī, missum', 'mitto', [3, 1], ['mitt', 'mitt', 'mīs', 'miss'], [{ tense: 'impf', voice: 'act', mood: 'subj', person: 3, number: 'sg' }], ['send'])],
  misit: [V('mittō, mittere, mīsī, missum', 'mitto', [3, 1], ['mitt', 'mitt', 'mīs', 'miss'], [{ tense: 'perf', voice: 'act', mood: 'ind', person: 3, number: 'sg' }], ['send'])],
  ut: [{ lemma: 'ut', h: 'ut', pos: 'CONJ', roots: [], parses: [], senses: ['so that'], enc: null }],
  servum: [N('servus -ī m', 'servus', [2, 1], 'm', ['serv', 'serv'], [{ case: 'acc', number: 'sg', gender: 'm' }], ['slave'])],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });

const units = [
  { id: 'w01:63.10', la: 'Ariadna Thēseō fīlum longum dedit.' },
  { id: 'w07:1.1', la: 'Puellae puerō librum dat.' },
  { id: 'w07:1.2', la: 'Rēgī servum mīsit ut gladiō puellae mitteret.' },
];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('scanUnit: finds the forms whose parses satisfy the filter, marks ambiguous ones', () => {
  const dat = index.skills.get('dative-indirect-object');
  const c = scanUnit(units[0], dat, lookup);
  assert.deepEqual(c.map((x) => [x.token.text, x.ambiguous]), [['Thēseō', true]]);   // dat / abl
  const c2 = scanUnit(units[1], dat, lookup);
  assert.deepEqual(c2.map((x) => [x.token.text, x.ambiguous]), [['Puellae', true], ['puerō', false]]);
  const perf = scanUnit(units[0], index.skills.get('perfect-active'), lookup);
  assert.deepEqual(perf.map((x) => x.token.text), ['dedit']);
  const subj = scanUnit(units[2], index.skills.get('imperfect-subjunctive'), lookup);
  assert.deepEqual(subj.map((x) => [x.token.text, x.value]), [['mitteret', 'impf subj']]);
});

test('recognise: choice with the confusable distractor, target gloss, meanings for every word', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), rand: () => 0.4 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false });
  assert.ok(it, 'an item');
  assert.equal(it.kind, 'recognise'); assert.equal(it.input, 'choice');
  assert.ok(['puerō', 'Rēgī'].includes(it.target.text));
  assert.ok(it.choices.length >= 3 && it.choices.length <= 4);
  assert.equal(it.choices.filter((c) => c.correct).length, 1);
  assert.ok(it.choices.some((c) => c.value === 'abl' && c.skill === 'ablative-means'), 'the confusable ablative is a distractor');
  assert.ok(it.choices.some((c) => c.value === 'gen' && c.skill === 'genitive-possession'));
  assert.equal(it.answer[0], 'dat');
  assert.match(it.prompt.gloss, /— (boy|king)/);
  assert.ok(it.meanings.length >= 4 && it.meanings.every((m) => m.form && m.text));
  assert.equal(it.feedback.term, "the dative (the 'to/for' form)");
  assert.ok(it.feedback.table, 'the paradigm with the cell lit');
  assert.ok(it.key.startsWith('recognise:w07:'));
});

test('parse: typed at stage 2 with feature matching; choice at stage 1', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), rand: () => 0.1 });
  const it = items.generate({ skill: 'imperfect-subjunctive', kind: 'parse', stage: 2 });
  assert.equal(it.input, 'type');
  assert.equal(it.target.text, 'mitteret');
  assert.deepEqual(it.expect.required, ['tense', 'mood']);
  assert.ok(judge(it, 'imperfect subjunctive').correct);
  assert.ok(judge(it, 'impf. subj. 3rd sg').correct);
  assert.ok(!judge(it, 'imperfect indicative').correct);
  assert.ok(!judge(it, 'imperfect subjunctive plural').correct);   // contradicts the number
  const it1 = items.generate({ skill: 'dative-indirect-object', kind: 'parse', stage: 1 });
  assert.equal(it1.input, 'choice');
  assert.ok(it1.choices.some((c) => c.correct && /^dative singular$/.test(c.label)));
});

test('blank: the sentence with the word blanked; macron-optional typed answer; choices from the paradigm at stage 1', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), rand: () => 0.9 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'blank', stage: 2 });
  assert.equal(it.input, 'type');
  assert.ok(it.prompt.la.includes('___'));
  assert.ok(!it.prompt.la.includes(it.target.text));
  assert.ok(judge(it, it.target.text).correct);
  assert.ok(judge(it, normaliseAnswer(it.target.text)).correct, 'macrons optional');
  assert.ok(!judge(it, 'xyz').correct);
  const it1 = items.generate({ skill: 'dative-indirect-object', kind: 'blank', stage: 1 });
  assert.equal(it1.input, 'choice');
  assert.ok(it1.choices.length >= 2);
  assert.equal(it1.choices.filter((c) => c.correct).length, 1);
});

test('chart: a single cell from the skill\'s lemmas, a column when full; judged cell by cell', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), rand: () => 0.2 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'chart', stage: 1 });
  assert.equal(it.input, 'chart');
  assert.equal(it.chart.cells.length, 1);
  assert.match(it.chart.cells[0].label, /^dative (singular|plural)$/);
  assert.ok(judge(it, { 0: it.chart.cells[0].answer[0] }).correct);
  assert.ok(judge(it, { 0: normaliseAnswer(it.chart.cells[0].answer[0]) }).correct);
  const full = items.generate({ skill: 'dative-indirect-object', kind: 'chart', stage: 1, full: true });
  assert.ok(full.chart.cells.length >= 5, 'a column of the table');
  assert.ok(full.chart.full);
  const r = judge(full, {});
  assert.equal(r.correct, false); assert.equal(r.cells.length, full.chart.cells.length);
});

test('pool: no item key repeats until the pool is exhausted, then it starts over', () => {
  const storage = mem();
  const pool = createPool(storage);
  const keys = ['a', 'b', 'c'];
  const seen = new Set();
  for (let i = 0; i < 3; i++) seen.add(pool.choose('s', 'k', keys, Math.random));
  assert.equal(seen.size, 3);
  assert.ok(keys.includes(pool.choose('s', 'k', keys, Math.random)));   // fourth: the pool restarts
  const again = createPool(storage);   // persisted
  assert.equal(again.used('s', 'k').size, 1);
  again.reset('s');
  assert.equal(again.used('s', 'k').size, 0);
});

test('generator: distinct sentences across a run; falls back to another kind when a pool is empty', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem() });
  const seen = new Set();
  for (let i = 0; i < 2; i++) seen.add(items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false }).key);
  assert.equal(seen.size, 2);   // puerō and Rēgī before any repeat
  // genitive: puellae is ambiguous → no recognise candidates → falls back to blank
  const g = items.generate({ skill: 'genitive-of', kind: 'recognise', stage: 1 });
  assert.ok(g && g.kind === 'blank');
  assert.equal(items.generate({ skill: 'nope', kind: 'blank' }), null);
});

test('normaliseAnswer / matchesForm: macrons, case, v/u, j/i, punctuation', () => {
  assert.equal(normaliseAnswer('  Thēseō!'), 'theseo');
  assert.ok(matchesForm('theseo', ['Thēseō']));
  assert.ok(matchesForm('IVLIVS', ['Iūlius']));
  assert.ok(matchesForm('juvenis', ['iuuenis']));
  assert.ok(!matchesForm('', ['a']));
  assert.ok(!matchesForm('theseus', ['Thēseō']));
});

test('parseFeatures / matchParse: abbreviations, order, contradictions', () => {
  assert.deepEqual(parseFeatures('dat. sg.'), { case: 'dat', number: 'sg' });
  assert.deepEqual(parseFeatures('singular dative feminine'), { case: 'dat', number: 'sg', gender: 'f' });
  assert.deepEqual(parseFeatures('3rd person plural perfect indicative'), { person: '3', number: 'pl', tense: 'perf', mood: 'ind' });
  assert.deepEqual(parseFeatures('future perfect'), { tense: 'futperf' });
  assert.deepEqual(parseFeatures('dative genitive').case, ['dat', 'gen']);
  const e = { values: { case: 'dat', number: 'sg', gender: 'm' }, required: ['case', 'number'] };
  assert.ok(matchParse('dative singular', e));
  assert.ok(matchParse('dat sg masc', e));
  assert.ok(!matchParse('dative', e));            // number missing
  assert.ok(!matchParse('dative singular fem', e)); // contradicts the gender
  assert.ok(!matchParse('dative or genitive singular', e));
});

test('judge / confusedWith: a wrong choice names the skill its distractor came from', () => {
  const it = { input: 'choice', skill: 'dative-indirect-object', choices: [{ value: 'dat', correct: true, label: 'dative', skill: 'dative-indirect-object' }, { value: 'abl', correct: false, label: 'ablative', skill: 'ablative-means' }, { value: 'acc', correct: false, label: 'accusative', skill: null }] };
  const r = judge(it, 'abl');
  assert.equal(r.correct, false); assert.equal(r.expected, 'dative'); assert.equal(r.given, 'ablative');
  assert.equal(confusedWith(it, r), 'ablative-means');
  assert.equal(confusedWith(it, judge(it, 'acc')), null);
  assert.equal(judge(null, 'x').correct, false);
});

test('labels', () => {
  assert.equal(featureLabel('case', 'dat').full, "dative — the 'to/for' form");
  assert.equal(featureLabel('tm', 'impf subj').name, 'imperfect subjunctive');
  assert.equal(lemmaGloss(G.filum[0]), 'fīlum -ī n — thread, string');
});

test('recognise (tap): the word indexes the skill fits are accepted, judged by index', () => {
  const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), rand: () => 0.4 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: true });
  assert.equal(it.input, 'tap');
  assert.ok(it.accept.includes(it.target.index));
  assert.ok(judge(it, it.target.index).correct);
  assert.ok(!judge(it, it.target.index + 1).correct);
  assert.equal(judge(it, it.target.index + 1).expected, it.target.text);
  assert.ok(it.key.startsWith('recognise-tap:'));
  const plain = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false });
  assert.equal(plain.input, 'choice');
});
