// node --test tests/ — pipeline/build_occurrences.mjs: the label → skill
// matching, the assembly of highlight and scanner counts into the table, the
// build checks, and — when the built file is present — the shape of
// app/data/grammar/occurrences.json (counts and unit ids only, never a word of
// the book; every skill; chapters I–XXXIV only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { skillsForLabel, assemble, checkShape, packIds, unpackIds, byUnitOrder } from '../pipeline/build_occurrences.mjs';

const root = new URL('../', import.meta.url);
const skillsJson = JSON.parse(readFileSync(new URL('app/data/grammar/skills.json', root), 'utf8'));
const SKILLS = skillsJson.skills;
const ids = (label) => skillsForLabel(label, SKILLS);

test('a label is claimed by the skill whose highlight_match names it', () => {
  assert.deepEqual(ids('dative: indirect object'), ['dative-indirect-object']);
  assert.deepEqual(ids('ablative of time when, 5th declension').sort(), ['ablative-time', 'fifth-declension']);
  assert.deepEqual(ids('supine of purpose'), ['supine']);
  assert.ok(ids('imperfect subjunctive, purpose clause').includes('purpose-clause'));
  assert.ok(ids('imperfect subjunctive, purpose clause').includes('imperfect-subjunctive'));
});

test('the shelf labels the app regex does not reach are claimed by the pipeline table', () => {
  assert.deepEqual(ids('imperative: an order to one person'), ['imperative']);
  assert.deepEqual(ids('vocative: calling someone'), ['vocative']);
  assert.deepEqual(ids('3rd declension: accusative singular'), ['third-declension']);
  assert.deepEqual(ids('3rd declension neuter: nominative singular'), ['third-declension-neuter']);
  assert.deepEqual(ids('deponent verb, present'), ['deponent-verbs']);
  assert.deepEqual(ids('nolite + infinitive: negative command, plural'), ['noli-infinitive']);
  assert.deepEqual(ids('passive beside the active'), ['passive-voice']);
  assert.deepEqual(ids('present passive subjunctive, indirect command after cūrā').sort(), ['indirect-command', 'present-subjunctive']);
  assert.deepEqual(ids('passive ending -minī, \'you all are …-ed\''), ['passive-personal-endings']);
});

test('macrons and case do not matter; a label naming a sibling is stepped back from', () => {
  assert.deepEqual(ids('Ablative Of Tīme when'), ['ablative-time']);
  assert.deepEqual(ids('pluperfect passive'), ['pluperfect']);
  assert.ok(!ids('future perfect passive').includes('perfect-passive'));
  assert.deepEqual(ids('imperfect subjunctive, causal cum clause').sort(), ['cum-causal', 'imperfect-subjunctive']);
  assert.ok(!ids('future perfect, cum clause').includes('cum-narrative'));
  assert.deepEqual(ids('poetic word order: postponed conjunction'), []);
});

test('ids pack by reading in reading order and unpack to the same set', () => {
  const list = ['r07:10.1', 'r07:9.2', 'c07:b3.1', 'w03:minos:b12.1', 'w03:minos:b2.1'];
  const packed = packIds(list);
  assert.deepEqual(packed, { r07: '9.2 10.1', c07: 'b3.1', 'w03:minos': 'b2.1 b12.1' });
  assert.deepEqual(unpackIds(packed).sort(byUnitOrder), [...list].sort(byUnitOrder));
});

const CHAPTERS = [{ n: 7, prefixes: ['r07:', 'c07:'] }, { n: 27, prefixes: ['w04:', 'w03:minos:'] }];
const UNITS = new Set(['r07:1.1', 'r07:2.1', 'r07:3.1', 'c07:b1.1', 'w04:5.1', 'w03:minos:b1.1']);
const DAT = SKILLS.find((s) => s.id === 'dative-indirect-object');
const SUP = SKILLS.find((s) => s.id === 'supine');

test('a chapter the highlights mark shows the highlight count with the scanner count beside it', () => {
  const highlights = [
    { unit_id: 'r07:1.1', label: 'dative: indirect object' },
    { unit_id: 'r07:2.1', label: 'dative: indirect object' },
    { unit_id: 'r07:2.1', label: 'dative plural: indirect object' },
  ];
  const scanned = new Map([['dative-indirect-object', [
    { unitId: 'r07:1.1', ambiguous: false }, { unitId: 'r07:3.1', ambiguous: true }, { unitId: 'c07:b1.1', ambiguous: false }, { unitId: 'w04:5.1', ambiguous: false },
  ]], ['supine', [{ unitId: 'w03:minos:b1.1', ambiguous: false }]]]);
  const { table, chapterMap, errors } = assemble({ chapters: CHAPTERS, unitIds: UNITS, highlights, skills: [DAT, SUP], scanned });
  assert.deepEqual(errors, []);
  assert.deepEqual(table['dative-indirect-object']['7'], { src: 'h', n: 3, h: 3, s: 2, sx: 1, ids: { r07: '1.1 2.1' } });
  assert.deepEqual(table['dative-indirect-object']['27'], { src: 's', n: 1, s: 1, ids: { w04: '5.1' } });
  assert.deepEqual(table['supine'], { 27: { src: 's', n: 1, s: 1, ids: { 'w03:minos': 'b1.1' } } });
  assert.deepEqual(chapterMap[7], { r: ['r07', 'c07'], hl: ['r07'] });
  assert.deepEqual(chapterMap[27], { r: ['w04', 'w03:minos'], hl: [] });
});

