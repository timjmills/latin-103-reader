// node --test tests/ — the grammar scheduler (GRAMMAR-CONTRACT.md "Scheduler"):
// state transitions, stability, the Learn criterion, the session builder's
// interleaving rules and the re-queue after a wrong answer (never immediate,
// never beside itself, never a neighbour's kind — over 500 seeds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, normaliseState, applyAnswer, decay, isDue, learnCriterion, passLearn, startLearning, addToPractice,
  buildSession, requeue, reviewFirst, suggestToday, kindsFor, orderCandidates, rng, DAY_MS, STABILITY_FLOOR, MASTERED_DAYS, SET_WINDOW, SET_MAX, setSlotAllowed} from '../app/js/grammar/scheduler.js';
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
  assert.equal(applyAnswer(s, { correct: false, now: t }).state, 'practising');
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
  // Stage 3 adds the production kinds (wave 2) to every drillable grammar skill; a chapter set keeps its one kind.
  assert.deepEqual(kindsFor(S.get('dative-indirect-object'), 3), ['parse', 'blank', 'transform', 'reorder', 'translate', 'chart']);
  assert.deepEqual(kindsFor({ kinds: ['blank'] }, 1), ['blank']);
  assert.deepEqual(kindsFor({ kinds: ['blank'] }, 3), ['blank']);
  assert.deepEqual(kindsFor({ set: 'vocab', kinds: ['vocab'] }, 3), ['vocab']);
});

test('buildSession: chapter sets take at most 3 of 10 slots (SET_SHARE) unless the preset is "this-week"', () => {
  const sets = new Map([['questions-07', { id: 'questions-07', set: 'questions', kinds: ['question'], confusable_with: [] }], ['vocab-07', { id: 'vocab-07', set: 'vocab', kinds: ['vocab'], confusable_with: [] }], ['pensum-07', { id: 'pensum-07', set: 'pensum', kinds: ['pensum'], confusable_with: [] }]]);
  const all = new Map([...S, ...sets]);
  const ids = ['dative-indirect-object', 'ablative-means', 'genitive-of', ...sets.keys()];
  for (let seed = 1; seed <= 200; seed++) {
    const plan = buildSession({ states: rotation(ids), skills: all, preset: 'review-heavy', size: 10, now: NOW, seed });
    assert.equal(plan.length, 10);
    assert.ok(plan.filter((p) => sets.has(p.skill)).length <= 3, `seed ${seed}: ${plan.map((p) => p.skill).join(',')}`);
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i].skill, plan[i - 1].skill);
  }
  const week = buildSession({ states: rotation(ids), skills: all, preset: 'this-week', currentWeek: [...sets.keys()], size: 9, now: NOW, seed: 5 });
  assert.ok(week.filter((p) => sets.has(p.skill)).length >= 4, 'this week: the week\'s sets take their two-thirds');
  const alone = buildSession({ states: rotation(['vocab-07']), skills: all, preset: 'one-skill', oneSkill: 'vocab-07', size: 5, now: NOW, seed: 1 });
  assert.equal(alone.length, 5);
  assert.ok(alone.every((p) => p.skill === 'vocab-07' && p.kind === 'vocab'));
});

test('the chapter-set cap is a sliding window: at most 3 in any ten in a row, over a long session, across an open session batch seam, and through a re-queue', () => {
  const sets = new Map([['questions-07', { id: 'questions-07', set: 'questions', kinds: ['question'], confusable_with: [] }], ['vocab-07', { id: 'vocab-07', set: 'vocab', kinds: ['vocab'], confusable_with: [] }], ['pensum-07', { id: 'pensum-07', set: 'pensum', kinds: ['pensum'], confusable_with: [] }]]);
  const all = new Map([...S, ...sets]);
  const ids = ['dative-indirect-object', 'ablative-means', 'genitive-of', ...sets.keys()];
  const isSet = (id) => sets.has(id);
  const windows = (plan) => { for (let i = 0; i + SET_WINDOW <= plan.length; i++) { const n = plan.slice(i, i + SET_WINDOW).filter((p) => isSet(p.skill)).length; assert.ok(n <= SET_MAX, `window at ${i}: ${n} set items in ${SET_WINDOW} — ${plan.map((p) => p.skill).join(',')}`); } };
  // A 15-item session: a session-total cap of floor(15 × 0.3) = 4 would let four land in one ten.
  for (let seed = 1; seed <= 120; seed++) windows(buildSession({ states: rotation(ids), skills: all, preset: 'review-heavy', size: 15, now: NOW, seed }));
  // An open session's second batch counts the first batch's tail (`prior`), so the seam is not a hole.
  for (let seed = 1; seed <= 120; seed++) {
    const first = buildSession({ states: rotation(ids), skills: all, preset: 'review-heavy', size: 10, now: NOW, seed });
    const second = buildSession({ states: rotation(ids), skills: all, preset: 'review-heavy', size: 10, now: NOW, seed: seed + 1000, prior: first });
    windows([...first, ...second]);
  }
  // A missed set item re-queues into a window that has room, never one that is full.
  for (let seed = 1; seed <= 120; seed++) {
    const plan = buildSession({ states: rotation(ids), skills: all, preset: 'review-heavy', size: 15, now: NOW, seed });
    const at = plan.findIndex((p) => isSet(p.skill));
    if (at < 0) continue;
    const played = plan.slice(0, at + 1);
    const rest = requeue(plan.slice(at + 1), { skill: plan[at].skill, kind: plan[at].kind, stage: 1, skills: all, rand: () => 0.5, played });
    windows([...played, ...rest]);
  }
  // setSlotAllowed itself: three sets in the last nine closes the window, and it reopens as they slide out.
  const set3 = [{ skill: 'vocab-07' }, { skill: 'questions-07' }, { skill: 'pensum-07' }];
  assert.equal(setSlotAllowed(set3, isSet), false);
  assert.equal(setSlotAllowed([...set3, ...Array.from({ length: 7 }, () => ({ skill: 'genitive-of' }))], isSet), true, 'the oldest set item has slid out of the ten');
});

