import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { noteRound, missedForms, missedDue } = await import('../app/js/misses.js');
const card = (key) => ({ key, cue: key, answers: ['x'] });
const DAY = 864e5;

test('a miss comes back the next day; right twice running and it leaves', () => {
  store.clear();
  const t0 = Date.UTC(2026, 9, 28);
  noteRound([card('a'), card('b')], new Set(['a']), { now: t0 });
  assert.equal(missedForms().length, 1);
  assert.equal(missedDue(t0), 0);
  assert.equal(missedDue(t0 + DAY), 1);
  noteRound([card('a')], new Set(), { now: t0 + DAY });
  assert.equal(missedDue(t0 + 2 * DAY), 0);
  assert.equal(missedDue(t0 + 4 * DAY), 1);   // 3 days on
  noteRound([card('a')], new Set(), { now: t0 + 4 * DAY });
  assert.equal(missedForms().length, 0);
});

test('missed again starts over; right by choosing does not count', () => {
  store.clear();
  const t0 = Date.UTC(2026, 9, 28);
  noteRound([card('a')], new Set(['a']), { now: t0 });
  noteRound([card('a')], new Set(), { now: t0 + DAY, typed: false });
  assert.equal(missedForms()[0].streak, 0);
  noteRound([card('a')], new Set(), { now: t0 + DAY });
  noteRound([card('a')], new Set(['a']), { now: t0 + 2 * DAY });
  assert.equal(missedForms()[0].step, 0);
  assert.equal(missedForms()[0].misses, 2);
});
