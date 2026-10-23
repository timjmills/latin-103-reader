// "For: …" (2026-10-23): which conjugations, declensions and words a skill's rule is for, from its own tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appliesTo, exampleOf } from '../app/js/grammar/applies.js';

const { skills } = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const of = (id) => appliesTo(skills.find((s) => s.id === id).paradigms);

test('every conjugation is said as such, the irregular verbs after', () => {
  assert.equal(of('perfect-active'), 'all four conjugations (and the 3rd’s -iō verbs); also sum, eō and ferō');
  assert.equal(of('imperative'), 'all four conjugations (and the 3rd’s -iō verbs)');
  assert.equal(appliesTo(['conj1', 'conj2']), 'the 1st and 2nd conjugations');
  assert.equal(appliesTo(['conj3io']), 'the 3rd -iō conjugation');
});

test('declensions are counted once each, whatever their tables', () => {
  assert.equal(of('dative-possession'), 'all five declensions');
  assert.equal(appliesTo(['decl2m', 'decl2n', 'decl2r']), 'the 2nd declension');
  assert.equal(of('third-declension'), 'the 3rd declension');
});

test('words alone are named; nothing is said for a skill with no tables', () => {
  assert.equal(of('personal-pronouns'), 'ego, tū and sē');
  assert.equal(appliesTo([]), '');
  assert.equal(appliesTo(undefined), '');
});

test('every skill with tables gets a line', () => {
  for (const s of skills) if (s.paradigms?.length) assert.ok(appliesTo(s.paradigms), s.id);
});

test('the example table is named as one example of the rule', () => {
  assert.equal(exampleOf('conj1', { label: '1st conjugation (-āre)', example: 'amō, amāre' }), 'The table is the 1st conjugation (-āre): amō — one example of the rule.');
  assert.equal(exampleOf(null), '');
});
