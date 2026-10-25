import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainAction, acrossLabel } from '../app/js/grammar/actions.js';

const now = Date.parse('2026-10-25T12:00:00Z');
const day = 86400000;

test('mainAction: the one button follows the skill’s state', () => {
  assert.equal(mainAction(null, { now }).verb, 'learn');
  assert.equal(mainAction({ state: 'new' }, { now, drillable: false }).verb, 'read');
  assert.equal(mainAction({ state: 'learning' }, { now }).view, 'learn');
  assert.equal(mainAction({ state: 'lapsed' }, { now }).label, 'Re-learn');
  assert.deepEqual(mainAction({ state: 'practising', due_at: new Date(now - day).toISOString() }, { now }), { verb: 'review', label: 'Review', view: 'blocked' });
  assert.deepEqual(mainAction({ state: 'mastered', due_at: new Date(now + 3 * day).toISOString() }, { now }), { verb: 'practise', label: 'Practise', view: 'drill' });
  assert.equal(mainAction({ state: 'practising', due_at: new Date(now + day).toISOString() }, { now, drillable: false }).verb, 'read');
  assert.equal(mainAction({ state: 'new' }, { now, set: true }).label, 'Start');
});

test('acrossLabel names what the skill goes across', () => {
  assert.equal(acrossLabel(['conj1', 'conj2', 'conj3', 'conj3io', 'conj4']), 'Across the conjugations (5)');
  assert.equal(acrossLabel(['conj1', 'conj2', 'conj3', 'conj3io', 'conj4', 'sum', 'eo']), 'Across the conjugations (7)');
  assert.equal(acrossLabel(['decl1', 'decl2m', 'decl2n', 'decl2r']), 'Across the declensions (4)');
  assert.equal(acrossLabel(['sum', 'possum', 'eo']), 'Across the irregular verbs (3)');
  assert.equal(acrossLabel(['hic', 'ille', 'is']), 'Across the pronouns (3)');
  assert.equal(acrossLabel(['decl1', 'decl2m', 'ego', 'tu']), 'Across the declensions (4)');
  assert.equal(acrossLabel(['conj1', 'conj2', 'conj3', 'conj3io', 'conj4', 'sum', 'possum', 'eo', 'fero', 'volo', 'nolo', 'malo', 'fio']), 'Across the conjugations (13)');
  assert.equal(acrossLabel(['adj12']), 'Its table');
  assert.equal(acrossLabel([]), '');
});
