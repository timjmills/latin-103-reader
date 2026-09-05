// Sessions (GRAMMAR-PLAN.md §4): the Learn flow for one skill and the mixed
// Practice session. No DOM — ui.js drives these and renders. Every answer is
// judged here (items.js matching), logged as a drill_attempt, and fed to the
// scheduler; a wrong practice answer re-queues the skill later in the session
// and records the confusion pair when the chosen distractor names one.

import { matchesForm, matchParse } from './items.js';
import { applyAnswer, learnCriterion, passLearn, startLearning, requeue, buildSession } from './scheduler.js';

export const LEARN_GUIDED = 5;
export const LEARN_BLOCKED = 10;
export const HINT_MS_PENALTY = 0;   // hints are logged, never timed against the learner

/** Judge an answer against an item. `value`: a string (type / choice value) or, for a chart, { cellIndex: string }. Pure. */
export function judge(item, value) {
  if (!item) return { correct: false, expected: '', given: '' };
  if (item.input === 'chart') {
    const cells = item.chart?.cells ?? [];
    const given = value && typeof value === 'object' ? value : {};
    const results = cells.map((c, i) => ({ i, ok: matchesForm(given[i] ?? '', c.answer), given: given[i] ?? '', expected: c.answer[0] }));
    return { correct: results.every((r) => r.ok), cells: results, expected: cells.map((c) => c.answer[0]).join(', '), given: results.map((r) => r.given).join(', ') };
  }
  if (item.input === 'tap') {
    const i = Number(value);
    const ok = (item.accept || []).includes(i);
    const word = item.meanings?.[i]?.text ?? '';
    return { correct: ok, expected: item.target?.text ?? item.answer?.[0] ?? '', given: word || String(value ?? '') };
  }
  const given = String(value ?? '');
  if (item.input === 'choice') {
    const ch = (item.choices || []).find((c) => c.value === given);
    return { correct: !!ch?.correct, expected: (item.choices || []).find((c) => c.correct)?.label ?? item.answer?.[0] ?? '', given: ch?.label ?? given, choice: ch ?? null };
  }
  if (item.expect) return { correct: matchParse(given, item.expect), expected: item.answer?.[0] ?? '', given };
  return { correct: matchesForm(given, item.answer || []), expected: item.answer?.[0] ?? '', given };
}

/** The confusable skill a wrong choice points at, if the distractor came from one. Pure. */
export function confusedWith(item, result) {
  const s = result?.choice?.skill;
  return s && s !== item.skill ? s : null;
}

/**
 * One drill run over a list of slots. `getItem(slot)` makes the item;
 * `record(attempt, result)` persists. Shared by Learn's phases and Practice.
 */
function createRunner({ slots, getItem, mode, onAnswer, requeueOn = false, skills = null, rand = Math.random }) {
  let queue = [...slots];
  let index = 0;
  let current = null;
  let startedAt = 0;
  let hinted = false;
  const log = [];
  function load() {
    while (index < queue.length) {
      const slot = queue[index];
      const item = getItem(slot);
      if (item) { current = { item, slot }; startedAt = Date.now(); hinted = false; return current; }
      index += 1;   // nothing could be built for the slot: skip it
    }
    current = null;
    return null;
  }
  return {
    get length() { return queue.length; },
    get position() { return index; },
    get current() { return current; },
    get log() { return log; },
    start() { return load(); },
    hint() { hinted = true; },
    async answer(value) {
      if (!current) return null;
      const { item, slot } = current;
      const result = judge(item, value);
      const took = Date.now() - startedAt;
      const attempt = { skill: item.skill, kind: item.kind, item_key: item.key, mode, correct: result.correct, hinted, answer: String(result.given ?? '').slice(0, 200), expected: String(result.expected ?? '').slice(0, 200), confused_with: result.correct ? null : confusedWith(item, result), ms: took, at: new Date().toISOString() };
      log.push(attempt);
      if (!result.correct && requeueOn) queue = [...queue.slice(0, index + 1), ...requeue(queue.slice(index + 1), { skill: item.skill, kind: item.kind, stage: slot.stage ?? item.stage, skills, rand })];
      await onAnswer?.({ item, slot, result, attempt, hinted, ms: took });
      return { ...result, attempt, item };
    },
    next() { index += 1; return load(); },
    /** Open-ended sessions: more slots appended. */
    extend(more) { queue = [...queue, ...more]; if (!current) return load(); return current; },
    summary() {
      const right = log.filter((a) => a.correct).length;
      const skillsSeen = [...new Set(log.map((a) => a.skill))];
      const wrong = log.filter((a) => !a.correct).map((a) => a.skill);
      return { total: log.length, right, wrong: [...new Set(wrong)], skills: skillsSeen, hinted: log.filter((a) => a.hinted).length, ms: log.reduce((n, a) => n + (a.ms || 0), 0) };
    },
  };
}

