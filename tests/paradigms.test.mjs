// Paradigm tables checked against Ørberg's Familia Romana tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { paradigm, conjugationName, nounNumber } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems } from '../app/js/grammar/items.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { setGlossary, lookup } from '../app/js/dictionary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const glossary = JSON.parse(readFileSync(path.join(here, '..', 'app', 'data', 'glossary.json'), 'utf8'));

/** First glossary entry whose headword (ascii) and pos match. */
function entry(h, pos, pred = () => true) {
  for (const list of Object.values(glossary)) {
    for (const e of list) if (e.h === h && e.pos === pos && pred(e)) return e;
  }
  throw new Error(`no glossary entry for ${h} (${pos})`);
}

function texts(p) {
  const out = new Set();
  for (const s of p.sections) for (const r of s.rows) for (const c of r.cells) {
    if (c.empty) continue;
    out.add(c.text);
    if (c.alt) out.add(c.alt);
    for (const part of c.text.split(' / ')) out.add(part);
  }
  return out;
}

function assertForms(p, forms, label) {
  const have = texts(p);
  const missing = forms.filter((f) => !have.has(f));
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(', ')}`);
}

function column(p, sectionTitle, col) {
  const s = p.sections.find((x) => x.title === sectionTitle);
  assert.ok(s, `section ${sectionTitle}`);
  return s.rows.map((r) => r.cells[col].text);
}

// --- nouns -----------------------------------------------------------------

const NOUNS = {
  puella: { sg: ['puella', 'puellae', 'puellae', 'puellam', 'puellā', 'puella'], pl: ['puellae', 'puellārum', 'puellīs', 'puellās', 'puellīs', 'puellae'] },
  servus: { sg: ['servus', 'servī', 'servō', 'servum', 'servō', 'serve'], pl: ['servī', 'servōrum', 'servīs', 'servōs', 'servīs', 'servī'] },
  puer: { sg: ['puer', 'puerī', 'puerō', 'puerum', 'puerō', 'puer'], pl: ['puerī', 'puerōrum', 'puerīs', 'puerōs', 'puerīs', 'puerī'] },
  ager: { sg: ['ager', 'agrī', 'agrō', 'agrum', 'agrō', 'ager'], pl: ['agrī', 'agrōrum', 'agrīs', 'agrōs', 'agrīs', 'agrī'] },
  verbum: { sg: ['verbum', 'verbī', 'verbō', 'verbum', 'verbō', 'verbum'], pl: ['verba', 'verbōrum', 'verbīs', 'verba', 'verbīs', 'verba'] },
  rex: { sg: ['rēx', 'rēgis', 'rēgī', 'rēgem', 'rēge', 'rēx'], pl: ['rēgēs', 'rēgum', 'rēgibus', 'rēgēs', 'rēgibus', 'rēgēs'] },
  corpus: { sg: ['corpus', 'corporis', 'corporī', 'corpus', 'corpore', 'corpus'], pl: ['corpora', 'corporum', 'corporibus', 'corpora', 'corporibus', 'corpora'] },
  mare: { sg: ['mare', 'maris', 'marī', 'mare', 'marī', 'mare'], pl: ['maria', 'marium', 'maribus', 'maria', 'maribus', 'maria'] },
  urbs: { sg: ['urbs', 'urbis', 'urbī', 'urbem', 'urbe', 'urbs'], pl: ['urbēs', 'urbium', 'urbibus', 'urbēs', 'urbibus', 'urbēs'] },
  manus: { sg: ['manus', 'manūs', 'manuī', 'manum', 'manū', 'manus'], pl: ['manūs', 'manuum', 'manibus', 'manūs', 'manibus', 'manūs'] },
  cornu: { sg: ['cornū', 'cornūs', 'cornū', 'cornū', 'cornū', 'cornū'], pl: ['cornua', 'cornuum', 'cornibus', 'cornua', 'cornibus', 'cornua'] },
  dies: { sg: ['diēs', 'diēī', 'diēī', 'diem', 'diē', 'diēs'], pl: ['diēs', 'diērum', 'diēbus', 'diēs', 'diēbus', 'diēs'] },
  res: { sg: ['rēs', 'reī', 'reī', 'rem', 'rē', 'rēs'], pl: ['rēs', 'rērum', 'rēbus', 'rēs', 'rēbus', 'rēs'] },
};

const NOUN_GENDER = { puella: 'f', servus: 'm', puer: 'm', ager: 'm', verbum: 'n', rex: 'm', corpus: 'n', mare: 'n', urbs: 'f', manus: 'f', cornu: 'n', dies: 'c', res: 'f' };

for (const [h, tbl] of Object.entries(NOUNS)) {
  test(`noun ${h} declines like Ørberg's table`, () => {
    const e = entry(h, 'N', (x) => (h === 'cornu' ? x.gender === 'n' : h === 'manus' ? x.gender === 'f' : true) && x.cat);
    const p = paradigm(e, e.parses);
    assert.ok(p, 'paradigm');
    assert.equal(p.kind, 'noun');
    assert.deepEqual(column(p, 'cases', 0).slice(0, 6), tbl.sg, `${h} singular`);
    assert.deepEqual(column(p, 'cases', 1).slice(0, 6), tbl.pl, `${h} plural`);
    assert.deepEqual(p.sections[0].rows.map((r) => r.label), ['nominative', 'genitive', 'dative', 'accusative', 'ablative', 'vocative']);
    // every cell splits stem and ending and re-joins to the text
    for (const r of p.sections[0].rows) for (const c of r.cells) assert.equal(c.stem + c.ending, c.text);
  });
}

test('stem/ending split: puell-ārum, rēg-um, urb-ium', () => {
  const puella = paradigm(entry('puella', 'N'), []);
  const genPl = puella.sections[0].rows[1].cells[1];
  assert.deepEqual([genPl.stem, genPl.ending], ['puell', 'ārum']);
  const rex = paradigm(entry('rex', 'N'), []);
  assert.deepEqual([rex.sections[0].rows[1].cells[1].stem, rex.sections[0].rows[1].cells[1].ending], ['rēg', 'um']);
  const urbs = paradigm(entry('urbs', 'N'), []);
  assert.equal(urbs.sections[0].rows[1].cells[1].ending, 'ium');
  assert.match(urbs.title, /i-stem/);
});

// Whitaker's N 2 4 is the -ium / -ius stem, not the vulgus type: an ordinary
// 2nd-declension noun, vocative and all.
const IUS_NOUNS = {
  aedificium: {
    sg: ['aedificium', 'aedificiī', 'aedificiō', 'aedificium', 'aedificiō', 'aedificium'],
    pl: ['aedificia', 'aedificiōrum', 'aedificiīs', 'aedificia', 'aedificiīs', 'aedificia'],
  },
  gladius: {
    sg: ['gladius', 'gladiī', 'gladiō', 'gladium', 'gladiō', 'gladie'],
    pl: ['gladiī', 'gladiōrum', 'gladiīs', 'gladiōs', 'gladiīs', 'gladiī'],
  },
};

for (const [h, tbl] of Object.entries(IUS_NOUNS)) {
  test(`noun ${h} (-ium / -ius stem) declines like Ørberg's table`, () => {
    const e = entry(h, 'N');
    assert.deepEqual(e.cat, [2, 4]);
    const p = paradigm(e, e.parses);
    assert.ok(p, 'paradigm');
    assert.equal(p.kind, 'noun');
    assert.deepEqual(column(p, 'cases', 0).slice(0, 6), tbl.sg, `${h} singular`);
    assert.deepEqual(column(p, 'cases', 1).slice(0, 6), tbl.pl, `${h} plural`);
    for (const r of p.sections[0].rows) for (const c of r.cells) assert.equal(c.stem + c.ending, c.text);
  });
}

