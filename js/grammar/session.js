// Sessions (GRAMMAR-PLAN.md §4): the Learn flow for one skill and the mixed
// Practice session. No DOM — ui.js drives these and renders. Every answer is
// judged here (items.js matching), logged as a drill_attempt, and fed to the
// scheduler; a wrong practice answer re-queues the skill later in the session
// and records the confusion pair when the chosen distractor names one.

import { matchesForm, matchesFormExact, matchParse, matchFunction, parseFeatures, normaliseAnswer, featureChoices, workedFeature, SHORT_WORDS } from './items.js';
import { applyAnswer, learnCriterion, passLearn, startLearning, addToPractice, requeue, buildSession, buildRedoSession, inRotation } from './scheduler.js';
import { matchQuestion } from './sets.js';
import { chapterOfWeek } from '../chapters.js';
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
/**
 * The per-box truth of a multi-box item — a chart's cells, a pensum's blanks, a
 * bank's slots, a match item's rows — as `{ i, ok, given, expected, … }`, one
 * entry per box, in reading order. `judge` folds it into the item's single
 * verdict; the UI paints each box with it as the learner leaves that box, and
 * again for all of them when the item is graded (GRAMMAR-CONTRACT.md §3).
 * `[]` for a single-box item — there is nothing to bind. Pure.
 */
export function cellResults(item, value) {
  const given = value && typeof value === 'object' ? value : {};
  if (item?.input === 'chart') {
    // A scaffolded table's given cells (§12) were printed, not filled: each is right by definition and marked
    // `given`, so the one attempt is scored on the cells the learner had to fill and nothing else.
    const givenCells = new Set((item.chart?.given ?? []).map(Number));
    return (item.chart?.cells ?? []).map((c, i) => (givenCells.has(i)
      ? { i, ok: true, given: c.answer[0], expected: c.answer[0], label: c.label ?? '', scaffold: true }
      : { i, ok: matchesForm(given[i] ?? '', c.answer), given: given[i] ?? '', expected: c.answer[0], label: c.label ?? '' }));
  }
  if (item?.input === 'match') {
    const pairs = item.pairs || [];
    const right = item.right || [];
    return pairs.map((p, i) => { const r = right[Number(given[i])]; return { i, ok: !!r && r.pair === i, given: r?.text ?? '', expected: p.en, la: p.la, label: p.la }; });
  }
  if (item?.input === 'inline' || item?.input === 'bank') {
    // A pensum blank is macron-sensitive (`item.exact`): Ørberg's Pensum B for chapter I offers *Italia* beside
    // *Italiā* precisely to drill the contrast, so accepting either would delete the exercise. Ordinary drills stay
    // macron-optional. Pensum A also accepts the ending alone or the whole word (stem + ending).
    const exact = !!item.exact;
    return (item.blanks || []).map((b, i) => {
      const g = String(given[i] ?? '');
      const whole = b.stem ? b.answers.map((a) => b.stem + a) : [];
      const hit = (fn) => fn(g, b.answers) || (whole.length > 0 && fn(g, whole));
      const ok = exact ? hit(matchesFormExact) : hit(matchesForm);
      return { i, ok, macron: !ok && exact && hit(matchesForm), given: g, expected: b.answers[0], stem: b.stem ?? '', note: b.note ?? '', label: b.note || `blank ${i + 1}` };
    });
  }
  return [];
}

/**
 * One box of a multi-box item, judged on its own — what the UI asks for as the
 * learner leaves a cell (blur, tab, Enter). The same truth `judge` uses, so a
 * cell cannot go green here and count wrong there. `null` when the item has no
 * such box. Pure.
 */
export function judgeCell(item, i, given) {
  const n = Number(i);
  return cellResults(item, { [n]: given }).find((c) => c.i === n) ?? null;
}