/**
 * Learn flow for one skill: lesson → worked examples → guided 5 (hint shown)
 * → blocked 10 (hint behind a button) → criterion (6 of 10 across ≥ 2 kinds)
 * → pass (practising, due tomorrow) or redo (fresh blocked 10).
 */
export function createLearn({ skill, gstore, items, rand = Math.random }) {
  const phases = ['lesson', 'examples', 'guided', 'blocked', 'result'];
  let phase = 'lesson';
  let runner = null;
  let rounds = 0;
  const kinds = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
  const kindSeq = (n) => { const out = []; let last = null; for (let i = 0; i < n; i++) { const pool = kinds.filter((k) => k !== last); const k = pool[Math.floor(rand() * pool.length)]; out.push({ skill: skill.id, kind: k, stage: k === 'blank' || k === 'parse' ? 2 : 1, currentWeek: false }); last = k; } return out; };
  const getItem = (slot) => items.generate({ skill: skill.id, kind: slot.kind, stage: slot.stage, full: phase === 'guided' && slot.kind === 'chart' });
  const record = async ({ attempt, result }) => {
    await gstore.addAttempt(attempt);
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(skill.id, attempt.confused_with);
  };
  return {
    skill,
    get phase() { return phase; },
    get runner() { return runner; },
    get rounds() { return rounds; },
    async begin() {
      const cur = gstore.getState(skill.id);
      await gstore.setState(startLearning(cur ?? skill.id));
    },
    goto(p) { if (phases.includes(p)) phase = p; return phase; },
    startGuided() { phase = 'guided'; runner = createRunner({ slots: kindSeq(LEARN_GUIDED), getItem, mode: 'learn', onAnswer: record, rand }); return runner.start(); },
    startBlocked() { phase = 'blocked'; rounds += 1; runner = createRunner({ slots: kindSeq(LEARN_BLOCKED), getItem, mode: 'learn', onAnswer: record, rand }); return runner.start(); },
    /** After the blocked drill: the criterion over its attempts. */
    async finishBlocked() {
      phase = 'result';
      const c = learnCriterion(runner.log);
      if (c.passed) await gstore.setState(passLearn(gstore.getState(skill.id) ?? skill.id));
      const missed = runner.log.filter((a) => !a.correct);
      return { ...c, missed, rounds };
    },
  };
}

/**
 * Practice: a mixed session from the scheduler's plan. `size` null = open
 * (batches of 10 until the learner stops). Answers update skill_state at
 * once, so a second device sees the change.
 */
export function createPractice({ plan = null, gstore, items, skillsIndex, currentWeekN = null, currentWeekSkills = [], preset = 'review-heavy', size = 10, oneSkill = null, rand = Math.random }) {
  const skills = skillsIndex.skills;
  const build = (n) => buildSession({ states: gstore.getStates(), skills, confusions: gstore.getConfusions(), preset, currentWeek: currentWeekSkills, size: n, oneSkill, seed: Math.floor(rand() * 1e9) });
  const slots = plan ?? build(size ?? 10);
  const getItem = (slot) => items.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, currentWeekN });
  const onAnswer = async ({ item, result, attempt, hinted, ms }) => {
    await gstore.addAttempt(attempt);
    const cur = gstore.getState(item.skill) ?? item.skill;
    await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, ms }));
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  const runner = createRunner({ slots, getItem, mode: 'practice', onAnswer, requeueOn: true, skills, rand });
  return {
    runner, preset, size, open: size == null,
    start: () => runner.start(),
    /** Open-ended: another batch. */
    more: () => runner.extend(build(10)),
  };
}

/** "Practice this skill": a 5-item blocked set on one skill (practice mode, scheduler updated). */
export function createBlockedFive({ skill, gstore, items, skillsIndex, rand = Math.random }) {
  const st = gstore.getState(skill.id);
  const stage = st?.stage ?? 1;
  const plan = buildSession({ states: new Map([[skill.id, { ...(st ?? { skill: skill.id, state: 'practising', stage }), state: 'practising' }]]), skills: skillsIndex.skills, preset: 'one-skill', oneSkill: skill.id, size: 5, seed: Math.floor(rand() * 1e9) });
  return createPractice({ plan, gstore, items, skillsIndex, preset: 'one-skill', size: 5, oneSkill: skill.id, rand });
}
