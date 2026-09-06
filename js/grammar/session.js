// Sessions (GRAMMAR-PLAN.md §4): the Learn flow for one skill and the mixed
// Practice session. No DOM — ui.js drives these and renders. Every answer is
// judged here (items.js matching), logged as a drill_attempt, and fed to the
// scheduler; a wrong practice answer re-queues the skill later in the session
// and records the confusion pair when the chosen distractor names one.

import { matchesForm, matchesFormExact, matchParse, matchFunction, parseFeatures, normaliseAnswer } from './items.js';
import { applyAnswer, learnCriterion, passLearn, startLearning, requeue, buildSession, buildRedoSession } from './scheduler.js';
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
 * How far a session may grow past what the learner asked for. Every wrong
 * answer re-queues, and a re-queued item answered wrong re-queues again: with
 * nothing to stop it a ten-item session answered wrongly throughout reached
 * **84 items and was still growing** (QA I1). The learner who most needs the
 * repetition is the one for whom the end recedes, which is the wrong way round.
 * A session may therefore grow by half of what was asked for (at least two
 * items); past that a miss is not re-queued — it comes back in the next
 * session instead, and the runner says so. Open-ended sessions count each
 * batch of ten as more asked for, so the ceiling moves with them.
 */
export const REQUEUE_GROWTH = 0.5;
export const REQUEUE_MIN_GROWTH = 2;
export const sessionCeiling = (asked) => asked + Math.max(REQUEUE_MIN_GROWTH, Math.ceil(asked * REQUEUE_GROWTH));

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
 * The items a run leaves missed (GRAMMAR-CONTRACT.md "Redo what was wrong"),
 * newest first. One row per (skill, item_key), the **last** answer to it
 * deciding — the same rule the store applies over the whole log, applied here
 * to one session's own log so the end of a session can offer its misses back
 * without a round trip. A self-graded "partly" is not a miss.
 *
 * This reads `log`, which holds first answers only: an immediate retry writes
 * nothing there, so trying an item again until it is right cannot take it off
 * this list. That is deliberate — the item was missed, and a redo later is the
 * spaced retrieval the plan wants. Pure.
 */
export function sessionMisses(log = []) {
  const last = new Map();
  for (const a of log) { if (!a?.skill || !a.item_key) continue; last.set(`${a.skill} ${a.item_key}`, a); }
  return [...last.values()]
    .filter((a) => !a.correct && !a.partial)
    .map((a) => ({ skill: a.skill, kind: a.kind, item_key: a.item_key, at: a.at, mode: a.mode }))
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
}

/**
 * One drill run over a list of slots. `getItem(slot)` makes the item;
 * `record(attempt, result)` persists. Shared by Learn's phases and Practice.
 *
 * Two rules from GRAMMAR-CONTRACT.md "Session flow — move on, step back,
 * colour the result" live here rather than in the view:
 *
 * - **Only the first answer to an item is logged.** A wrong answer holds the
 *   item where it is and the learner tries again until it is right; those
 *   retries are for learning. `answer()` judges a retry and hands the result
 *   back, but writes nothing: no `drill_attempts` row, no `skill_state`, no
 *   confusion, no re-queue, no place in `log` (so the Learn criterion and
 *   `successes_spaced` cannot be inflated by trying twice either).
 * - **`index` is where the learner is looking; `frontier` is how far the
 *   session has got.** `back()` and `forward()` walk `index` over items that
 *   are already made and already answered — a replay, never re-graded.
 *   `forward()` at the frontier is the deliberate press that gets past an item
 *   the learner has not managed, and it is the only thing that does.
 */
