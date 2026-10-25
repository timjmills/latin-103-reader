import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsAcross } from '../app/js/grammar/session.js';

test('wordsAcross: the shown table first, then round the skill’s other tables, each word once', () => {
  const stock = { conj1: ['amo', 'voco', 'laudo'], conj2: ['moneo', 'video'], conj3: ['rego'], sum: ['sum'] };
  const teachItems = { chartWords: ({ key }) => stock[key] ?? [] };
  const skill = { paradigms: ['conj1', 'conj2', 'conj3', 'sum'] };
  assert.deepEqual(wordsAcross(teachItems, skill, 'conj1'), ['amo', 'moneo', 'rego', 'sum', 'voco', 'video', 'laudo']);
  // A step on the 2nd conjugation starts there
  assert.deepEqual(wordsAcross(teachItems, skill, 'conj2').slice(0, 3), ['moneo', 'amo', 'rego']);
  // A skill of one table is that table's words
  assert.deepEqual(wordsAcross(teachItems, { paradigms: ['conj1'] }, 'conj1'), ['amo', 'voco', 'laudo']);
});