export function judge(item, value) {
  if (!item) return { correct: false, expected: '', given: '' };
  if (item.input === 'chart') {
    const cells = item.chart?.cells ?? [];
    const results = cellResults(item, value);
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
    const pairs = item.pairs || [];
    const results = cellResults(item, value);
    return { correct: results.every((r) => r.ok), cells: results, expected: pairs.map((p) => `${p.la} — ${p.en}`).join(', '), given: results.map((r) => `${r.la} — ${r.given || '—'}`).join(', ') };
  }
  if (item.input === 'inline' || item.input === 'bank') {
    const blanks = item.blanks || [];
    const results = cellResults(item, value);
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
  let lastAt = 0;
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
      // `at` is part of an attempt's id (store-grammar `attemptId`: at | skill | item_key), and a teaching step's or
      // a catalogue's item has no key — so two answers in the same millisecond would be one row. Time only moves forward here.
      lastAt = Math.max(Date.now(), lastAt + 1);
      // A generated sentence's attempt says so (§11b): `meta` carries the template and the sentence id, kept on
      // the device (store-grammar `normaliseAttempt`; the server row has no column), so the analytics can tell
      // a generated item from a written one. A written item's attempt carries no meta at all.
      const meta = item.generated === true ? { generated: true, template: item.template ?? null, sentence: item.taught ?? null } : null;
      const attempt = { skill: item.skill, kind: item.kind, item_key: item.key, mode, correct: result.correct, hinted: hinted || self, self, partial: !!result.partial, answer: self ? `self: ${result.given}` : String(result.given ?? '').slice(0, 200), expected: String(result.expected ?? '').slice(0, 200), confused_with: result.correct ? null : confusedWith(item, result), ms: took, at: new Date(lastAt).toISOString(), ...(meta ? { meta } : {}) };
      log.push(attempt);
      results[index] = { result, attempt, value, hinted: hinted || self };
      if (!result.correct && requeueOn) {
        const before = queue.length;
        const played = queue.slice(0, index + 1);
        // A pair session's re-queue is two slots (the pair), every other one is a single slot.
        const other = (pair || []).find((x) => x && x !== item.skill) ?? null;
        const need = other ? 2 : 1;
        queue = [...played, ...requeue(queue.slice(index + 1), { skill: item.skill, kind: item.kind, stage: slot.stage ?? item.stage, skills, rand, fill, played, pair: other, cap: ceiling(), chapter: slot.chapter ?? null })];
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

/* ============================================ one skill's items (§8, §9 A1) */
/**
 * The draw behind a skill's teaching steps and its blocked ten, shared by
 * Learn and by "Just drill it" (§10). It keeps one sitting's memory — the
 * written sentence ids shown, the library keys used, the stock words a chart
 * was practised on — so nothing comes round twice until both the written and
 * the short-library pools are spent.
 *
 *   stepItem(slot)      the check of one step: a chart over its words, else the
 *                       named written sentence, else another written sentence
 *                       — never the library (§8)
 *   blockedItem(slot)   A1's tiers: the skill's written sentences not yet shown;
 *                       then its generated bank (§11b, `generatedItem`, none
 *                       shown twice until the bank is spent); then
 *                       chapter-capped library sentences of eight words or
 *                       fewer; then the rest under the cap. `item.pool` says
 *                       which tier answered, only when it had to reach past the
 *                       written set.
 */
export function createSkillDraw({ skill, steps = [], teachItems = null, libraryItem, generatedItem = null, rand = Math.random }) {
  const shown = new Set();
  const usedKeys = new Set();
  const stepWords = new Set();   // headwords the steps' chart checks were practised on
  const noteShown = (id) => { if (id) shown.add(id); };
  const stepSlots = steps.map((s, i) => ({ skill: skill.id, kind: s.check?.kind ?? 'recognise', stage: 1, step: i, currentWeek: false }));
  const shownKeyOf = (step) => step.check?.key ?? (step.show?.kind === 'paradigm' ? step.show.key : null) ?? skill.paradigms?.[0] ?? null;
  const stepItem = (slot) => {
    const step = steps[slot.step];
    if (!step || !teachItems) return null;
    const check = step.check;
    let item = null;
    if (check?.kind === 'chart') {
      // A2: a step checks the table it showed unless it names another, so a check with no `key` is on the shown table.
      item = teachItems.chartItem({ key: shownKeyOf(step), cells: check.cells, words: check.words, step: slot.step });
      if (item) for (const b of item.chart?.cells ?? []) stepWords.add(b.word);
    }
    if (!item) {
      const kind = check?.kind && check.kind !== 'chart' ? check.kind : 'recognise';
      item = teachItems.sentenceItem({ kind, sentence: check?.sentence ?? null, stage: 1, avoid: shown });
    }
    if (item) { noteShown(step.show?.kind === 'sentence' ? step.show.id : null); noteShown(step.worked?.sentence ?? null); noteShown(item.taught); for (const id of step.notice?.sentences ?? []) noteShown(id); }
    // A step may word its own question (`check.ask`): "What is lūdat doing here?" over the generator's stock line.
    if (item && check?.ask && item.prompt) item = { ...item, prompt: { ...item.prompt, question: check.ask } };
    return item ? { ...item, step: slot.step } : null;
  };

  const chartSpecs = steps.filter((s) => s.check?.kind === 'chart').map((s) => ({ key: shownKeyOf(s), cells: s.check.cells }));
  // No chart steps (a drill has none): a table skill still drills the cells its focus names, on each of its tables'
  // stock words — `cells: null` asks chartItem for every cell of the table that fits `skill.paradigm_focus`.
  if (!chartSpecs.length && skill.paradigm_focus && (skill.paradigms?.length)) for (const key of skill.paradigms) chartSpecs.push({ key, cells: null });
  let specAt = 0;
  /** A taught cell on a stock word the steps did not use — the written pool's answer for a chart slot. */
  const chartFromSteps = () => {
    if (!teachItems || !chartSpecs.length) return null;
    for (let n = 0; n < chartSpecs.length; n++) {
      const spec = chartSpecs[(specAt + n) % chartSpecs.length];
      const fresh = teachItems.chartWords({ key: spec.key }).filter((w) => !stepWords.has(w)).slice(0, 3);
      if (!fresh.length) continue;
      const item = teachItems.chartItem({ key: spec.key, cells: spec.cells, words: fresh });
      if (!item) continue;
      specAt = (specAt + n + 1) % chartSpecs.length;
      for (const b of item.chart?.cells ?? []) stepWords.add(b.word);
      return item;
    }
    return null;
  };
  const blockedItem = (slot, opts = {}) => {
    // 1 · the skill's own written sentences not yet shown in this sitting. `keyed`: a drawn item is a real
    //     item, so it carries the key that lets a miss on it come back through "redo what was wrong" (M-3);
    //     only a step's check, which is a moment in the step, stays keyless. A chart has no rebuildable key.
    if (teachItems) {
      const own = slot.kind === 'chart' ? chartFromSteps() : teachItems.sentenceItem({ kind: slot.kind, stage: slot.stage, avoid: shown, unshownOnly: true, keyed: true });
      if (own) { noteShown(own.taught); return { ...own, pool: 'written' }; }
    }
    // 2 · the skill's generated bank (§11b): the endless supply once the written set is spent, none shown twice
    //     until the whole bank has come round (`createGeneratedTier`).
    if (generatedItem) { const g = generatedItem(slot); if (g) return g; }
    // 3 · chapter-capped library sentences of eight words or fewer, none shown in this sitting.
    const short = libraryItem(slot, { avoid: opts.avoid, maxWords: SHORT_WORDS, exclude: usedKeys });
    if (short) { usedKeys.add(short.key); return { ...short, pool: teachItems ? 'library-short' : null }; }
    // 4 · the rest under the cap; only when that too is spent may an item come round again.
    const rest = libraryItem(slot, { avoid: opts.avoid, exclude: usedKeys }) ?? libraryItem(slot, { avoid: opts.avoid });
    if (rest) { usedKeys.add(rest.key); return { ...rest, pool: teachItems ? 'library' : null }; }
    return null;
  };
  return { shown, usedKeys, stepSlots, stepItem, blockedItem, rand };
}

const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * The generated tier of a skill's draw (GRAMMAR-CONTRACT.md §11, §11b): the
 * skill's pre-built bank of generated sentences as items, drawn in a fresh
 * shuffle, **none twice until the whole bank has come round**, then a fresh
 * shuffle again — the first item of the new round says so (`repeat`). `generated`
 * is a `createTeachItems` over the bank (the bank's sentences are shaped like the
 * written ones, so the same item kinds, hints and per-box feedback apply), or
 * null, in which case the tier answers nothing. A chart slot is asked as the
 * skill's first sentence kind: a sentence carries no table.
 *
 *   item(slot)   → the item with `pool: 'generated'`, or null
 *   round        how many times the bank has been started over
 *   size         sentences in the bank
 */
export function createGeneratedTier({ skill, generated = null, rand = Math.random } = {}) {
  const ids = (generated?.sentences ?? []).map((s) => s.id);
  const sentenceKind = (skill?.kinds ?? []).find((k) => k !== 'chart') ?? 'recognise';
  let queue = shuffle(ids, rand);
  const shown = new Set();
  let round = 0;
  const item = (slot) => {
    if (!generated || !ids.length) return null;
    const kind = slot.kind === 'chart' ? sentenceKind : slot.kind;
    let repeat = false;
    for (let pass = 0; pass < 2; pass++) {
      if (!queue.length) {
        if (!shown.size) return null;   // nothing in the bank can be an item at all
        queue = shuffle(ids, rand); shown.clear(); round += 1; repeat = true;
      }
      while (queue.length) {
        const id = queue.shift();
        if (shown.has(id)) continue;
        // The named sentence first; when it cannot carry this kind, `sentenceItem` moves to another unshown one.
        const it = generated.sentenceItem({ kind, sentence: id, stage: slot.stage ?? 1, avoid: shown, unshownOnly: true });
        if (!it) { shown.add(id); continue; }
        shown.add(it.taught);
        // The named sentence could not carry this kind and another answered: it goes to the back, still unshown.
        if (it.taught !== id) queue.push(id);
        return { ...it, pool: 'generated', repeat };
      }
    }
    return null;
  };
  return { item, get round() { return round; }, get size() { return ids.length; }, shown };
}

/** The kinds of a skill in a sequence of `n` slots, no kind twice running. Pure but for `rand`. */
export function kindSequence(skill, n, stageOf, rand = Math.random) {
  const kinds = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
  const out = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const pool = kinds.filter((k) => k !== last);
    const k = (pool.length ? pool : kinds)[Math.floor(rand() * (pool.length || kinds.length))];
    out.push({ skill: skill.id, kind: k, stage: stageOf(k), currentWeek: false });
    last = k;
  }
  return out;
}

/**
 * **"Just drill it"** (GRAMMAR-CONTRACT.md §10): a blocked set on one skill
 * alone, its written sentences first (A1), no steps in the way, the rule
 * pinned at the top of every item (`pin`). Ten by default; the same-session
 * re-test is the same thing three long (`RETEST_SIZE`).
 *
 * It is practice, and logged as practice: the skill enters the rotation now
 * if it was new or lapsed (as "Practise this skill" has always done), so the
 * answers that follow are judged as practice rather than as an early review.
 * A skill still in Learn keeps its `learning` state — its attempts are logged
 * in learn mode, so the criterion can read them, and nothing here graduates
 * it (only Learn's own criterion does).
 *
 * `generated` (§11b) is the skill's bank as a `createTeachItems`: once the
 * written set is spent the ten draws from it before the book. **Unlimited
 * practice** (§11) is the same drill with `open: true`: `more()` appends
 * another `size` slots, as often as the learner asks, the bank reshuffled and
 * started over only when every sentence in it has come round.
 */
export function createDrill({ skill, gstore, items, teachItems = null, generated = null, currentWeekN = null, size = LEARN_BLOCKED, rand = Math.random, pin = null, open = false }) {
  const ceiling = currentWeekN == null ? null : chapterOfWeek(currentWeekN);
  const st = gstore.getState(skill.id);
  const learning = st?.state === 'learning';
  const mode = learning ? 'learn' : 'practice';
  const libraryItem = (slot, opts = {}) => items.generate({ skill: skill.id, kind: slot.kind, stage: slot.stage, chapter: ceiling, chapterMode: 'ceiling', currentWeekN, ...opts });
  const tier = createGeneratedTier({ skill, generated, rand });
  const draw = createSkillDraw({ skill, steps: [], teachItems, libraryItem, generatedItem: generated ? tier.item : null, rand });
  const stage = Math.max(1, Number(st?.stage) || 1);
  const stageOf = (k) => (k === 'blank' || k === 'parse' ? Math.min(2, Math.max(stage, 1)) : 1);
  const slots = kindSequence(skill, size, stageOf, rand);
  const onAnswer = async ({ item, result, attempt, hinted, partial, ms }) => {
    await gstore.addAttempt(attempt);
    if (!learning) {
      const cur = gstore.getState(item.skill) ?? item.skill;
      await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, partial, ms }));
    }
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  // The pinned rule is swept like a hint (§7.5): a rule that quotes the very form an item wants back is not pinned
  // above that item — the skill's summary stands in, or nothing — so no item prints its own answer.
  const pinFor = (it) => pinText([pin, skill.summary], it);
  const runner = createRunner({ slots, getItem: (slot, o) => { const it = draw.blockedItem(slot, { avoid: o?.avoid }); const p = it ? pinFor(it) : null; return it && p ? { ...it, pin: p } : it; }, mode, onAnswer, requeueOn: false, rand, grows: false });
  return {
    runner, skill, size, mode, pin, open,
    /** Sentences in the skill's generated bank (0 without one) and how often the bank has been started over. */
    get bank() { return tier.size; },
    get round() { return tier.round; },
    /** The skill enters the rotation before the first item (new or lapsed → practising, due now); a learning skill is left as it is. */
    async begin() { if (!learning && (!inRotation(st) || st?.state === 'lapsed')) await gstore.setState(addToPractice(st ?? skill.id)); },
    start: () => runner.start(),
    /** Unlimited practice: another `size` slots on the same draw (the bank's memory carries over, so nothing repeats early). */
    more: () => runner.extend(kindSequence(skill, size, stageOf, rand)),
  };
}

