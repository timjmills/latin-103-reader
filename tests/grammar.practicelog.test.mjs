// The practice chart's counts (2026-10-23): from the synced attempt log, so every device shows the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceLog, needsPractice, ROUND_GAP_MS } from '../app/js/grammar/practicelog.js';

const at = (min) => new Date(Date.UTC(2026, 9, 1) + min * 60000).toISOString();
const A = (skill, min, extra = {}) => ({ skill, kind: 'chart', at: at(min), correct: true, ...extra });

test('a round is a sitting: answers with no half-hour gap between them', () => {
  const log = practiceLog([A('s', 0), A('s', 5), A('s', 20), A('s', 120), A('s', 121), A('t', 3, { correct: false })]);
  assert.equal(log.skill('s').rounds, 2);
  assert.equal(log.skill('s').answers, 5);
  assert.equal(log.skill('t').right, 0);
  assert.equal(log.skill('none').rounds, 0);
  assert.equal(ROUND_GAP_MS, 30 * 60000);
});

test('parts are counted by the step their answers record; a game is a round of its own', () => {
  const log = practiceLog([A('s', 0, { meta: { step: 2 } }), A('s', 1, { meta: { step: 2 } }), A('s', 90, { meta: { step: 2 } }),
    A('s', 91, { meta: { game: true, uncounted: true, table: 'decl1' } }), A('s', 92, { meta: { game: true, uncounted: true, table: 'decl1' } })]);
  assert.equal(log.part('s', 2), 2);
  assert.equal(log.tablePart('s'), 2);
  assert.equal(log.table('decl1'), 2);
  assert.equal(log.count('part:s:2'), 2);
  assert.equal(log.count('skill:s'), 4, 'two sittings of answers, and each game played to its end');
});

test('what still needs practice, most pressing first', () => {
  const now = Date.parse(at(1000));
  assert.equal(needsPractice({ state: 'lapsed' }, {}, now).rank, 0);
  assert.equal(needsPractice({ state: 'practising', due_at: at(10) }, {}, now).why, 'Due for review');
  assert.equal(needsPractice({ state: 'practising', due_at: at(5000) }, {}, now), null);
  assert.equal(needsPractice({ state: 'learning' }, {}, now).why, 'Lesson not finished');
  assert.equal(needsPractice({ state: 'new' }, { answers: 3 }, now).why, 'Started, not learned');
  assert.equal(needsPractice(null, {}, now).why, 'Not started');
});