// The contracted vocative in -ī belongs to PROPER NAMES in -ius plus fīlius and
// genius (A&G §49.c, Bennett §25.2, Gildersleeve & Lodge §33). An ordinary
// common noun in -ius keeps the regular -ie, whatever Whitaker class it is in.
test('the contracted vocative is for names in -ius and fīlius; a common noun has -ie', () => {
  const gladius = paradigm(entry('gladius', 'N'), []);
  const voc = gladius.sections[0].rows[5].cells[0];
  assert.equal(voc.text, 'gladie');
  assert.notEqual(voc.text, 'gladī');
  assert.deepEqual([voc.stem, voc.ending], ['gladi', 'e']);
  assert.match(gladius.note ?? '', /vocative is regular — gladie/);

  for (const [h, want] of [['filius', 'fīlī'], ['iulius', 'Iūlī'], ['cornelius', 'Cornēlī'],
                           ['dionysius', 'Dionysī']]) {
    const p = paradigm(entry(h, 'N'), []);
    assert.equal(p.sections[0].rows[5].cells[0].text, want, `${h} vocative`);
    assert.match(p.note ?? '', /short vocative singular/, `${h} note`);
  }
  // Common nouns in -ius across all three Whitaker classes keep -ie.
  for (const [h, want] of [['fluvius', 'fluvie'], ['nuntius', 'nūntie'], ['sestertius', 'sēstertie'],
                           ['tabellarius', 'tabellārie'], ['denarius', 'dēnārie'], ['medius', 'medie']]) {
    assert.equal(paradigm(entry(h, 'N'), []).sections[0].rows[5].cells[0].text, want, `${h} vocative`);
  }
});

// G3-02: an `alt` is an accepted drill answer everywhere it is read, so the
// contracted genitive fīlī would let one string answer two rows of the chart.
test('no -ius noun carries a contracted genitive as a second accepted form', () => {
  for (const h of ['gladius', 'filius', 'iulius', 'cornelius', 'fluvius']) {
    const p = paradigm(entry(h, 'N'), []);
    const gen = p.sections[0].rows[1].cells[0];
    assert.equal(gen.alt, undefined, `${h} genitive alt`);
    assert.ok(!gen.text.includes(' / '), `${h} genitive is one form`);
  }
  const f = paradigm(entry('filius', 'N'), []);
  assert.equal(f.sections[0].rows[1].cells[0].text, 'fīliī');
  assert.equal(f.sections[0].rows[5].cells[0].text, 'fīlī');
  // the contraction is still taught — in the note, where it cannot be typed in
  assert.match(f.note ?? '', /older Latin/);
});

test('aedificium: neuter -ium keeps a plural and never shows a -us nominative', () => {
  const p = paradigm(entry('aedificium', 'N'), []);
  assert.equal(p.sections[0].headers.length, 2, 'singular and plural');
  const all = [...texts(p)];
  assert.ok(!all.some((t) => /ius$/.test(t)), `no -ius forms: ${all.join(' ')}`);
  assert.equal(p.note ?? null, null);
});

test('vulgus type (virus, N 2 1 neuter) keeps the no-plural -us table', () => {
  const p = paradigm(entry('virus', 'N'), []);
  assert.deepEqual(p.sections[0].headers, ['singular']);
  assert.deepEqual(column(p, 'cases', 0).slice(0, 6), ['virus', 'virī', 'virō', 'virus', 'virō', 'virus']);
  assert.match(p.note ?? '', /no plural/);
});

test('consonant stems in -is / -ex / -us take gen. pl. -um, not -ium (A&G §121–122)', () => {
  const genPl = (p) => p.sections[0].rows[1].cells[1];
  const canis = paradigm(entry('canis', 'N'), []);
  assert.equal(genPl(canis).text, 'canum');
  assert.equal(genPl(canis).ending, 'um');
  assert.doesNotMatch(canis.title, /i-stem/);
  assert.match(canis.note ?? '', /not an i-stem/);
  assert.equal(canis.sections[0].rows[4].cells[0].text, 'cane');
  const iuvenis = paradigm(entry('iuvenis', 'N'), []);
  assert.equal(genPl(iuvenis).text, 'iuvenum');
  const senex = paradigm(entry('senex', 'N'), []);
  assert.equal(genPl(senex).text, 'senum');
  const pater = paradigm(entry('pater', 'N'), []);
  assert.equal(genPl(pater).text, 'patrum');
  assert.deepEqual(column(pater, 'cases', 0).slice(0, 6), ['pater', 'patris', 'patrī', 'patrem', 'patre', 'pater']);
  // real i-stems are untouched
  assert.equal(genPl(paradigm(entry('urbs', 'N'), [])).text, 'urbium');
  assert.equal(genPl(paradigm(entry('navis', 'N'), [])).text, 'nāvium');
  assert.equal(genPl(paradigm(entry('mare', 'N'), [])).text, 'marium');
});

test('vetus and senex (consonant-stem adjectives): veterum / vetera / vetere, senum / sena', () => {
  const vetus = paradigm(entry('vetus', 'ADJ'), [{ case: 'nom', number: 'sg' }]);
  const pos = vetus.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pos.rows[0].cells.map((c) => c.text), ['vetus', 'vetus', 'vetus']);
  assert.deepEqual(pos.rows[4].cells.map((c) => c.text), ['vetere', 'vetere', 'vetere']);
  assert.deepEqual(pos.rows[6].cells.map((c) => c.text), ['veterēs', 'veterēs', 'vetera']);
  assert.deepEqual(pos.rows[7].cells.map((c) => c.text), ['veterum', 'veterum', 'veterum']);
  assert.match(vetus.note ?? '', /not an i-stem/);
  const senex = paradigm(entry('senex', 'ADJ'), []);
  const sp = senex.sections.find((s) => s.title === 'positive');
  assert.deepEqual(sp.rows[7].cells.map((c) => c.text), ['senum', 'senum', 'senum']);
  assert.deepEqual(sp.rows[6].cells.map((c) => c.text), ['senēs', 'senēs', 'sena']);
  // one-ending i-stem adjectives keep -ium / -ia
  const felix = paradigm(entry('felix', 'ADJ'), []);
  assert.deepEqual(felix.sections[0].rows[7].cells.map((c) => c.text), ['fēlīcium', 'fēlīcium', 'fēlīcium']);
});

test('locative row appears for a locative parse', () => {
  const romae = glossary['romae']?.find((e) => e.h === 'roma');
  if (!romae) return; // not in this corpus
  const p = paradigm(romae, [{ case: 'loc', number: 'sg', gender: 'f' }]);
  const loc = p.sections[0].rows.find((r) => r.label === 'locative');
  assert.ok(loc);
  assert.equal(loc.cells[0].text, 'Rōmae');
  assert.ok(loc.cells[0].hit);
});

// --- adjectives ------------------------------------------------------------

test('bonus -a -um with comparative and superlative', () => {
  const e = entry('bonus', 'ADJ');
  const p = paradigm(e, [{ case: 'nom', number: 'sg', gender: 'm' }]);
  assert.equal(p.kind, 'adjective');
  const pos = p.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pos.headers, ['masculine', 'feminine', 'neuter']);
  assert.deepEqual(pos.rows.slice(0, 6).map((r) => r.cells.map((c) => c.text)), [
    ['bonus', 'bona', 'bonum'], ['bonī', 'bonae', 'bonī'], ['bonō', 'bonae', 'bonō'],
    ['bonum', 'bonam', 'bonum'], ['bonō', 'bonā', 'bonō'], ['bone', 'bona', 'bonum'],
  ]);
  assert.deepEqual(pos.rows.slice(6, 12).map((r) => r.cells.map((c) => c.text)), [
    ['bonī', 'bonae', 'bona'], ['bonōrum', 'bonārum', 'bonōrum'], ['bonīs', 'bonīs', 'bonīs'],
    ['bonōs', 'bonās', 'bona'], ['bonīs', 'bonīs', 'bonīs'], ['bonī', 'bonae', 'bona'],
  ]);
  assert.ok(pos.rows[0].cells[0].hit && !pos.rows[0].cells[1].hit);
  assertForms(p, ['melior', 'melius', 'meliōris', 'meliōrem', 'meliōrēs', 'meliōra', 'meliōrum', 'meliōribus', 'optimus', 'optima', 'optimum', 'optimī', 'optimōrum'], 'bonus degrees');
});

