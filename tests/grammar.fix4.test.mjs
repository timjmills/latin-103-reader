// node --test tests/ — the final-fix blockers (qa/grammar/QA-FINAL.md B1–B3).
//
//   B1  a `blank` item printed its own answer in the gloss line one row above
//       the input ("Mārcus ▁▁▁ nihil dat. … sorōrī — from soror sorōris f").
//       The sweep below fails if *any* generated prompt or gloss contains an
//       accepted answer.
//   B2  the scanner asserted fabricated lemmas with `verified: true` (Latiō
//       parsed as a nominative of `latiō lationis f`; amīcus meus drilled as an
//       adjective). A candidate now has to be one the entry can account for.
//   B3  the gloss line looked words up by their macron-stripped form, so māla
//       (apples) glossed as "bad, evil, wicked".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems, scanUnit, normaliseAnswer } from '../app/js/grammar/items.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { setGlossary, lookup as realLookup } from '../app/js/dictionary.js';

const index = indexSkills(JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8')));
const S = index.skills;

/* A glossary in the build's shape, holding the exact traps QA-FINAL found. */
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const ADJ = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'ADJ', cat, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind: null });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const fin = (tense, mood, person, number, voice = 'act') => ({ tense, voice, mood, person, number });

const SOROR = ['soror sorōris f', 'soror', [3, 1], 'f', ['soror', 'sorōr']];
const G = {
  // in Latiō — the glossary has no Latium, only an unrelated third-declension noun and an adjective.
  latio: [
    ADJ('latius -a -um', 'latius', [1, 1], ['lati', 'lati'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm'), nk('abl', 'sg', 'n')], ['Latin']),
    N('latiō lationis f', 'latio', [3, 1], 'f', ['latiō', 'lation'], [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f')], ['right', 'proposal (of law)']),
  ],
  // amīcus meus — noun and adjective share the form; only the noun fits.
  amicus: [
    ADJ('amīcus -a -um', 'amicus', [1, 1], ['amīc', 'amīc', 'amici', 'amicissi'], [nk('nom', 'sg', 'm')], ['friendly, dear']),
    N('amīcus -ī m', 'amicus', [2, 1], 'm', ['amīc', 'amīc'], [nk('nom', 'sg', 'm')], ['friend']),
  ],
  meus: [ADJ('meus -a -um', 'meus', [1, 1], ['me', 'me'], [nk('nom', 'sg', 'm')], ['my'])],
  // Whitaker's rows for montēs know nothing of the accusative the preposition demands.
  montes: [N('mōns montis m', 'mons', [3, 3], 'm', ['mōns', 'mont'], [nk('nom', 'pl', 'm'), nk('voc', 'pl', 'm')], ['mountain'])],
  inter: [{ lemma: 'inter', h: 'inter', pos: 'PREP', roots: [], parses: [{ governs: 'acc' }], senses: ['between'], enc: null, kind: 'acc' }],
  in: [{ lemma: 'in', h: 'in', pos: 'PREP', roots: [], parses: [{ governs: 'abl' }, { governs: 'acc' }], senses: ['in'], enc: null, kind: 'abl' }],
  sunt: [V('sum, esse, fuī, futūrum', 'sum', [5, 1], ['s', 'es', 'fu', 'fut'], [fin('pres', 'ind', 3, 'pl')], ['be'])],
  est: [V('sum, esse, fuī, futūrum', 'sum', [5, 1], ['s', 'es', 'fu', 'fut'], [fin('pres', 'ind', 3, 'sg')], ['be'])],
  dat: [V('dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat'], [fin('pres', 'ind', 3, 'sg')], ['give'])],
  sorori: [N(...SOROR, [nk('dat', 'sg', 'f')], ['sister'])],
  soror: [N(...SOROR, [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f')], ['sister'])],
  marcus: [N('Mārcus -ī m', 'marcus', [2, 1], 'm', ['Mārc', 'Mārc'], [nk('nom', 'sg', 'm')], ['Marcus'])],
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  vallēs: [N('vallis -is f', 'vallis', [3, 3], 'f', ['vall', 'vall'], [nk('nom', 'pl', 'f')], ['valley'])],
  valles: [N('vallis -is f', 'vallis', [3, 3], 'f', ['vall', 'vall'], [nk('nom', 'pl', 'f')], ['valley'])],
  nihil: [N('nihil n', 'nihil', [9, 9], 'n', ['nihil', 'nihil'], [nk('acc', 'sg', 'n'), nk('nom', 'sg', 'n')], ['nothing'])],
  vir: [N('vir virī m', 'vir', [2, 3], 'm', ['vir', 'vir'], [nk('nom', 'sg', 'm')], ['man'])],
  iulius: [N('Iūlius -ī m', 'iulius', [2, 1], 'm', ['Iūli', 'Iūli'], [nk('nom', 'sg', 'm')], ['Julius'])],
  rosam: [N('rosa -ae f', 'rosa', [1, 1], 'f', ['ros', 'ros'], [nk('acc', 'sg', 'f')], ['rose'])],
  et: [{ lemma: 'et', h: 'et', pos: 'CONJ', roots: [], parses: [{}], senses: ['and'], enc: null }],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const plainTable = (() => { const m = new Map(); return (e) => { if (!m.has(e.lemma)) m.set(e.lemma, paradigm(e, [])); return m.get(e.lemma); }; })();
const scan = (la, skillId) => scanUnit({ id: 'w07:1.1', la }, S.get(skillId), lookup, { paradigm: plainTable });

/* ------------------------------------------------------------ B2 */

test('B2: a headword whose own stem cannot print the word is never asserted — "in Latiō" yields no candidate', () => {
  // `latiō lationis f` does have a nominative cell spelled Latiō, which is how the old scanner reached it
  // — but `in` governs the ablative and accusative, and this entry spells those lationē / lationem.
  const got = scan('Multae vīllae in Latiō sunt.', 'noun-gender');
  assert.ok(!got.some((c) => c.token.text === 'Latiō'), 'Latiō is dropped, not parsed as a nominative of a word the book never prints');
  // Without the preposition the reading is merely unlikely, not contradicted, so the scanner may still use it:
  // the guard is about what the sentence *shows*, not about second-guessing the dictionary.
  assert.ok(scan('Latiō magnum est.', 'noun-gender').some((c) => c.token.text === 'Latiō'));
});

test('B2: where the preposition settles the case, the entry\'s own table supplies the reading Whitaker\'s rows lack', () => {
  const got = scan('Inter montēs vallēs sunt.', 'third-declension');
  const mons = got.find((c) => c.token.text === 'montēs');
  assert.ok(mons, 'montēs is still drilled — mōns montis m does print montēs in the accusative');
  assert.equal(mons.parse.case, 'acc', 'and it is read as the accusative the preposition demands, not the nominative the row list offered');
  assert.equal(mons.parse.number, 'pl');
  assert.equal(mons.verified, true);
});

test('B2: an adjective reading of a word that is also a noun needs the noun it agrees with', () => {
  const alone = scan('Amīcus meus in vīllā est.', 'adjective-agreement');
  assert.ok(!alone.some((c) => c.token.text === 'Amīcus'), 'amīcus meus is "my friend": the subject noun is never drilled as an adjective');
  assert.ok(alone.some((c) => c.token.text === 'meus'), 'meus, which really is the adjective agreeing with it, still is');
  const withNoun = scan('Vir amīcus est.', 'adjective-agreement');
  assert.deepEqual(withNoun.map((c) => c.token.text), ['amīcus'], 'beside a noun it agrees with, the adjective reading stands');
});

test('B2: `verified` means the entry prints this very form — cells existing is not enough', () => {
  const got = scan('Mārcus sorōrī nihil dat.', 'dative-indirect-object');
  const s = got.find((c) => c.token.text === 'sorōrī');
  assert.ok(s && s.verified, 'sorōrī is the entry\'s own dative singular cell');
  // A candidate the table contradicts is not verified, so transform / reorder / translate never draw it.
  const table = { sections: [{ rows: [{ cells: [{ key: { kind: 'nominal', case: 'dat', number: 'sg', gender: 'f' }, text: 'lationī' }] }] }] };
  const fake = scanUnit({ id: 'w07:1.1', la: 'Latiō nihil dat.' }, S.get('noun-gender'), lookup, { paradigm: (e) => (e.pos === 'N' && e.h === 'latio' ? table : plainTable(e)) });
  assert.ok(fake.every((c) => c.token.text !== 'Latiō' || c.verified === false), 'a form the table cannot print is never verified');
});

/* ------------------------------------------------------------ B1 */

const units = [
  { id: 'w07:1.1', la: 'Mārcus sorōrī nihil dat.' },
  { id: 'w07:1.2', la: 'Soror puerō librum dat.' },
  { id: 'w07:2.1', la: 'Inter montēs vallēs sunt.' },
  { id: 'w07:2.2', la: 'Vir amīcus est.' },
];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const mk = () => createItems({ units, lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4 });
const mkOn = (la, id = 'w07:9.1') => createItems({ units: [{ id, la }], lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4 });

/** Every string the item shows *before* it is answered (the hint holds the paradigm on purpose). */
const shown = (item) => [item.prompt?.la, item.prompt?.question, item.prompt?.gloss].filter((s) => typeof s === 'string');
const leaks = (text, answers) => {
  const hay = ` ${normaliseAnswer(String(text)).replace(/[^a-z0-9]+/g, ' ')} `;
  return answers.filter((a) => a && hay.includes(` ${normaliseAnswer(a)} `));
};

test('B1: no generated prompt or gloss ever contains an accepted answer', () => {
  const items = mk();
  const s3 = createStage3({ items, paradigm, rand: () => 0.3 });
  let seen = 0;
  const sweep = (it, id) => {
    if (!it || !Array.isArray(it.answer)) return;
    seen += 1;
    // A parse item's answer is a label ("dative singular"), not a form; the sweep is about the forms.
    if (it.kind === 'parse' || it.kind === 'recognise') return;
    for (const text of shown(it)) {
      const bad = leaks(text, it.answer);
      assert.deepEqual(bad, [], `${id} · ${it.kind}: "${text}" gives away ${bad.join(', ')}`);
    }
  };
  for (const id of index.order) {
    if (!items.drillable(id)) continue;
    for (const stage of [1, 2, 3]) {
      for (const kind of ['recognise', 'parse', 'blank', 'chart']) sweep(items.generate({ skill: id, kind, stage }), id);
      for (const kind of ['transform', 'reorder']) sweep(s3.generate({ skill: id, kind, stage }), id);
    }
  }
  assert.ok(seen > 4, 'the sweep actually generated items');
});

test('B1: a chart never asks for the cell its own headword spells', () => {
  // "Give the nominative singular of Mārcus" would be answered by the question. The cell is left out
  // of the chart pool while the table has any other the skill drills.
  const items = mkOn('Mārcus sorōrī nihil dat.');
  let seen = 0;
  for (let i = 0; i < 8; i++) {
    const it = items.generate({ skill: 'nominative-subject', kind: 'chart', stage: 1 });
    if (!it || it.kind !== 'chart') continue;
    seen += 1;
    assert.deepEqual(leaks(it.prompt.question, it.answer), [], `"${it.prompt.question}" answers itself`);
    assert.deepEqual(leaks(it.prompt.gloss, it.answer), [], `"${it.prompt.gloss}" answers the chart`);
  }
  assert.ok(seen > 0, 'the skill does produce charts');
});

test('B1: a sentence that prints the word twice makes no blank of it', () => {
  // Blanking the first sorōrī leaves the second one standing in the same sentence.
  const items = mkOn('Mārcus sorōrī nihil dat et Iūlius sorōrī rosam dat.', 'w07:3.1');
  assert.deepEqual(items.candidates('dative-indirect-object').map((c) => c.token.text), ['sorōrī', 'sorōrī'], 'both are candidates for every other kind');
  for (let i = 0; i < 6; i++) {
    const it = items.generate({ skill: 'dative-indirect-object', kind: 'blank', stage: 2 });
    assert.notEqual(it?.kind, 'blank', 'no blank is built from a sentence that keeps its own answer');
  }
});


test('B1: a blank item glosses the dictionary form, never the word it removed', () => {
  const items = mk();
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'blank', stage: 2 });
  assert.ok(it && it.kind === 'blank');
  assert.match(it.prompt.la, /___/);
  assert.ok(!it.prompt.la.includes(it.target.text), 'the sentence no longer prints the word');
  assert.ok(it.prompt.gloss.startsWith(it.entry.lemma), 'the gloss is the dictionary line…');
  assert.deepEqual(leaks(it.prompt.gloss, it.answer), [], '…and it never spells the answer');
  assert.deepEqual(leaks(it.prompt.question, it.answer), [], 'nor does "Fill the blank with the right form of …"');
});

test('B1: a word that is its own dictionary form is not made into a blank — it would be its own answer', () => {
  const items = createItems({ units: [{ id: 'w07:9.1', la: 'Soror puerō librum dat.' }], lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4 });
  for (let i = 0; i < 6; i++) {
    const it = items.generate({ skill: 'nominative-subject', kind: 'blank', stage: 2 });
    if (!it) continue;
    assert.notEqual(normaliseAnswer(it.target.text), normaliseAnswer(String(it.entry.lemma).split(/[\s,]/)[0]));
  }
});

/* ------------------------------------------------------------ B3 */

test('B3: two readings that both contradict the printed macrons are reported as ambiguous, not chosen between', () => {
  // A glossary of the exact shape the build produces, holding only readings spelled without the macron:
  // neither accounts for māla, so the app says so and the gloss line shows both.
  setGlossary({
    mala: [
      ADJ('malus -a -um', 'malus', [1, 1], ['mal', 'mal', 'pēi', '-'], [nk('nom', 'sg', 'f'), nk('nom', 'pl', 'n')], ['bad, evil, wicked']),
      N('malum -ī n', 'malum', [2, 2], 'n', ['mal', 'mal'], [nk('nom', 'pl', 'n'), nk('acc', 'pl', 'n')], ['apple']),
    ],
    marco: [
      V('mārcō, mārcere, marcuī, marcitum', 'marco', [3, 1], ['mārc', 'mārc', 'marcu', 'marcit'], [fin('pres', 'ind', 1, 'sg')], ['be withered or flabby']),
      N('Mārcus -ī m', 'marcus', [2, 1], 'm', ['Mārc', 'Mārc'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['Marcus']),
    ],
  });
  assert.equal(realLookup('māla').ambiguous, true, 'the dictionary cannot tell apples from evil here — both readings are shown');
  assert.equal(realLookup('mala').ambiguous, false, 'without a macron there is nothing to weigh');

  // A capitalised word in a sentence takes the capitalised headword, whatever the glossary's own order.
  assert.equal(realLookup('Mārcō').entries[0].lemma, 'Mārcus -ī m');
  assert.equal(realLookup('mārcō').entries[0].pos, 'V', 'lower case leaves the verb where it was');
});

test('B3: over the shipped glossary the printed form is what is looked up', () => {
  setGlossary(JSON.parse(readFileSync(new URL('../app/data/glossary.json', import.meta.url), 'utf8')));
  const accounts = (e, q) => String(e.lemma).split(/[\s,(/]/)[0].toLowerCase() === q
    || (() => { const t = paradigm(e, []); for (const s of t?.sections ?? []) for (const r of s.rows ?? []) for (const c of r.cells ?? []) if (c && !c.empty && String(c.text).toLowerCase() === q) return true; return false; })();
  for (const q of ['māla', 'vēnit', 'Mārcō']) {
    const top = realLookup(q).entries[0];
    assert.ok(top, `${q} is in the glossary`);
    assert.ok(accounts(top, q.toLowerCase()), `${q}: the leading reading is one that actually prints ${q}`);
  }
  // Plain homography (readings that all do print the word) is not "ambiguous": the gloss line stays quiet.
  assert.equal(realLookup('quī').ambiguous, false);
});