function createRunner({ slots, getItem, mode, onAnswer, requeueOn = false, skills = null, rand = Math.random, fill = null, resume = null, onChange = null, pair = null, grows = true }) {
  let queue = [...(resume?.queue ?? slots)];
  let index = resume?.index ?? 0;    // the item on screen
  let frontier = index;              // the furthest item reached: index never passes it
  let current = null;
  let startedAt = 0;
  let hinted = false;
  const log = [...(resume?.log ?? [])];
  const made = [];        // queue index → { item, slot } | null (null: the slot built nothing and is skipped)
  const results = [];     // queue index → the FIRST answer there: { result, attempt, value, hinted }
  // What the learner actually asked for, so "3 of 14" can say where the extra four came from.
  let asked = Number(resume?.asked) || (resume?.queue?.length ?? slots.length);
  let capped = false;     // a miss was not re-queued because the session is full
  // Slots that built nothing and were skipped. Ordinary sessions almost never have one (the scheduler only
  // plans drillable skills); a **redo** can, because it names items and a named item may have gone — the
  // sentence left the library, the deck changed. The session then simply holds fewer items and says so,
  // which is the contract's "drop it quietly and say the count is smaller, never crash".
  let dropped = 0;
  const ceiling = () => (grows ? sessionCeiling(asked) : Infinity);
  const changed = () => { try { onChange?.(snapshot()); } catch { /* storage */ } };
  // A resume restarts the walk at the frontier: the items before it were answered in another sitting and were not kept.
  function snapshot() { return { queue, index: results[frontier] ? frontier + 1 : frontier, log, asked }; }
  /** Show an item already made, without judging or generating anything. */
  function show(i) {
    index = i;
    current = made[i] ?? null;
    // Coming back to an item that is still unanswered restarts its clock: the seconds spent reading an
    // earlier item are not this one's answer time (§9a-31, timing is measured quietly and never shown).
    if (i === frontier && !results[i]) startedAt = Date.now();
    changed();
    return current;
  }
  function load() {
    while (frontier < queue.length) {
      if (made[frontier] === undefined) {
        const slot = queue[frontier];
        const prevKind = log.length ? log[log.length - 1].kind : null;
        const item = getItem(slot, { avoid: [prevKind, queue[frontier + 1]?.kind].filter(Boolean) });
        made[frontier] = item ? { item, slot } : null;   // nothing could be built for the slot: skipped, and stepping back skips it too
      }
      if (made[frontier]) { index = frontier; current = made[frontier]; startedAt = Date.now(); hinted = false; changed(); return current; }
      dropped += 1;
      frontier += 1;
    }
    index = frontier;
    current = null;
    changed();
    return null;
  }
  /** The nearest made item before `i`, or -1. */
  const prevMade = (i) => { for (let j = i - 1; j >= 0; j--) if (made[j]) return j; return -1; };
  const nextMade = (i) => { for (let j = i + 1; j <= frontier; j++) if (made[j]) return j; return -1; };
  return {
    get length() { return queue.length; },
    get queue() { return queue; },
    get position() { return index; },
    /** How far the session has got: `position` walks back over this, never past it. */
    get frontier() { return frontier; },
    /** True while the learner is looking at an item behind the frontier: read-only, never re-gradable. */
    get replay() { return index < frontier; },
    /** True when the item on screen was answered wrong and is holding the session (the drill). */
    get held() { return index === frontier && !!results[index] && !results[index].result.correct; },
    /** How the item on screen was first answered, or null. */
    get answered() { return results[index] ?? null; },
    resultAt(i) { return results[i] ?? null; },
    itemAt(i) { return made[i] ?? null; },
    get canBack() { return prevMade(index) >= 0; },
    /** Forward is open once the item on screen has been answered — that press is what gets past a miss. */
    get canForward() { return index < frontier || !!results[index]; },
    /** How many items the learner asked for, and how many came back after a wrong answer. */
    get asked() { return asked; },
    get added() { return Math.max(0, queue.length - asked); },
    /** True once a miss went un-re-queued because the session had reached its ceiling. */
    get capped() { return capped; },
    /** How many slots built nothing and were passed over (a redo whose item can no longer be made). */
    get dropped() { return dropped; },
    get current() { return current; },
    get log() { return log; },
    snapshot,
    start() { return load(); },
    hint() { if (!results[index]) hinted = true; },   // a hint pressed on a retry cannot change what was logged
    async answer(value) {
      if (!current) return null;
      const { item, slot } = current;
      const result = judge(item, value);
      if (item.input === 'tap') result.index = Number(value);
      // A retry (the item was answered wrong and is being tried again) or a replay behind the frontier:
      // judged so the learner sees where they are, written down nowhere.
      if (index < frontier || results[index]) return { ...result, retry: true, item, attempt: results[index]?.attempt ?? null, first: results[index]?.result ?? null };
      const took = Date.now() - startedAt;
      // A self-graded answer (translate) is weaker evidence: logged self: true and weighted as hinted (the server row has no column; `answer` carries the grade).
      const self = !!result.self;
      const attempt = { skill: item.skill, kind: item.kind, item_key: item.key, mode, correct: result.correct, hinted: hinted || self, self, partial: !!result.partial, answer: self ? `self: ${result.given}` : String(result.given ?? '').slice(0, 200), expected: String(result.expected ?? '').slice(0, 200), confused_with: result.correct ? null : confusedWith(item, result), ms: took, at: new Date().toISOString() };
      log.push(attempt);
      results[index] = { result, attempt, value, hinted: hinted || self };
      if (!result.correct && requeueOn) {
        const before = queue.length;
        const played = queue.slice(0, index + 1);
        // A pair session's re-queue is two slots (the pair), every other one is a single slot.
        const other = (pair || []).find((x) => x && x !== item.skill) ?? null;
        const need = other ? 2 : 1;
        queue = [...played, ...requeue(queue.slice(index + 1), { skill: item.skill, kind: item.kind, stage: slot.stage ?? item.stage, skills, rand, fill, played, pair: other, cap: ceiling() })];
        if (queue.length === before && before + need > ceiling()) capped = true;
      }
      await onAnswer?.({ item, slot, result, attempt, hinted: hinted || self, partial: !!result.partial, ms: took });
      changed();
      return { ...result, attempt, item, retry: false };
    },
    /** One step back through the items already seen. Never re-generates and never grades. */
    back() { const j = prevMade(index); return j < 0 ? current : show(j); },
    /**
     * Forward. Behind the frontier it returns to where the learner was; at the
     * frontier it is the deliberate press past an answered item — the only way
     * past one that was answered wrong.
     */
    forward() {
      if (index < frontier) { const j = nextMade(index); return j < 0 ? show(frontier) : show(j); }
      if (!results[index]) return current;   // nothing answered here yet: forward is not a way to skip
      frontier += 1;
      return load();
    },
    next() { if (index < frontier) { const j = nextMade(index); return j < 0 ? show(frontier) : show(j); } frontier += 1; return load(); },
    /** Open-ended sessions: more slots appended — asked for, so the ceiling moves with them. */
    extend(more) { queue = [...queue, ...more]; asked += more.length; capped = false; changed(); if (!current) return load(); return current; },
    summary() {
      const right = log.filter((a) => a.correct).length;
      const partly = log.filter((a) => a.correct && a.partial).length;
      const skillsSeen = [...new Set(log.map((a) => a.skill))];
      const wrong = log.filter((a) => !a.correct).map((a) => a.skill);
      // `missed` is the items to offer back ("Redo the N you missed"), not the skills: one row per item, the
      // last answer to it deciding, so an item missed and then got right later in the same session is not in it.
      return { total: log.length, right, partly, wrong: [...new Set(wrong)], missed: sessionMisses(log), skills: skillsSeen, hinted: log.filter((a) => a.hinted).length, ms: log.reduce((n, a) => n + (a.ms || 0), 0), asked, added: Math.max(0, queue.length - asked), capped, dropped };
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
export function createPractice({ plan = null, gstore, items, skillsIndex, currentWeekN = null, currentWeekSkills = [], preset = 'review-heavy', size = 10, oneSkill = null, rand = Math.random, resume = null, onChange = null, fill = undefined, pair = null }) {
  const skills = skillsIndex.skills;
  // Only skills that can produce an item enter a plan (M8): a metre skill or one with no sentences never becomes a slot.
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  const build = (n, exclude = null, prior = null) => buildSession({ states: gstore.getStates(), skills: exclude ? new Map([...drillSkills].filter(([id]) => id !== exclude)) : drillSkills, confusions: gstore.getConfusions(), preset: exclude && preset === 'one-skill' ? 'review-heavy' : preset, currentWeek: currentWeekSkills, size: n, oneSkill, seed: Math.floor(rand() * 1e9), prior });
  const slots = plan ?? build(size ?? 10);
  // `itemKey` (a redo's slot) asks the generator for that exact item and nothing else; an ordinary slot has none.
  const getItem = (slot, opts = {}) => items.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, currentWeekN, avoid: opts.avoid, itemKey: slot.itemKey ?? null });
  const onAnswer = async ({ item, result, attempt, hinted, partial, ms }) => {
    await gstore.addAttempt(attempt);
    const cur = gstore.getState(item.skill) ?? item.skill;
    await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, partial, ms }));
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  // A blocked set on one skill repeats that skill by design, so a wrong answer there is not re-queued (it could only come back at once).
  // `fill: null` is a caller saying no other skill may enter the session at all (the confusion pair's ten): a re-queue
  // that cannot find room is then dropped rather than padded out with a third skill. `pair: [a, b]` goes with it —
  // in an alternation a miss comes back as the pair, which is the only shape that keeps the two alternating (G3-04).
  const filler = fill === undefined ? (n, exclude) => build(n, exclude) : fill;
  const runner = createRunner({ slots, getItem, mode: 'practice', onAnswer, requeueOn: preset !== 'one-skill', skills, rand, fill: filler, resume, onChange, pair });
  return {
    runner, preset, size, open: size == null,
    start: () => runner.start(),
    /** Open-ended: another batch, counting the chapter-set window across the seam. */
    more: () => runner.extend(build(10, null, runner.queue)),
  };
}

