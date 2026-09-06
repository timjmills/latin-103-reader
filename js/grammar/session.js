// Sessions (GRAMMAR-PLAN.md §4): the Learn flow for one skill and the mixed
// Practice session. No DOM — ui.js drives these and renders. Every answer is
// judged here (items.js matching), logged as a drill_attempt, and fed to the
// scheduler; a wrong practice answer re-queues the skill later in the session
// and records the confusion pair when the chosen distractor names one.

import { matchesForm, matchesFormExact, matchParse, matchFunction, parseFeatures, normaliseAnswer } from './items.js';
import { applyAnswer, learnCriterion, passLearn, startLearning, requeue, buildSession } from './scheduler.js';
import { matchQuestion } from './sets.js';
import { orderMatches } from './stage3.js';

export const LEARN_GUIDED = 5;
export const LEARN_BLOCKED = 10;
/**
 * A chapter set's Learn pass is a batch, not the whole deck. `vocab-27` holds
 * ~119 words; 119 items followed by a blocked ten is not a sitting, and
 * GRAMMAR-PLAN §4 sizes a session at 5 / 10 / 15 / open. The learner takes the
 * deck fifteen at a time, sees how far through it is, and can stop and come
 * back — the pool remembers which words have been shown (CR M8).
 */
export const SET_LEARN_BATCH = 15;

/**
 * Judge an answer against an item. `value`: a string (type / choice value); a
 * word index (tap); { cellIndex: string } (chart); an array of chunk indexes
 * (order); { leftIndex: rightIndex } (match); { blankIndex: string } (inline /
 * bank); 'right' | 'partly' | 'wrong' (self). Pure.
 */
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
  if (item.input === 'order') {
    const order = Array.isArray(value) ? value.map(Number) : [];
    const chunks = item.chunks || [];
    // The recap reads back what was on screen: the chips carry `display` (the last word without its full stop, m1),
    // while judging is always against `chunks`, the book's own text.
    const shown = item.display ?? chunks;
    return { correct: orderMatches(chunks, order), expected: chunks.join(' '), given: order.map((i) => shown[i] ?? '').join(' ') };
  }
  if (item.input === 'match') {
    const given = value && typeof value === 'object' ? value : {};
    const pairs = item.pairs || [];
    const right = item.right || [];
    const results = pairs.map((p, i) => { const r = right[Number(given[i])]; return { i, ok: !!r && r.pair === i, given: r?.text ?? '', expected: p.en, la: p.la }; });
    return { correct: results.every((r) => r.ok), cells: results, expected: pairs.map((p) => `${p.la} — ${p.en}`).join(', '), given: results.map((r) => `${r.la} — ${r.given || '—'}`).join(', ') };
  }
  if (item.input === 'inline' || item.input === 'bank') {
    const given = value && typeof value === 'object' ? value : {};
    const blanks = item.blanks || [];
    // A pensum blank is macron-sensitive (`item.exact`): Ørberg's Pensum B for chapter I offers *Italia* beside
    // *Italiā* precisely to drill the contrast, so accepting either would delete the exercise. Ordinary drills stay
    // macron-optional. Pensum A also accepts the ending alone or the whole word (stem + ending).
    const exact = !!item.exact;
    const results = blanks.map((b, i) => {
      const g = String(given[i] ?? '');
      const whole = b.stem ? b.answers.map((a) => b.stem + a) : [];
      const hit = (fn) => fn(g, b.answers) || (whole.length > 0 && fn(g, whole));
      const ok = exact ? hit(matchesFormExact) : hit(matchesForm);
      return { i, ok, macron: !ok && exact && hit(matchesForm), given: g, expected: b.answers[0], stem: b.stem ?? '', note: b.note ?? '' };
    });
    return { correct: results.every((r) => r.ok), macron: results.some((r) => r.macron), cells: results, expected: blanks.map((b) => b.answers[0]).join(', '), given: results.map((r) => r.given || '—').join(', ') };
  }
  if (item.input === 'self') {
    const g = String(value ?? '');
    return { correct: g === 'right' || g === 'partly', partial: g === 'partly', self: true, expected: item.answer?.[0] ?? '', given: g };
  }
  const given = String(value ?? '');
  if (item.input === 'choice') {
    const ch = (item.choices || []).find((c) => c.value === given);
    return { correct: !!ch?.correct, expected: (item.choices || []).find((c) => c.correct)?.label ?? item.answer?.[0] ?? '', given: ch?.label ?? given, choice: ch ?? null };
  }
  if (item.expect?.kind === 'function') { const m = matchFunction(given, item.expect); return { correct: m.correct, expected: item.answer?.[0] ?? '', given, confusedSkill: m.confused }; }
  if (item.expect) return { correct: matchParse(given, item.expect), expected: item.answer?.[0] ?? '', given };
  if (item.kind === 'question' || (item.kind === 'pensum' && item.pensum === 'C')) return { correct: matchQuestion(given, item.answer || [], item.feedback?.sentence ?? ''), expected: item.answer?.[0] ?? '', given };
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
    get queue() { return queue; },
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
      // A self-graded answer (translate) is weaker evidence: logged self: true and weighted as hinted (the server row has no column; `answer` carries the grade).
      const self = !!result.self;
      const attempt = { skill: item.skill, kind: item.kind, item_key: item.key, mode, correct: result.correct, hinted: hinted || self, self, partial: !!result.partial, answer: self ? `self: ${result.given}` : String(result.given ?? '').slice(0, 200), expected: String(result.expected ?? '').slice(0, 200), confused_with: result.correct ? null : confusedWith(item, result), ms: took, at: new Date().toISOString() };
      log.push(attempt);
      answered = true;
      if (!result.correct && requeueOn) queue = [...queue.slice(0, index + 1), ...requeue(queue.slice(index + 1), { skill: item.skill, kind: item.kind, stage: slot.stage ?? item.stage, skills, rand, fill, played: queue.slice(0, index + 1) })];
      await onAnswer?.({ item, slot, result, attempt, hinted: hinted || self, partial: !!result.partial, ms: took });
      changed();
      return { ...result, attempt, item };
    },
    next() { index += 1; return load(); },
    /** Open-ended sessions: more slots appended. */
    extend(more) { queue = [...queue, ...more]; changed(); if (!current) return load(); return current; },
    summary() {
      const right = log.filter((a) => a.correct).length;
      const partly = log.filter((a) => a.correct && a.partial).length;
      const skillsSeen = [...new Set(log.map((a) => a.skill))];
      const wrong = log.filter((a) => !a.correct).map((a) => a.skill);
      return { total: log.length, right, partly, wrong: [...new Set(wrong)], skills: skillsSeen, hinted: log.filter((a) => a.hinted).length, ms: log.reduce((n, a) => n + (a.ms || 0), 0) };
    },
  };
}