test('ācer ācris ācre (three endings)', () => {
  const e = entry('acer', 'ADJ');
  const p = paradigm(e, [{ case: 'nom', number: 'sg', gender: 'm' }]);
  const pos = p.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pos.rows[0].cells.map((c) => c.text), ['ācer', 'ācris', 'ācre']);
  assert.deepEqual(pos.rows[1].cells.map((c) => c.text), ['ācris', 'ācris', 'ācris']);
  assert.deepEqual(pos.rows[3].cells.map((c) => c.text), ['ācrem', 'ācrem', 'ācre']);
  assert.deepEqual(pos.rows[4].cells.map((c) => c.text), ['ācrī', 'ācrī', 'ācrī']);
  assert.deepEqual(pos.rows[6].cells.map((c) => c.text), ['ācrēs', 'ācrēs', 'ācria']);
  assert.deepEqual(pos.rows[7].cells.map((c) => c.text), ['ācrium', 'ācrium', 'ācrium']);
  assertForms(p, ['ācrior', 'ācrius', 'ācerrimus'], 'acer degrees');
});

// Whitaker hands us fōrmōs- for the positive but formosi- / formōsissi- for the
// degrees; the book prints fōrmōsissimus. A degree stem never changes the
// quantity of the stem it is built on, so the macrons are filled back in.
test('a comparative or superlative keeps the macrons of its own stem', () => {
  const cases = [['formosus', ['fōrmōsior', 'fōrmōsissimus', 'fōrmōsissimum']],
                 ['clarus', ['clārior', 'clārissimus']],
                 ['ater', ['ātrior']],
                 ['infelix', ['īnfēlīcior', 'īnfēlīcissimus']],
                 ['rectus', ['rēctior', 'rēctissimus']]];
  for (const [h, want] of cases) assertForms(paradigm(entry(h, 'ADJ'), []), want, `${h} degrees`);
  // never the other way round: serus has no macron, sērior keeps its own
  const serus = paradigm(entry('serus', 'ADJ'), []);
  assertForms(serus, ['sērior'], 'serus comparative');
});

// The book prints ārdēre / ārdentem and pārēre / pāret; Whitaker's stems lost
// the long vowel, and latēre / fatērī were given one they never had.
test('second-conjugation stems the glossary mis-macronised', () => {
  const ardeo = paradigm(entry('ardeo', 'VPAR'), []);
  assertForms(ardeo, ['ārdeō', 'ārdēre', 'ārdet', 'ārdēns'], 'ardeo');
  assertForms(paradigm(entry('pareo', 'V'), []), ['pāreō', 'pārēre', 'pāret'], 'pareo');
  const lateo = [...texts(paradigm(entry('lateo', 'V'), []))];
  assert.ok(lateo.includes('latēre') && !lateo.includes('lātēre'), 'lateo keeps a short a');
});

test('fēlīx (one ending) and ingēns', () => {
  const felix = paradigm(entry('felix', 'ADJ'), [{ case: 'nom', number: 'sg' }]);
  const pos = felix.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pos.rows[0].cells.map((c) => c.text), ['fēlīx', 'fēlīx', 'fēlīx']);
  assert.deepEqual(pos.rows[1].cells.map((c) => c.text), ['fēlīcis', 'fēlīcis', 'fēlīcis']);
  assert.deepEqual(pos.rows[3].cells.map((c) => c.text), ['fēlīcem', 'fēlīcem', 'fēlīx']);
  assert.deepEqual(pos.rows[4].cells.map((c) => c.text), ['fēlīcī', 'fēlīcī', 'fēlīcī']);
  assert.deepEqual(pos.rows[6].cells.map((c) => c.text), ['fēlīcēs', 'fēlīcēs', 'fēlīcia']);
  assert.deepEqual(pos.rows[7].cells.map((c) => c.text), ['fēlīcium', 'fēlīcium', 'fēlīcium']);
  // gender unknown in the parse → nominative singular lights all three genders
  assert.ok(pos.rows[0].cells.every((c) => c.hit));
  const ingens = paradigm(entry('ingens', 'ADJ'), []);
  assertForms(ingens, ['ingēns', 'ingentis', 'ingentī', 'ingentem', 'ingentēs', 'ingentia', 'ingentium', 'ingentibus'], 'ingens');
});

test('uterque and plērīque carry their fixed -que through the table', () => {
  // build_glossary folds uter + -que into one lemma but keeps Whitaker's bare
  // roots (uter- / utr-, plēr-), so the table hangs -que back on every cell, the
  // way the quisque table does. Allen & Greenough §151.a (uterque, utraque,
  // utrumque, utrīusque, utrīque) and §151.b (plērīque, plēraeque, plēraque);
  // Ørberg lists uterque among the prōnōmina indēfīnīta in cap. XXXV but prints
  // no table for it.
  const uterque = paradigm(entry('uterque', 'ADJ'), []);
  const pos = uterque.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pos.rows[0].cells.map((c) => c.text), ['uterque', 'utraque', 'utrumque']);
  assert.deepEqual(pos.rows[1].cells.map((c) => c.text), ['utrīusque', 'utrīusque', 'utrīusque']);
  assert.deepEqual(pos.rows[2].cells.map((c) => c.text), ['utrīque', 'utrīque', 'utrīque']);
  assert.deepEqual(pos.rows[3].cells.map((c) => c.text), ['utrumque', 'utramque', 'utrumque']);
  assert.deepEqual(pos.rows[4].cells.map((c) => c.text), ['utrōque', 'utrāque', 'utrōque']);
  assert.deepEqual(pos.rows[7].cells.map((c) => c.text), ['utrōrumque', 'utrārumque', 'utrōrumque']);
  assert.ok(!texts(uterque).has('uter'), 'uterque must not decline as bare uter');

  const plerique = paradigm(entry('plerique', 'ADJ'), []);
  const pp = plerique.sections.find((s) => s.title === 'positive');
  assert.deepEqual(pp.rows[6].cells.map((c) => c.text), ['plērīque', 'plēraeque', 'plēraque']);
  assert.deepEqual(pp.rows[7].cells.map((c) => c.text), ['plērōrumque', 'plērārumque', 'plērōrumque']);
  assert.deepEqual(pp.rows[8].cells.map((c) => c.text), ['plērīsque', 'plērīsque', 'plērīsque']);
  assert.equal(pp.rows[3].cells[2].text, 'plērumque');    // plērumque = mostly
  assert.ok(!texts(plerique).has('plērus'));
});

// --- verbs -----------------------------------------------------------------