/**
 * The members of a skill's **mixed practice** (GRAMMAR-CONTRACT.md §12): the
 * skill itself first, then the skills it is declared confusable with
 * (`confusable_with`, the point of mixing) and its prerequisites (`prereqs`),
 * each once, only those the map knows, that can be drilled, and — capped to
 * the learner's chapter — introduced at or before `chapter` (null: no cap).
 * At most `max` related skills. Pure.
 */
export function mixedMembers(skill, skills, { chapter = null, drillable = () => true, max = 4 } = {}) {
  const out = [skill];
  const seen = new Set([skill.id]);
  for (const id of [...(skill.confusable_with ?? []), ...(skill.prereqs ?? [])]) {
    if (seen.has(id) || out.length > max) continue;
    seen.add(id);
    const s = skills.get(id);
    if (!s || s.set || !drillable(s.id)) continue;
    if (chapter != null && Number(s.chapter) > Number(chapter)) continue;
    out.push(s);
  }
  return out;
}

/**
 * **Mixed practice** on one skill (§12): a set that interleaves the skill with
 * its confusable and prerequisite skills — the skill on every other item, the
 * related ones taking turns between — each drawn from its own pool in A1's
 * order (written, generated bank, then the book under the chapter cap).
 * `members` is `mixedMembers`' list with each skill's material:
 * `{ skill, teachItems, generated, pin }`. Open-ended like unlimited practice:
 * `more()` appends another `size` in the same rhythm.
 *
 * Logged as practice under each item's own skill; a member new or lapsed
 * enters the rotation at `begin()` as a drill's does; a member still in Learn
 * keeps its state (its attempts are logged, nothing here moves it).
 */
