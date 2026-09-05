// node --test tests/ — the grammar scheduler (GRAMMAR-CONTRACT.md "Scheduler"):
// state transitions, stability, the Learn criterion, the session builder's
// interleaving rules and the re-queue after a wrong answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, normaliseState, applyAnswer, decay, isDue, learnCriterion, passLearn, startLearning, addToPractice,
  buildSession, requeue, reviewFirst, suggestToday, kindsFor, DAY_MS, STABILITY_FLOOR, MASTERED_DAYS,
} from '../app/js/grammar/scheduler.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { readFileSync } from 'node:fs';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const raw = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const index = indexSkills(raw);
const S = index.skills;

test('newState / normaliseState: defaults and clamps', () => {
  const s = newState('dative-indirect-object', NOW);
  assert.equal(s.state, 'new');
  assert.equal(s.stability_days, STABILITY_FLOOR);
  const n = normaliseState({ skill: 'x', state: 'bogus', stage: 9, stability_days: -3, streak: '2' });
  assert.equal(n.state, 'new'); assert.equal(n.stage, 3); assert.equal(n.stability_days, STABILITY_FLOOR); assert.equal(n.streak, 2);
  assert.equal(normaliseState(null), null);
});

test('applyAnswer: correct unaided × 1.7, fast × 2.2, hinted × 1.2, wrong × 0.3 with a floor', () => {
  const base = { ...addToPractice(newState('a', NOW), NOW), stability_days: 4, due_at: new Date(NOW - 1000).toISOString() };
  assert.equal(applyAnswer(base, { correct: true, ms: 20000, now: NOW }).stability_days, 4 * 1.7);
  assert.equal(applyAnswer(base, { correct: true, ms: 3000, now: NOW }).stability_days, 4 * 2.2);
  assert.equal(applyAnswer(base, { correct: true, hinted: true, ms: 3000, now: NOW }).stability_days, 4 * 1.2);
  const wrong = applyAnswer(base, { correct: false, now: NOW });
  assert.equal(wrong.stability_days, 1.2);
  assert.equal(wrong.failures, 1); assert.equal(wrong.streak, 0);
  const floor = applyAnswer({ ...base, stability_days: 0.6 }, { correct: false, now: NOW });
  assert.equal(floor.stability_days, STABILITY_FLOOR);
  // due_at = now + stability
  const r = applyAnswer(base, { correct: true, ms: 20000, now: NOW });
  assert.equal(Date.parse(r.due_at) - NOW, Math.round(4 * 1.7 * DAY_MS));
});

test('applyAnswer: an early (not yet due) correct answer grows at most × 1.2', () => {
  const s = { ...addToPractice(newState('a', NOW), NOW), stability_days: 4, due_at: new Date(NOW + DAY_MS).toISOString() };
  assert.equal(applyAnswer(s, { correct: true, ms: 1000, now: NOW }).stability_days, 4 * 1.2);
});

test('stage +1 after 4 unaided correct in a row; mastered past 21 days with 3 successes; a wrong answer drops mastered back', () => {
  let s = addToPractice(newState('a', NOW), NOW);
  let t = NOW;
  for (let i = 0; i < 4; i++) { s = applyAnswer(s, { correct: true, ms: 20000, now: t }); t = Date.parse(s.due_at) + 1; }
  assert.equal(s.stage, 2); assert.equal(s.streak, 0);
  for (let i = 0; i < 6; i++) { s = applyAnswer(s, { correct: true, ms: 20000, now: t }); t = Date.parse(s.due_at) + 1; }
  assert.ok(s.stability_days > MASTERED_DAYS);
  assert.equal(s.state, 'mastered');
  assert.equal(s.stage, 3);
  const back = applyAnswer(s, { correct: false, now: t });
  assert.equal(back.state, 'practising');
});

test('decay: overdue by more than twice the stability → lapsed; isDue', () => {
  const s = { ...addToPractice(newState('a', NOW), NOW), stability_days: 2, due_at: new Date(NOW - 5 * DAY_MS).toISOString() };
  assert.equal(decay(s, NOW).state, 'lapsed');
  const ok = { ...s, due_at: new Date(NOW - 3 * DAY_MS).toISOString() };
  assert.equal(decay(ok, NOW).state, 'practising');
  assert.equal(isDue(ok, NOW), true);
  assert.equal(isDue({ ...ok, due_at: new Date(NOW + DAY_MS).toISOString() }, NOW), false);
  assert.equal(isDue(newState('z', NOW), NOW), false);   // not in rotation
});