const VERBS = {
  amo: {
    'present indicative': [['amō', 'amās', 'amat', 'amāmus', 'amātis', 'amant'], ['amor', 'amāris', 'amātur', 'amāmur', 'amāminī', 'amantur']],
    'imperfect indicative': [['amābam', 'amābās', 'amābat', 'amābāmus', 'amābātis', 'amābant'], ['amābar', 'amābāris', 'amābātur', 'amābāmur', 'amābāminī', 'amābantur']],
    'future indicative': [['amābō', 'amābis', 'amābit', 'amābimus', 'amābitis', 'amābunt'], ['amābor', 'amāberis', 'amābitur', 'amābimur', 'amābiminī', 'amābuntur']],
    'perfect indicative': [['amāvī', 'amāvistī', 'amāvit', 'amāvimus', 'amāvistis', 'amāvērunt'], ['amātus sum', 'amātus es', 'amātus est', 'amātī sumus', 'amātī estis', 'amātī sunt']],
    'pluperfect indicative': [['amāveram', 'amāverās', 'amāverat', 'amāverāmus', 'amāverātis', 'amāverant']],
    'future perfect indicative': [['amāverō', 'amāveris', 'amāverit', 'amāverimus', 'amāveritis', 'amāverint']],
    'present subjunctive': [['amem', 'amēs', 'amet', 'amēmus', 'amētis', 'ament'], ['amer', 'amēris', 'amētur', 'amēmur', 'amēminī', 'amentur']],
    'imperfect subjunctive': [['amārem', 'amārēs', 'amāret', 'amārēmus', 'amārētis', 'amārent']],
    'perfect subjunctive': [['amāverim', 'amāverīs', 'amāverit', 'amāverīmus', 'amāverītis', 'amāverint']],
    'pluperfect subjunctive': [['amāvissem', 'amāvissēs', 'amāvisset', 'amāvissēmus', 'amāvissētis', 'amāvissent']],
    extra: ['amā', 'amāte', 'amāre', 'amārī', 'amāvisse', 'amātus esse', 'amātūrus esse', 'amātum īrī', 'amāns', 'amātus -a -um', 'amātūrus -a -um', 'amandus -a -um', 'amandī', 'amandum', 'amātum', 'amātū'],
  },
  moneo: {
    'present indicative': [['moneō', 'monēs', 'monet', 'monēmus', 'monētis', 'monent'], ['moneor', 'monēris', 'monētur', 'monēmur', 'monēminī', 'monentur']],
    'imperfect indicative': [['monēbam', 'monēbās', 'monēbat', 'monēbāmus', 'monēbātis', 'monēbant']],
    'future indicative': [['monēbō', 'monēbis', 'monēbit', 'monēbimus', 'monēbitis', 'monēbunt']],
    'perfect indicative': [['monuī', 'monuistī', 'monuit', 'monuimus', 'monuistis', 'monuērunt'], ['monitus sum', 'monitus es', 'monitus est', 'monitī sumus', 'monitī estis', 'monitī sunt']],
    'present subjunctive': [['moneam', 'moneās', 'moneat', 'moneāmus', 'moneātis', 'moneant']],
    'imperfect subjunctive': [['monērem', 'monērēs', 'monēret', 'monērēmus', 'monērētis', 'monērent']],
    extra: ['monē', 'monēte', 'monēre', 'monērī', 'monēns', 'monendus -a -um'],
  },
  rego: {
    'present indicative': [['regō', 'regis', 'regit', 'regimus', 'regitis', 'regunt'], ['regor', 'regeris', 'regitur', 'regimur', 'regiminī', 'reguntur']],
    'imperfect indicative': [['regēbam', 'regēbās', 'regēbat', 'regēbāmus', 'regēbātis', 'regēbant']],
    'future indicative': [['regam', 'regēs', 'reget', 'regēmus', 'regētis', 'regent'], ['regar', 'regēris', 'regētur', 'regēmur', 'regēminī', 'regentur']],
    'perfect indicative': [['rēxī', 'rēxistī', 'rēxit', 'rēximus', 'rēxistis', 'rēxērunt'], ['rēctus sum', 'rēctus es', 'rēctus est', 'rēctī sumus', 'rēctī estis', 'rēctī sunt']],
    'present subjunctive': [['regam', 'regās', 'regat', 'regāmus', 'regātis', 'regant']],
    'imperfect subjunctive': [['regerem', 'regerēs', 'regeret', 'regerēmus', 'regerētis', 'regerent'], ['regerer', 'regerēris', 'regerētur', 'regerēmur', 'regerēminī', 'regerentur']],
    extra: ['rege', 'regite', 'regere', 'regī', 'rēxisse', 'regēns', 'regendus -a -um', 'regendī'],
  },
  capio: {
    'present indicative': [['capiō', 'capis', 'capit', 'capimus', 'capitis', 'capiunt'], ['capior', 'caperis', 'capitur', 'capimur', 'capiminī', 'capiuntur']],
    'imperfect indicative': [['capiēbam', 'capiēbās', 'capiēbat', 'capiēbāmus', 'capiēbātis', 'capiēbant']],
    'future indicative': [['capiam', 'capiēs', 'capiet', 'capiēmus', 'capiētis', 'capient']],
    'perfect indicative': [['cēpī', 'cēpistī', 'cēpit', 'cēpimus', 'cēpistis', 'cēpērunt'], ['captus sum', 'captus es', 'captus est', 'captī sumus', 'captī estis', 'captī sunt']],
    'present subjunctive': [['capiam', 'capiās', 'capiat', 'capiāmus', 'capiātis', 'capiant']],
    'imperfect subjunctive': [['caperem', 'caperēs', 'caperet', 'caperēmus', 'caperētis', 'caperent']],
    extra: ['cape', 'capite', 'capere', 'capī', 'capiēns', 'capiendus -a -um', 'capiendī'],
  },
  audio: {
    'present indicative': [['audiō', 'audīs', 'audit', 'audīmus', 'audītis', 'audiunt'], ['audior', 'audīris', 'audītur', 'audīmur', 'audīminī', 'audiuntur']],
    'imperfect indicative': [['audiēbam', 'audiēbās', 'audiēbat', 'audiēbāmus', 'audiēbātis', 'audiēbant']],
    'future indicative': [['audiam', 'audiēs', 'audiet', 'audiēmus', 'audiētis', 'audient']],
    'perfect indicative': [['audīvī', 'audīvistī', 'audīvit', 'audīvimus', 'audīvistis', 'audīvērunt'], ['audītus sum', 'audītus es', 'audītus est', 'audītī sumus', 'audītī estis', 'audītī sunt']],
    'present subjunctive': [['audiam', 'audiās', 'audiat', 'audiāmus', 'audiātis', 'audiant']],
    'imperfect subjunctive': [['audīrem', 'audīrēs', 'audīret', 'audīrēmus', 'audīrētis', 'audīrent']],
    extra: ['audī', 'audīte', 'audīre', 'audīrī', 'audiēns', 'audiendus -a -um'],
  },
};

for (const [h, tbl] of Object.entries(VERBS)) {
  test(`verb ${h} conjugates like Ørberg's table`, () => {
    const e = entry(h, 'V');
    const p = paradigm(e, []);
    assert.equal(p.kind, 'verb');
    for (const [title, cols] of Object.entries(tbl)) {
      if (title === 'extra') { assertForms(p, cols, h); continue; }
      cols.forEach((col, i) => assert.deepEqual(column(p, title, i), col, `${h} ${title} col ${i}`));
    }
    // learner order of sections
    const titles = p.sections.map((s) => s.title);
    assert.deepEqual(titles.slice(0, 10), ['present indicative', 'imperfect indicative', 'future indicative', 'perfect indicative', 'pluperfect indicative', 'future perfect indicative', 'present subjunctive', 'imperfect subjunctive', 'perfect subjunctive', 'pluperfect subjunctive']);
    assert.deepEqual(titles.slice(10), ['imperative', 'infinitives', 'participles', 'gerund', 'supine']);
    assert.deepEqual(p.sections[0].headers, ['active', 'passive']);
  });
}

test('deponents: sequor, loquor, proficīscor show passive forms with active labels', () => {
  const seq = paradigm(entry('sequor', 'V'), [{ tense: 'pres', voice: 'pass', mood: 'imper', person: 2, number: 'pl' }]);
  assert.deepEqual(column(seq, 'present indicative', 0), ['sequor', 'sequeris', 'sequitur', 'sequimur', 'sequiminī', 'sequuntur']);
  assert.equal(seq.sections[0].headers.length, 1);
  assert.equal(seq.sections[0].headers[0], 'deponent');
  assert.deepEqual(column(seq, 'perfect indicative', 0), ['secūtus sum', 'secūtus es', 'secūtus est', 'secūtī sumus', 'secūtī estis', 'secūtī sunt']);
  assert.deepEqual(column(seq, 'imperative', 0), ['sequere', 'sequiminī']);
  assertForms(seq, ['sequī', 'secūtus esse', 'secūtūrus esse', 'sequēns', 'secūtus -a -um', 'secūtūrus -a -um', 'sequendus -a -um', 'sequendī', 'sequar', 'sequerer', 'sequēbar'], 'sequor');
  assert.match(seq.note, /Deponent/);
  const hit = seq.sections.find((s) => s.title === 'imperative').rows.flatMap((r) => r.cells).find((c) => c.hit);
  assert.equal(hit.text, 'sequiminī');
  const loq = paradigm(entry('loquor', 'V'), []);
  assertForms(loq, ['loquor', 'loqueris', 'loquitur', 'loquimur', 'loquiminī', 'loquuntur', 'locūtus sum', 'loquere', 'loquī', 'loquēns'], 'loquor');
  const prof = paradigm(entry('proficiscor', 'V'), []);
  assertForms(prof, ['proficīscor', 'proficīsceris', 'proficīscitur', 'profectus sum', 'proficīscere', 'proficīscī', 'proficīscēns'], 'proficiscor');
});