/**
 * **Redo what was wrong** (GRAMMAR-CONTRACT.md, 2026-09-06): the items the
 * learner missed and has not since answered right, played again as an
 * ordinary session.
 *
 * It *is* an ordinary session, and that is the whole point of it. Every answer
 * is logged as a `drill_attempt` and fed to the scheduler, because a redo
 * happens later in time and is exactly the spaced retrieval the plan wants: a
 * right answer here clears the item from the missed list (its newest attempt
 * is now a correct one) and grows the skill's stability; a wrong one keeps it,
 * with a fresher timestamp. Nothing about the runner changes for it.
 *
 * This is the opposite of the **immediate retry inside an item** — the "Try
 * again" that follows a wrong answer, which is judged and shown and written
 * down nowhere (`createRunner.answer` returns early with `retry: true`). The
 * two are kept apart by construction: a retry never reaches `onAnswer`, and a
 * redo is a fresh slot in a fresh queue that goes through it like any other.
 *
 *   misses      attempt rows to draw from (store.getMissed(), or a session's
 *               own `summary().missed`)
 *   skillsIndex the world the session may reach — one skill, one chapter's
 *               material, or the whole map; the re-queue and the filler stay
 *               inside it, so a narrowed redo cannot wander out of its skill
 *               or its chapter
 *   size        the cap; the plan is at most this long, often shorter
 *   oneSkill    set when the redo is one skill's, so a miss is not re-queued
 *               (it could only come back beside itself, as in "Practise this
 *               skill")
 *
 * `requested` says how many misses were offered and `plan.length` how many
 * became slots; the runner's `dropped` counts those that turned out to build
 * nothing after all. The view prints the difference rather than pretending.
 */
