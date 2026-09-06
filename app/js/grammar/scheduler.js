// Grammar scheduler (GRAMMAR-CONTRACT.md "Scheduler"): pure functions, no
// I/O, no DOM — tested in tests/grammar.scheduler.test.mjs.
//
//   skill_state row: { skill, state, stage, stability_days, due_at, last_at,
//                      streak, successes, failures, updated_at }
//   state: new | learning | practising | mastered | lapsed
//
// Spacing: correct unaided → stability × 1.7 (× 2.2 when answered in under
// 8 s); hinted correct → × 1.2; wrong → × 0.3 (floor half a day). A correct
// answer before the skill was due grows it only by the hinted factor, so an
// "even mix" session cannot inflate a fresh skill to mastered in an evening.
// due_at = now + stability. Stage +1 after 4 correct in a row at the stage.
// Mastered: stability > 21 d and ≥ 3 successes; lapsed: overdue by more than
// twice its stability.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const FAST_MS = 8000;
export const STABILITY_FLOOR = 0.5;
export const MASTERED_DAYS = 21;
export const MASTERED_SUCCESSES = 3;
export const STAGE_UP_STREAK = 4;
export const LEARN_WINDOW = 10;
export const LEARN_NEEDED = 6;
export const LEARN_KINDS = 2;
export const STATES = Object.freeze(['new', 'learning', 'practising', 'mastered', 'lapsed']);
export const PRESETS = Object.freeze(['review-heavy', 'this-week', 'even', 'one-skill']);   // the setup's radio group (ui.js PRESET_LABEL)
export const KINDS_BY_STAGE = Object.freeze({ 1: ['recognise', 'chart'], 2: ['chart', 'parse'], 3: ['parse', 'blank'] });

const iso = (t) => new Date(t).toISOString();
const ms = (v) => { if (!v) return 0; const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; };

/** A fresh row for a skill. Pure. */
export function newState(skill, now = Date.now()) {
  return { skill, state: 'new', stage: 1, stability_days: STABILITY_FLOOR, due_at: null, last_at: null, streak: 0, successes: 0, failures: 0, updated_at: iso(now) };
}

/** A row from any source with every field usable (missing → defaults, bad numbers clamped). Pure. */
export function normaliseState(row, now = Date.now()) {
  if (!row || typeof row.skill !== 'string' || !row.skill) return null;
  const base = newState(row.skill, now);
  const num = (v, d, min = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, n) : d; };
  return {
    ...base,
    ...row,
    state: STATES.includes(row.state) ? row.state : 'new',
    stage: Math.min(3, Math.max(1, Math.round(num(row.stage, 1, 1)))),
    stability_days: Math.max(STABILITY_FLOOR, num(row.stability_days, STABILITY_FLOOR)),
    due_at: row.due_at ? iso(ms(row.due_at)) : null,
    last_at: row.last_at ? iso(ms(row.last_at)) : null,
    streak: Math.round(num(row.streak, 0)),
    successes: Math.round(num(row.successes, 0)),
    failures: Math.round(num(row.failures, 0)),
    updated_at: row.updated_at || base.updated_at,
  };
}

/** A row from a row or a bare skill id (a skill never touched yet). Pure. */
export const asState = (s, now = Date.now()) => (typeof s === 'string' ? newState(s, now) : (normaliseState(s, now) ?? newState(String(s?.skill ?? ''), now)));

/** True when the skill takes part in mixed practice. */
export const inRotation = (s) => !!s && (s.state === 'practising' || s.state === 'mastered');

/** True when the skill is due now (never reviewed counts as due). */
export function isDue(s, now = Date.now()) {
  if (!inRotation(s)) return false;
  return !s.due_at || ms(s.due_at) <= now;
}

/** How overdue, in units of the skill's own stability (0 when not yet due). */
export function overdueRatio(s, now = Date.now()) {
  if (!s?.due_at) return 0;
  const late = now - ms(s.due_at);
  if (late <= 0) return 0;
  return late / (Math.max(STABILITY_FLOOR, s.stability_days) * DAY_MS);
}

/** The state after time has passed: a practising / mastered skill overdue by more than twice its stability lapses. Pure. */
export function decay(s, now = Date.now()) {
  if (!inRotation(s)) return s;
  if (overdueRatio(s, now) > 2) return { ...s, state: 'lapsed', updated_at: iso(now) };
  return s;
}

/**
 * The state after one practice answer. `hinted` answers count as weaker
 * evidence; `early` (before due) growth is the hinted factor at most.
 */
