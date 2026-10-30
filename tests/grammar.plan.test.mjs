import test from 'node:test';
import assert from 'node:assert/strict';
import { planToday, studyDays, DEFAULT_PLAN, classWeekOf } from '../app/js/grammar/plan.js';

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

test('class week: counted from the first class (Sat 5 Sep 2026); week 9 is Sat 31 Oct; its skills come first', () => {
  assert.deepEqual(classWeekOf('2026-09-05').n, 1);
  assert.equal(classWeekOf('2026-09-06').n, 2);
  assert.deepEqual(classWeekOf('2026-10-30'), { n: 9, classDay: '2026-10-31', over: false });
  assert.equal(classWeekOf('2026-10-31').n, 9);
  assert.equal(classWeekOf('2026-11-01').n, 10);
  const order = ['a', 'b', 'c', 'd', 'gerundive', 'periphrastic'];
  // Friday before the class: both class skills today, ahead of the course order.
  const t = planToday({ order, today: '2026-10-30', classSkills: ['gerundive', 'periphrastic'] });
  assert.deepEqual(t.newToday.slice(0, 2), ['gerundive', 'periphrastic']);
  assert.equal(t.classWeek, 9);
  // Learnt already: nothing extra for class.
  const t2 = planToday({ order, learned: new Set(['gerundive', 'periphrastic']), today: '2026-10-30', classSkills: ['gerundive', 'periphrastic'] });
  assert.deepEqual(t2.classNew, []);
});