test('applyAnswer: a self-graded "partly" holds the stability (× 1) and never steps the stage', () => {
  const base = { ...addToPractice(newState('a', NOW), NOW), stability_days: 4, due_at: new Date(NOW - 1000).toISOString(), streak: 3 };
  const r = applyAnswer(base, { correct: true, hinted: true, partial: true, ms: 3000, now: NOW });
  assert.equal(r.stability_days, 4);
  assert.equal(r.stage, 1);
  assert.equal(r.successes, 1);
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
    assert.equal(plan.filter((p) => p.currentWeek).length, 3);   // ≈ 20 % of 15
  }
});

test('buildSession: due skills come first; this-week gives two thirds to the current week, round-robin over its skills (m1); one-skill blocks', () => {
  const states = rotation(['nominative-subject', 'genitive-of', 'ablative-means'], { due: false });
  states.set('dative-indirect-object', { ...addToPractice(newState('dative-indirect-object', NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString() });
  const plan = buildSession({ states, skills: S, preset: 'review-heavy', size: 4, now: NOW, seed: 7 });
  assert.equal(plan[0].skill, 'dative-indirect-object');
  const all = rotation(['nominative-subject', 'genitive-of', 'dative-indirect-object', 'ablative-means', 'perfect-active', 'imperfect-subjunctive', 'purpose-clause']);
  const cw = ['imperfect-subjunctive', 'perfect-active', 'purpose-clause'];
  for (const seed of [3, 11, 29]) {
    const week = buildSession({ states: all, skills: S, preset: 'this-week', currentWeek: cw, size: 12, now: NOW, seed });
    const counts = cw.map((id) => week.filter((p) => p.skill === id).length);
    assert.ok(counts.reduce((a, b) => a + b) >= 8, `two thirds of 12 from the week, got ${counts}`);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `week skills shared out: ${counts}`);
    assert.ok(counts.every((n) => n > 0), `no week skill starved: ${counts}`);
  }
  const one = buildSession({ states: all, skills: S, preset: 'one-skill', oneSkill: 'genitive-of', size: 5, now: NOW, seed: 3 });
  assert.equal(one.length, 5);
  assert.ok(one.every((p) => p.skill === 'genitive-of'));
  for (let i = 1; i < one.length; i++) assert.notEqual(one[i].kind, one[i - 1].kind);
  assert.deepEqual(buildSession({ states: new Map(), skills: S, size: 5 }), []);
});

test('one-skill plans ignore decay (M1): "Practise this skill" on a lapsed row builds a full set; mixed presets still lapse it', () => {
  const lapsed = new Map([['dative-indirect-object', { ...addToPractice(newState('dative-indirect-object', NOW), NOW), stability_days: 1, due_at: new Date(NOW - 10 * DAY_MS).toISOString() }]]);
  assert.equal(decay(lapsed.get('dative-indirect-object'), NOW).state, 'lapsed');
  assert.equal(orderCandidates({ states: lapsed, skills: S, preset: 'one-skill', oneSkill: 'dative-indirect-object', now: NOW }).length, 1);
  assert.equal(buildSession({ states: lapsed, skills: S, preset: 'one-skill', oneSkill: 'dative-indirect-object', size: 5, now: NOW, seed: 1 }).length, 5);
  assert.deepEqual(buildSession({ states: lapsed, skills: S, preset: 'review-heavy', size: 5, now: NOW, seed: 1 }), []);
});

const KINDS4 = ['recognise', 'chart', 'parse', 'blank'];
const skillsFor = (ids, kinds = KINDS4) => new Map(ids.map((id) => [id, { id, kinds }]));

test('requeue: the skill returns 3–6 items later, never next to itself, never a neighbour\'s kind', () => {
  const plan = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => ({ skill: s, kind: 'blank', stage: 2 }));
  const skills = skillsFor([...plan.map((p) => p.skill), 'x']);
  for (let i = 0; i < 20; i++) {
    const out = requeue(plan, { skill: 'x', kind: 'blank', stage: 2, skills, rand: Math.random });
    const at = out.findIndex((p) => p.skill === 'x');
    assert.ok(at >= 3 && at <= 6, `re-queued at ${at}`);
    assert.ok(out[at].requeued);
    assert.notEqual(out[at].kind, out[at - 1].kind);
    if (out[at + 1]) assert.notEqual(out[at].kind, out[at + 1].kind);
  }
  // never beside itself
  const beside = requeue([{ skill: 'a' }, { skill: 'b' }, { skill: 'x' }, { skill: 'x' }, { skill: 'c' }].map((p) => ({ ...p, kind: 'blank', stage: 1 })), { skill: 'x', kind: 'blank', stage: 1, skills, rand: () => 0 });
  const idx = beside.map((p, i) => (p.requeued ? i : -1)).find((i) => i >= 0);
  assert.notEqual(beside[idx - 1]?.skill, 'x'); assert.notEqual(beside[idx + 1]?.skill, 'x');
});