export function createRedo({ misses = [], gstore, items, skillsIndex, size = 10, oneSkill = null, currentWeekN = null, rand = Math.random, resume = null, onChange = null }) {
  const skills = skillsIndex.skills;
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  const plan = buildRedoSession({ misses, skills: drillSkills, states: gstore.getStates(), size: size ?? 10, seed: Math.floor(rand() * 1e9) });
  const practice = createPractice({ plan, gstore, items, skillsIndex, currentWeekN, preset: oneSkill ? 'one-skill' : 'review-heavy', size: plan.length || 1, oneSkill, rand, resume, onChange });
  return { ...practice, redo: true, plan, requested: misses.length, size: plan.length, open: false };
}

/** "Practice this skill": a 5-item blocked set on one skill (practice mode, scheduler updated). */
export function createBlockedFive({ skill, gstore, items, skillsIndex, rand = Math.random }) {
  const st = gstore.getState(skill.id);
  const stage = st?.stage ?? 1;
  const plan = buildSession({ states: new Map([[skill.id, { ...(st ?? { skill: skill.id, state: 'practising', stage }), state: 'practising' }]]), skills: skillsIndex.skills, preset: 'one-skill', oneSkill: skill.id, size: 5, seed: Math.floor(rand() * 1e9) });
  return createPractice({ plan, gstore, items, skillsIndex, preset: 'one-skill', size: 5, oneSkill: skill.id, rand });
}

