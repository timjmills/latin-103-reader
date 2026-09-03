// Paradigm tables checked against Ørberg's Familia Romana tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { paradigm, conjugationName } from '../app/js/paradigms.js';

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

  const eo = paradigm(entry('eo', 'V'), []);
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

  const volo = paradigm(entry('volo', 'V'), []);
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
  const fio = paradigm(entry('fio', 'V'), []);
  assertForms(fio, ['fīō', 'fīs', 'fit', 'fīmus', 'fītis', 'fīunt', 'fīēbam', 'fīam', 'factus sum', 'fierem', 'fierī', 'factus -a -um'], 'fio');
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
