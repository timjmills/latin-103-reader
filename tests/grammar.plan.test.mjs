import test from 'node:test';
import assert from 'node:assert/strict';
import { planToday, studyDays, DEFAULT_PLAN } from '../app/js/grammar/plan.js';

const order = Array.from({ length: 88 }, (_, i) => `s${i}`);

test('studyDays leaves out the rest day', () => {
  const d = studyDays('2026-10-26', '2026-11-01', 0);   // Mon → Sun
  assert.equal(d.length, 6);
  assert.ok(!d.includes('2026-11-01'));
});

test('learning phase spreads the remaining skills over the days left to learnBy', () => {
  const r = planToday({ order, learned: new Set(order.slice(0, 4)), today: '2026-10-28', plan: { ...DEFAULT_PLAN, start: '2026-10-28', startDone: 4 } });
  assert.equal(r.kind, 'learn');
  const days = studyDays('2026-10-28', DEFAULT_PLAN.learnBy, 0).length;
  assert.equal(r.newToday.length, Math.ceil(84 / days));
  assert.deepEqual(r.newToday[0], 's4');
  assert.equal(r.status, 'on-track');
});

test('a missed day spreads forward and shows behind', () => {
  const r = planToday({ order, learned: new Set(order.slice(0, 4)), today: '2026-11-10', plan: { ...DEFAULT_PLAN, start: '2026-10-28', startDone: 4 } });
  assert.equal(r.kind, 'learn');
  assert.equal(r.status, 'behind');
  assert.ok(r.newToday.length > Math.ceil(84 / studyDays('2026-10-28', DEFAULT_PLAN.learnBy, 0).length));
});

test('rest day, mastery phase, after the goal', () => {
  assert.equal(planToday({ order, today: '2026-11-01' }).kind, 'rest');
  const m = planToday({ order, learned: new Set(order), today: '2026-11-30' });
  assert.equal(m.kind, 'master');
  assert.equal(m.newToday.length, 0);
  assert.equal(m.status, 'learnt');
  assert.equal(planToday({ order, today: '2026-12-20' }).kind, 'past');
});
