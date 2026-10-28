import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { noteRound, missedForms, missedDue, missedToReview } = await import('../app/js/misses.js');
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

test('the day\'s review of what was wrong: everything missed today or yesterday, and anything due back', () => {
  store.clear();
  const now = new Date(2026, 9, 28, 15).getTime();   // local time, mid-afternoon
  noteRound([card('today')], new Set(['today']), { now: now - 3600e3 });
  noteRound([card('yesterday')], new Set(['yesterday']), { now: now - DAY });
  noteRound([card('old')], new Set(['old']), { now: now - 3 * DAY });
  noteRound([card('old')], new Set(), { now: now - 2 * DAY });   // right once: back in 3 days, not due yet
  const keys = missedToReview(now).map((r) => r.card.key).sort();
  assert.deepEqual(keys, ['today', 'yesterday']);
  assert.deepEqual(missedToReview(now + 2 * DAY).map((r) => r.card.key).sort(), ['old', 'today', 'yesterday']);   // all due by then
});
