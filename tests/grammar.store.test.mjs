// node --test tests/ — the grammar store's pure row helpers and its local
// (fixture) backend: server column shapes, attempt ids, resets, confusions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrammarStore, serverStateRow, serverAttemptRow, normaliseAttempt, attemptId, confusionKey } from '../app/js/grammar/store-grammar.js';
import { addToPractice } from '../app/js/grammar/scheduler.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m }; };

test('serverStateRow: only the columns skill_state has, normalised', () => {
  const row = serverStateRow({ skill: 'a', state: 'practising', stage: '2', stability_days: 3, extra: 'no', updated_at: '2026-09-05T10:00:00.000Z' });
  assert.deepEqual(Object.keys(row).sort(), ['due_at', 'failures', 'last_at', 'skill', 'stability_days', 'stage', 'state', 'streak', 'successes', 'updated_at']);
  assert.equal(row.stage, 2);
  assert.equal('extra' in row, false);
});

test('normaliseAttempt / attemptId: (at, skill, item_key) names a row on both sides; bad rows → null', () => {
  const a = normaliseAttempt({ skill: 'a', kind: 'blank', item_key: 'blank:w01:1.1:x:0', mode: 'learn', correct: 'yes', ms: 1234.6, at: '2026-09-05T10:00:00.000Z' });
  assert.equal(a.id, '2026-09-05T10:00:00.000Z|a|blank:w01:1.1:x:0');
  assert.equal(a.correct, true); assert.equal(a.hinted, false); assert.equal(a.ms, 1235); assert.equal(a.mode, 'learn');
  assert.equal(attemptId(a), a.id);
  assert.equal(normaliseAttempt({ skill: 'a' }), null);
  assert.equal('id' in serverAttemptRow(a), false);
  assert.equal(confusionKey('a', 'b'), 'a|b');
});

test('local backend: states, attempts and confusions persist in the storage and survive a reload; resets', async () => {
  const storage = mem();
  const g = createGrammarStore({ mode: 'local', storage });
  await g.ready();
  await g.setState(addToPractice('dative-indirect-object'));
  await g.addAttempt({ skill: 'dative-indirect-object', kind: 'blank', item_key: 'k1', mode: 'practice', correct: false, at: '2026-09-05T10:00:00.000Z' });
  await g.addAttempt({ skill: 'dative-indirect-object', kind: 'chart', item_key: 'k2', mode: 'practice', correct: true, at: '2026-09-05T10:01:00.000Z' });
  await g.bumpConfusion('dative-indirect-object', 'ablative-means');
  await g.bumpConfusion('dative-indirect-object', 'ablative-means');
  assert.equal(g.getState('dative-indirect-object').state, 'practising');
  assert.equal(g.getAttempts().length, 2);
  assert.equal(g.getAttempts()[0].item_key, 'k1');   // oldest first
  assert.equal(g.getConfusions()[0].count, 2);

  const again = createGrammarStore({ mode: 'local', storage });
  await again.ready();
  assert.equal(again.getStates().size, 1);
  assert.equal(again.getAttempts({ skill: 'dative-indirect-object' }).length, 2);
  assert.equal(again.getConfusions().length, 1);

  let changes = 0;
  again.onChange(() => { changes += 1; });
  await again.resetSkill('dative-indirect-object');
  assert.equal(again.getStates().size, 0);
  assert.equal(again.getAttempts().length, 0);
  assert.equal(again.getConfusions().length, 0);
  assert.equal(changes, 1);
  await again.setState(addToPractice('genitive-of'));
  await again.resetAll();
  assert.equal(again.getStates().size, 0);
});

test('the same attempt added twice is one row (idempotent by id)', async () => {
  const g = createGrammarStore({ mode: 'local', storage: mem() });
  await g.ready();
  const row = { skill: 'a', kind: 'blank', item_key: 'k', mode: 'practice', correct: true, at: '2026-09-05T10:00:00.000Z' };
  await g.addAttempt(row); await g.addAttempt(row);
  assert.equal(g.getAttempts().length, 1);
});
