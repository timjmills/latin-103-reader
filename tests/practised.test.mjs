// The "×N" counts (2026-10-23): how many times a skill, a lesson part or a table has been practised.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { practised, notePractised, timesText } = await import('../app/js/practised.js');

test('a count starts at nothing and goes up one a round, each key on its own', () => {
  assert.equal(practised('skill:a'), 0);
  notePractised('skill:a');
  notePractised(['skill:a', 'table:decl1', null, '']);
  assert.equal(practised('skill:a'), 2);
  assert.equal(practised('table:decl1'), 1);
  assert.equal(practised('part:a:0'), 0);
  assert.deepEqual(JSON.parse(mem.get('l103.practised')), { 'skill:a': 2, 'table:decl1': 1 });
});

test('it reads as a small number, and as nothing when never', () => {
  assert.equal(timesText(0), '');
  assert.equal(timesText(3), '×3');
});
