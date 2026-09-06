// Sessions (GRAMMAR-PLAN.md §4): the Learn flow for one skill and the mixed
// Practice session. No DOM — ui.js drives these and renders. Every answer is
// judged here (items.js matching), logged as a drill_attempt, and fed to the
// scheduler; a wrong practice answer re-queues the skill later in the session
// and records the confusion pair when the chosen distractor names one.

import { matchesForm, matchParse, matchFunction, parseFeatures, normaliseAnswer } from './items.js';
import { applyAnswer, learnCriterion, passLearn, startLearning, requeue, buildSession } from './scheduler.js';

export const LEARN_GUIDED = 5;
export const LEARN_BLOCKED = 10;

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
  if (item.expect?.kind === 'function') { const m = matchFunction(given, item.expect); return { correct: m.correct, expected: item.answer?.[0] ?? '', given, confusedSkill: m.confused }; }
  if (item.expect) return { correct: matchParse(given, item.expect), expected: item.answer?.[0] ?? '', given };
  return { correct: matchesForm(given, item.answer || []), expected: item.answer?.[0] ?? '', given };
}

/**
 * The confusable skill a wrong answer points at, whichever way it was given:
 * a distractor from that skill; a tapped word that skill's filter fits
 * (`item.confuse.indexes`); a typed parse naming that skill's value
 * (`confuse.values`); a typed or chart form that is another cell of the
 * paradigm (`confuse.forms`); a typed function naming it. Pure.
 */
export function confusedWith(item, result) {
  if (!item || !result || result.correct) return null;
  const own = (s) => (s && s !== item.skill ? s : null);
  if (result.choice) return own(result.choice.skill);
  if (result.confusedSkill) return own(result.confusedSkill);
  const conf = item.confuse || {};
  if (item.input === 'tap') return own(conf.indexes?.[String(result.index ?? result.given)] ?? null);
  const value = (v) => own(conf.values?.[v] ?? null);
  if (item.input === 'type' && item.expect && item.expectKey) {
    const f = parseFeatures(result.given || '');
    const k = item.expectKey;
    const v = k === 'case' || k === 'gender' || k === 'number' || k === 'degree' || k === 'voice' ? f[k]
      : k === 'person' ? (f.person && f.number ? `${f.person} ${f.number}` : null) : (f.tense && f.mood ? `${f.tense} ${f.mood}` : null);
    return typeof v === 'string' ? value(v) : null;
  }
  if (item.input === 'type' || item.input === 'chart') {
    const typed = item.input === 'chart' ? (result.cells || []).filter((c) => !c.ok).map((c) => c.given) : [result.given];
    for (const t of typed) { const sid = conf.forms?.[normaliseAnswer(t || '')]; if (sid) return own(sid); }
  }
  return null;
}

/**
 * One drill run over a list of slots. `getItem(slot)` makes the item;
 * `record(attempt, result)` persists. Shared by Learn's phases and Practice.
 */