test('learnCriterion: 6 of the last 10 across at least two kinds', () => {
  const a = (correct, kind) => ({ correct, kind });
  assert.equal(learnCriterion([1, 1, 1, 1, 1, 1].map(() => a(true, 'blank'))).passed, false);   // one kind only
  assert.equal(learnCriterion([...Array(5).fill(a(true, 'blank')), a(true, 'parse'), ...Array(4).fill(a(false, 'chart'))]).passed, true);
  assert.equal(learnCriterion([...Array(5).fill(a(true, 'blank')), ...Array(5).fill(a(false, 'parse'))]).passed, false);
  // only the last 10 count
  const older = Array(10).fill(a(true, 'blank')).concat(Array(10).fill(a(false, 'parse')));
  assert.equal(learnCriterion(older).passed, false);
});

test('every transition accepts a bare skill id (a skill never touched yet)', () => {
  assert.equal(addToPractice('genitive-of', NOW).state, 'practising');
  assert.equal(addToPractice('genitive-of', NOW).due_at, new Date(NOW).toISOString());
  assert.equal(passLearn('genitive-of', NOW).state, 'practising');
  assert.equal(applyAnswer('genitive-of', { correct: true, now: NOW }).successes, 1);
  assert.equal(startLearning('genitive-of', NOW).skill, 'genitive-of');
});

test('startLearning / passLearn: learning → practising, due tomorrow, stability one day', () => {
  const l = startLearning('dative-indirect-object', NOW);
  assert.equal(l.state, 'learning');
  const p = passLearn(l, NOW);
  assert.equal(p.state, 'practising');
  assert.equal(p.stability_days, 1);
  assert.equal(Date.parse(p.due_at) - NOW, DAY_MS);
});

test('kindsFor: the stage and one below, kept to the skill\'s kinds', () => {
  assert.deepEqual(kindsFor(S.get('dative-indirect-object'), 1), ['recognise', 'chart']);
  assert.deepEqual(kindsFor(S.get('dative-indirect-object'), 2), ['chart', 'parse', 'recognise']);
  assert.deepEqual(kindsFor(S.get('dative-indirect-object'), 3), ['parse', 'blank', 'chart']);
  assert.deepEqual(kindsFor({ kinds: ['blank'] }, 1), ['blank']);
});

function rotation(ids, { due = true } = {}) {
  const m = new Map();
  for (const id of ids) m.set(id, { ...addToPractice(newState(id, NOW), NOW), due_at: new Date(due ? NOW - 1000 : NOW + DAY_MS).toISOString(), stability_days: 2 });
  return m;
}

test('buildSession: no two consecutive items on one skill or of one kind; ≥ 1 confusable pair per 5', () => {
  const states = rotation(['nominative-subject', 'genitive-of', 'dative-indirect-object', 'ablative-means', 'perfect-active', 'imperfect-subjunctive']);
  for (const seed of [1, 2, 3, 42, 99]) {
    const plan = buildSession({ states, skills: S, preset: 'review-heavy', size: 15, now: NOW, seed });
    assert.equal(plan.length, 15);
    for (let i = 1; i < plan.length; i++) {
      assert.notEqual(plan[i].skill, plan[i - 1].skill, `seed ${seed}: same skill twice at ${i}`);
      assert.notEqual(plan[i].kind, plan[i - 1].kind, `seed ${seed}: same kind twice at ${i}`);
    }
    for (let w = 0; w + 5 <= plan.length; w += 5) {
      const win = plan.slice(w, w + 5);
      const pair = win.some((x, j) => win.slice(j + 1, j + 4).some((y) => S.get(x.skill).confusable_with.includes(y.skill)));
      assert.ok(pair, `seed ${seed}: no confusable pair in items ${w}–${w + 4}: ${win.map((x) => x.skill).join(', ')}`);
    }
    const cw = plan.filter((p) => p.currentWeek).length;
    assert.equal(cw, 3);   // ≈ 20 % of 15
  }
});