export function createMixed({ members, gstore, items, currentWeekN = null, size = LEARN_BLOCKED, rand = Math.random }) {
  const ceiling = currentWeekN == null ? null : chapterOfWeek(currentWeekN);
  const list = (members ?? []).filter((m) => m?.skill);
  if (!list.length) throw new Error('createMixed: no members');
  const [main, ...related] = list;
  const draws = new Map();
  for (const m of list) {
    const libraryItem = (slot, opts = {}) => items.generate({ skill: m.skill.id, kind: slot.kind, stage: slot.stage, chapter: ceiling, chapterMode: 'ceiling', currentWeekN, ...opts });
    const tier = createGeneratedTier({ skill: m.skill, generated: m.generated ?? null, rand });
    const draw = createSkillDraw({ skill: m.skill, steps: [], teachItems: m.teachItems ?? null, libraryItem, generatedItem: m.generated ? tier.item : null, rand });
    const st = gstore.getState(m.skill.id);
    draws.set(m.skill.id, { draw, tier, member: m, learning: st?.state === 'learning', stage: Math.max(1, Number(st?.stage) || 1) });
  }
  let n = 0;
  let lastKind = null;
  /** `count` slots in the rhythm: the skill, a related one, the skill, the next related one … */
  const plan = (count) => {
    const out = [];
    for (let i = 0; i < count; i++, n++) {
      const m = related.length && n % 2 === 1 ? related[Math.floor(n / 2) % related.length] : main;
      const d = draws.get(m.skill.id);
      const kinds = m.skill.kinds?.length ? m.skill.kinds : ['recognise', 'parse', 'blank'];
      const pool = kinds.filter((k) => k !== lastKind);
      const kind = (pool.length ? pool : kinds)[Math.floor(rand() * (pool.length || kinds.length))];
      lastKind = kind;
      out.push({ skill: m.skill.id, kind, stage: kind === 'blank' || kind === 'parse' ? Math.min(2, d.stage) : 1, currentWeek: false });
    }
    return out;
  };
  const onAnswer = async ({ item, result, attempt, hinted, partial, ms }) => {
    await gstore.addAttempt(attempt);
    const d = draws.get(item.skill);
    if (d && !d.learning) {
      const cur = gstore.getState(item.skill) ?? item.skill;
      await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, partial, ms }));
    }
    if (!result.correct && attempt.confused_with) await gstore.bumpConfusion(item.skill, attempt.confused_with);
  };
  const getItem = (slot, o) => {
    const d = draws.get(slot.skill);
    const it = d?.draw.blockedItem(slot, { avoid: o?.avoid }) ?? null;
    const p = it ? pinText([d.member.pin, d.member.skill.summary], it) : null;
    return it && p ? { ...it, pin: p } : it;
  };
  const runner = createRunner({ slots: plan(size), getItem, mode: 'practice', onAnswer, requeueOn: false, rand, grows: false });
  return {
    runner, skill: main.skill, members: list.map((m) => m.skill), size, mode: 'practice', open: true,
    async begin() {
      for (const m of list) {
        const st = gstore.getState(m.skill.id);
        if (st?.state !== 'learning' && (!inRotation(st) || st?.state === 'lapsed')) await gstore.setState(addToPractice(st ?? m.skill.id));
      }
    },
    start: () => runner.start(),
    more: () => runner.extend(plan(size)),
  };
}

/**
 * The catalogue's practice (§4, decision 10; §11): a run over items already
 * built — one cell across words, or a whole table on one word after another.
 * It logs under the skill that names the table **only while that skill is in
 * the rotation**, where the scheduler can use the evidence; otherwise the run
 * is practice and nothing more, and the view says so (`counted`). Items carry
 * no `key`, so a miss here never enters "redo what was wrong", which must be
 * able to rebuild what it offers.
 */
export function createCatalogueDrill({ items = [], gstore, skillId = null, rand = Math.random }) {
  const state = skillId ? gstore.getState(skillId) : null;
  const counted = !!(skillId && inRotation(state));
  const slots = items.map((it, i) => ({ skill: it.skill, kind: 'chart', stage: 1, i, currentWeek: false }));
  const onAnswer = async ({ item, result, attempt, hinted, partial, ms }) => {
    if (!counted) return;
    await gstore.addAttempt({ ...attempt, skill: skillId });
    const cur = gstore.getState(skillId) ?? skillId;
    await gstore.setState(applyAnswer(cur, { correct: result.correct, hinted, partial, ms }));
  };
  const runner = createRunner({ slots, getItem: (slot) => items[slot.i] ?? null, mode: 'practice', onAnswer, requeueOn: false, rand, grows: false });
  return { runner, counted, skillId, start: () => runner.start() };
}

/** The first of `candidates` that spells none of the item's accepted answers (label kinds are exempt, as in `boxHints`); null when none is safe. Pure. */
export function pinText(candidates, item) {
  const answers = item && !LABEL_KINDS.has(item.kind) ? acceptedAnswers(item) : [];
  for (const c of candidates) { const t = String(c ?? '').trim(); if (t && answerLeak(t, answers).length === 0) return t; }
  return null;
}