export function applyAnswer(s, { correct, hinted = false, ms: took = null, now = Date.now() } = {}) {
  const cur = asState(s, now);
  const wasDue = !cur.due_at || ms(cur.due_at) <= now;
  let stability = cur.stability_days;
  let streak = cur.streak;
  let stage = cur.stage;
  let successes = cur.successes;
  let failures = cur.failures;
  if (correct) {
    let factor = hinted ? 1.2 : (took != null && took < FAST_MS ? 2.2 : 1.7);
    if (!wasDue) factor = Math.min(factor, 1.2);
    stability = stability * factor;
    streak += 1;
    successes += 1;
    if (!hinted && streak >= STAGE_UP_STREAK && stage < 3) { stage += 1; streak = 0; }
  } else {
    stability = Math.max(STABILITY_FLOOR, stability * 0.3);
    streak = 0;
    failures += 1;
  }
  let state = cur.state;
  if (state === 'lapsed' || state === 'new' || state === 'learning') state = 'practising';
  if (!correct) { if (state === 'mastered') state = 'practising'; }
  else if (stability > MASTERED_DAYS && successes >= MASTERED_SUCCESSES) state = 'mastered';
  return {
    ...cur, state, stage, stability_days: stability, streak, successes, failures,
    last_at: iso(now), due_at: iso(now + stability * DAY_MS), updated_at: iso(now),
  };
}

/** Learn mode: the skill enters (or re-enters) Learn. */
export function startLearning(s, now = Date.now()) {
  const cur = asState(s, now);
  return { ...cur, state: 'learning', stage: 1, streak: 0, updated_at: iso(now) };
}

/** "Add to mixed practice": straight into the rotation, due now. */
export function addToPractice(s, now = Date.now()) {
  const cur = asState(s, now);
  return { ...cur, state: 'practising', stage: Math.max(1, cur.stage), stability_days: Math.max(STABILITY_FLOOR, cur.stability_days), due_at: iso(now), updated_at: iso(now) };
}

/** The Learn criterion over the last 10 learn-mode attempts: ≥ 6 correct across ≥ 2 kinds. Pure. */
export function learnCriterion(attempts, { window = LEARN_WINDOW, needed = LEARN_NEEDED, kinds = LEARN_KINDS } = {}) {
  const recent = (attempts || []).slice(-window);
  const right = recent.filter((a) => a && a.correct);
  const kindSet = new Set(right.map((a) => a.kind));
  return { passed: right.length >= needed && kindSet.size >= kinds, correct: right.length, total: recent.length, kinds: kindSet.size };
}

/** After passing Learn: practising, first review due tomorrow, one day of stability. */
export function passLearn(s, now = Date.now()) {
  const cur = asState(s, now);
  return { ...cur, state: 'practising', stage: Math.max(cur.stage, 2), stability_days: 1, streak: 0, last_at: iso(now), due_at: iso(now + DAY_MS), updated_at: iso(now) };
}

/** Drill kinds for a skill at its stage: the stage's own and one below, kept to what the skill allows. */
export function kindsFor(skill, stage = 1) {
  const allowed = skill?.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
  const st = Math.min(3, Math.max(1, stage));
  const pool = [...(KINDS_BY_STAGE[st] || []), ...(KINDS_BY_STAGE[st - 1] || [])];
  const out = pool.filter((k) => allowed.includes(k));
  return out.length ? [...new Set(out)] : allowed;
}

/* ---------------------------------------------------------------- session */

// A tiny seedable PRNG so a session is reproducible in tests.
export function rng(seed = Date.now()) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Confusion counts as a Map "a|b" → count from rows { skill_a, skill_b, count }. */
export function confusionMap(rows) {
  const m = new Map();
  for (const r of rows || []) if (r?.skill_a && r?.skill_b) m.set(`${r.skill_a}|${r.skill_b}`, Number(r.count) || 0);
  return m;
}
const confusionWeight = (map, a, b) => (map?.get(`${a}|${b}`) ?? 0) + (map?.get(`${b}|${a}`) ?? 0);

/**
 * The skills a session draws from, in priority order for the preset.
 * `states`: Map skill → row; `skills`: Map id → skill definition.
 */
export function orderCandidates({ states, skills, preset, currentWeek = [], now = Date.now(), rand = Math.random, oneSkill = null }) {
  // A blocked set on one skill is asked for on purpose (a lapsed row included: "Practise this skill" re-enters it), so decay does not apply there.
  if (preset === 'one-skill') return [...states.values()].filter((s) => s.skill === oneSkill && inRotation(s) && skills.has(s.skill));
  const rows = [...states.values()].map((s) => decay(s, now)).filter((s) => inRotation(s) && skills.has(s.skill));
  const due = rows.filter((s) => isDue(s, now)).sort((a, b) => overdueRatio(b, now) - overdueRatio(a, now) || ms(a.due_at) - ms(b.due_at));
  const rest = rows.filter((s) => !isDue(s, now)).sort((a, b) => ms(a.due_at) - ms(b.due_at));
  if (preset === 'even') return shuffle(rows, rand);
  if (preset === 'this-week') {
    const cur = new Set(currentWeek);
    const week = rows.filter((s) => cur.has(s.skill));
    const others = [...due, ...rest].filter((s) => !cur.has(s.skill));
    return [...shuffle(week, rand), ...others];
  }
  return [...due, ...rest];   // review-heavy (default)
}

