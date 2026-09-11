// node --test tests/ — drill item generators (GRAMMAR-CONTRACT.md "Drill items")
// over a fixture unit set and a mocked lookup, plus answer matching and
// parse normalisation. The real paradigm builder and the real skill map are
// used. Covers the G1 fixes: every skill drills its own feature (C1 / M3 —
// construction skills ask the function, choices are the confusables), the
// Whitaker trims (M9), the pool tiers and honest exhaustion (M2), parse
// prompts that name what they grade (M4), non-finite chart cells (M6),
// degree in chart labels (G1-03), confusions from every input way (P7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import {
  createItems, scanUnit, normaliseAnswer, matchesForm, parseFeatures, matchParse, matchFunction, createPool, featureLabel, featureKey, featureValue, valueFits, entryAllowed, lemmaGloss,
  compilePatterns, patternSpans, cellsFor, stemOf,
} from '../app/js/grammar/items.js';
import { judge, confusedWith } from '../app/js/grammar/session.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const index = indexSkills(raw);
const S = index.skills;

// A small glossary in the build's shape (forms → entries with parses).
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses, kind = null) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind });
const ADJ = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'ADJ', cat, roots, parses, senses, enc: null });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const fin = (tense, mood, person, number, voice = 'act') => ({ tense, voice, mood, person, number });
const PUELLA = ['puella -ae f', 'puella', [1, 1], 'f', ['puell', 'puell']];
const SERVUS = ['servus -ī m', 'servus', [2, 1], 'm', ['serv', 'serv']];
const MITTO = ['mittō, mittere, mīsī, missum', 'mitto', [3, 1], ['mitt', 'mitt', 'mīs', 'miss']];
const DO = ['dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat']];
const G = {
  ariadna: [N('Ariadna -ae f', 'ariadna', [1, 1], 'f', ['Ariadn', 'Ariadn'], [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f'), nk('abl', 'sg', 'f')], ['Ariadne'])],
  theseo: [N('Thēseus -ī m', 'theseus', [2, 1], 'm', ['Thēse', 'Thēse'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['Theseus'])],
  filum: [N('fīlum -ī n', 'filum', [2, 2], 'n', ['fīl', 'fīl'], [nk('nom', 'sg', 'n'), nk('acc', 'sg', 'n'), nk('voc', 'sg', 'n')], ['thread, string'])],
  longum: [ADJ('longus -a -um', 'longus', [1, 1], ['long', 'long', 'longi', 'longissi'], [nk('acc', 'sg', 'n'), nk('nom', 'sg', 'n'), nk('acc', 'sg', 'm')], ['long'])],
  longissimum: [ADJ('longus -a -um', 'longus', [1, 1], ['long', 'long', 'longi', 'longissi'], [{ ...nk('acc', 'sg', 'm'), degree: 'super' }, { ...nk('nom', 'sg', 'n'), degree: 'super' }], ['long'])],
  dedit: [V(...DO, [fin('perf', 'ind', 3, 'sg')], ['give'])],
  dat: [V(...DO, [fin('pres', 'ind', 3, 'sg')], ['give'])],
  puellae: [N(...PUELLA, [nk('gen', 'sg', 'f'), nk('dat', 'sg', 'f'), nk('nom', 'pl', 'f'), nk('voc', 'pl', 'f')], ['girl'])],
  puella: [N(...PUELLA, [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f'), nk('abl', 'sg', 'f')], ['girl'])],
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],   // Whitaker would add abl; kept to one reading so the fixture has an unambiguous dative
  regi: [N('rēx, rēgis m', 'rex', [3, 1], 'm', ['rēx', 'rēg'], [nk('dat', 'sg', 'm')], ['king'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  gladio: [N('gladius -ī m', 'gladius', [2, 1], 'm', ['gladi', 'gladi'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['sword'])],
  villa: [N('vīlla -ae f', 'villa', [1, 1], 'f', ['vīll', 'vīll'], [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f'), nk('abl', 'sg', 'f')], ['villa'])],
  servo: [N(...SERVUS, [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['slave'])],
  servum: [N(...SERVUS, [nk('acc', 'sg', 'm')], ['slave'])],
  serve: [N(...SERVUS, [nk('voc', 'sg', 'm')], ['slave'])],
  marce: [N('Mārcus -ī m', 'marcus', [2, 1], 'm', ['Mārc', 'Mārc'], [nk('voc', 'sg', 'm')], ['Marcus'])],
  tarde: [ADJ('tardus -a -um', 'tardus', [1, 1], ['tard', 'tard', 'tardi', 'tardissi'], [nk('voc', 'sg', 'm')], ['slow']), { lemma: 'tardē', h: 'tarde', pos: 'ADV', cat: [1, 0], roots: ['tardē'], parses: [{}], senses: ['slowly'], enc: null }],
  mitteret: [V(...MITTO, [fin('impf', 'subj', 3, 'sg')], ['send'])],
  mittere: [V(...MITTO, [{ tense: 'pres', voice: 'act', mood: 'inf' }], ['send'])],
  misit: [V(...MITTO, [fin('perf', 'ind', 3, 'sg')], ['send'])],
  mittit: [V(...MITTO, [fin('pres', 'ind', 3, 'sg')], ['send'])],
  veni: [V('veniō, venīre, vēnī, ventum', 'venio', [3, 4], ['veni', 'ven', 'vēn', 'vent'], [{ tense: 'pres', voice: 'act', mood: 'imper', number: 'sg' }, fin('perf', 'ind', 1, 'sg')], ['come'])],
  venit: [V('veniō, venīre, vēnī, ventum', 'venio', [3, 4], ['veni', 'ven', 'vēn', 'vent'], [fin('pres', 'ind', 3, 'sg'), fin('perf', 'ind', 3, 'sg')], ['come'])],
  missus: [{ lemma: 'mittō, mittere, mīsī, missum', h: 'mitto', pos: 'VPAR', cat: [3, 1], roots: ['mitt', 'mitt', 'mīs', 'miss'], parses: [{ tense: 'perf', voice: 'pass', mood: 'ptc', case: 'nom', number: 'sg', gender: 'm' }], senses: ['send'], enc: null }],
  ut: [{ lemma: 'ut', h: 'ut', pos: 'CONJ', roots: [], parses: [{}], senses: ['so that'], enc: null }],
  in: [{ lemma: 'in', h: 'in', pos: 'PREP', roots: [], parses: [{ governs: 'abl' }, { governs: 'acc' }], senses: ['in'], enc: null, kind: 'abl' }],
  est: [V('sum, esse, fuī, futūrum', 'sum', [5, 1], ['s', 'es', 'fu', 'fut'], [fin('pres', 'ind', 3, 'sg')], ['be'])],
  vult: [V('volō, velle, voluī', 'volo', [6, 2], ['vol', 'vel', 'volu', '-'], [fin('pres', 'ind', 3, 'sg')], ['want'])],
  volarem: [V('volō, velle, voluī', 'volo', [6, 2], ['vol', 'vel', 'volu', '-'], [fin('impf', 'subj', 1, 'sg')], ['want'])],   // Whitaker's misparse: velle has no -ārem (G1-04)
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const plainTable = (() => { const m = new Map(); return (e) => { if (!m.has(e.lemma)) m.set(e.lemma, paradigm(e, [])); return m.get(e.lemma); }; })();

const units = [
  { id: 'w01:63.10', la: 'Ariadna servō librum longum dedit.' },
  { id: 'w07:1.1', la: 'Puellae puerō librum dat.' },
  { id: 'w07:1.2', la: 'Rēgī servum mīsit ut gladiō puellae mitteret.' },
  { id: 'w07:2.1', la: 'Puella in vīllā est.' },
  { id: 'w07:2.2', la: 'Venī, Mārce, et tardē mittere vult.' },
  { id: 'w07:2.3', la: 'Servō librum dat.' },
  { id: 'r07:3.1', la: 'Servus puellae librum dat.' },
  { id: 'w12:9.1', la: 'Servus missus est ut librum longissimum mitteret; venit.' },
];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const mk = (opts = {}) => createItems({ units, lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4, ...opts });
const dat = S.get('dative-indirect-object');
const pats = (id) => compilePatterns(S.get(id).patterns);

test('every skill carries an explicit feature (skills.json) and featureKey reads it; a bare filter is inferred', () => {
  for (const s of S.values()) assert.ok(s.feature === null || ['case', 'gender', 'number', 'tense', 'mood', 'voice', 'person', 'degree', 'construction', 'form'].includes(s.feature), s.id);
  assert.equal(featureKey(dat), 'construction');
  assert.equal(featureKey(S.get('nominative-subject')), 'case');
  assert.equal(featureKey(S.get('elegiac-couplet')), null);
  assert.equal(featureKey({ case: 'dat' }), 'case');
  assert.equal(featureKey({ pos: 'N' }), 'gender');
  for (const s of S.values()) if (s.feature === 'construction') assert.ok(s.function, `${s.id} names its function`);
});

test('valueFits: a filter that names no value for the feature fits nothing (C1); valueFits per feature', () => {
  assert.equal(valueFits('nom', { pos: 'N' }, 'case'), false);
  assert.equal(valueFits('dat', { case: 'dat' }, 'case'), true);
  assert.equal(valueFits('m', { pos: 'ADJ' }, 'gender'), false);
  assert.equal(valueFits('dep', { deponent: true, mood: 'ind' }, 'voice'), true);
  assert.equal(valueFits('pass', { deponent: true, mood: 'ind' }, 'voice'), false);
  assert.equal(valueFits('3 sg', { person: 3, tense: 'pres' }, 'person'), true);
  assert.equal(valueFits('pres ind', { pos: 'V' }, 'tense'), false);
  assert.equal(valueFits('gerund', { mood: 'gerund' }, 'mood'), true);
});

test('featureValue / stemOf / featureLabel over the features', () => {
  assert.equal(featureValue({ case: 'dat', number: 'sg', gender: 'm' }, 'person'), null);
  assert.equal(featureValue({ tense: 'pres', mood: 'ind', person: 3, number: 'sg', voice: 'act' }, 'person'), '3 sg');
  assert.equal(featureValue({ tense: 'pres', mood: 'ind', voice: 'pass' }, 'voice', { kind: 'dep' }), 'dep');
  assert.equal(featureValue({ mood: 'imper', voice: 'act', number: 'sg' }, 'mood'), 'pres imper');
  assert.equal(featureValue({}, 'degree', { pos: 'ADV' }), 'pos');
  assert.equal(stemOf({ tense: 'perf', mood: 'ind', voice: 'act' }), 'stem2');
  assert.equal(stemOf({ tense: 'perf', mood: 'ptc', voice: 'pass' }), 'stem3');
  assert.equal(featureLabel('case', 'dat').full, "dative — the 'to/for' form");
  assert.equal(featureLabel('tense', 'impf subj').name, 'imperfect subjunctive');
  assert.equal(featureLabel('person', '1 pl').name, '1st person plural');
  assert.equal(featureLabel('construction', 'purpose-clause', { skills: S }).name, 'purpose');
  assert.equal(featureLabel('construction', 'purpose-clause', { skills: S }).plain, 'in order to');
  assert.equal(featureLabel(null, null, { skill: dat }).name, dat.title);
  assert.equal(lemmaGloss(G.filum[0]), 'fīlum -ī n — thread, string');
});

test('patterns: (?i) becomes a flag; spans are macron-stripped offsets; a token must sit in a match', () => {
  const re = pats('dative-indirect-object');
  assert.ok(re.length >= 2 && re.every((r) => r instanceof RegExp && r.flags.includes('i')));
  const spans = patternSpans('Puellae puerō librum dat.', re);
  assert.ok(spans.some(([s, e]) => s <= 8 && e >= 13), 'puerō (before dat) is inside a match');
  const c = scanUnit(units[1], dat, lookup, { patterns: re });
  assert.deepEqual(c.map((x) => x.token.text), ['Puellae', 'puerō']);
  // no giving verb → no dative candidate for the construction, whatever the ending
  assert.deepEqual(scanUnit({ id: 'x', la: 'Puella in vīllā est.' }, dat, lookup, { patterns: re }), []);
});

test('scanUnit: finds the forms whose parses satisfy the filter, marks ambiguous ones by their case', () => {
  const c = scanUnit(units[0], dat, lookup, { paradigm: plainTable });
  assert.deepEqual(c.map((x) => [x.token.text, x.ambiguous, x.value, x.ambKey]), [['servō', true, 'dative-indirect-object', 'case']]);   // dat / abl
  const c2 = scanUnit(units[1], dat, lookup, { paradigm: plainTable });
  assert.deepEqual(c2.map((x) => [x.token.text, x.ambiguous]), [['Puellae', true], ['puerō', false]]);
  const perf = scanUnit(units[0], S.get('perfect-active'), lookup, { paradigm: plainTable });
  assert.deepEqual(perf.map((x) => [x.token.text, x.value]), [['dedit', 'perf ind']]);
  const subj = scanUnit(units[2], S.get('imperfect-subjunctive'), lookup, { paradigm: plainTable });
  assert.deepEqual(subj.map((x) => [x.token.text, x.value]), [['mitteret', 'impf subj']]);
});

test('Whitaker trims (M9): a preposition fixes the case; macrons pick the reading; vocative needs a cue; adverbs never fill a case; a reading the paradigm cannot produce is dropped', () => {
  const nom = S.get('nominative-subject');
  // "Puella in vīllā est": puella (nom / voc / abl in Whitaker) → nominative only: no vocative cue, and the final -a is short
  const c = scanUnit(units[3], nom, lookup, { paradigm: plainTable, patterns: pats('nominative-subject') });
  assert.deepEqual(c.map((x) => [x.token.text, x.value, x.ambiguous]), [['Puella', 'nom', false]]);
  // "in vīllā": the preposition governs the ablative, so vīllā is not a nominative candidate
  assert.ok(!c.some((x) => x.token.text === 'vīllā'));
  const abl = scanUnit(units[3], S.get('ablative-place'), lookup, { paradigm: plainTable, patterns: pats('ablative-place') });
  assert.deepEqual(abl.map((x) => [x.token.text, x.ambiguous]), [['vīllā', false]]);
  // vocative: Mārce after a comma in an imperative sentence counts; puella in a plain statement does not
  const voc = S.get('vocative');
  assert.deepEqual(scanUnit(units[4], voc, lookup, { paradigm: plainTable }).map((x) => x.token.text), ['Mārce']);
  assert.deepEqual(scanUnit(units[3], voc, lookup, { paradigm: plainTable }), []);
  // tardē: an adverb, whatever the adjective entry claims (voc sg of tardus)
  assert.equal(entryAllowed(G.tarde[1], { case: 'voc' }), false);
  assert.ok(!scanUnit(units[4], voc, lookup, {}).some((x) => x.token.text === 'tardē'));
  // volārem: velle's paradigm has no such cell → the reading is dropped, the word is not glossed as "want" (G1-04)
  assert.deepEqual(scanUnit({ id: 'x', la: 'Volārem ut venīret.' }, S.get('imperfect-subjunctive'), lookup, { paradigm: plainTable }), []);
  // venit: present or perfect in Whitaker; the macron-less form is the present, vēnit the perfect
  assert.deepEqual(scanUnit({ id: 'y', la: 'Iūlius venit.' }, S.get('perfect-active'), lookup, { paradigm: plainTable }), []);
  assert.deepEqual(scanUnit({ id: 'y', la: 'Iūlius venit.' }, S.get('present-indicative-3rd'), lookup, { paradigm: plainTable }).map((x) => [x.token.text, x.ambiguous]), [['venit', false]]);
  // an unmacronised sentence gives no such cue: both readings stay
  assert.equal(scanUnit({ id: 'y', la: 'Servus venit.' }, S.get('perfect-active'), lookup, { paradigm: plainTable })[0]?.ambiguous, true);
  assert.ok(cellsFor(plainTable(G.mitteret[0]), G.mitteret[0].parses[0]).length === 1);
});

test('construction recognise (dative-indirect-object): asks the function, the choices are the dative\'s other jobs, the confusion map covers every input way', () => {
  const items = mk({ rand: () => 0.1 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false });
  assert.ok(it, 'an item');
  assert.equal(it.kind, 'recognise'); assert.equal(it.input, 'choice');
  assert.match(it.prompt.question, /^What is this dative \(\S+\) doing here\?$/);
  assert.ok(it.choices.length >= 2 && it.choices.length <= 4);
  assert.equal(it.choices.filter((c) => c.correct).length, 1);
  assert.equal(it.choices.find((c) => c.correct).label, 'indirect object');
  assert.ok(it.choices.every((c) => S.get(c.value)?.feature === 'construction'), 'every choice names a construction');
  assert.ok(it.choices.every((c) => c.correct || S.get(c.value).parse_filter.case === 'dat'), 'the distractors are dative functions');
  assert.ok(it.choices.some((c) => ['dative-possession', 'dative-verbs', 'dative-of-agent'].includes(c.skill)), 'a confusable dative function is offered');
  assert.equal(it.answer[0], 'dative-indirect-object');
  assert.match(it.prompt.gloss, /— (boy|king|slave|girl)/);
  assert.equal(it.feedback.term, "the dative (the 'to/for' form)");
  assert.match(it.feedback.short, /is dative, indirect object — the receiver — from/);
  assert.ok(it.confuse.values['ablative-means'] === 'ablative-means' && it.confuse.values['dative-possession'] === 'dative-possession');
  const wrong = judge(it, it.choices.find((c) => !c.correct).value);
  assert.equal(wrong.correct, false);
  assert.equal(confusedWith(it, wrong), it.choices.find((c) => !c.correct).skill);
});

test('construction parse: choice at stage 1 names case and function; typed at stage 2 accepts the function words and logs the confusable named instead', () => {
  const items = mk({ rand: () => 0.1 });
  const it1 = items.generate({ skill: 'dative-indirect-object', kind: 'parse', stage: 1 });
  assert.equal(it1.input, 'choice');
  assert.match(it1.prompt.question, /which case, and what is it doing here\?/);
  assert.ok(it1.choices.find((c) => c.correct).label.startsWith('dative — indirect object'));
  const it2 = items.generate({ skill: 'dative-indirect-object', kind: 'parse', stage: 2 });
  assert.equal(it2.input, 'type');
  assert.equal(it2.expect.kind, 'function');
  assert.match(it2.prompt.question, /what is it doing here\? \(its function\)$/);
  assert.ok(judge(it2, 'indirect object').correct);
  assert.ok(judge(it2, 'the receiver, indirect object of dat').correct);
  const r = judge(it2, 'dative of possession');
  assert.equal(r.correct, false);
  assert.equal(confusedWith(it2, r), 'dative-possession');
  assert.equal(judge(it2, 'means').correct, false);
  assert.deepEqual(matchFunction('purpose clause', { accept: ['purpose'], reject: { result: 'result-clause' } }), { correct: true, confused: null });
  assert.deepEqual(matchFunction('a result clause', { accept: ['purpose'], reject: { result: 'result-clause' } }), { correct: false, confused: 'result-clause' });
  assert.equal(matchFunction('indirect object', { accept: ['direct object'], reject: {} }).correct, false, 'word boundaries: "indirect object" is not "direct object"');
});

test('a syntax skill (purpose-clause) asks what kind of clause the subjunctive is in; the confusables are the choices', () => {
  const items = mk({ rand: () => 0.2 });
  const it = items.generate({ skill: 'purpose-clause', kind: 'recognise', stage: 1, tap: false });
  assert.ok(it, 'a purpose item from "ut … mitteret"');
  assert.equal(it.target.text, 'mitteret');
  assert.match(it.prompt.question, /^mitteret is subjunctive: what kind of clause is it in\?$/);
  const ids = it.choices.map((c) => c.value);
  assert.ok(ids.includes('purpose-clause'));
  assert.ok(ids.includes('result-clause') || ids.includes('indirect-command'), 'the ut-clause confusables are offered');
  assert.ok(it.choices.every((c) => S.get(c.value).feature === 'construction' && !S.get(c.value).parse_filter.case), 'clause constructions only');
  assert.ok(it.feedback.short.includes('purpose — in order to'));
});

test('a form skill asks its own feature: tense and mood with the confusable tense as a distractor; gender for noun-gender; ≥ 2 choices or no item', () => {
  const items = mk({ rand: () => 0.1 });
  const it = items.generate({ skill: 'imperfect-subjunctive', kind: 'recognise', stage: 1, tap: false });
  assert.match(it.prompt.question, /^Which tense and mood is mitteret here\?$/);
  assert.ok(it.choices.some((c) => c.value === 'pres subj' && c.skill === 'present-subjunctive'), 'the confusable present subjunctive');
  assert.ok(it.choices.every((c) => !['gerund', 'supine', 'gerundive'].includes(c.value)), 'no mood-only fillers against a finite verb');
  const g = items.generate({ skill: 'noun-gender', kind: 'recognise', stage: 1, tap: false });
  assert.match(g.prompt.question, /^Which gender is \S+\?$/);
  assert.deepEqual([...new Set(g.choices.map((c) => c.value))].sort(), ['f', 'm', 'n'].filter((v) => g.choices.some((c) => c.value === v)));
  assert.ok(g.choices.length >= 2);
  // a skill with no candidates in the library: nothing, honestly (M8)
  assert.equal(items.drillable('future-infinitive'), false);
  assert.equal(items.generate({ skill: 'future-infinitive', kind: 'recognise', stage: 1 }), null);
  assert.equal(items.drillable('elegiac-couplet'), false);
  assert.equal(items.generate({ skill: 'nope', kind: 'blank' }), null);
});

test('parse prompts name exactly the features they grade (M4): case + number for a case skill, degree first for a degree skill, the participle\'s tense / voice / case / number / gender', () => {
  const items = mk({ rand: () => 0.1 });
  const c = items.generate({ skill: 'nominative-subject', kind: 'parse', stage: 2 });
  assert.equal(c.prompt.question, `Parse ${c.target.text}: case and number`);
  assert.deepEqual(c.expect.required, ['case', 'number']);
  assert.equal(c.prompt.placeholder, 'e.g. dative singular');
  assert.ok(judge(c, 'nominative singular').correct);
  const d = items.generate({ skill: 'superlative', kind: 'parse', stage: 2 });
  assert.ok(d && d.target.text === 'longissimum');
  assert.equal(d.prompt.question, 'Parse longissimum: degree, case and number');
  assert.ok(judge(d, 'superlative accusative singular').correct);
  assert.ok(!judge(d, 'comparative accusative singular').correct);
  const p = items.generate({ skill: 'perfect-passive-participle', kind: 'parse', stage: 2 });
  assert.ok(p && p.target.text === 'missus');
  assert.equal(p.prompt.question, 'Parse missus: tense, voice, case, number and gender (it is a participle)');
  assert.deepEqual(p.expect.required, ['tense', 'voice', 'case', 'number', 'gender']);
  assert.ok(judge(p, 'perfect passive participle, nominative singular masculine').correct);
  assert.ok(!judge(p, 'perfect participle').correct);
  const t = items.generate({ skill: 'imperfect-subjunctive', kind: 'parse', stage: 2 });
  assert.equal(t.prompt.question, 'Parse mitteret: tense and mood');
  assert.ok(judge(t, 'imperfect subjunctive').correct);
  assert.ok(judge(t, 'impf. subj. 3rd sg').correct);
  assert.ok(!judge(t, 'imperfect indicative').correct);
  assert.ok(!judge(t, 'imperfect subjunctive plural').correct);   // contradicts the number
  assert.ok(!judge(t, 'imperfect subjunctive passive').correct);  // contradicts the voice (m3)
  const it1 = items.generate({ skill: 'imperfect-subjunctive', kind: 'parse', stage: 1 });
  assert.equal(it1.input, 'choice');
  assert.ok(it1.choices.some((x) => x.correct && /^imperfect subjunctive/.test(x.label)));
});

test('blank: the sentence with the word blanked; macron-optional typed answer; choices from the paradigm at stage 1; the confusion map knows the other cells', () => {
  const items = mk({ rand: () => 0.9 });
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
  // typed the ablative cell of the same noun → the dative / ablative pair
  const abl = Object.entries(it.confuse.forms).find(([, v]) => v === 'ablative-means');
  assert.ok(abl, 'the ablative form of the target noun maps to the ablative skill');
  const r = judge(it, abl[0]);
  assert.equal(r.correct, false);
  assert.equal(confusedWith(it, r), 'ablative-means');
});

test('recognise (tap): the word indexes the skill fits are accepted; a tapped confusable word is logged as that confusion (P7); punctuation-free keys', () => {
  const items = mk({ rand: () => 0.4 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: true });
  assert.equal(it.input, 'tap');
  assert.ok(it.accept.includes(it.target.index));
  assert.ok(judge(it, it.target.index).correct);
  const r = judge(it, it.target.index + 1);
  assert.equal(r.correct, false);
  assert.equal(r.expected, it.target.text);
  assert.ok(it.key.startsWith('recognise-tap:'));
  assert.equal(confusedWith(it, { ...r, index: it.target.index + 1 }), null);
  // a sentence with a genitive beside the dative: tapping it is the dative / genitive confusion
  const items2 = createItems({ units: [units[6]], lookup, paradigm, skills: S, storage: mem(), rand: () => 0 });
  const g = items2.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: true });
  assert.ok(g, 'a tap item on "Servus puellae librum dat"');
  assert.equal(g.confuse.indexes[1], undefined, 'puellae is the target here (dative), not a distractor');
  const gen = items2.generate({ skill: 'genitive-possession', kind: 'recognise', stage: 1, tap: true });
  assert.ok(gen && gen.kind !== 'recognise' && gen.kind !== 'parse', 'puellae reads as genitive or dative: never a recognise target (the slot falls back to another kind)');
  assert.ok(items2.candidates('genitive-possession').every((c) => c.ambiguous));
});

test('chart: a single cell from the skill\'s lemmas, a column when full; infinitive tables have cells (M6); degree named on adjective tables (G1-03); a case skill fills the case row across genders (G1-22)', () => {
  const items = mk({ rand: () => 0.2 });
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'chart', stage: 1 });
  assert.equal(it.input, 'chart'); assert.equal(it.kind, 'chart');
  assert.equal(it.chart.cells.length, 1);
  assert.match(it.chart.cells[0].label, /^dative (singular|plural)$/);
  assert.ok(judge(it, { 0: it.chart.cells[0].answer[0] }).correct);
  const full = items.generate({ skill: 'dative-indirect-object', kind: 'chart', stage: 1, full: true });
  assert.ok(full.chart.cells.length >= 5, 'a column of the table');
  assert.equal(judge(full, {}).correct, false);
  const inf = items.generate({ skill: 'infinitive', kind: 'chart', stage: 1 });
  assert.ok(inf && inf.kind === 'chart', 'an infinitive chart cell, not a blank fallback');
  assert.match(inf.chart.cells[0].label, /infinitive/i);
  assert.ok(judge(inf, { 0: inf.chart.cells[0].answer[0] }).correct);
  const sup = items.generate({ skill: 'superlative', kind: 'chart', stage: 1 });
  assert.ok(sup && /^superlative, /.test(sup.chart.cells[0].label), `degree named: ${sup?.chart.cells[0].label}`);
  assert.match(sup.prompt.question, /^Give the superlative, /);
  const agr = items.generate({ skill: 'adjective-agreement', kind: 'chart', stage: 1, full: true });
  assert.ok(agr && agr.chart.cells.every((c) => !/comparative|superlative/.test(c.label)), 'a non-degree skill stays in the positive section');
  const nomAdj = createItems({ units: [{ id: 'z', la: 'Fīlum longum est.' }], lookup, paradigm, skills: new Map([['x', { ...S.get('accusative-object'), id: 'x', parse_filter: { case: 'acc', pos: 'ADJ' }, feature: 'case', patterns: [] }]]), storage: mem(), rand: () => 0 })
    .generate({ skill: 'x', kind: 'chart', stage: 1, full: true });
  assert.ok(nomAdj && nomAdj.chart.cells.length === 3 && nomAdj.chart.cells.every((c) => /^accusative sg\./.test(c.label)), 'the case row, one cell per gender');
  assert.match(nomAdj.prompt.question, /in every gender$/);
});

test('pool (M2): the whole key list is drawn before any repeat, the preferred tiers first, and the wrap is reported', () => {
  const storage = mem();
  const pool = createPool(storage);
  const keys = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  for (let i = 0; i < 4; i++) { const r = pool.chooseInfo('s', 'k', keys, Math.random, [new Set(['c', 'd'])]); seen.add(r.key); assert.equal(r.wrapped, false); if (i < 2) assert.ok(['c', 'd'].includes(r.key), 'the preferred tier first'); }
  assert.equal(seen.size, 4);
  assert.equal(pool.chooseInfo('s', 'k', keys, Math.random).wrapped, true);   // fifth: the pool restarts
  const again = createPool(storage);   // persisted
  assert.equal(again.used('s', 'k').size, 1);
  again.reset('s');
  assert.equal(again.used('s', 'k').size, 0);
  // a generator run: distinct sentences until the pool is spent, then `repeat` on the item
  const items = mk({ rand: () => 0.3 });
  const got = [];
  for (let i = 0; i < 6; i++) got.push(items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false }));
  const n = items.candidates('dative-indirect-object').filter((c) => !c.ambiguous).length;
  assert.equal(new Set(got.slice(0, n).map((x) => x.key)).size, n, 'no repeat before the pool is exhausted');
  assert.ok(got.slice(0, n).every((x) => !x.repeat) && got[n].repeat, 'the first repeat is flagged');
});

test('gold items come first (lesson examples and labelled highlights), and a gold unit needs no pattern match', () => {
  const gold = { lessonUnits: new Map([['dative-indirect-object', ['w07:1.1']]]), highlights: new Map([['w12:9.1', [{ text: 'ut librum longissimum mitteret', label: 'imperfect subjunctive, purpose clause' }]]]) };
  const items = mk({ gold, rand: () => 0.99 });
  const c = items.candidates('dative-indirect-object');
  assert.equal(c.find((x) => x.unit.id === 'w07:1.1')?.gold, 'lesson');
  const first = items.generate({ skill: 'dative-indirect-object', kind: 'recognise', stage: 1, tap: false });
  assert.equal(first.unit_id, 'w07:1.1', 'the lesson example is drawn first');
  const p = items.candidates('purpose-clause').find((x) => x.unit.id === 'w12:9.1');
  assert.equal(p?.gold, 'highlight');
  assert.equal(items.candidates('result-clause').some((x) => x.unit.id === 'w12:9.1'), false, 'the highlight names purpose, not result');
});

test('generate: falls back through the skill\'s other kinds, the neighbours\' kinds last, and reports the real kind', () => {
  const items = mk();
  const g = items.generate({ skill: 'genitive-possession', kind: 'recognise', stage: 1, avoid: ['blank'] });
  // genitive-possession: puellae is ambiguous, so no recognise / parse; the chart (not the avoided blank) comes first
  assert.ok(g && g.kind === 'chart', g?.kind);
  const b = items.generate({ skill: 'genitive-possession', kind: 'recognise', stage: 1, avoid: ['chart'] });
  assert.ok(b && b.kind === 'blank', b?.kind);
  const items2 = mk();
  const v = items2.generate({ skill: 'dative-indirect-object', kind: 'chart', stage: 1, avoid: ['recognise'] });
  assert.equal(v.kind, 'chart');
});

test('normaliseAnswer / matchesForm: macrons, case, v/u, j/i, punctuation', () => {
  assert.equal(normaliseAnswer('  Thēseō!'), 'theseo');
  assert.ok(matchesForm('theseo', ['Thēseō']));
  assert.ok(matchesForm('IVLIVS', ['Iūlius']));
  assert.ok(matchesForm('juvenis', ['iuuenis']));
  assert.ok(!matchesForm('', ['a']));
  assert.ok(!matchesForm('theseus', ['Thēseō']));
});

test('parseFeatures / matchParse: abbreviations, order, contradictions, voice', () => {
  assert.deepEqual(parseFeatures('dat. sg.'), { case: 'dat', number: 'sg' });
  assert.deepEqual(parseFeatures('singular dative feminine'), { case: 'dat', number: 'sg', gender: 'f' });
  assert.deepEqual(parseFeatures('3rd person plural perfect indicative'), { person: '3', number: 'pl', tense: 'perf', mood: 'ind' });
  assert.deepEqual(parseFeatures('future perfect'), { tense: 'futperf' });
  assert.deepEqual(parseFeatures('perfect passive participle'), { tense: 'perf', voice: 'pass', mood: 'ptc' });
  assert.deepEqual(parseFeatures('dative genitive').case, ['dat', 'gen']);
  const e = { values: { case: 'dat', number: 'sg', gender: 'm' }, required: ['case', 'number'] };
  assert.ok(matchParse('dative singular', e));
  assert.ok(matchParse('dat sg masc', e));
  assert.ok(!matchParse('dative', e));            // number missing
  assert.ok(!matchParse('dative singular fem', e)); // contradicts the gender
  assert.ok(!matchParse('dative or genitive singular', e));
  assert.ok(!matchParse('perfect indicative active', { values: { tense: 'perf', mood: 'ind', voice: 'pass' }, required: ['tense', 'mood'] }));
});

test('judge / confusedWith: a wrong choice names the skill its distractor came from; a typed case maps through the values', () => {
  const it = { input: 'choice', skill: 'dative-indirect-object', choices: [{ value: 'dat', correct: true, label: 'dative', skill: 'dative-indirect-object' }, { value: 'abl', correct: false, label: 'ablative', skill: 'ablative-means' }, { value: 'acc', correct: false, label: 'accusative', skill: null }] };
  const r = judge(it, 'abl');
  assert.equal(r.correct, false); assert.equal(r.expected, 'dative'); assert.equal(r.given, 'ablative');
  assert.equal(confusedWith(it, r), 'ablative-means');
  assert.equal(confusedWith(it, judge(it, 'acc')), null);
  assert.equal(judge(null, 'x').correct, false);
  const typed = { input: 'type', skill: 'nominative-subject', expectKey: 'case', expect: { values: { case: 'nom', number: 'sg' }, required: ['case', 'number'] }, answer: ['nominative singular'], confuse: { values: { acc: 'accusative-object' }, indexes: {}, forms: {} } };
  const t = judge(typed, 'accusative singular');
  assert.equal(t.correct, false);
  assert.equal(confusedWith(typed, t), 'accusative-object');
  assert.equal(confusedWith(typed, judge(typed, 'nominative singular')), null);
});