test('irregular verbs: sum, possum, eō, ferō, volō', () => {
  const sum = paradigm(entry('sum', 'V'), [{ tense: 'pres', voice: 'act', mood: 'ind', person: 3, number: 'sg' }]);
  assert.deepEqual(column(sum, 'present indicative', 0), ['sum', 'es', 'est', 'sumus', 'estis', 'sunt']);
  assert.deepEqual(column(sum, 'imperfect indicative', 0), ['eram', 'erās', 'erat', 'erāmus', 'erātis', 'erant']);
  assert.deepEqual(column(sum, 'future indicative', 0), ['erō', 'eris', 'erit', 'erimus', 'eritis', 'erunt']);
  assert.deepEqual(column(sum, 'perfect indicative', 0), ['fuī', 'fuistī', 'fuit', 'fuimus', 'fuistis', 'fuērunt']);
  assert.deepEqual(column(sum, 'present subjunctive', 0), ['sim', 'sīs', 'sit', 'sīmus', 'sītis', 'sint']);
  assert.deepEqual(column(sum, 'imperfect subjunctive', 0), ['essem', 'essēs', 'esset', 'essēmus', 'essētis', 'essent']);
  assertForms(sum, ['es', 'este', 'esse', 'fuisse', 'futūrus esse', 'fueram', 'fuerō', 'fuerim', 'fuissem'], 'sum');
  const est = column(sum, 'present indicative', 0)[2];
  assert.equal(est, 'est');
  assert.ok(sum.sections[0].rows[2].cells[0].hit);
  assert.deepEqual([sum.sections[0].rows[2].cells[0].stem, sum.sections[0].rows[2].cells[0].ending], ['es', 't']);

  const possum = paradigm(entry('possum', 'V'), []);
  assert.deepEqual(column(possum, 'present indicative', 0), ['possum', 'potes', 'potest', 'possumus', 'potestis', 'possunt']);
  assert.deepEqual(column(possum, 'imperfect indicative', 0), ['poteram', 'poterās', 'poterat', 'poterāmus', 'poterātis', 'poterant']);
  assert.deepEqual(column(possum, 'present subjunctive', 0), ['possim', 'possīs', 'possit', 'possīmus', 'possītis', 'possint']);
  assert.deepEqual(column(possum, 'imperfect subjunctive', 0), ['possem', 'possēs', 'posset', 'possēmus', 'possētis', 'possent']);
  assertForms(possum, ['potuī', 'posse', 'potuisse', 'poterō'], 'possum');

  // the headword alone is ambiguous: pick the lexeme whose category owns the table
  const eo = paradigm(entry('eo', 'V', (e) => e.cat?.[0] === 6), []);
  assert.deepEqual(column(eo, 'present indicative', 0), ['eō', 'īs', 'it', 'īmus', 'ītis', 'eunt']);
  assert.deepEqual(column(eo, 'imperfect indicative', 0), ['ībam', 'ībās', 'ībat', 'ībāmus', 'ībātis', 'ībant']);
  assert.deepEqual(column(eo, 'future indicative', 0), ['ībō', 'ībis', 'ībit', 'ībimus', 'ībitis', 'ībunt']);
  assert.deepEqual(column(eo, 'perfect indicative', 0), ['iī', 'īstī', 'iit', 'iimus', 'īstis', 'iērunt']);
  assert.deepEqual(column(eo, 'present subjunctive', 0), ['eam', 'eās', 'eat', 'eāmus', 'eātis', 'eant']);
  assert.deepEqual(column(eo, 'imperfect subjunctive', 0), ['īrem', 'īrēs', 'īret', 'īrēmus', 'īrētis', 'īrent']);
  assertForms(eo, ['ī', 'īte', 'īre', 'īsse', 'eundī', 'itum'], 'eo');

  const fero = paradigm(entry('fero', 'V'), []);
  assert.deepEqual(column(fero, 'present indicative', 0), ['ferō', 'fers', 'fert', 'ferimus', 'fertis', 'ferunt']);
  assert.deepEqual(column(fero, 'present indicative', 1), ['feror', 'ferris', 'fertur', 'ferimur', 'feriminī', 'feruntur']);
  assert.deepEqual(column(fero, 'perfect indicative', 0), ['tulī', 'tulistī', 'tulit', 'tulimus', 'tulistis', 'tulērunt']);
  assert.deepEqual(column(fero, 'perfect indicative', 1), ['lātus sum', 'lātus es', 'lātus est', 'lātī sumus', 'lātī estis', 'lātī sunt']);
  assert.deepEqual(column(fero, 'imperfect subjunctive', 0), ['ferrem', 'ferrēs', 'ferret', 'ferrēmus', 'ferrētis', 'ferrent']);
  assertForms(fero, ['fer', 'ferte', 'ferre', 'ferrī', 'tulisse', 'lātus esse', 'ferēns', 'lātus -a -um', 'lātūrus -a -um', 'ferendus -a -um'], 'fero');

  const volo = paradigm(entry('volo', 'V', (e) => e.cat?.[0] === 6), []);
  assert.deepEqual(column(volo, 'present indicative', 0), ['volō', 'vīs', 'vult', 'volumus', 'vultis', 'volunt']);
  assert.deepEqual(column(volo, 'present subjunctive', 0), ['velim', 'velīs', 'velit', 'velīmus', 'velītis', 'velint']);
  assert.deepEqual(column(volo, 'imperfect subjunctive', 0), ['vellem', 'vellēs', 'vellet', 'vellēmus', 'vellētis', 'vellent']);
  assertForms(volo, ['voluī', 'velle', 'voluisse', 'volēns', 'volēbam', 'volam'], 'volo');
});

test('nōlō, mālō, fīō hand tables', () => {
  const nolo = paradigm(entry('nolo', 'V'), []);
  assertForms(nolo, ['nōlō', 'nōn vīs', 'nōn vult', 'nōlumus', 'nōlunt', 'nōlī', 'nōlīte', 'nōlle', 'nōlim', 'nōllem', 'nōluī'], 'nolo');
  const malo = paradigm(entry('malo', 'V'), []);
  assertForms(malo, ['mālō', 'māvīs', 'māvult', 'mālumus', 'mālunt', 'mālle', 'mālim', 'māllem', 'māluī'], 'malo');
  const fio = paradigm(entry('fio', 'V', (e) => e.cat?.[0] === 3), []);
  assertForms(fio, ['fīō', 'fīs', 'fit', 'fīmus', 'fītis', 'fīunt', 'fīēbam', 'fīam', 'factus sum', 'fierem', 'fierī', 'factus -a -um'], 'fio');
});