/* ============================================ the same-session re-test (§10) */
/** How long after a skill is learned or drilled its re-test is offered, and how long the re-test is. */
export const RETEST_AFTER_MS = 10 * 60 * 1000;
export const RETEST_SIZE = 3;
/**
 * The re-test list: `{ skill, at }` per skill learned or drilled this
 * session, newest last, one entry a skill. `noteRetest` records a sitting;
 * `retestDue` is what may be offered now — everything whose ten minutes have
 * passed — and `retestPending` the rest, soonest first, for the summary that
 * comes too early. Pure.
 */
export function noteRetest(list, skill, now = Date.now()) {
  const rest = (Array.isArray(list) ? list : []).filter((r) => r && r.skill !== skill && typeof r.skill === 'string');
  return [...rest, { skill, at: now }];
}
export function retestDue(list, now = Date.now(), after = RETEST_AFTER_MS) {
  return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.skill === 'string' && Number(r.at) + after <= now);
}
export function retestPending(list, now = Date.now(), after = RETEST_AFTER_MS) {
  return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.skill === 'string' && Number(r.at) + after > now).sort((a, b) => Number(a.at) - Number(b.at));
}

/* ============================================ scaffolded tables (§12, §13) */
/**
 * The scaffold levels of a table drill: how much of the table is printed
 * before the learner starts. `auto` (the default) begins at 80 and fades a
 * level after each table completed right unaided, stepping back a level after
 * one completed wrong; `off` is the blank table. `settings.grammar.scaffold`
 * holds the global default and each table remembers its own.
 */
export const SCAFFOLD_LEVELS = Object.freeze(['auto', 80, 50, 20, 'off']);
export const SCAFFOLD_STEPS = Object.freeze([80, 50, 20, 0]);
export const normaliseScaffold = (v) => (v === 'auto' || v === 'off' ? v : [80, 50, 20].includes(Number(v)) && v !== '' && v !== true ? Number(v) : v === 0 || v === '0' ? 'off' : 'auto');
/** The percentage a level gives: `off` is 0; `auto` is read through its remembered step (`autoAt`). */
export const scaffoldPercent = (level, autoAt = 80) => (level === 'off' ? 0 : level === 'auto' ? (SCAFFOLD_STEPS.includes(Number(autoAt)) ? Number(autoAt) : 80) : Number(level) || 0);
/** Auto's next step after a table: a level down after one right unaided, a level back after one wrong. Pure. */
export function scaffoldStep(autoAt, { correct, hinted = false } = {}) {
  const i = Math.max(0, SCAFFOLD_STEPS.indexOf(SCAFFOLD_STEPS.includes(Number(autoAt)) ? Number(autoAt) : 80));
  if (correct && !hinted) return SCAFFOLD_STEPS[Math.min(SCAFFOLD_STEPS.length - 1, i + 1)];
  if (!correct) return SCAFFOLD_STEPS[Math.max(0, i - 1)];
  return SCAFFOLD_STEPS[i];
}
/** The dictionary-form cells (§12's anchors): nominative and genitive singular; first person singular present and the present infinitive. */
export function isAnchorKey(key) {
  if (!key) return false;
  if (key.kind === 'nominal') return key.number === 'sg' && (key.case === 'nom' || key.case === 'gen') && (!key.degree || key.degree === 'pos');
  if (key.kind === 'finite') return key.tense === 'pres' && key.mood === 'ind' && key.voice === 'act' && String(key.person) === '1' && key.number === 'sg';
  if (key.kind === 'inf') return key.tense === 'pres' && key.voice === 'act';
  return false;
}
/** The paradigm key behind one cell of a chart item, read off the rendered table it was cut from. */
export const chartCellKey = (item, c) => (c?.key ?? item?.chart?.table?.sections?.[item.chart.section]?.rows?.[c?.row]?.cells?.[c?.col]?.key ?? null);
/**
 * Which cells of a table drill are **given** at a level (§12): deliberate,
 * never random. The anchors first, then cells the learner has already met
 * (`met`: cell ids), then the rest in reading order; **the cell a step is
 * teaching is never given** (`taught`: cell ids); and a given cell must never
 * be the answer to a cell left to fill — two cells that print the same form
 * (nominative and vocative, dative and ablative plural) would otherwise hand
 * one over. At least one cell is always left to fill. Returns the indexes into
 * `item.chart.cells`. Pure.
 */