/* ================================================== hints, per answer box */
// GRAMMAR-CONTRACT.md "Hints, per answer box". Pure: no DOM, no storage — ui.js
// renders what `boxHints` returns. It lives here rather than in a module of its
// own because the session is what logs a hint (`hinted` on the attempt, weaker
// evidence for the scheduler), and because a new file under app/js/ must also
// join app/sw.js's PRECACHE, which belongs to the shell.
//
// An item with four blanks has four hints, each about its own box. Every hint
// has two levels:
//
//   1. what *this* box is being asked for, in plain words with the grammar
//      term ("Dative singular: the 'to/for' form");
//   2. the rule it comes from, or the cell of the paradigm it sits in.
//
// A hint narrows, it never answers. `boxHints` runs every level it builds
// through `answerLeak` and drops any level that spells one of the item's own
// accepted answers, so a hint cannot give the form away even if a lesson's
// summary or a pensum's authored note happens to contain it. The build-time
// sweep (tests/grammar.session-flow.test.mjs) is the same check over every
// skill, so a leak fails the build rather than reaching a learner.
//
// Two kinds are exempt from that check, exactly as the item sweep exempts
// them (tests/grammar.fix4.test.mjs B1): `recognise` and `parse` are answered
// with a *label* ("dative singular"), and a hint that may not name the case is
// not a hint. Their hints stay at the level of the rule, as they always were.


export const HINT_MODES = Object.freeze(['press', 'always', 'off']);
export const HINT_MODE_LABEL = Object.freeze({
  press: ['Press for a hint', 'The hint sits quietly beside each box and opens when you press it.'],
  always: ['Always show', 'Every box shows its hint from the start. Every answer then counts as hinted, which is weaker evidence, so skills come round again sooner.'],
  off: ['No hints', 'The hint controls are hidden altogether.'],
});
export const normaliseHintMode = (v) => (HINT_MODES.includes(v) ? v : 'press');

/** Kinds whose answer is a grammatical label, not a form: their hints may name the term. */
const LABEL_KINDS = new Set(['recognise', 'parse']);
/**
 * One- and two-letter answers that are also ordinary English words. A Pensum A
 * blank wants an ending — *a*, *is*, *am*, *us* — and no English sentence about
 * the ablative can avoid the word "a". These are left out of the leak check;
 * nothing in the generator ever puts a Latin form into hint text, and the check
 * still catches every ending of three letters or more (-ōrum, -ibus, -ere).
 */
