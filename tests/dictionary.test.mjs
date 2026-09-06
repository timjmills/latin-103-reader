import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { tokenize, stripMacrons } from '../app/js/tokenize.js';
import { setGlossary, lookup, describe, _internal } from '../app/js/dictionary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'app', 'data');
const load = (f) => JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));

setGlossary(load('glossary.json'), load('function-words.json'), load('glosses.json'));

test('tokenize keeps offsets and macrons, treats quotes and … as punctuation', () => {
  // invented sentence (no textbook text in the repo)
  const la = 'Iūlia: "Nōlī" inquit "canem tangere!" … Puer hīc dormīre vult.';
  const toks = tokenize(la);
  assert.equal(toks.map((t) => t.text).join(''), la);
  const words = toks.filter((t) => t.isWord).map((t) => t.text);
  assert.deepEqual(words, ['Iūlia', 'Nōlī', 'inquit', 'canem', 'tangere', 'Puer', 'hīc', 'dormīre', 'vult']);
  const noli = toks.find((t) => t.text === 'Nōlī');
  assert.equal(noli.form, 'noli');
  assert.equal(la.slice(noli.start, noli.end), 'Nōlī');
  assert.equal(stripMacrons('Āēīōūȳ'), 'Aeiouy');
  assert.ok(toks.some((t) => !t.isWord && t.text.includes('…')));
  assert.ok(!toks.some((t) => t.isWord && /['"…]/.test(t.text)));
});

test('labyrinthō → dative or ablative singular of labyrinthus with a plain meaning line', () => {
  const r = lookup('labyrinthō');
  assert.notEqual(r.via, 'miss');
  const e = r.entries.find((x) => x.h === 'labyrinthus');
  assert.ok(e, 'labyrinthus entry');
  const d = describe(e);
  assert.equal(d.meaning, 'to/for the labyrinth · by/with/from the labyrinth');
  assert.equal(d.parse, 'dative or ablative singular');
  assert.match(d.lemma, /^labyrinthus -ī m/);
  assert.equal(d.category, '2nd declension');
  assert.ok(d.glosses.some((g) => g.term === 'dative'));
  assert.ok(d.glosses.some((g) => g.term === 'ablative'));
  assert.equal(describe(e, { compact: true }).parse, 'dat./abl. sg.');
  assert.ok(d.paradigm, 'paradigm present');
  const hits = d.paradigm.sections[0].rows.filter((row) => row.cells.some((c) => c.hit)).map((row) => row.label);
  assert.deepEqual(hits, ['dative', 'ablative']);
  const dat = d.paradigm.sections[0].rows.find((r) => r.label === 'dative').cells[0];
  assert.equal(dat.stem, 'labyrinth');
  assert.equal(dat.ending, 'ō');
  assert.equal(dat.text, 'labyrinthō');
  assert.match(d.usage, /no words for 'a' or 'the'/);
});

test('mitterent → "they were sending / they should send (subjunctive)" + imperfect subjunctive 3rd pl', () => {
  const r = lookup('mitterent');
  const e = r.entries.find((x) => x.h === 'mitto' && x.pos === 'V');
  assert.ok(e, 'mitto entry');
  assert.deepEqual(e.parses[0], { tense: 'impf', voice: 'act', mood: 'subj', person: 3, number: 'pl' });
  const d = describe(e);
  assert.equal(d.meaning, 'they were sending / they should send (subjunctive)');
  assert.equal(d.parse, 'imperfect subjunctive, 3rd person plural');
  assert.equal(d.lemma, 'mittō, mittere, mīsī, missum');
  assert.equal(d.category, '3rd conjugation');
  assert.ok(d.glosses.some((g) => g.term === 'subjunctive'));
  assert.ok(d.glosses.some((g) => g.term === 'imperfect'));
  assert.equal(describe(e, { compact: true }).parse, 'impf. subj. 3rd pl.');
  const sec = d.paradigm.sections.find((s) => s.title === 'imperfect subjunctive');
  const hit = sec.rows.flatMap((row) => row.cells).find((c) => c.hit);
  assert.equal(hit.text, 'mitterent');
  assert.equal(hit.stem, 'mitt');
});

test('Sequiminī → deponent imperative plural with an active meaning', () => {
  const r = lookup('Sequiminī');
  assert.equal(r.via, 'lower');
  const e = r.entries.find((x) => x.h === 'sequor');
  assert.ok(e, 'sequor entry');
  assert.equal(e.kind, 'dep');
  const d = describe(e);
  assert.match(d.meaning, /follow! \(command to more than one person\)/);
  assert.match(d.parse, /imperative/);
  assert.match(d.parse, /plural/);
  assert.match(d.parse, /deponent/);
  assert.doesNotMatch(d.parse, /passive/);
  assert.match(d.category, /deponent/);
  assert.ok(d.glosses.some((g) => g.term === 'deponent'));
  const imper = d.paradigm.sections.find((s) => s.title === 'imperative');
  assert.ok(imper.rows.some((row) => row.cells.some((c) => c.hit && c.text === 'sequiminī')));
});

test('fābulamne → enclitic -ne stripped', () => {
  const r = lookup('fābulamne');
  assert.notEqual(r.via, 'miss');
  assert.equal(r.enclitic, 'ne');
  const e = r.entries.find((x) => x.h === 'fabula');
  assert.ok(e, 'fabula entry');
  assert.equal(e.enc, 'ne');
  assert.deepEqual(e.parses[0], { case: 'acc', number: 'sg', gender: 'f' });
  const d = describe(e);
  assert.equal(d.meaning, 'the story (object)');
  assert.match(d.parse, /accusative singular.*-ne/);
  assert.match(d.usage, /yes\/no question/);
  // a form the build never saw still resolves by stripping the enclitic
  const r2 = lookup('labyrinthumve');
  assert.equal(r2.via, 'enclitic');
  assert.equal(r2.enclitic, 've');
  assert.equal(r2.entries[0].enc, 've');
  assert.match(describe(r2.entries[0]).usage, /-ve/);
});

test('nonsense word → miss', () => {
  const r = lookup('xyzzyq');
  assert.equal(r.via, 'miss');
  assert.deepEqual(r.entries, []);
  assert.equal(lookup('').via, 'miss');
});

test('lookup handles v/u and capitalised forms', () => {
  assert.notEqual(lookup('vīvēbat').via, 'miss');
  assert.notEqual(lookup('Vīvēbat').via, 'miss');
  const r = lookup('Athēnīs');
  assert.notEqual(r.via, 'miss');
  assert.ok(r.entries.some((e) => /Ath/i.test(e.lemma)));
});

test('function words get usage notes and case-specific meanings', () => {
  const inAbl = lookup('in').entries.find((e) => e.pos === 'PREP');
  assert.ok(inAbl);
  const d = describe(inAbl);
  assert.match(d.category, /preposition \+ (ablative|accusative)/);
  assert.match(d.usage, /Two cases/);
  const ut = describe(lookup('ut').entries.find((e) => e.pos === 'CONJ'));
  assert.equal(ut.category, 'conjunction');
  assert.match(ut.usage, /subjunctive/);
  assert.equal(ut.paradigm, null);
});

test('irregular verb sum: est → "he/she/it is" and the hand table lights est', () => {
  const e = lookup('est').entries.find((x) => x.h === 'sum');
  assert.ok(e, 'sum entry');
  const d = describe(e);
  assert.equal(d.meaning, 'he/she/it is');
  assert.equal(d.parse, 'present indicative, 3rd person singular');
  const pres = d.paradigm.sections.find((s) => s.title === 'present indicative');
  const hit = pres.rows.flatMap((r) => r.cells).find((c) => c.hit);
  assert.equal(hit.text, 'est');
});

test('participles, gerund and supine are flagged explicitly', () => {
  const missum = lookup('missum').entries.find((x) => x.h === 'mitto' && x.pos === 'VPAR');
  assert.ok(missum);
  assert.ok(missum.parses.some((p) => p.mood === 'ptc' && p.tense === 'perf' && p.voice === 'pass'));
  assert.ok(missum.parses.some((p) => p.mood === 'supine' && p.case === 'acc'));
  const d = describe(missum);
  assert.match(d.meaning, /sent \/ having been sent/);
  assert.match(d.parse, /perfect passive participle/);
  const mittendum = lookup('mittendum').entries.find((x) => x.h === 'mitto' && x.pos === 'VPAR');
  assert.ok(mittendum.parses.some((p) => p.mood === 'gerundive'));
  assert.ok(mittendum.parses.some((p) => p.mood === 'gerund' && p.case === 'acc'));
  assert.ok(describe(mittendum).glosses.some((g) => g.term === 'gerund'));
});

test('English verb inflection helpers', () => {
  const { thirdSg, pastTense, pastParticiple, ingForm, pluralNoun } = _internal;
  assert.equal(thirdSg('send'), 'sends');
  assert.equal(thirdSg('carry'), 'carries');
  assert.equal(thirdSg('take hold'), 'takes hold');
  assert.equal(pastTense('send'), 'sent');
  assert.equal(pastTense('love'), 'loved');
  assert.equal(pastTense('stop'), 'stopped');
  assert.equal(pastParticiple('see'), 'seen');
  assert.equal(ingForm('send'), 'sending');
  assert.equal(ingForm('love'), 'loving');
  assert.equal(ingForm('be'), 'being');
  assert.equal(pluralNoun('city'), 'cities');
  assert.equal(pluralNoun('young man'), 'young men');
});

test('vīs / vult are volō "you want", not nōlō (M2)', () => {
  const vis = lookup('vīs');
  assert.notEqual(vis.via, 'miss');
  assert.equal(vis.entries[0].h, 'volo');
  assert.ok(!vis.entries.some((e) => e.h === 'nolo'), 'no nōlō reading for vīs');
  const d = describe(vis.entries[0]);
  assert.match(d.meaning, /you want/);
  assert.equal(d.parse, 'present indicative, 2nd person singular');
  assert.ok(vis.entries.some((e) => e.h === 'vis' && e.pos === 'N'), 'the noun vīs is still offered');
  assert.equal(lookup('vult').entries[0].h, 'volo');
  assert.match(describe(lookup('vult').entries[0]).meaning, /he\/she\/it wants/);
  assert.equal(lookup('māvīs').entries[0].h, 'malo');
  assert.equal(lookup('nōlī').entries[0].h, 'nolo');
});

test('whole-word quisque / neque rank before the enclitic split (M5)', () => {
  const q = lookup('quisque');
  assert.equal(q.via, 'exact');
  assert.equal(q.enclitic, null);
  assert.equal(q.entries[0].enc, null);
  assert.equal(q.entries[0].h, 'quisque');
  const firstSplit = q.entries.findIndex((e) => e.enc);
  const lastWhole = q.entries.map((e) => !e.enc).lastIndexOf(true);
  assert.ok(firstSplit === -1 || firstSplit > lastWhole, 'every whole-word reading precedes every -que split');
  const n = lookup('neque');
  assert.equal(n.entries[0].h, 'neque');
  assert.equal(n.entries[0].enc, null);
  assert.doesNotMatch(describe(n.entries[0]).meaning, /-que \(and\)/);
  for (const f of ['ubīque', 'itaque', 'atque', 'quoque', 'namque', 'usque', 'undique', 'dēnique', 'uterque']) {
    const r = lookup(f);
    if (r.via === 'miss') continue;
    assert.equal(r.entries[0].enc, null, `${f}: first entry is the whole word`);
  }
});

test('capiō is labelled "3rd conjugation (-iō)"; mittō stays plain 3rd', () => {
  const cap = lookup('capiō').entries.find((e) => e.h === 'capio' && e.pos === 'V');
  assert.equal(describe(cap).category, '3rd conjugation (-iō)');
  const capiunt = lookup('capiunt').entries.find((e) => e.h === 'capio' && e.pos === 'V');
  assert.equal(describe(capiunt).category, '3rd conjugation (-iō)');
  const mitto = lookup('mittō').entries.find((e) => e.h === 'mitto' && e.pos === 'V');
  assert.equal(describe(mitto).category, '3rd conjugation');
});

test('dīs is dative/ablative plural of deus, not a bogus "disus"', () => {
  const r = lookup('dīs');
  assert.ok(!r.entries.some((e) => e.h === 'disus'), 'no disus headword');
  const deus = r.entries.find((e) => e.h === 'deus');
  assert.ok(deus, 'deus entry');
  assert.ok(deus.parses.some((p) => p.case === 'dat' && p.number === 'pl'));
  assert.ok(deus.parses.some((p) => p.case === 'abl' && p.number === 'pl'));
  assert.match(describe(deus).lemma, /^deus -ī m/);
  assert.equal(lookup('dī').entries[0].h, 'deus');
  assert.ok(!lookup('deus').entries.some((e) => e.h === 'deusus'));
});

test('iuvenis / iuvat / adiuvat keep their v in the right place (M3)', () => {
  const iuv = lookup('iuvenis');
  assert.ok(iuv.entries.every((e) => e.h === 'iuvenis'), JSON.stringify(iuv.entries.map((e) => e.h)));
  const noun = iuv.entries.find((e) => e.pos === 'N');
  assert.match(noun.lemma, /^iuvenis -is/);
  assert.equal(lookup('iuvat').entries[0].h, 'iuvo');
  assert.match(lookup('iuvat').entries[0].lemma, /^iuvō, iuvāre/);
  assert.equal(lookup('adiuvat').entries[0].h, 'adiuvo');
  assert.equal(lookup('vīvus').entries[0].h, 'vivus');
});

test('vocative reading is kept and comes first when the sentence addresses someone', () => {
  const cives = lookup('cīvēs').entries.find((e) => e.h === 'civis');
  assert.ok(cives);
  assert.ok(cives.parses.some((p) => p.case === 'voc'), 'voc parse present');
  const plain = describe(cives, { form: 'cīvēs' });
  assert.match(plain.meaning, /^the fellow citizens \(subject\)/);
  assert.match(plain.meaning, /O fellow citizens!/);
  // invented context sentence
  const shout = describe(cives, { form: 'cīvēs', context: 'Gaudēte, cīvēs meī! Hostēs fūgērunt.' });
  assert.match(shout.meaning, /^O fellow citizens!/);
  assert.match(shout.meaning, /the fellow citizens \(subject\)/);
  const stated = describe(cives, { form: 'cīvēs', context: 'Cīvēs in forō sunt; cīvēs laetī sunt.' });
  assert.match(stated.meaning, /^the fellow citizens \(subject\)/);
});

test('personal pronouns drop the gender from the parse line', () => {
  const tibi = describe(lookup('tibi').entries[0]);
  assert.equal(tibi.parse, 'dative singular');
  assert.doesNotMatch(describe(lookup('mihi').entries[0]).parse, /masculine|feminine/);
  assert.doesNotMatch(describe(lookup('tē').entries[0]).parse, /masculine|feminine/);
  assert.doesNotMatch(describe(lookup('sē').entries[0]).parse, /masculine|feminine/);
  // other pronouns keep it
  assert.match(describe(lookup('eum').entries.find((e) => e.h === 'is')).parse, /masculine/);
});

test('imperative reading first for a capitalised or exclaimed form (sequere, Sequiminī)', () => {
  const seq = lookup('sequere').entries.find((e) => e.h === 'sequor');
  assert.match(describe(seq, { form: 'sequere' }).meaning, /^you will follow/);
  assert.match(describe(seq, { form: 'sequere', context: 'Tū mē sequere!' }).meaning, /^follow! \(command to one person\)/);
  assert.match(describe(seq, { form: 'sequere', context: 'Sī vīs, mē sequere.' }).meaning, /^you will follow/);
  assert.match(describe(seq, { form: 'Sequere' }).meaning, /^follow!/);
  const pl = lookup('Sequiminī').entries.find((e) => e.h === 'sequor');
  assert.match(describe(pl, { form: 'Sequiminī' }).meaning, /^follow! \(command to more than one person\)/);
  assert.match(describe(pl, { form: 'sequiminī' }).meaning, /^you \(pl\.\) follow/);
});

test('duplicate lexemes are merged in the build (no twin chips)', () => {
  for (const f of ['secūtus', 'vīs', 'acūtus', 'ait', 'abiēcit', 'canis']) {
    const r = lookup(f);
    if (r.via === 'miss') continue;
    const seen = new Set();
    for (const e of r.entries) {
      const k = `${e.pos}|${e.enc || ''}|${e.lemma}`;
      assert.ok(!seen.has(k), `${f}: duplicate lemma ${e.lemma}`);
      seen.add(k);
      const k2 = `${e.pos}|${e.enc || ''}|${e.senses.join('|')}`;
      assert.ok(!seen.has(k2), `${f}: duplicate senses for ${e.lemma}`);
      seen.add(k2);
    }
  }
  assert.ok(!lookup('secūtus').entries.some((e) => e.h === 'secor'), 'ghost lemma secor gone');
});

// ---------------------------------------------------------------------------
// ranking: which reading of a form leads the list

test('māla in "Aemilia puerīs māla dat" is apples, and every reading is still offered', () => {
  const la = 'Aemilia puerīs māla dat.';
  const at = la.indexOf('māla');
  const r = lookup('māla', { context: la, at });
  assert.equal(r.entries[0].h, 'malum');
  assert.match(r.entries[0].lemma, /^mālum -ī n/);
  assert.match(describe(r.entries[0], { form: 'māla', context: la }).meaning, /apples/);
  // the word panel offers the rest — nothing is dropped, only ordered
  assert.ok(r.entries.length >= 4, `all readings kept (${r.entries.length})`);
  assert.ok(r.entries.some((e) => /^māla -ae f/.test(e.lemma)), 'the cheeks reading is still there');
  assert.equal(r.ambiguous, false, 'one reading leads; the caller need not show two');
  // the drill gloss has no sentence to go on, and the library counts alone still settle it
  assert.match(lookup('māla').entries[0].lemma, /^mālum -ī n/);
});

test('nōn is "not", with no second reading offered beside it', () => {
  const r = lookup('nōn', { context: 'Quīntus nōn dormit.', at: 8 });
  assert.equal(r.entries[0].pos, 'ADV');
  assert.match(describe(r.entries[0]).meaning, /^not/);
  assert.equal(r.ambiguous, false, 'the Nones are not offered as a rival reading');
  assert.equal(lookup('nōn').ambiguous, false);
});

test('the library counts push back a reading the course never prints, and only that', () => {
  const { countRanks } = _internal;
  const seen = { n: 80, nd: 8 }, never = { n: 0, nd: 7 };
  assert.deepEqual(countRanks([seen, never]), [0, 1]);
  // a near miss is left where the build put it
  assert.deepEqual(countRanks([{ n: 80, nd: 8 }, { n: 12, nd: 7 }]), [0, 0]);
  // a rival that was counted over ten times the evidence proves nothing (a verb against a noun)
  assert.deepEqual(countRanks([{ n: 22, nd: 146 }, { n: 0, nd: 5 }]), [0, 0]);
  // and a reading with nothing of its own to count is never moved
  assert.deepEqual(countRanks([{ n: 80, nd: 8 }, {}]), [0, 0]);
  const mala = lookup('māla').entries;
  assert.equal(mala.find((e) => /^māla -ae f/.test(e.lemma)).n, 0, 'cheeks: the library prints none of its own forms');
  assert.ok(mala.find((e) => /^mālum -ī n/.test(e.lemma)).n >= 10, 'apples: all over the course');
});

test('the sentence decides: a preposition governs the word it stands in front of', () => {
  const { fitPenalties } = _internal;
  const abl = { pos: 'N', parses: [{ case: 'abl', number: 'sg' }] };
  const acc = { pos: 'N', parses: [{ case: 'acc', number: 'sg' }] };
  // invented sentences (no textbook text in the repo). `ex` takes the ablative and nothing else.
  const la = 'Puer ex hortō venit.';
  const pen = fitPenalties([abl, acc], 'hortō', { context: la, at: la.indexOf('hortō') });
  assert.equal(pen.hard[0], 0);
  assert.ok(pen.hard[1] > 0, 'an accusative-only reading cannot follow "ex hortō"');
  // …and not over a word it has an object for already: in "ex ōrā maris" the genitive belongs to
  // `ōrā`, not to `ex`
  const la2 = 'Ex ōrā maris vēnit.';
  const gen = { pos: 'N', parses: [{ case: 'gen', number: 'sg' }] };
  const p2 = fitPenalties([gen, acc], 'maris', { context: la2, at: la2.indexOf('maris') });
  assert.deepEqual(p2.hard, [0, 0]);
  // a rule no reading satisfies is dropped whole, so an adverb is not floated up by it
  const adv = { pos: 'ADV', parses: [{}] };
  const p3 = fitPenalties([gen, adv], 'hortō', { context: la, at: la.indexOf('hortō') });
  assert.deepEqual(p3.hard, [0, 0]);
  // and the verb's empty object slot is a guess, kept apart from what the sentence actually says
  const dat = { pos: 'N', parses: [{ case: 'dat', number: 'sg' }] };
  const la4 = 'Puella puerīs rosam dat.';
  const p4 = fitPenalties([acc, dat], 'rosam', { context: la4, at: la4.indexOf('rosam') });
  assert.deepEqual(p4.hard, [0, 0]);
  assert.deepEqual(p4.soft, [0, 1]);
});

test('a caller that knows the role says so, and readings that cannot take it lose', () => {
  const dat = lookup('labyrinthō', { want: { case: 'dat', number: 'sg' } });
  assert.ok(dat.entries[0].parses.some((p) => p.case === 'dat'));
  // an impossible want is ignored rather than shuffling the list at random
  const before = lookup('labyrinthō').entries.map((e) => e.lemma);
  assert.deepEqual(lookup('labyrinthō', { want: { case: 'loc' } }).entries.map((e) => e.lemma), before);
});

test('a capital prefers a name, unless the sentence put it there', () => {
  // invented sentences
  const la = 'Iūlius Aemiliam et Aemiliae fīliōs videt.';
  const r = lookup('Aemiliae', { context: la, at: la.indexOf('Aemiliae') });
  assert.equal(r.entries[0].pos, 'N', 'the woman, not the adjective Aemilius -a -um');
  assert.match(r.entries[0].lemma, /^Aemilia/);
  // "Num" opens the question; the capital is the sentence's, not Numerius's
  const q = 'Num pater domī est?';
  assert.equal(lookup('Num', { context: q, at: 0 }).entries[0].pos, 'ADV');
  // with no sentence to go on the capital is taken at face value, as before
  assert.match(lookup('Mārcō').entries[0].lemma, /^Mārcus/);
});

test('the printed macron still outranks the sentence and the counts', () => {
  // hīc (here) and hic (this) share a key; the macron says which
  assert.equal(lookup('hīc').entries[0].pos, 'ADV');
  assert.equal(lookup('hic').entries[0].pos, 'PRON');
  assert.match(lookup('lectō').entries[0].lemma, /^lectus -ī m/);   // in bed, not lēctō from legō
  assert.match(lookup('ēst').entries[0].lemma, /^edō/);             // he eats, not est "he is"
  // …but a particle whose vowel length the library itself writes both ways is left to the build
  assert.equal(lookup('modō').entries[0].pos, 'ADV');
  assert.equal(lookup('modo').entries[0].pos, 'ADV');
});

test('lookup keeps its old shape when called with one argument', () => {
  const r = lookup('puella');
  assert.equal(r.form, 'puella');
  assert.equal(r.via, 'exact');
  assert.equal(r.enclitic, null);
  assert.equal(r.ambiguous, false);
  assert.ok(Array.isArray(r.entries) && r.entries.length);
  // an unknown option is ignored, not obeyed
  assert.deepEqual(lookup('puella', { nonsense: true }).entries, r.entries);
});