export function scaffoldGiven(item, { percent = 0, taught = [], met = [], cellIdOf = null } = {}) {
  const cells = item?.chart?.cells ?? [];
  if (!cells.length || item?.chart?.byWord || !(percent > 0)) return [];
  const n = cells.length;
  const want = Math.min(n - 1, Math.round((n * percent) / 100));
  if (want <= 0) return [];
  const idOf = (i) => (typeof cellIdOf === 'function' ? cellIdOf(cells[i], i) : cells[i].cellId ?? null);
  const taughtSet = new Set(taught);
  const metSet = new Set(met);
  const forms = (i) => (cells[i].answer ?? []).map(normaliseAnswer).filter(Boolean);
  // Cells that print the same form (macrons aside, as the matching is) go together: given all or given none,
  // so a printed *puellae* never answers a blank *puellae*. A group holding a taught cell is never given.
  const groupOf = cells.map((_, i) => i);
  const find = (i) => (groupOf[i] === i ? i : (groupOf[i] = find(groupOf[i])));
  const byForm = new Map();
  cells.forEach((_, i) => { for (const f of forms(i)) { if (byForm.has(f)) groupOf[find(i)] = find(byForm.get(f)); else byForm.set(f, i); } });
  const groups = new Map();
  cells.forEach((_, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
  const rank = (i) => {
    if (isAnchorKey(chartCellKey(item, cells[i]))) return 0;
    const id = idOf(i);
    return id && metSet.has(id) ? 1 : 2;
  };
  const ordered = [...groups.values()]
    .filter((g) => !g.some((i) => { const id = idOf(i); return id && taughtSet.has(id); }))
    .map((g) => ({ g, rank: Math.min(...g.map(rank)), first: Math.min(...g) }))
    .sort((a, b) => a.rank - b.rank || a.first - b.first);
  const given = [];
  for (const { g } of ordered) {
    if (given.length + g.length > want) continue;   // a whole group or nothing; a smaller one may still fit
    given.push(...g);
    if (given.length >= want) break;
  }
  return given.sort((a, b) => a - b);
}
/** The given cells of a scaffolded item that spell the answer of a cell left to fill — the sweep the tests run. Pure. */
export function scaffoldLeak(item) {
  const cells = item?.chart?.cells ?? [];
  const given = new Set((item?.chart?.given ?? []).map(Number));
  const out = [];
  for (const g of given) {
    const f = new Set((cells[g]?.answer ?? []).map(normaliseAnswer).filter(Boolean));
    for (let j = 0; j < cells.length; j++) if (!given.has(j) && (cells[j].answer ?? []).some((a) => f.has(normaliseAnswer(a)))) out.push({ given: g, fills: j });
  }
  return out;
}
/** The item with its given cells set (a copy); `[]` leaves it as it was. */
export const scaffoldItem = (item, given) => (given?.length && item?.chart ? { ...item, chart: { ...item.chart, given: [...given] } } : item);

/**
 * Learn flow for one skill (GRAMMAR-CONTRACT.md "Teaching rebuild" §2, §8, §9
 * A1; decision 16 replaced the four-screen flow with this):
 *
 *   the teach steps, in order — each one idea: its `say`, its `show` (a
 *   written sentence with its gloss, or the one or two paradigm cells the step
 *   reveals), a worked example to complete, and the **single check** on that
 *   idea — then the **blocked ten**, then the 6-of-10 criterion → pass
 *   (practising, due tomorrow) or another ten.
 *
 * Nothing before the first check is a screen of its own: the say / show /
 * worked example sit above the check on the step's page, so the first thing
 * the learner does comes at once. A chapter set (vocab, questions) has no
 * teach steps and keeps its deck walk (`startGuided`).
 *
 * **A step's check draws from the skill's own written sentences and never
 * from the library** (§8): `teachItems` is a generator whose whole world is
 * `sentences/<skill>.json`, so the library is unreachable from a step.
 *
 * **A1.** The blocked ten draw, per slot: the skill's written sentences not
 * yet shown in this Learn; then chapter-capped library sentences of eight
 * words or fewer; then the rest under the cap. `shown` and `usedKeys` are
 * this Learn's own memory, so nothing repeats until both the written and the
 * short-library pools are spent; an item says which pool it came from
 * (`item.pool`) only when it had to reach past the written set.
 */
export function createLearn({ skill, gstore, items, teach = null, teachItems = null, currentWeekN = null, rand = Math.random, resume = null, onProgress = null }) {
  // Learn is scoped by the learner's own position like every other session (§7.2): the sentences that
  // teach a skill are the ones they have read. A skill with nothing at or before it reaches outward
  // exactly as chapter.js does, and the item says so.
  const ceiling = currentWeekN == null ? null : chapterOfWeek(currentWeekN);
  const isSet = !!skill.set;
  const steps = isSet ? [] : (Array.isArray(teach) ? teach : []).filter((s) => s && typeof s === 'object');
  const phases = ['steps', 'guided', 'blocked', 'result'];
  let phase = steps.length ? 'steps' : 'guided';
  let runner = null;
  let rounds = 0;
  const kinds = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
  // Recognition before recall (plan §3): the blocked ten mix stages 1–2 (typed parse and blank from stage 2).
  const kindSeq = (n, stageOf) => { const out = []; let last = null; for (let i = 0; i < n; i++) { const pool = kinds.filter((k) => k !== last); const k = (pool.length ? pool : kinds)[Math.floor(rand() * (pool.length || kinds.length))]; out.push({ skill: skill.id, kind: k, stage: stageOf(k), currentWeek: false }); last = k; } return out; };
  const libraryItem = (slot, opts = {}) => items.generate({ skill: skill.id, kind: slot.kind, stage: slot.stage, chapter: ceiling, chapterMode: 'ceiling', currentWeekN, match: isSet && phase === 'guided' ? false : undefined, ...opts });
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

  /* ---------------------------------------------- the steps and the ten */
  // One draw for the steps' checks and for the blocked ten (A1), shared with "Just drill it" (`createDrill`),
  // which is the same ten without the steps. It keeps this sitting's memory of what has been shown.
  const draw = createSkillDraw({ skill, steps, teachItems, libraryItem, rand });
  const { shown, stepSlots, stepItem, blockedItem } = draw;

  return {
    skill,
    isSet,
    deckSize,
    steps,
    get total() { return total; },
    get seen() { return seen; },
    get left() { return Math.max(0, total - seen); },
    get batchSize() { return batchOf(); },
    get phase() { return phase; },
    get runner() { return runner; },
    get rounds() { return rounds; },
    /** The written sentence ids this Learn has shown so far (a show, a worked example, a check). */
    get shown() { return shown; },
    async begin() {
      const cur = gstore.getState(skill.id);
      await gstore.setState(startLearning(cur ?? skill.id));
    },
    goto(p) { if (phases.includes(p)) phase = p; return phase; },
    /**
     * The teach steps, one check each, as one run; null when the skill has no
     * steps (the caller goes to the ten). `at` opens the run on that step
     * rather than the first: a sitting interrupted by a reload comes back
     * where it was, instead of making the learner walk the prerequisite
     * warning and the noticing opener again (QA M-2). `onStep` reports the
     * step on screen so the caller can keep that place.
     */
    startSteps({ at = 0, onStep = null } = {}) {
      if (!steps.length) return null;
      phase = 'steps';
      const from = Math.min(Math.max(0, Math.floor(Number(at) || 0)), steps.length - 1);
      const onChange = onStep ? (snap) => { try { onStep({ skill: skill.id, step: Math.min(snap.index, steps.length), steps: steps.length }); } catch { /* storage */ } } : null;
      // `resume` is the runner's own: it starts the walk at that slot and never re-makes the ones before it.
      runner = createRunner({ slots: stepSlots, getItem: stepItem, mode: 'learn', onAnswer: record, rand, grows: false, onChange, resume: from > 0 ? { queue: stepSlots, index: from, log: [] } : null });
      try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ }
      return runner.start();
    },
    /** A batch of a chapter set's guided pass. `fresh` (the default when nothing was resumed) starts the deck from the top. */
    startGuided({ fresh = seen === 0 } = {}) {
      phase = 'guided';
      if (isSet && fresh) { items.pool.reset(skill.id); seen = 0; }   // from the top
      runner = createRunner({ slots: kindSeq(batchOf(), () => 1), getItem: (slot, o) => libraryItem(slot, { avoid: o?.avoid }), mode: 'learn', onAnswer: record, rand });
      try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ }
      return runner.start();
    },
    /** The next batch of the same pass: the pool keeps its place, so no word comes round twice. */
    moreGuided() { return this.startGuided({ fresh: false }); },
    startBlocked() {
      phase = 'blocked'; rounds += 1;
      try { onProgress?.({ skill: skill.id, seen, total, phase }); } catch { /* storage */ }
      runner = createRunner({ slots: kindSeq(LEARN_BLOCKED, (k) => (k === 'blank' || k === 'parse' ? 2 : 1)), getItem: isSet ? (slot, o) => libraryItem(slot, { avoid: o?.avoid }) : blockedItem, mode: 'learn', onAnswer: record, rand });
      return runner.start();
    },
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

/* ------------------------------------------------ the steps' helpers (pure) */
/**
 * The prerequisites of a skill that are not in the rotation yet (new, still in
 * Learn, or lapsed). Decision 4: Learn names and offers them, then lets the
 * learner go on — a warning, never a bar. Pure.
 */
export function unmetPrereqs(skill, stateOf) {
  return (skill?.prereqs ?? []).filter((id) => { const s = typeof stateOf === 'function' ? stateOf(id) : null; return !inRotation(s); });
}

/**
 * A one-line reason, judged generously (§8: a reason, not a form). It is right
 * when it says something — two words, or one word long enough to be a word
 * rather than a keystroke — and it can never fail the step: nothing that
 * reads it is logged. Pure.
 */
export function judgeWhy(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const words = t ? t.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)) : [];
  return { ok: words.length >= 2 || (words.length === 1 && words[0].length >= 4), given: t, empty: !t };
}