const SHORT_ENGLISH = new Set(['a', 'am', 'an', 'as', 'at', 'be', 'do', 'e', 'he', 'i', 'id', 'in', 'is', 'it', 'me', 'my', 'no', 'o', 'of', 'on', 'or', 'os', 'so', 'to', 'up', 'us', 'we']);

/** Which of `answers` the text spells out, whole-word, macrons and case ignored. Pure. */
export function answerLeak(text, answers = []) {
  const hay = ` ${normaliseAnswer(text)} `;
  const out = [];
  for (const a of new Set(answers)) {
    const n = normaliseAnswer(a);
    if (!n || (n.length <= 2 && SHORT_ENGLISH.has(n))) continue;
    if (hay.includes(` ${n} `) && !out.includes(a)) out.push(a);
  }
  return out;
}

/* --------------------------------------------------------------- text */
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stop = (s) => { const t = clean(s); return !t ? '' : (/[.!?…]$/.test(t) ? t : `${t}.`); };
const cap = (s) => { const t = clean(s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const lower = (s) => { const t = clean(s); return t ? t.charAt(0).toLowerCase() + t.slice(1) : ''; };
// Sentences joined into a paragraph. The first part keeps its own case (it may open with a Latin word, which
// must not be capitalised into a proper noun); every part after it is a fresh sentence and is capitalised.
const join = (...parts) => parts.map((p, i) => stop(i ? cap(p) : p)).filter(Boolean).join(' ');
const head = (lemma) => String(lemma ?? '').split(/[\s,]/)[0];

/** The item's grammar term and its plain gloss, whichever the generator settled. */
const labelOf = (item) => {
  const l = item?.feedback?.label;
  return { name: clean(l?.name ?? ''), plain: clean(l?.plain ?? ''), full: clean(l?.full ?? '') };
};
/** The rule behind an item: the skill's own summary, else the item-level hint the generator wrote. */
const ruleOf = (item, skill) => clean(skill?.summary || item?.prompt?.hint || '');
const termOf = (item, skill) => clean(skill?.plain || item?.feedback?.term || '');

/** Every answer this item accepts anywhere, so no hint of any of its boxes can spell one. */
export function acceptedAnswers(item) {
  if (!item) return [];
  const out = [...(Array.isArray(item.answer) ? item.answer : [])];
  for (const c of item.chart?.cells ?? []) out.push(...(c.answer ?? []));
  for (const b of item.blanks ?? []) { out.push(...(b.answers ?? [])); if (b.stem) out.push(...(b.answers ?? []).map((a) => b.stem + a)); }
  for (const p of item.pairs ?? []) out.push(p.en);
  for (const ch of item.choices ?? []) if (ch.correct) out.push(ch.label, ch.value);
  return out.filter((a) => typeof a === 'string' && a.length);
}

/* -------------------------------------------------------------- boxes */
/**
 * The answer boxes of an item, each with its own two-level hint.
 *
 *   boxHints(item, { skill, describe })
 *     skill     the skill row (for `summary` — the rule behind level 2)
 *     describe  (form, text) → { lemma, meaning, parse } | null. Only the
 *               `order` input uses it: its chips cannot be tapped for their
 *               entry (a tap places the word), so the hint is where the
 *               dictionary line lives.
 *
 * Returns [{ id, index, label, levels: [string, …] }] — `id` is the key the
 * input uses for that box (a chart cell index, a blank index, a match row, a
 * chunk index; '0' where the item has a single box). `levels` may be one long
 * or empty when a level would have given the answer away.
 */
export function boxHints(item, { skill = null, describe = null } = {}) {
  if (!item) return [];
  // A chapter set has no rule of its own — its `summary` is the deck's description ("Orberg's Pensum A, B and C
  // for chapter I"), which says nothing about the box — so level two falls back to what the generator wrote.
  const rawRule = skill?.set ? clean(item?.prompt?.hint ?? '') : ruleOf(item, skill);
  const term = termOf(item, skill);
  const lab = labelOf(item);
  const exempt = LABEL_KINDS.has(item.kind);
  const answers = exempt ? [] : acceptedAnswers(item);
  // Authored text (a pensum blank's note) is checked before it is built into a sentence, so a note that would
  // have spelled an answer costs its own clause rather than the whole level: "agrees with fluvius" is dropped
  // from a sentence whose sibling blank accepts *fluvius*, and the plain statement of the blank still stands.
  const safe = (t) => (t && answerLeak(t, answers).length === 0 ? t : '');
  // The rule is sanitised the same way and for the same reason: a lesson summary or a generated item hint that
  // happens to print a form this item accepts must not take the general statement of the level down with it.
  const rule = safe(rawRule);
  const raw = build(item, { skill, describe, rule, term, lab, safe });
  return raw
    .map((b) => ({ ...b, levels: b.levels.map(clean).filter(Boolean).filter((t) => answerLeak(t, answers).length === 0) }))
    .filter((b) => b.levels.length);
}

/** Every hint string an item would show, for the no-leak sweep and for tests. */
export const hintTexts = (item, opts = {}) => boxHints(item, opts).flatMap((b) => b.levels);

function build(item, ctx) {
  switch (item.input) {
    case 'chart': return chartBoxes(item, ctx);
    case 'inline': return inlineBoxes(item, ctx);
    case 'bank': return bankBoxes(item, ctx);
    case 'match': return matchBoxes(item, ctx);
    case 'order': return orderBoxes(item, ctx);
    default: return [singleBox(item, ctx)];
  }
}

/* ------------------------------------------------------------- charts */
function chartBoxes(item, { rule, lab }) {
  const cells = item.chart?.cells ?? [];
  const h = head(item.chart?.head ?? item.lemma ?? '');
  // The generator's own item hint reads "Dative — the 'to/for' form", and it describes the *target* cell. On a
  // whole-row chart (Learn's guided five fill six cells at once) the other cells are other cases, so the gloss is
  // theirs only when the chart is a single cell; otherwise the cell's own label says what it wants and no more.
  const plain = cells.length === 1 ? (clean(String(item.prompt?.hint ?? '').split(/\s+—\s+/).slice(1).join(' — ')) || lab.plain) : '';
  return cells.map((c, i) => ({
    id: String(i), index: i, label: c.label || `cell ${i + 1}`,
    levels: [
      `This cell wants the ${lower(c.label)}${h ? ` of ${h}` : ''}${plain ? ` — ${plain}` : ''}.`,
      join(rule, h ? `Only the ending changes; the stem of ${h} stays as it is` : ''),
    ],
  }));
}

/* ------------------------------------------- Pensum A: typed endings */
function inlineBoxes(item, { rule, safe }) {
  const blanks = item.blanks ?? [];
  return blanks.map((b, i) => {
    const note = safe(clean(b.note));
    return {
      id: String(i), index: i, label: `Blank ${i + 1}`,
      levels: [
        join(`Blank ${i + 1} wants the ending${b.stem ? ' on the stem already printed' : ''}`, note || 'the words around it decide which one'),
        join('The stem is given; only the ending is missing. Macrons count here — a long vowel is part of the ending, so two spellings that differ by a macron alone are two different forms', rule && rule !== note ? rule : ''),
      ],
    };
  });
}

/* --------------------------------------------- Pensum B: a word bank */
function bankBoxes(item, { rule, safe }) {
  const blanks = item.blanks ?? [];
  return blanks.map((b, i) => {
    const note = safe(clean(b.note));
    return {
      id: String(i), index: i, label: `Blank ${i + 1}`,
      levels: [
        join(`Blank ${i + 1} wants one word from the bank`, note || 'the words on either side of it decide which'),
        join('Two tiles that differ only in a macron are two different forms; read the whole sentence before you choose', rule && rule !== note ? rule : ''),
      ],
    };
  });
}

/* --------------------------------------------------- match: one row */
function matchBoxes(item, { rule }) {
  const pairs = item.pairs ?? [];
  return pairs.map((p, i) => ({
    id: String(i), index: i, label: p.la,
    levels: [
      join('Pick the meaning that belongs to this word', p.dict ? `its dictionary line is ${p.dict}` : ''),
      join(p.dict ? 'The dictionary line gives its declension and gender, not its meaning — but it tells you what kind of word you are looking for' : '', rule),
    ],
  }));
}

/* ------------------------------------------------ order: one chip each */
/**
 * A reorder item's boxes are its word chips: those are what the learner moves,
 * and a chip cannot be tapped for its dictionary entry the way a word in a
 * plain sentence can, because tapping places it. The hint is therefore where a
 * chip's dictionary line lives. Naming a word never gives the order away — the
 * accepted answer is the whole sentence.
 */
function orderBoxes(item, { rule, describe }) {
  const chunks = item.chunks ?? [];
  const shown = item.display ?? chunks;
  return chunks.map((word, i) => {
    const text = shown[i] ?? word;
    const d = (() => { try { return describe ? describe(word, text) : null; } catch { return null; } })();
    const line = d ? [d.lemma ? `from ${d.lemma}` : '', d.meaning ? `“${d.meaning}”` : ''].filter(Boolean).join(', ') : '';
    return {
      id: String(i), index: i, label: text,
      levels: [
        join(line ? cap(line) : `Where does ${text} belong in the book's sentence?`, d?.parse || ''),
        join('The endings, not the order, say who does what; the book\'s own order is what is being asked for, and Latin usually keeps the verb near the end', rule),
      ],
    };
  });
}

/* ------------------------------------------------ a single answer box */
function singleBox(item, { rule, term, lab }) {
  const target = clean(item.target?.text ?? '');
  const h = head(item.feedback?.lemma ?? item.word?.lemma ?? item.lemma ?? '');
  let first = '';
  if (item.kind === 'blank') first = join(`The blank wants the ${lower(lab.name) || 'right'} form${h ? ` of ${h}` : ''}`, lab.plain);
  else if (item.kind === 'recognise') first = join(target ? `You are asked what ${target} is in this sentence — read its ending, not its place in the line` : 'You are asked what the marked word is in this sentence', item.prompt?.gloss ? 'the dictionary form is under the sentence' : '');
  else if (item.kind === 'parse') first = join(target ? `Name what ${target} is: ${item.prompt?.placeholder ? `answer in the shape “${item.prompt.placeholder.replace(/^e\.g\.\s*/i, '')}”` : 'the ending carries it'}` : 'Name what the marked word is; the ending carries it');
  else if (item.kind === 'transform') first = join(`Change the marked word as the question asks and leave the rest of it alone`, lab.plain ? `it is now ${lower(lab.name)} — ${lab.plain}` : '');
  else if (item.kind === 'translate') first = 'Write what the sentence says in English, then reveal the book\'s version and grade yourself — the lit words are the ones that carry the construction.';
  else if (item.kind === 'question') first = join('The answer is in the chapter\'s own sentence, in Latin, in the case the question asks for', item.prompt?.en ? 'the English of the question is behind “In English”' : '');
  else if (item.kind === 'pensum') first = 'Answer from the chapter itself, in Latin.';
  else if (item.kind === 'vocab') first = item.input === 'type' ? 'Give the word\'s dictionary form — the one a dictionary would list it under.' : 'One of these is the word\'s meaning; the others are words from the same chapter.';
  else first = join(term ? `This one is about ${lower(term)}` : 'Read the ending of the marked word', lab.plain);
  const second = item.kind === 'vocab' || item.kind === 'question' || item.kind === 'pensum'
    ? join(item.prompt?.hint || '', '')
    : join(rule, item.entry ? 'The paradigm under this hint has the same shape' : '');
  return { id: '0', index: 0, label: item.input === 'tap' ? 'the sentence' : 'your answer', levels: [first, second] };
}
