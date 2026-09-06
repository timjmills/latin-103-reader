// node --test tests/ — the daily plan (GRAMMAR-CONTRACT.md "Daily plan"):
// Learn (one of the week's unlearned skills) · Practice (10 items, due count,
// pairs) · Questions for the week's passage · Vocabulary due · the reading
// line; minutes from the attempt log's pace (25 s until twenty attempts say
// otherwise); dismissible per day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildToday, itemSeconds, isDismissed, fmtMinutes, DEFAULT_ITEM_S } from '../app/js/grammar/today.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { newState, addToPractice, passLearn, DAY_MS } from '../app/js/grammar/scheduler.js';
import { localDay } from '../app/js/grammar/stats.js';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const S = indexSkills(JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'))).skills;
const sets = new Map([
  ['questions-07', { id: 'questions-07', set: 'questions', chapter: 7, title: 'Questions · Cap. VII', count: 12, kinds: ['question'], confusable_with: [] }],
  ['vocab-07', { id: 'vocab-07', set: 'vocab', chapter: 7, title: 'Vocabulary · Cap. VII', count: 20, kinds: ['vocab'], confusable_with: [] }],
  ['vocab-07-rev', { id: 'vocab-07-rev', set: 'vocab', rev: true, chapter: 7, title: 'Vocabulary · Cap. VII · English → Latin', count: 20, kinds: ['vocab'], confusable_with: [] }],
  ['vocab-01', { id: 'vocab-01', set: 'vocab', chapter: 1, title: 'Vocabulary · Cap. I', count: 12, kinds: ['vocab'], confusable_with: [] }],
  ['pensum-07', { id: 'pensum-07', set: 'pensum', chapter: 7, title: 'Pensa · Cap. VII', count: 9, kinds: ['pensum'], confusable_with: [] }],
]);
const all = new Map([...S, ...sets]);
const week1 = [...S.values()].filter((s) => s.course === '103' && s.week === 1).map((s) => s.id);
const due = (id) => ({ ...addToPractice(newState(id, NOW), NOW), due_at: new Date(NOW - 1000).toISOString(), stability_days: 2 });
const later = (id) => ({ ...addToPractice(newState(id, NOW), NOW), due_at: new Date(NOW + 3 * DAY_MS).toISOString(), stability_days: 4 });

test('itemSeconds: 25 s until twenty timed attempts, then the median, each attempt capped at two minutes, the result clamped 5–120', () => {
  assert.equal(itemSeconds([]), DEFAULT_ITEM_S);
  assert.equal(itemSeconds(Array.from({ length: 19 }, () => ({ ms: 40000 }))), DEFAULT_ITEM_S);
  assert.equal(itemSeconds(Array.from({ length: 20 }, () => ({ ms: 40000 }))), 40);
  assert.equal(itemSeconds(Array.from({ length: 30 }, () => ({ ms: 500 }))), 5);
  assert.equal(itemSeconds(Array.from({ length: 30 }, () => ({ ms: 900000 }))), 120, 'every attempt is capped at 120 s');
  // One item left open while the learner walked away used to drag the mean to the clamp for the next 180 items.
  const fast = Array.from({ length: 24 }, () => ({ ms: 10000 }));
  assert.equal(itemSeconds([...fast, { ms: 3600000 }]), 10);
});

test('an empty learner with a current week: Learn the week\'s first skill, no practice, questions + vocabulary once through, the reading line', () => {
  const plan = buildToday({ states: new Map(), skills: all, currentWeek: week1, weekChapter: 7, unread: 30, pace: { perHour: 60 }, now: NOW });
  const kinds = plan.lines.map((l) => l.kind);
  assert.deepEqual(kinds, ['learn', 'questions', 'vocab', 'read']);
  const learn = plan.lines[0];
  assert.equal(learn.skill, week1[0]); assert.equal(learn.action.view, 'learn'); assert.equal(learn.minutes, 2 + Math.round(15 * 25 / 60));
  // 103 week 1 holds a single skill, so the detail marks it new rather than counting a remainder.
  assert.equal(week1.length, 1);
  assert.ok(learn.detail.includes('new this week'), learn.detail);
  assert.equal(plan.lines[1].action.view, 'learn'); assert.equal(plan.lines[1].skill, 'questions-07');
  assert.equal(plan.lines[2].skill, 'vocab-07');
  assert.equal(plan.lines[3].minutes, 30);
  assert.equal(plan.minutes, plan.lines.reduce((n, l) => n + l.minutes, 0));
  assert.equal(plan.dismissed, false); assert.equal(plan.day, localDay(NOW));
});

test('a week with several unlearned skills counts the remainder; a lesson-only skill is not counted', () => {
  const week5 = [...S.values()].filter((s) => s.course === '103' && s.week === 5).map((s) => s.id);
  assert.equal(week5.length, 3);
  const plan = buildToday({ states: new Map(), skills: all, currentWeek: week5, weekChapter: 7, now: NOW });
  assert.ok(plan.lines[0].detail.includes('2 more this week'), plan.lines[0].detail);
  // week 13 mixes two drillable skills with the metre skill (parse_filter null), which the plan leaves out.
  const week13 = [...S.values()].filter((s) => s.course === '103' && s.week === 13).map((s) => s.id);
  const p13 = buildToday({ states: new Map(), skills: all, currentWeek: week13, weekChapter: 7, now: NOW });
  assert.ok(p13.lines[0].detail.includes('1 more this week'), p13.lines[0].detail);
});

test('with skills in rotation: Practice names the due count and the pairs, its Start is the exact 10-item session; a due deck gets a ten-item set; a learned questions set that is not due is left out', () => {
  const states = new Map([['dative-indirect-object', due('dative-indirect-object')], ['ablative-means', due('ablative-means')], ['genitive-of', later('genitive-of')],
    ['questions-07', later('questions-07')], ['vocab-07', due('vocab-07')], ['vocab-01', due('vocab-01')], ['vocab-07-rev', later('vocab-07-rev')], ['pensum-07', due('pensum-07')]]);
  const learned = new Map([...states, ...week1.map((id) => [id, passLearn(newState(id, NOW), NOW)])]);
  const plan = buildToday({ states: learned, skills: all, currentWeek: week1, weekChapter: 7, attempts: Array.from({ length: 25 }, () => ({ ms: 30000 })), now: NOW });
  assert.deepEqual(plan.lines.map((l) => l.kind), ['practice', 'vocab', 'vocab']);
  const p = plan.lines[0];
  assert.equal(p.due, 2); assert.equal(p.pairs, 1, 'dative ↔ ablative of means are confusable and both due');
  assert.deepEqual(p.action, { view: 'session', params: { preset: 'review-heavy', size: 10, oneSkill: null } });
  assert.equal(p.minutes, 5, '10 × 30 s');
  assert.deepEqual(plan.lines.slice(1).map((l) => l.skill), ['vocab-01', 'vocab-07']);
  assert.deepEqual(plan.lines[1].action, { view: 'session', params: { preset: 'one-skill', size: 10, oneSkill: 'vocab-01' } });
  assert.equal(plan.itemSeconds, 30);
});

test('a due questions set is a ten-item one-skill session; a lapsed week skill says Re-learn; no week → no learn line', () => {
  const states = new Map([['questions-07', due('questions-07')], [week1[0], { ...due(week1[0]), state: 'lapsed' }]]);
  const plan = buildToday({ states, skills: all, currentWeek: week1, weekChapter: 7, now: NOW });
  assert.equal(plan.lines[0].label, 'Re-learn');
  const q = plan.lines.find((l) => l.kind === 'questions');
  assert.deepEqual(q.action, { view: 'session', params: { preset: 'one-skill', size: 10, oneSkill: 'questions-07' } });
  const none = buildToday({ states: new Map(), skills: all, currentWeek: [], weekChapter: null, now: NOW });
  assert.deepEqual(none.lines, []);
});

test('dismissed for the day only', () => {
  const day = localDay(NOW);
  assert.equal(isDismissed(day, day), true);
  assert.equal(isDismissed('2026-09-05', day), false);
  assert.equal(buildToday({ states: new Map(), skills: all, currentWeek: week1, now: NOW, dismissed: day }).dismissed, true);
  assert.equal(buildToday({ states: new Map(), skills: all, currentWeek: week1, now: NOW + DAY_MS, dismissed: day }).dismissed, false);
  assert.equal(fmtMinutes(0.4), 'under a minute'); assert.equal(fmtMinutes(12), 'about 12 min'); assert.equal(fmtMinutes(null), '');
});