test('requeue with a short remainder (M7): fillers from other skills hold the gap, or the re-queue is dropped — never immediate', () => {
  const skills = skillsFor(['a', 'b', 'c', 'd', 'x']);
  const fill = (n) => ['c', 'd', 'a', 'b'].slice(0, n).map((s) => ({ skill: s, kind: 'recognise', stage: 1 }));
  for (const rest of [[], [{ skill: 'a', kind: 'blank', stage: 1 }], [{ skill: 'a', kind: 'blank', stage: 1 }, { skill: 'b', kind: 'recognise', stage: 1 }]]) {
    const out = requeue(rest, { skill: 'x', kind: 'blank', stage: 1, skills, rand: () => 0, fill });
    const at = out.findIndex((p) => p.skill === 'x');
    assert.ok(at >= 3, `x re-queued at ${at} with ${rest.length} left`);
    assert.ok(out.slice(0, at).every((p) => p.skill !== 'x'));
    for (let i = 1; i < out.length; i++) { assert.notEqual(out[i].kind, out[i - 1].kind, `kinds ${out.map((p) => p.kind)}`); assert.notEqual(out[i].skill, out[i - 1].skill); }
  }
  // no fillers to be had (a one-skill set): nothing is inserted rather than something immediate
  const none = requeue([{ skill: 'a', kind: 'blank', stage: 1 }], { skill: 'x', kind: 'blank', stage: 1, skills, rand: () => 0 });
  assert.equal(none.some((p) => p.skill === 'x'), false);
  assert.equal(requeue([], { skill: 'x', kind: 'blank', stage: 1, skills }).length, 0);
});

test('requeue keeps the kind rule across 500 seeds of built sessions (G1-05)', () => {
  const ids = ['nominative-subject', 'genitive-of', 'dative-indirect-object', 'ablative-means', 'perfect-active', 'imperfect-subjunctive', 'purpose-clause', 'result-clause'];
  const states = rotation(ids);
  let violations = 0, inserted = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const rand = rng(seed);
    const plan = buildSession({ states, skills: S, preset: 'review-heavy', size: 10, now: NOW, seed });
    // answer item i wrong for a few i, re-queue the rest each time
    let queue = plan;
    for (const i of [1, 4, 7, 8]) {
      const cur = queue[i];
      if (!cur) continue;
      const fill = (n, exclude) => buildSession({ states, skills: new Map([...S].filter(([id]) => id !== exclude)), preset: 'review-heavy', size: n, now: NOW, seed: seed * 7 + i });
      const after = requeue(queue.slice(i + 1), { skill: cur.skill, kind: cur.kind, stage: cur.stage, skills: S, rand, fill });
      queue = [...queue.slice(0, i + 1), ...after];
      if (after.some((p) => p.requeued)) inserted += 1;
    }
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].kind === queue[i - 1].kind) violations += 1;
      if (queue[i].skill === queue[i - 1].skill) violations += 1;
    }
    const firstWrong = queue.findIndex((p) => p.requeued);
    if (firstWrong >= 0) { const before = queue.slice(0, firstWrong); assert.ok(before.length >= 3, `seed ${seed}: re-queued at ${firstWrong}`); }
  }
  assert.equal(violations, 0);
  assert.ok(inserted > 1000, `re-queues happened (${inserted})`);
});

test('reviewFirst: the week\'s prerequisites, most decayed first; suggestToday', () => {
  const states = new Map([
    ['imperfect-active', { ...addToPractice(newState('imperfect-active', NOW), NOW), stability_days: 1, due_at: new Date(NOW - 5 * DAY_MS).toISOString() }],
  ]);
  const list = reviewFirst({ weekSkills: ['imperfect-subjunctive', 'dative-indirect-object'], skills: S, states, now: NOW });
  assert.deepEqual(list.map((x) => x.skill), ['imperfect-active', 'present-subjunctive', 'infinitive', 'nominative-subject', 'accusative-object']);
  assert.equal(list[0].state, 'lapsed');
  const today = suggestToday({ states, skills: S, currentWeek: ['imperfect-subjunctive'], now: NOW });
  assert.deepEqual(today.learn, ['imperfect-subjunctive']);
});