/**
 * A completed worked example (§8, decision 2), as a plan the view walks:
 * `given` — the focus word's features printed as read; `asks` — the ones the
 * learner supplies, one at a time, each a small choice over that feature's
 * own values; `why` — whether a one-line reason is asked for; `reason` — the
 * model answer shown after it. Features the word does not carry are dropped
 * rather than asked (a verb has no gender). `first` prints everything as
 * given: the first worked example of a skill is shown fully parsed.
 * `focus` is `teachItems.focusOf(sentence)`; null when the sentence cannot be
 * parsed at all, and the step then shows the sentence without it. Pure but
 * for `rand`.
 */
export function workedPlan(worked, focus, { skill = null, skills = null, first = false, rand = Math.random } = {}) {
  if (!worked || !focus?.candidate) return null;
  const { written, candidate: c } = focus;
  const feat = (key) => workedFeature(key, c, { skill, skills });
  const wants = first ? [...worked.given, ...worked.ask.filter((k) => k !== 'why')] : worked.given;
  const given = [...new Set(wants)].map(feat).filter(Boolean);
  const asks = first ? [] : worked.ask.filter((k) => k !== 'why').map((key) => {
    const f = feat(key);
    if (!f) return null;
    const choices = featureChoices(key, f.value, { n: 4, rand, skills, skill, pool: f.pool ?? null });
    return choices.length >= 2 ? { ...f, choices } : null;
  }).filter(Boolean);
  const why = !first && worked.ask.includes('why');
  // "servō is dative singular masculine — the 'to/for' form. <the rule>": the form's features read as one
  // phrase, the construction (when asked) as a clause of its own.
  const feats = [...given, ...asks];
  const what = [feats.filter((f) => f.key !== 'construction').map((f) => f.name).join(' '), ...feats.filter((f) => f.key === 'construction').map((f) => f.name)].filter(Boolean).join(', ');
  const reason = written.note || (what ? `${c.token.text} is ${what}${skill?.plain ? ` — ${skill.plain}` : ''}.${skill?.summary ? ` ${skill.summary}` : ''}` : (skill?.summary ?? ''));
  return { sentence: written, word: c.token.text, index: c.index, lemma: c.entry?.lemma ?? '', given, asks, why, reason };
}

/**
 * Practice: a mixed session from the scheduler's plan. `size` null = open
 * (batches of 10 until the learner stops). Answers update skill_state at
 * once, so a second device sees the change.
 */
export function createPractice({ plan = null, gstore, items, skillsIndex, currentWeekN = null, currentWeekSkills = [], preset = 'review-heavy', size = 10, oneSkill = null, chapter = null, rand = Math.random, resume = null, onChange = null, fill = undefined, pair = null, rebuild = null }) {
  const skills = skillsIndex.skills;
  // Only skills that can produce an item enter a plan (M8): a metre skill or one with no sentences never becomes a slot.
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  // The chapter that scopes the sentences (chapter.js "the sentence's chapter"): the chapter of a chapter
  // session, else the learner's own chapter as the ceiling on every slot (GRAMMAR-CONTRACT.md §7.2).
  const weekChapter = currentWeekN == null ? null : chapterOfWeek(currentWeekN);
  /**
   * What scopes one slot's draw. The scheduler writes both onto every slot it
   * builds; a plan handed in ready-made (a redo's named items, a confusion
   * pair's alternation) carries neither, so the session's own chapter answers
   * for it — and failing that the learner's position, as a ceiling.
   */
  const scopeOf = (slot) => (slot.chapter != null ? { chapter: slot.chapter, chapterMode: slot.chapterMode ?? 'own-first' }
    : chapter != null ? { chapter, chapterMode: 'own-first' }
    : { chapter: weekChapter, chapterMode: 'ceiling' });
  const build = (n, exclude = null, prior = null) => buildSession({ states: gstore.getStates(), skills: exclude ? new Map([...drillSkills].filter(([id]) => id !== exclude)) : drillSkills, confusions: gstore.getConfusions(), preset: exclude && preset === 'one-skill' ? 'review-heavy' : preset, currentWeek: currentWeekSkills, size: n, oneSkill, seed: Math.floor(rand() * 1e9), prior, chapter, currentWeekChapter: weekChapter });
  const slots = plan ?? build(size ?? 10);
  // `itemKey` (a redo's slot) asks the generator for that exact item and nothing else; an ordinary slot has none.
  // `rebuild` is the caller's answer for a key the library generator cannot know — an item drawn from a skill's
  // own written sentences, whose pool is that skill's `createTeachItems` and not the library (M-3). It is asked
  // first for a named slot, and null from it falls through to the library exactly as before.
  const getItem = (slot, opts = {}) => (slot.itemKey && rebuild ? rebuild(slot, opts) : null)
    ?? items.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, currentWeekN, ...scopeOf(slot), avoid: opts.avoid, itemKey: slot.itemKey ?? null });
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
export function createRedo({ misses = [], gstore, items, skillsIndex, size = 10, oneSkill = null, chapter = null, currentWeekN = null, rand = Math.random, resume = null, onChange = null, rebuild = null }) {
  const skills = skillsIndex.skills;
  const drillSkills = new Map([...skills].filter(([id]) => items.drillable?.(id) ?? true));
  const plan = buildRedoSession({ misses, skills: drillSkills, states: gstore.getStates(), size: size ?? 10, seed: Math.floor(rand() * 1e9) });
  const practice = createPractice({ plan, gstore, items, skillsIndex, currentWeekN, chapter, preset: oneSkill ? 'one-skill' : 'review-heavy', size: plan.length || 1, oneSkill, rand, resume, onChange, rebuild });
  return { ...practice, redo: true, plan, requested: misses.length, size: plan.length, open: false };
}