test('a hand table belongs to its category, not to its headword alone', () => {
  // volō volāre "fly" is Ørberg's cap. X (avēs in āere volant, volāre nōn
  // possum) and Whitaker's V 1 1; volō velle is V 6 2. Same headword, two verbs.
  const fly = paradigm(entry('volo', 'V', (e) => e.cat?.[0] === 1), []);
  assert.ok(fly.title.endsWith('1st conjugation'), fly.title);
  assert.deepEqual(column(fly, 'present indicative', 0), ['volō', 'volās', 'volat', 'volāmus', 'volātis', 'volant']);
  assert.deepEqual(column(fly, 'imperfect indicative', 0), ['volābam', 'volābās', 'volābat', 'volābāmus', 'volābātis', 'volābant']);
  assert.deepEqual(column(fly, 'future indicative', 0), ['volābō', 'volābis', 'volābit', 'volābimus', 'volābitis', 'volābunt']);
  const flying = texts(fly);
  for (const wrong of ['vult', 'vīs', 'velle', 'velim', 'vellem']) assert.ok(!flying.has(wrong), `volāre must not print ${wrong}`);

  // Whitaker's ghost 1st-conjugation eō (eāre, ēvī, etum) collides the same way
  const ghost = paradigm({ lemma: 'eō, īre, iī, itum', h: 'eo', pos: 'V', cat: [1, 1], roots: ['e', 'e', 'ēv', 'et'] }, []);
  assert.ok(ghost.title.endsWith('1st conjugation'), ghost.title);
  assert.ok(!texts(ghost).has('ībat'));

  // a hand supplement carries no category: the headword is all we have to go on
  const bare = paradigm({ lemma: 'fīō, fierī, factus sum', h: 'fio', pos: 'V', roots: [] }, []);
  assertForms(bare, ['fierem', 'fierī'], 'fio (no category)');
});

test('prōsum keeps its d before a vowel: prōdest / prōsunt', () => {
  // Ørberg, cap. XXVII, margin: "prōd-esse prō-fuisse", "prōd-est prō-sunt".
  // The whole table is Allen & Greenough §204.
  const p = paradigm(entry('prosum', 'V'), []);
  assert.deepEqual(column(p, 'present indicative', 0), ['prōsum', 'prōdes', 'prōdest', 'prōsumus', 'prōdestis', 'prōsunt']);
  assert.deepEqual(column(p, 'imperfect indicative', 0), ['prōderam', 'prōderās', 'prōderat', 'prōderāmus', 'prōderātis', 'prōderant']);
  assert.deepEqual(column(p, 'future indicative', 0), ['prōderō', 'prōderis', 'prōderit', 'prōderimus', 'prōderitis', 'prōderunt']);
  assert.deepEqual(column(p, 'perfect indicative', 0), ['prōfuī', 'prōfuistī', 'prōfuit', 'prōfuimus', 'prōfuistis', 'prōfuērunt']);
  assert.deepEqual(column(p, 'present subjunctive', 0), ['prōsim', 'prōsīs', 'prōsit', 'prōsīmus', 'prōsītis', 'prōsint']);
  assert.deepEqual(column(p, 'imperfect subjunctive', 0), ['prōdessem', 'prōdessēs', 'prōdesset', 'prōdessēmus', 'prōdessētis', 'prōdessent']);
  assertForms(p, ['prōdesse', 'prōfuisse', 'prōdes', 'prōdeste', 'prōdestō', 'prōfutūrus -a -um'], 'prosum');
  // the d is prō-'s alone
  const absum = paradigm(Object.values(glossary).flat().find((e) => e.h === 'absum' && e.pos === 'V'), []);
  assert.deepEqual(column(absum, 'present indicative', 0), ['absum', 'abes', 'abest', 'absumus', 'abestis', 'absunt']);
});

test('the table gaps Ørberg fills: fore, īrī, factūrus, factum', () => {
  // fore = futūrum esse (Ørberg cap. XXXIII margin: "fore (īnf fut) =
  // futūrum/-am … esse"; Allen & Greenough §170.b)
  const sum = paradigm(entry('sum', 'V'), []);
  assertForms(sum, ['fore', 'futūrus esse', 'futūrus esse / fore'], 'sum');
  // "'laudātum īrī' … quī ex supīnō et 'īrī' cōnstat" (Ørberg cap. XXIII)
  const eo = paradigm(entry('eo', 'V', (e) => e.cat?.[0] === 6), []);
  const inf = eo.sections.find((s) => s.title === 'infinitives');
  assert.deepEqual(inf.headers, ['active', 'passive']);
  assert.deepEqual(inf.rows[0].cells.map((c) => c.text), ['īre', 'īrī']);
  // fīō borrows faciō's fourth principal part (Allen & Greenough §204.b)
  const fio = paradigm(entry('fio', 'V', (e) => e.cat?.[0] === 3), []);
  assertForms(fio, ['factūrus -a -um', 'factum', 'factū', 'factum īrī'], 'fio');
});

test('compounds of eō and sum reuse the irregular tables', () => {
  const abeo = glossary['abiit']?.find((e) => e.h === 'abeo') || glossary['abire']?.find((e) => e.h === 'abeo');
  if (abeo) {
    const p = paradigm(abeo, []);
    assertForms(p, ['abeō', 'abīs', 'abit', 'abībam', 'abiī', 'abīre', 'abī'], 'abeo');
  }
  const absum = Object.values(glossary).flat().find((e) => e.h === 'absum');
  if (absum) {
    const p = paradigm(absum, []);
    assertForms(p, ['absum', 'abes', 'abest', 'aberam', 'abesse'], 'absum');
  }
});

// --- pronouns --------------------------------------------------------------

test('pronoun hand tables: is, hic, ille, ipse, īdem, quī, quis, ego, tū, sē', () => {
  const is = paradigm(entry('is', 'PRON'), [{ case: 'gen', number: 'sg', gender: 'm' }]);
  assert.equal(is.kind, 'pronoun');
  assertForms(is, ['is', 'ea', 'id', 'eius', 'eī', 'eum', 'eam', 'eō', 'eā', 'iī', 'eae', 'eōrum', 'eārum', 'iīs', 'eōs', 'eās'], 'is');
  assert.ok(is.sections[0].rows[1].cells[0].hit);
  const hic = paradigm(entry('hic', 'PRON'), []);
  assertForms(hic, ['hic', 'haec', 'hoc', 'huius', 'huic', 'hunc', 'hanc', 'hōc', 'hāc', 'hī', 'hae', 'hōrum', 'hārum', 'hīs', 'hōs', 'hās'], 'hic');
  const ille = paradigm(entry('ille', 'PRON'), []);
  assertForms(ille, ['ille', 'illa', 'illud', 'illīus', 'illī', 'illum', 'illam', 'illō', 'illā', 'illae', 'illōrum', 'illīs', 'illōs'], 'ille');
  const ipse = paradigm(entry('ipse', 'PRON'), []);
  assertForms(ipse, ['ipse', 'ipsa', 'ipsum', 'ipsīus', 'ipsī', 'ipsō', 'ipsōrum'], 'ipse');
  const idem = paradigm(entry('idem', 'PRON'), []);
  assertForms(idem, ['īdem', 'eadem', 'idem', 'eiusdem', 'eīdem', 'eundem', 'eandem', 'eōdem', 'eādem', 'eōrundem', 'eīsdem'], 'idem');
  const qui = paradigm(entry('qui', 'PRON'), [{ case: 'nom', number: 'sg', gender: 'm' }]);
  assertForms(qui, ['quī', 'quae', 'quod', 'cuius', 'cui', 'quem', 'quam', 'quō', 'quā', 'quōrum', 'quārum', 'quibus', 'quōs', 'quās'], 'qui');
  assert.ok(qui.sections[0].rows[0].cells[0].hit);
  const quis = paradigm(entry('quis', 'PRON'), []);
  assertForms(quis, ['quis', 'quid', 'cuius', 'cui', 'quem', 'quō'], 'quis');
  const ego = paradigm(entry('ego', 'PRON'), [{ case: 'dat', number: 'sg' }]);
  assertForms(ego, ['ego', 'meī', 'mihi', 'mē', 'nōs', 'nostrum', 'nōbīs'], 'ego');
  assert.ok(ego.sections[0].rows[2].cells[0].hit);
  const tu = paradigm(entry('tu', 'PRON'), []);
  assertForms(tu, ['tū', 'tuī', 'tibi', 'tē', 'vōs', 'vestrum', 'vōbīs'], 'tu');
  const se = paradigm(entry('se', 'PRON'), []);
  assertForms(se, ['suī', 'sibi', 'sē', 'sēsē'], 'se');
});