function createRunner({ slots, getItem, mode, onAnswer, requeueOn = false, skills = null, rand = Math.random, fill = null, resume = null, onChange = null }) {
  let queue = [...(resume?.queue ?? slots)];
  let index = resume?.index ?? 0;
  let current = null;
  let startedAt = 0;
  let hinted = false;
  const log = [...(resume?.log ?? [])];
  let answered = false;   // the item at `index` has been answered: a resume starts after it
  const changed = () => { try { onChange?.(snapshot()); } catch { /* storage */ } };
  function snapshot() { return { queue, index: answered ? index + 1 : index, log }; }
  function load() {
    while (index < queue.length) {
      const slot = queue[index];
      const prevKind = log.length ? log[log.length - 1].kind : null;
      const item = getItem(slot, { avoid: [prevKind, queue[index + 1]?.kind].filter(Boolean) });
      if (item) { current = { item, slot }; startedAt = Date.now(); hinted = false; answered = false; changed(); return current; }
      index += 1;   // nothing could be built for the slot: skip it
    }
    current = null;
    changed();
    return null;
  }
  return {
    get length() { return queue.length; },
    get position() { return index; },
    get current() { return current; },
    get log() { return log; },
    snapshot,
    start() { return load(); },
    hint() { hinted = true; },
    async answer(value) {
      if (!current) return null;
      const { item, slot } = current;
      const result = judge(item, value);
      if (item.input === 'tap') result.index = Number(value);
      const took = Date.now() - startedAt;
      const attempt = { skill: item.skill, kind: item.kind, item_key: item.key, mode, correct: result.correct, hinted, answer: String(result.given ?? '').slice(0, 200), expected: String(result.expected ?? '').slice(0, 200), confused_with: result.correct ? null : confusedWith(item, result), ms: took, at: new Date().toISOString() };
      log.push(attempt);
      answered = true;
      if (!result.correct && requeueOn) queue = [...queue.slice(0, index + 1), ...requeue(queue.slice(index + 1), { skill: item.skill, kind: item.kind, stage: slot.stage ?? item.stage, skills, rand, fill })];
      await onAnswer?.({ item, slot, result, attempt, hinted, ms: took });
      changed();
      return { ...result, attempt, item };
    },
    next() { index += 1; return load(); },
    /** Open-ended sessions: more slots appended. */
    extend(more) { queue = [...queue, ...more]; changed(); if (!current) return load(); return current; },
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
  // Recognition before recall (plan §3): the guided five are stage-1 items (choices, a whole chart);
  // the blocked ten mix stages 1–2 (typed parse and blank from stage 2).
  const kindSeq = (n, stageOf) => { const out = []; let last = null; for (let i = 0; i < n; i++) { const pool = kinds.filter((k) => k !== last); const k = pool[Math.floor(rand() * pool.length)]; out.push({ skill: skill.id, kind: k, stage: stageOf(k), currentWeek: false }); last = k; } return out; };
  const getItem = (slot, opts = {}) => items.generate({ skill: skill.id, kind: slot.kind, stage: slot.stage, full: phase === 'guided' && slot.kind === 'chart', avoid: opts.avoid });
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
    startGuided() { phase = 'guided'; runner = createRunner({ slots: kindSeq(LEARN_GUIDED, () => 1), getItem, mode: 'learn', onAnswer: record, rand }); return runner.start(); },
    startBlocked() { phase = 'blocked'; rounds += 1; runner = createRunner({ slots: kindSeq(LEARN_BLOCKED, (k) => (k === 'blank' || k === 'parse' ? 2 : 1)), getItem, mode: 'learn', onAnswer: record, rand }); return runner.start(); },
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
export function createPractice({ plan = null, gstore, items, skillsIndex, currentWeekN = null, currentWeekSkills = [], preset = 'review-heavy', size = 10, oneSkill = null, rand = Math.random, resume = null, onChange = null }) {
  const skills = skillsIndex.skills;
  // Only skills that can produce an item enter a plan (M8): a metre skill or one with no sentences never becomes a slot.
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  const build = (n, exclude = null) => buildSession({ states: gstore.getStates(), skills: exclude ? new Map([...drillSkills].filter(([id]) => id !== exclude)) : drillSkills, confusions: gstore.getConfusions(), preset: exclude && preset === 'one-skill' ? 'review-heavy' : preset, currentWeek: currentWeekSkills, size: n, oneSkill, seed: Math.floor(rand() * 1e9) });
  const slots = plan ?? build(size ?? 10);
  const getItem = (slot, opts = {}) => items.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, currentWeekN, avoid: opts.avoid });
  const onAnswer = async ({ item, result, attempt, hinted, ms }) => {
    await gstore.addAttempt(attempt);
    const cur = gstore.getState(item.skill) ?? item.skill;
    await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, ms }));
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  // A blocked set on one skill repeats that skill by design, so a wrong answer there is not re-queued (it could only come back at once).
  const runner = createRunner({ slots, getItem, mode: 'practice', onAnswer, requeueOn: preset !== 'one-skill', skills, rand, fill: (n, exclude) => build(n, exclude), resume, onChange });
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