/**
 * Build a session plan: `size` slots of { skill, kind, currentWeek } that
 * obey the interleaving rules — no two consecutive slots on one skill or of
 * one kind; at least one confusable pair per five items (a skill and one of
 * its confusable_with within three items), pairs the learner has confused
 * preferred; ≈ 20 % of slots asked to come from the current week's units;
 * "this-week" gives two thirds of the slots to the current week's skills.
 * `size` null = open-ended (a first batch of 10; the runner asks for more).
 */
export function buildSession({ states, skills, confusions = null, preset = 'review-heavy', currentWeek = [], size = 10, now = Date.now(), seed = Date.now(), oneSkill = null }) {
  const rand = rng(seed);
  const n = size == null ? 10 : Math.max(1, size);
  const ordered = orderCandidates({ states, skills, preset, currentWeek, now, rand, oneSkill });
  if (!ordered.length) return [];
  const byId = new Map(ordered.map((s) => [s.skill, s]));
  const cmap = confusions instanceof Map ? confusions : confusionMap(confusions);
  const cur = new Set(currentWeek);

  // The skill sequence first (interleaving is about skills), kinds after.
  const seq = [];
  const lastKindOf = new Map();
  const pick = (exclude, prefer = null) => {
    if (prefer && byId.has(prefer) && prefer !== exclude) return byId.get(prefer);
    // Round-robin over the priority list: the least-used candidates first, ties by priority.
    const counts = new Map(ordered.map((s) => [s.skill, 0]));
    for (const x of seq) counts.set(x.skill, (counts.get(x.skill) ?? 0) + 1);
    const pool = ordered.filter((s) => s.skill !== exclude);
    if (!pool.length) return ordered[0];
    const min = Math.min(...pool.map((s) => counts.get(s.skill)));
    return pool.find((s) => counts.get(s.skill) === min);
  };
  const confusableOf = (id) => (skills.get(id)?.confusable_with || []).filter((c) => byId.has(c));
  const bestPartner = (id) => {
    const cs = confusableOf(id);
    if (!cs.length) return null;
    return [...cs].sort((a, b) => confusionWeight(cmap, id, b) - confusionWeight(cmap, id, a))[0];
  };
  const weekQuota = preset === 'this-week' ? Math.round(n * 2 / 3) : 0;
  let weekUsed = 0;
  for (let i = 0; i < n; i++) {
    const prev = seq[i - 1]?.skill ?? null;
    let prefer = null;
    // Rule: at least one confusable pair per five items — the pair partner sits within three of its mate.
    const windowStart = Math.floor(i / 5) * 5;
    const window = seq.slice(windowStart, i);
    const hasPair = window.some((x, j) => window.slice(j + 1, j + 4).some((y) => confusableOf(x.skill).includes(y.skill)));
    if (!hasPair && window.length) {
      for (let j = window.length - 1; j >= Math.max(0, window.length - 3) && !prefer; j--) {
        const p = bestPartner(window[j].skill);
        if (p && p !== prev) prefer = p;
      }
    }
    if (!prefer && weekQuota && weekUsed < weekQuota) {
      // Round-robin over the week's skills: the least used first, so a third week skill is never starved (m1).
      const weekSkills = ordered.filter((s) => cur.has(s.skill) && s.skill !== prev);
      const used = new Map(weekSkills.map((s) => [s.skill, seq.filter((x) => x.skill === s.skill).length]));
      const w = weekSkills.sort((a, b) => used.get(a.skill) - used.get(b.skill))[0];
      if (w) { prefer = w.skill; weekUsed += 1; }
    }
    const s = pick(prev, prefer);
    seq.push({ skill: s.skill, stage: s.stage });
  }
  // Kinds: from the skill's stage (and one below), never the same kind twice in a row.
  const plan = [];
  for (let i = 0; i < seq.length; i++) {
    const { skill, stage } = seq[i];
    const def = skills.get(skill);
    let kinds = kindsFor(def, stage);
    const prevKind = plan[i - 1]?.kind;
    const last = lastKindOf.get(skill);
    let choice = kinds.filter((k) => k !== prevKind && k !== last);
    if (!choice.length) choice = kinds.filter((k) => k !== prevKind);
    if (!choice.length) choice = (def?.kinds || kinds).filter((k) => k !== prevKind);   // a stage with one kind (genitive-of at stage 1: recognise only, no chart): any other kind of the skill's rather than a repeat
    if (!choice.length) choice = kinds;
    const kind = choice[Math.floor(rand() * choice.length)];
    lastKindOf.set(skill, kind);
    plan.push({ skill, kind, stage, currentWeek: false });
  }
  // ≈ 20 % of the slots draw their sentence from the current week's units (a request the generator honours when it can).
  const want = Math.round(plan.length * 0.2);
  const idx = shuffle(plan.map((_, i) => i), rand).slice(0, want);
  for (const i of idx) plan[i].currentWeek = true;
  return plan;
}