test('suus declines like bonus', () => {
  const e = entry('suus', 'ADJ');
  const p = paradigm(e, [{ case: 'acc', number: 'sg', gender: 'f' }]);
  assertForms(p, ['suus', 'sua', 'suum', 'suī', 'suae', 'suō', 'suam', 'suā', 'suōrum', 'suārum', 'suīs', 'suōs', 'suās'], 'suus');
  const pos = p.sections[0];
  assert.ok(pos.rows[3].cells[1].hit && !pos.rows[3].cells[0].hit);
});

test('indeclinables and function words produce no table', () => {
  const ut = Object.values(glossary).flat().find((e) => e.pos === 'CONJ');
  assert.equal(paradigm(ut, []), null);
  assert.equal(paradigm(null, []), null);
});

test('conjugationName distinguishes -iō verbs of the 3rd conjugation', () => {
  assert.equal(conjugationName(entry('capio', 'V')), '3rd conjugation (-iō)');
  assert.equal(conjugationName(entry('facio', 'V')), '3rd conjugation (-iō)');
  assert.equal(conjugationName(entry('mitto', 'V')), '3rd conjugation');
  assert.equal(conjugationName(entry('rego', 'V')), '3rd conjugation');
  assert.equal(conjugationName(entry('amo', 'V')), '1st conjugation');
  assert.equal(conjugationName(entry('audio', 'V')), '4th conjugation');
});

test('verb table headers are short enough for a phone panel; alternates and empty cells survive', () => {
  const sequor = paradigm(entry('sequor', 'V'), []);
  for (const sec of sequor.sections) for (const h of sec.headers) assert.ok(h.length <= 14, `header too long: ${h}`);
  assert.ok(sequor.sections[0].headers.includes('deponent'));
  assert.match(sequor.note, /active meanings/);
  const amo = paradigm(entry('amo', 'V'), []);
  assert.deepEqual(amo.sections[0].headers, ['active', 'passive']);
  const is = paradigm(entry('is', 'PRON'), []);
  const cells = is.sections.flatMap((s) => s.rows.flatMap((r) => r.cells));
  assert.ok(cells.some((c) => c.alt), 'is keeps eī / iī alternates');
  const se = paradigm(entry('se', 'PRON'), []);
  assert.ok(se.sections[0].rows[0].cells[0].empty, 'sē has an empty nominative cell');
});

// --- number: plūrālia tantum, and the words with no plural ------------------
//
// qa/grammar/QA-NAV-SESSION.md M1: the very first item of the first chapter
// session was "Give the dative singular of Athēniēnsēs", a word the dictionary
// line itself marks `m pl`. The table invented a whole singular column, whose
// nominative and vocative were the plural form over again, and the chart drill
// then asked the learner for it. A word used only in one number now gets only
// that number's column — the missing cells are never built, so no generator can
// reach them — exactly as the vulgus type has always printed no plural.
//
// Every word below was read against Ørberg's own vocabulary; the chapter and
// line after each is Familia Romana's Index vocābulōrum unless said otherwise.

const numberOf = (p) => p.sections[0].headers;
const rowOf = (p, label) => p.sections[0].rows.find((r) => r.label === label).cells.map((c) => c.text);
const allCells = (p) => p.sections.flatMap((s) => s.rows.flatMap((r) => r.cells));

test('plūrālia tantum print no singular at all — Ørberg gives them no singular head', () => {
  //  Alpēs        the margin gloss reads "Alpēs -ium f pl: montēs…"
  //  castra       Index: castra -ōrum n 12.93
  //  moenia       Index: moenia -ium n 25.11
  //  Athēniēnsēs  the project's own name list, "Athēniēnsēs Athēniēnsium m pl"
  const cases = [
    ['alpes', 'Alpēs', ['Alpēs', 'Alpium', 'Alpibus', 'Alpēs', 'Alpibus', 'Alpēs']],
    ['castrum', 'castra', ['castra', 'castrōrum', 'castrīs', 'castra', 'castrīs', 'castra']],
    ['moene', 'moenia', ['moenia', 'moenium', 'moenibus', 'moenia', 'moenibus', 'moenia']],
    ['athenienses', 'Athēniēnsēs', ['Athēniēnsēs', 'Athēniēnsium', 'Athēniēnsibus', 'Athēniēnsēs', 'Athēniēnsibus', 'Athēniēnsēs']],
  ];
  for (const [h, head, forms] of cases) {
    const p = paradigm(entry(h, 'N'), []);
    assert.deepEqual(numberOf(p), ['plural'], `${head}: one column, and it is the plural`);
    assert.deepEqual(p.sections[0].rows.map((r) => r.cells[0].text), forms, head);
    for (const r of p.sections[0].rows) {
      assert.equal(r.cells.length, 1, `${head}: no second column to ask about`);
      assert.equal(r.cells[0].key.number, 'pl', `${head}: every cell is a plural`);
    }
    assert.match(p.note, /^Used only in the plural — /, `${head}: the table says so`);
    assert.match(p.note, /no singular/, head);
  }
});

test('the fabricated nominative and vocative singular are gone, not merely relabelled', () => {
  // The old table read "nominative Athēniēnsēs | Athēniēnsēs" beside a genitive
  // singular Athēniēnsis: a singular column that contradicted itself.
  for (const h of ['alpes', 'athenienses', 'phaeaces']) {
    const p = paradigm(entry(h, 'N'), []);
    assert.deepEqual(allCells(p).filter((c) => c.key?.number === 'sg'), [], `${h}: not one singular cell survives`);
  }
});

test('a plural-only table still marks the cell a parse names, and marks no other', () => {
  const p = paradigm(entry('castrum', 'N'), [{ case: 'acc', number: 'pl', gender: 'n' }]);
  assert.deepEqual(p.sections[0].rows.filter((r) => r.cells[0].hit).map((r) => r.label), ['accusative']);
});

test("Ørberg's other plūrālia tantum come out plural too, each on his own vocabulary", () => {
  // Index vocābulōrum: arma -ōrum n 12.34 · līberī -ōrum m 2.21 ·
  // dīvitiae -ārum f 29.27 · tenebrae -ārum f 34.83 · kalendae -ārum f 13.57 ·
  // nōnae -ārum f pl 13.69 · cūnae -ārum f 20.2 · dēliciae -ārum f 34.87 ·
  // nūgae -ārum f 31.198 · frūgēs -um f 27.29 · viscera -um n 11.22.
  const want = {
    armum: 'arma', liber: 'līberī', divitia: 'dīvitiae', tenebra: 'tenebrae',
    kalenda: 'kalendae', nona: 'nōnae', cuna: 'cūnae', delicia: 'dēliciae',
    nuga: 'nūgae', frux: 'frūgēs', viscus: 'viscera',
  };
  for (const [h, nom] of Object.entries(want)) {
    const p = paradigm(entry(h, 'N'), []);
    assert.deepEqual(numberOf(p), ['plural'], h);
    assert.equal(p.sections[0].rows[0].cells[0].text, nom, h);
  }
});

test("Whitaker's plural marker on a LATER sense is not the lemma's: aqua and hortus keep both numbers", () => {
  // aqua "rain, rainfall (in the plural)", hortus "park (in the plural)",
  // littera "(in the plural) letter, epistle" — a plural-only *meaning*, not a
  // plural-only word. Only the head sense decides.
  for (const h of ['aqua', 'hortus', 'littera']) {
    assert.deepEqual(numberOf(paradigm(entry(h, 'N'), [])), ['singular', 'plural'], h);
  }
});

test('Ørberg overrules Whitaker where Whitaker files two words under one headword', () => {
  // gena -ae f 11.8 and lectus -ī m 10.125 are singulars in Ørberg's own index;
  // Whitaker glosses them "cheeks (in the plural)" and "chosen … men (in the
  // plural) / bed, couch, lounge". The book's word wins.
  for (const h of ['gena', 'lectus']) {
    assert.deepEqual(numberOf(paradigm(entry(h, 'N', (e) => (e.cat || [])[0]), [])), ['singular', 'plural'], h);
  }
});