test('build checks: a highlight on an unknown unit id, a chapter without readings, a chapter without units', () => {
  const bad = assemble({
    chapters: [...CHAPTERS, { n: 8, prefixes: [] }, { n: 9, prefixes: ['r09:'] }],
    unitIds: UNITS, highlights: [{ unit_id: 'r07:99.9', label: 'dative: indirect object' }], skills: [DAT], scanned: new Map(),
  });
  assert.ok(bad.errors.some((e) => /r07:99\.9/.test(e)));
  assert.ok(bad.errors.some((e) => /chapter 8 has no readings/.test(e)));
  assert.ok(bad.errors.some((e) => /chapter 9 .*no units/.test(e)));
});

test('labels no skill claims are reported, not silently dropped', () => {
  const { unclaimed, table } = assemble({ chapters: CHAPTERS, unitIds: UNITS, highlights: [{ unit_id: 'r07:1.1', label: 'poetic word order: postponed conjunction' }], skills: [DAT], scanned: new Map() });
  assert.deepEqual([...unclaimed], [['poetic word order: postponed conjunction', 1]]);
  assert.deepEqual(table['dative-indirect-object'], {});
});

test('checkShape refuses anything that is not counts and unit ids', () => {
  const ok = { skills: { supine: { 27: { src: 's', n: 1, s: 1, ids: { 'w03:minos': 'b1.1' } } } } };
  assert.deepEqual(checkShape(ok, ['supine']), []);
  assert.ok(checkShape({ skills: { supine: { 27: { src: 's', n: 1, s: 1, ids: { 'w03:minos': 'b1.1' }, la: 'x' } } } }, ['supine']).some((e) => /unexpected key la/.test(e)));
  assert.ok(checkShape({ skills: { supine: { 35: { src: 's', n: 0, s: 0, ids: {} } } } }, ['supine']).some((e) => /bad chapter 35/.test(e)));
  assert.ok(checkShape({ skills: { supine: { 27: { src: 'h', n: 2, h: 1, s: 0, ids: {} } } } }, ['supine']).some((e) => /highlight count/.test(e)));
  assert.ok(checkShape({ skills: { supine: { 27: { src: 's', n: 1, s: 1, ids: { 'w03:minos': 'ecce puella' } } } } }, ['supine']).some((e) => /unit-id tails/.test(e)));
  assert.ok(checkShape({ skills: {} }, ['supine']).some((e) => /skill missing: supine/.test(e)));
});

const BUILT = new URL('app/data/grammar/occurrences.json', root);
test('the built occurrences.json holds every skill, chapters I–XXXIV only, and nothing but counts and ids', { skip: !existsSync(BUILT) && 'app/data/grammar/occurrences.json not built' }, () => {
  const doc = JSON.parse(readFileSync(BUILT, 'utf8'));
  assert.deepEqual(checkShape(doc, SKILLS.map((s) => s.id)), []);
  assert.deepEqual(Object.keys(doc.chapters).map(Number).sort((a, b) => a - b), Array.from({ length: 34 }, (_, i) => i + 1));
  for (const c of Object.values(doc.chapters)) { assert.ok(c.r.length >= 1); for (const h of c.hl) assert.ok(c.r.includes(h)); }
  // Every id sits in one of its chapter's readings, and no value anywhere is prose.
  for (const rows of Object.values(doc.skills)) for (const [n, row] of Object.entries(rows)) for (const r of Object.keys(row.ids)) assert.ok(doc.chapters[n].r.includes(r), `${r} is not a reading of chapter ${n}`);
  const text = JSON.stringify(doc);
  assert.ok(!/[āēīōūȳĀĒĪŌŪ]/.test(text), 'no macronised Latin in the file');
  assert.ok(!/\b(est|sunt|et|in|non)\b/.test(text.replace(/"(src|n|h|s|sx|ids|r|hl|version|built|chapters|skills)"/g, '')), 'no Latin words in the file');
});