/**
 * A wrong answer re-queues the skill 3–6 items later — never immediately,
 * never beside itself, never the same kind as a neighbour. `plan` is the
 * remaining plan after the current item; returns a new array. When fewer
 * than three items remain, `fill(n, exclude)` supplies filler slots on other
 * skills (session.js builds them with buildSession) so the gap holds; with
 * no fillers to be had the re-queue is dropped (the summary's "worth another
 * look" still names the skill).
 */
export function requeue(plan, { skill, kind, stage = 1, skills, rand = Math.random, fill = null }) {
  const out = [...plan];
  let at = 3 + Math.floor(rand() * 4);   // 3..6
  if (out.length < 3) {
    const need = 3 - out.length;
    const extra = (fill ? fill(need + 2, skill) : []).filter((s) => s && s.skill !== skill);
    for (const f of extra) {
      if (out.length >= 3) break;
      const last = out[out.length - 1];
      if (last && last.skill === f.skill) continue;
      const def = skills?.get(f.skill);
      let k = f.kind;
      if (last && k === last.kind) k = kindsFor(def, f.stage ?? 1).find((x) => x !== last.kind) ?? (def?.kinds || []).find((x) => x !== last.kind) ?? null;
      if (!k) continue;
      out.push({ ...f, kind: k, currentWeek: false, filler: true });
    }
    if (out.length < 3) return out;
    at = 3;
  }
  at = Math.min(at, out.length);
  const def = skills?.get(skill);
  const allKinds = def?.kinds?.length ? def.kinds : ['recognise', 'chart', 'parse', 'blank'];
  const pickKind = (before, after) => {
    const ok = (x) => x !== before?.kind && x !== after?.kind;
    return kindsFor(def, stage).filter((x) => ok(x) && x !== kind)[0] ?? kindsFor(def, stage).find(ok) ?? allKinds.find(ok) ?? null;
  };
  // Find a spot at or after `at` where the neighbours differ in skill and a kind unlike both neighbours' exists.
  for (let i = at; i <= out.length; i++) {
    const before = out[i - 1], after = out[i];
    if (before?.skill === skill || after?.skill === skill) continue;
    const k = pickKind(before, after);
    if (!k) continue;
    out.splice(i, 0, { skill, kind: k, stage, currentWeek: false, requeued: true });
    return out;
  }
  return out;
}

/** The review-first list for a 103 week: prerequisites of its new skills, most decayed first. Pure. */
export function reviewFirst({ weekSkills, skills, states, now = Date.now() }) {
  const seen = new Set();
  const out = [];
  for (const id of weekSkills || []) {
    for (const p of skills.get(id)?.prereqs || []) {
      if (seen.has(p) || !skills.has(p)) continue;
      seen.add(p);
      const s = states.get(p) ? decay(states.get(p), now) : newState(p, now);
      out.push({ skill: p, state: s.state, overdue: overdueRatio(s, now), stability_days: s.stability_days, due_at: s.due_at });
    }
  }
  const rank = { lapsed: 0, new: 1, learning: 2, practising: 3, mastered: 4 };
  return out.sort((a, b) => (rank[a.state] - rank[b.state]) || (b.overdue - a.overdue) || (a.stability_days - b.stability_days));
}

/** The suggested set for today: Learn for the current week's new skills, Practice for the rest. Pure. */
export function suggestToday({ states, skills, currentWeek = [], now = Date.now() }) {
  const learn = (currentWeek || []).map((id) => states.get(id) ?? newState(id, now)).filter((s) => s.state === 'new' || s.state === 'learning' || s.state === 'lapsed').map((s) => s.skill);
  const due = [...states.values()].map((s) => decay(s, now)).filter((s) => isDue(s, now) && skills.has(s.skill));
  const pairs = new Set();
  for (const s of due) for (const c of skills.get(s.skill)?.confusable_with || []) if (due.some((d) => d.skill === c)) pairs.add([s.skill, c].sort().join('|'));
  return { learn, due: due.map((s) => s.skill), pairs: pairs.size, size: due.length ? Math.min(15, Math.max(5, due.length * 2)) : (learn.length ? 0 : 5) };
}