test('vīs and the vulgus type are untouched: an irregular keeps its own hand table', () => {
  const vis = paradigm(entry('vis', 'N'), []);
  assert.deepEqual(numberOf(vis), ['singular', 'plural']);
  assert.equal(rowOf(vis, 'nominative')[0], 'vīs');
  const virus = paradigm(entry('virus', 'N'), []);
  assert.deepEqual(numberOf(virus), ['singular'], 'the vulgus type still prints no plural');
  assert.match(virus.note, /no plural/);
  assert.equal(nounNumber(entry('vis', 'N')), null, 'an irregular is never flagged');
});

test('the mirror: a name of one person or place is given no plural', () => {
  // Ørberg prints Mārcus, Iūlia, Rōma, Neptūnus and never a plural of any of
  // them; the generator was building Mārcōs, Iūliārum, Rōmīs, Neptūnōrum, and a
  // chart could ask for them. Allen & Greenough, "Defective Nouns": proper
  // names are among the nouns wanting the plural.
  for (const h of ['marcus', 'iulia', 'roma', 'neptunus', 'medus']) {
    const p = paradigm(entry(h, 'N', (e) => e.proper), []);
    assert.deepEqual(numberOf(p), ['singular'], h);
    for (const r of p.sections[0].rows) assert.equal(r.cells[0].key.number, 'sg', h);
    assert.match(p.note, /no plural/, h);
  }
  // aurum: a name of a material — Index vocābulōrum "aurum -ī n 22.15".
  assert.deepEqual(numberOf(paradigm(entry('aurum', 'N', (e) => (e.cat || [])[0] === 2), [])), ['singular']);
});

test('the mirror stops where the course really does print the plural', () => {
  // Measured over the whole library: Rōmānōrum / Rōmānīs / Rōmānōs 34,
  // Germānōrum 27, Graecōrum 16, Christiānōrum 13, Athēniēnsēs 12,
  // Iūdaeōrum 5, nymphārum 4. A name that is also a class keeps its plural.
  for (const h of ['romanus', 'graecus', 'germanus', 'christianus', 'iudaeus', 'nympha', 'musa', 'atheniensis']) {
    assert.deepEqual(numberOf(paradigm(entry(h, 'N', (e) => e.proper), [])), ['singular', 'plural'], h);
  }
});

test('over the whole glossary, no noun table ever keeps a number it has dropped', () => {
  let checked = 0;
  for (const list of Object.values(glossary)) {
    for (const e of list) {
      if (e.pos !== 'N') continue;
      const num = nounNumber(e);
      if (!num) continue;
      const p = paradigm(e, []);
      if (!p) continue;
      const numbers = [...new Set(allCells(p).map((c) => c.key?.number).filter(Boolean))];
      assert.deepEqual(numbers, [num], `${e.lemma}: the table still holds the other number`);
      checked += 1;
    }
  }
  assert.ok(checked > 200, `the sweep found words to check (saw ${checked})`);
});

// --- the generators may never ask for a cell that does not exist -----------
//
// The model is the QA-FINAL B1 sweep ("no item prints its own answer",
// tests/grammar.fix4.test.mjs): drive every skill, every kind and every stage
// over a small library, and assert one invariant over everything that comes
// back. Here the invariant is that an item only ever asks for a form the
// entry's own table really prints — so the chart drill can never again open a
// chapter session with "Give the dative singular of Athēniēnsēs".
//
// app/js/grammar/items.js and stage3.js are read, never written: the guards
// they already carry (`cellMatches` skips an empty cell; `formFor` returns null
// when the parse names no cell) are what make this hold once the cells are gone.

const sweepUnits = [
  { id: 'w12:1.1', la: 'Rōmānī castra pōnunt.' },
  { id: 'w12:1.2', la: 'Mīlitēs in castrīs dormiunt.' },
  { id: 'w12:1.3', la: 'Arma mīlitum in castrīs sunt.' },
  { id: 'w25:1.1', la: 'Moenia urbis alta sunt.' },
  { id: 'w25:1.2', la: 'Servus moenia spectat.' },
  { id: 'w16:1.1', la: 'Mīlitēs trāns Alpēs eunt.' },
  { id: 'w07:1.1', la: 'Athēniēnsēs Thēseō rosās dant.' },
  { id: 'w22:1.1', la: 'Iūlius Mārcō aurum dat.' },
  { id: 'w02:1.1', la: 'Mārcus Iūliae rosam dat.' },
  { id: 'w29:1.1', la: 'Dīvitiae virī magnae sunt.' },
  { id: 'w02:1.2', la: 'Iūlius līberōs suōs amat.' },
];

const bare = (s) => String(s).normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

test("no generated item ever asks for a form the entry's own table does not print", () => {
  setGlossary(glossary);
  const skillIndex = indexSkills(JSON.parse(readFileSync(path.join(here, '..', 'app', 'data', 'grammar', 'skills.json'), 'utf8')));
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const items = createItems({ units: sweepUnits, lookup, paradigm, skills: skillIndex.skills, storage: store(), rand: () => 0.4 });
  const s3 = createStage3({ items, paradigm, rand: () => 0.3 });

  let seen = 0;
  let restricted = 0;
  const check = (it, id) => {
    if (!it) return;
    seen += 1;
    const where = `${id} · ${it.kind} · ${it.entry?.lemma ?? '—'}`;
    if (it.kind === 'chart') {
      const sec = it.chart.table.sections[it.chart.section];
      assert.ok(sec, `${where}: the chart names a section the table has not got`);
      assert.ok(sec.headers.length > it.chart.col, `${where}: column ${it.chart.col} does not exist`);
      for (const c of it.chart.cells) {
        const real = sec.rows[c.row]?.cells[c.col];
        assert.ok(real && !real.empty, `${where}: it asks about a cell the table has not got (row ${c.row}, col ${c.col})`);
        assert.ok((c.answer ?? []).includes(real.text), `${where}: the answer is not that cell's own form`);
      }
    }
    const num = it.entry ? nounNumber(it.entry) : null;
    if (!num) return;
    restricted += 1;
    // Nothing that ASKS about this word may name the number it has not got: the
    // question itself and the label on each answer box.  (A skill's own hint
    // describes the case in general — "nominative: singular -a / -us / -um,
    // plural -ae / -ī / -a" — and is about the ending, not about this lemma, so
    // it is not swept here.)
    const other = num === 'pl' ? /\bsingular\b|\bsg\.\b/ : /\bplural\b|\bpl\.\b/;
    for (const s of [it.prompt?.question, ...(it.chart?.cells ?? []).map((c) => c.label)]) {
      if (typeof s !== 'string') continue;
      assert.ok(!other.test(s), `${where}: it names the ${num === 'pl' ? 'singular' : 'plural'} of a word that has none — "${s}"`);
    }
    // …and every form it accepts is one the table prints.
    const printed = new Set([...texts(paradigm(it.entry, []))].map(bare));
    const asked = it.kind === 'chart' ? it.chart.cells.flatMap((c) => c.answer ?? [])
      : it.kind === 'transform' ? (it.answer ?? []) : [];
    for (const a of asked) assert.ok(printed.has(bare(a)), `${where}: the accepted answer ${a} is not in the table`);
  };
  for (const id of skillIndex.order) {
    if (!items.drillable(id)) continue;
    for (const stage of [1, 2, 3]) {
      for (const kind of ['recognise', 'parse', 'blank', 'chart']) check(items.generate({ skill: id, kind, stage }), id);
      for (const kind of ['transform', 'reorder']) check(s3.generate({ skill: id, kind, stage }), id);
    }
  }
  assert.ok(seen > 50, `the sweep generated items (saw ${seen})`);
  assert.ok(restricted > 20, `and reached the plural-only and name entries (saw ${restricted})`);
});