/**
 * Learn flow for one skill: lesson → worked examples → guided 5 (hint shown)
 * → blocked 10 (hint behind a button) → criterion (6 of 10 across ≥ 2 kinds)
 * → pass (practising, due tomorrow) or redo (fresh blocked 10).
 */
export function createLearn({ skill, gstore, items, rand = Math.random, resume = null, onProgress = null }) {
  const phases = ['lesson', 'examples', 'guided', 'blocked', 'result'];
  let phase = 'lesson';
  let runner = null;
  let rounds = 0;
  const isSet = !!skill.set;
  const kinds = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
  // Recognition before recall (plan §3): the guided five are stage-1 items (choices, a whole chart);
  // the blocked ten mix stages 1–2 (typed parse and blank from stage 2).
  const kindSeq = (n, stageOf) => { const out = []; let last = null; for (let i = 0; i < n; i++) { const pool = kinds.filter((k) => k !== last); const k = (pool.length ? pool : kinds)[Math.floor(rand() * (pool.length || kinds.length))]; out.push({ skill: skill.id, kind: k, stage: stageOf(k), currentWeek: false }); last = k; } return out; };
  const getItem = (slot, opts = {}) => items.generate({ skill: skill.id, kind: slot.kind, stage: slot.stage, full: phase === 'guided' && slot.kind === 'chart', avoid: opts.avoid, match: isSet && phase === 'guided' ? false : undefined });
  // A chapter set's "guided" phase walks the deck in batches, with feedback after each item; the blocked ten follow.
  const total = isSet ? Math.max(1, Number(skill.count) || 0) : LEARN_GUIDED;
  const deckSize = isSet ? Math.min(SET_LEARN_BATCH, total) : LEARN_GUIDED;
  let seen = isSet ? Math.max(0, Math.min(total, Number(resume?.seen) || 0)) : 0;
  const record = async ({ attempt, result }) => {
    if (isSet && phase === 'guided') { seen = Math.min(total, seen + 1); try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ } }
    await gstore.addAttempt(attempt);
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(skill.id, attempt.confused_with);
  };
  const batchOf = () => Math.max(1, Math.min(deckSize, total - seen) || deckSize);
  return {
    skill,
    isSet,
    deckSize,
    get total() { return total; },
    get seen() { return seen; },
    get left() { return Math.max(0, total - seen); },
    get batchSize() { return batchOf(); },
    get phase() { return phase; },
    get runner() { return runner; },
    get rounds() { return rounds; },
    async begin() {
      const cur = gstore.getState(skill.id);
      await gstore.setState(startLearning(cur ?? skill.id));
    },
    goto(p) { if (phases.includes(p)) phase = p; return phase; },
    /** A batch of the guided pass. `fresh` (the default when nothing was resumed) starts the deck from the top. */
    startGuided({ fresh = seen === 0 } = {}) {
      phase = 'guided';
      if (isSet && fresh) { items.pool.reset(skill.id); seen = 0; }   // from the top
      runner = createRunner({ slots: kindSeq(batchOf(), () => 1), getItem, mode: 'learn', onAnswer: record, rand });
      try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ }
      return runner.start();
    },
    /** The next batch of the same pass: the pool keeps its place, so no word comes round twice. */
    moreGuided() { return this.startGuided({ fresh: false }); },
    startBlocked() { phase = 'blocked'; rounds += 1; try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ } runner = createRunner({ slots: kindSeq(LEARN_BLOCKED, (k) => (k === 'blank' || k === 'parse' ? 2 : 1)), getItem, mode: 'learn', onAnswer: record, rand }); return runner.start(); },
    /** After the blocked drill: the criterion over its attempts (a set has one kind, so the two-kinds rule does not apply to it). */
    async finishBlocked() {
      phase = 'result';
      const c = learnCriterion(runner.log, isSet ? { kinds: 1 } : {});
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
export function createPractice({ plan = null, gstore, items, skillsIndex, currentWeekN = null, currentWeekSkills = [], preset = 'review-heavy', size = 10, oneSkill = null, rand = Math.random, resume = null, onChange = null, fill = undefined }) {
  const skills = skillsIndex.skills;
  // Only skills that can produce an item enter a plan (M8): a metre skill or one with no sentences never becomes a slot.
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  const build = (n, exclude = null, prior = null) => buildSession({ states: gstore.getStates(), skills: exclude ? new Map([...drillSkills].filter(([id]) => id !== exclude)) : drillSkills, confusions: gstore.getConfusions(), preset: exclude && preset === 'one-skill' ? 'review-heavy' : preset, currentWeek: currentWeekSkills, size: n, oneSkill, seed: Math.floor(rand() * 1e9), prior });
  const slots = plan ?? build(size ?? 10);
  const getItem = (slot, opts = {}) => items.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, currentWeekN, avoid: opts.avoid });
  const onAnswer = async ({ item, result, attempt, hinted, partial, ms }) => {
    await gstore.addAttempt(attempt);
    const cur = gstore.getState(item.skill) ?? item.skill;
    await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, partial, ms }));
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  // A blocked set on one skill repeats that skill by design, so a wrong answer there is not re-queued (it could only come back at once).
  //  is a caller saying no other skill may enter the session at all (the confusion pair's ten): a re-queue
  // that cannot find room is then dropped rather than padded out with a third skill.
  const filler = fill === undefined ? (n, exclude) => build(n, exclude) : fill;
  const runner = createRunner({ slots, getItem, mode: 'practice', onAnswer, requeueOn: preset !== 'one-skill', skills, rand, fill: filler, resume, onChange });
  return {
    runner, preset, size, open: size == null,
    start: () => runner.start(),
    /** Open-ended: another batch, counting the chapter-set window across the seam. */
    more: () => runner.extend(build(10, null, runner.queue)),
  };
}

/** "Practice this skill": a 5-item blocked set on one skill (practice mode, scheduler updated). */
export function createBlockedFive({ skill, gstore, items, skillsIndex, rand = Math.random }) {
  const st = gstore.getState(skill.id);
  const stage = st?.stage ?? 1;
  const plan = buildSession({ states: new Map([[skill.id, { ...(st ?? { skill: skill.id, state: 'practising', stage }), state: 'practising' }]]), skills: skillsIndex.skills, preset: 'one-skill', oneSkill: skill.id, size: 5, seed: Math.floor(rand() * 1e9) });
  return createPractice({ plan, gstore, items, skillsIndex, preset: 'one-skill', size: 5, oneSkill: skill.id, rand });
}