/** "Practice this skill": a 5-item blocked set on one skill (practice mode, scheduler updated). */
export function createBlockedFive({ skill, gstore, items, skillsIndex, currentWeekN = null, rand = Math.random }) {
  const st = gstore.getState(skill.id);
  const stage = st?.stage ?? 1;
  // The learner's own chapter is the ceiling here as everywhere (§7.2): "Practise this skill" used to pass
  // no chapter at all, so a five-item set on a chapter-II skill could quote cap. XXXIV at it.
  const plan = buildSession({ states: new Map([[skill.id, { ...(st ?? { skill: skill.id, state: 'practising', stage }), state: 'practising' }]]), skills: skillsIndex.skills, preset: 'one-skill', oneSkill: skill.id, size: 5, seed: Math.floor(rand() * 1e9), currentWeekChapter: currentWeekN == null ? null : chapterOfWeek(currentWeekN) });
  return createPractice({ plan, gstore, items, skillsIndex, preset: 'one-skill', size: 5, oneSkill: skill.id, currentWeekN, rand });
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

/* ------------------------------------------------- the rendered paradigm */
// The leak sweep above reads **strings**, and for a long time that was every
// way an item could give itself away. It is not: a single-box `blank` item's
// "Tell me more" renders the word's whole paradigm, and one cell of that table
// *is* the answer — "fill the blank with the right form of soror", then a
// table with sorōrī printed in it (GRAMMAR-CONTRACT.md §7.5). The sweep has to
// look at the rendered table too, so it does, here, before the table is built:
// a leaking cell is printed as an ellipsis, which leaves the paradigm doing the
// job a hint should do — showing the shape the answer belongs to, and where in
// it the answer sits — without printing the answer itself.

/** Every Latin form one paradigm cell prints (its text, its alternative, and its stem + ending). Pure. */
const formsOfCell = (c) => [c?.text, c?.alt, (c?.stem ?? '') + (c?.ending ?? '')]
  .flatMap((f) => String(f ?? '').split(' / '))
  .map((f) => f.trim())
  .filter((f) => f && f !== '—');

/**
 * Which of `answers` a **rendered paradigm** spells out — cell by cell, and the
 * table's own title and note. The string sweep's `answerLeak`, over a table.
 * Pure.
 */
export function paradigmLeak(table, answers = []) {
  const out = [];
  const seen = (f) => { for (const a of answerLeak(f, answers)) if (!out.includes(a)) out.push(a); };
  for (const t of [table?.title, table?.note]) if (t) seen(t);
  for (const sec of table?.sections ?? []) {
    for (const t of [sec?.title]) if (t) seen(t);
    for (const row of sec?.rows ?? []) for (const cell of row?.cells ?? []) { if (!cell || cell.empty) continue; for (const f of formsOfCell(cell)) seen(f); }
  }
  return out;
}

/**
 * The same table with every cell that would spell an answer printed as `mask`
 * instead (and a title or note that would, dropped). A copy: the paradigm the
 * feedback prints afterwards, and the dictionary panel's, are untouched. Pure.
 */
export function maskParadigm(table, answers = [], mask = '…') {
  if (!table) return table;
  if (!paradigmLeak(table, answers).length) return table;
  const safe = (t) => (t && answerLeak(t, answers).length ? '' : t);
  return {
    ...table,
    title: safe(table.title),
    note: safe(table.note),
    sections: (table.sections ?? []).map((sec) => ({
      ...sec,
      title: safe(sec.title),
      rows: (sec.rows ?? []).map((row) => ({
        ...row,
        cells: (row.cells ?? []).map((cell) => {
          if (!cell || cell.empty) return cell;
          return formsOfCell(cell).some((f) => answerLeak(f, answers).length)
            ? { ...cell, text: mask, alt: null, stem: null, ending: null, masked: true }
            : cell;
        }),
      })),
    })),
  };
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
  // A teaching step's chart (one box a word, §8) names each box by its own word and its cell. On a whole table the
  // word's own head is one of its cells (puella is the nominative of puella), and a hint that named it would be
  // dropped by the leak sweep with the whole box — so where the head is an answer the hint says "this word".
  const answers = acceptedAnswers(item);
  const safe = (w) => (w && answerLeak(w, answers).length ? 'this word' : w);
  return cells.map((c, i) => {
    const word = safe(c.word ?? h);
    const cellName = c.cellLabel ?? c.label;
    return {
      id: String(i), index: i, label: c.label || `cell ${i + 1}`,
      levels: [
        `This cell wants the ${lower(cellName)}${word ? ` of ${word}` : ''}${plain ? ` — ${plain}` : ''}.`,
        join(rule, word ? `Only the ending changes; the stem of ${word} stays as it is` : ''),
      ],
    };
  });
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