test('buildSession: due skills come first; this-week gives two thirds to the current week; one-skill blocks', () => {
  const states = rotation(['nominative-subject', 'genitive-of', 'ablative-means'], { due: false });
  states.set('dative-indirect-object', { ...addToPractice(newState('dative-indirect-object', NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString() });
  const plan = buildSession({ states, skills: S, preset: 'review-heavy', size: 4, now: NOW, seed: 7 });
  assert.equal(plan[0].skill, 'dative-indirect-object');
  const all = rotation(['nominative-subject', 'genitive-of', 'dative-indirect-object', 'ablative-means', 'perfect-active', 'imperfect-subjunctive']);
  const week = buildSession({ states: all, skills: S, preset: 'this-week', currentWeek: ['imperfect-subjunctive', 'perfect-active'], size: 9, now: NOW, seed: 3 });
  const inWeek = week.filter((p) => ['imperfect-subjunctive', 'perfect-active'].includes(p.skill)).length;
  assert.ok(inWeek >= 5, `two thirds of 9 from the week, got ${inWeek}`);
  const one = buildSession({ states: all, skills: S, preset: 'one-skill', oneSkill: 'genitive-of', size: 5, now: NOW, seed: 3 });
  assert.equal(one.length, 5);
  assert.ok(one.every((p) => p.skill === 'genitive-of'));
  for (let i = 1; i < one.length; i++) assert.notEqual(one[i].kind, one[i - 1].kind);
  assert.deepEqual(buildSession({ states: new Map(), skills: S, size: 5 }), []);
});

test('requeue: the skill returns 3–6 items later, never next to itself', () => {
  const plan = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => ({ skill: s, kind: 'blank', stage: 2 }));
  const skills = new Map(plan.map((p) => [p.skill, { id: p.skill, kinds: ['recognise', 'chart', 'parse', 'blank'] }]));
  for (let i = 0; i < 20; i++) {
    const out = requeue(plan, { skill: 'x', kind: 'blank', stage: 2, skills, rand: Math.random });
    const at = out.findIndex((p) => p.skill === 'x');
    assert.ok(at >= 3 && at <= 6, `re-queued at ${at}`);
    assert.ok(out[at].requeued);
    assert.notEqual(out[at].kind, out[at - 1].kind);
  }
  // a short remainder: appended at the end
  const short = requeue(plan.slice(0, 2), { skill: 'x', kind: 'blank', stage: 2, skills });
  assert.equal(short[short.length - 1].skill, 'x');
  // never beside itself
  const beside = requeue([{ skill: 'a' }, { skill: 'b' }, { skill: 'x' }, { skill: 'x' }, { skill: 'c' }].map((p) => ({ ...p, kind: 'blank', stage: 1 })), { skill: 'x', kind: 'blank', stage: 1, skills, rand: () => 0 });
  const idx = beside.map((p, i) => (p.requeued ? i : -1)).find((i) => i >= 0);
  assert.notEqual(beside[idx - 1]?.skill, 'x'); assert.notEqual(beside[idx + 1]?.skill, 'x');
});

test('reviewFirst: the week\'s prerequisites, most decayed first; suggestToday', () => {
  const states = new Map([
    ['imperfect-active', { ...addToPractice(newState('imperfect-active', NOW), NOW), stability_days: 1, due_at: new Date(NOW - 5 * DAY_MS).toISOString() }],
  ]);
  // The prerequisites of the week's skills (skills.json: imperfect-subjunctive ← present-subjunctive, infinitive, imperfect-active; dative ← nominative, accusative), the lapsed one first, then the new ones in order.
  const list = reviewFirst({ weekSkills: ['imperfect-subjunctive', 'dative-indirect-object'], skills: S, states, now: NOW });
  assert.deepEqual(list.map((x) => x.skill), ['imperfect-active', 'present-subjunctive', 'infinitive', 'nominative-subject', 'accusative-object']);
  assert.equal(list[0].state, 'lapsed');
  const today = suggestToday({ states, skills: S, currentWeek: ['imperfect-subjunctive'], now: NOW });
  assert.deepEqual(today.learn, ['imperfect-subjunctive']);
});
