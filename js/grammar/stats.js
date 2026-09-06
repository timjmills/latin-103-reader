// Grammar stats (GRAMMAR-CONTRACT.md "Grammar stats"): pure figures over the
// skill_state rows and the drill_attempts log. Never merged into the reading
// study log.

import { STATES, applyAnswer, newState, passLearn, learnCriterion } from './scheduler.js';

const DAY = 24 * 60 * 60 * 1000;
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
export const localDay = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * The last `days` local calendar days ending today, oldest first. Calendar
 * arithmetic, not `now - i × 24 h`: on the days around a clock change two
 * subtractions land on the same local date and one date is skipped, so a day
 * went missing from every strip twice a year (G3-07). Pure.
 */
export function dayList(days, now = Date.now()) {
  const d = new Date(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 12)));
  return out;
}

/** Skills by state: { new, learning, practising, mastered, lapsed } counts, over every skill in the map. */
export function byState(states, skillIds) {
  const out = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const id of skillIds) { const s = states.get(id)?.state ?? 'new'; out[s] = (out[s] ?? 0) + 1; }
  return out;
}

/** Items today / last 7 days, accuracy over each. */
export function totals(attempts, now = Date.now()) {
  const today = localDay(now);
  const since7 = now - 7 * DAY;
  const t = { today: 0, todayRight: 0, week: 0, weekRight: 0, all: 0, allRight: 0, ms: 0 };
  for (const a of attempts || []) {
    const at = ms(a.at);
    t.all += 1; if (a.correct) t.allRight += 1; t.ms += Number(a.ms) || 0;
    if (at >= since7) { t.week += 1; if (a.correct) t.weekRight += 1; }
    if (localDay(at) === today) { t.today += 1; if (a.correct) t.todayRight += 1; }
  }
  const acc = (r, n) => (n ? Math.round((r / n) * 100) : null);
  return { ...t, accToday: acc(t.todayRight, t.today), accWeek: acc(t.weekRight, t.week), accAll: acc(t.allRight, t.all) };
}

/** Items per local day over the last `days` days (oldest first). */
export function perDay(attempts, { days = 14, now = Date.now() } = {}) {
  const out = dayList(days, now).map((day) => ({ day, items: 0, right: 0 }));
  const idx = new Map(out.map((d, i) => [d.day, i]));
  for (const a of attempts || []) { const i = idx.get(localDay(ms(a.at))); if (i != null) { out[i].items += 1; if (a.correct) out[i].right += 1; } }
  return out;
}

/** Per skill: the last 10 attempts (oldest first), accuracy, hinted count. */
export function perSkill(attempts, skillIds, { last = 10 } = {}) {
  const by = new Map(skillIds.map((id) => [id, []]));
  for (const a of [...(attempts || [])].sort((x, y) => ms(x.at) - ms(y.at))) if (by.has(a.skill)) by.get(a.skill).push(a);
  const out = new Map();
  for (const [id, list] of by) {
    const recent = list.slice(-last);
    out.set(id, { total: list.length, recent: recent.map((a) => ({ correct: !!a.correct, hinted: !!a.hinted, kind: a.kind, at: a.at })), right: recent.filter((a) => a.correct).length, hinted: recent.filter((a) => a.hinted).length });
  }
  return out;
}

/* --------------------------------------------- wave 3: confusion analytics */

/**
 * The learner's top confusion *pairs*. "You mix up X and Y" is symmetric, so
 * the two `confusions` rows for a pair are one line here. The pair is named
 * (a, b) with `a` the direction answered more often — the mistake actually
 * made — and keeps both directional counts. `[{ a, b, count, ab, ba }]`, most
 * confused first. Pure.
 */
export function confusionPairs(rows, skills, { limit = 6, min = 1 } = {}) {
  const merged = new Map();
  for (const r of rows || []) {
    if (!r || !skills?.has?.(r.skill_a) || !skills.has(r.skill_b) || r.skill_a === r.skill_b) continue;
    const n = Number(r.count) || 0;
    if (n <= 0) continue;
    const key = [r.skill_a, r.skill_b].sort().join('|');
    const cur = merged.get(key) ?? { key, count: 0, dir: new Map() };
    cur.count += n;
    const dk = `${r.skill_a}|${r.skill_b}`;
    cur.dir.set(dk, (cur.dir.get(dk) ?? 0) + n);
    merged.set(key, cur);
  }
  const out = [];
  for (const m of merged.values()) {
    const [x, y] = m.key.split('|');
    const xy = m.dir.get(`${x}|${y}`) ?? 0;
    const yx = m.dir.get(`${y}|${x}`) ?? 0;
    const [a, b, ab, ba] = xy >= yx ? [x, y, xy, yx] : [y, x, yx, xy];
    if (m.count >= min) out.push({ a, b, count: m.count, ab, ba });
  }
  // Ties settle on the skill ids, so the list does not reshuffle between repaints.
  out.sort((p, q) => q.count - p.count || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0));
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * The plain-words line under a confusion pair: what actually separates the
 * two. The lessons' own confusion blocks say it best (either lesson may name
 * the other), so those come first; failing that the two skills' `plain`
 * glosses are set against each other, which is what they are carried for.
 * `skillA` / `skillB` are skill-map entries, `lessonA` / `lessonB` their
 * lesson JSON (or null — a lesson may not be written yet). Pure.
 */
export function confusionReason(skillA, skillB, { lessonA = null, lessonB = null } = {}) {
  const blockOf = (lesson, other) => (lesson?.core ?? []).find((b) => b?.type === 'confusion' && b.with === other && String(b.text ?? '').trim())?.text ?? null;
  const own = blockOf(lessonA, skillB?.id) ?? blockOf(lessonB, skillA?.id);
  if (own) return String(own).trim();
  const plainA = String(skillA?.plain ?? '').trim();
  const plainB = String(skillB?.plain ?? '').trim();
  if (plainA && plainB) return `${skillA.title} is ${plainA}; ${skillB.title} is ${plainB}.`;
  if (skillA?.summary && skillB?.summary) return `${skillA.title}: ${skillA.summary} ${skillB.title}: ${skillB.summary}`;
  return 'Two skills that answer to the same forms — practising them side by side is what separates them.';
}

/* ------------------------------------------- wave 3: per-skill history */

/**
 * One skill's history from `drill_attempts` alone (no new tables). The log can
 * be long — a year of practice is thousands of rows — so only the tail is ever
 * read: at most `max` attempts, newest kept (the store hands in an already
 * windowed list; this is the second guard). `attempts` are that skill's rows,
 * oldest first.
 *
 * `total` is the skill's **lifetime** count, which the caller knows and this
 * list does not: the store has already trimmed the rows, so deriving it from
 * `attempts.length` made `windowed` permanently false and the sentence that
 * explains the gap unreachable (QA-B2). Pass `gstore.countAttempts(skill)`.
 *
 * Returns `{ total, read, windowed, counts, perDay, recent, trail, stageChanges }`:
 * `counts` = right / hinted / wrong over the window, `perDay` the last `days`
 * local days, `recent` the last `last` items newest first (the learner's own
 * answer beside the right one), `trail` how stability and stage moved. Pure.
 */
export function skillHistory(attempts, { last = 20, days = 21, now = Date.now(), max = 400, total: lifetime = null } = {}) {
  const all = (attempts || []).filter(Boolean);
  const list = all.length > max ? all.slice(-max) : all;
  // Never less than what we hold: a stale count must not read as fewer items than the page shows.
  const total = Number.isFinite(lifetime) ? Math.max(Math.round(lifetime), all.length) : all.length;
  const counts = { right: 0, hinted: 0, wrong: 0 };
  for (const a of list) { if (!a.correct) counts.wrong += 1; else if (a.hinted) counts.hinted += 1; else counts.right += 1; }
  const perDay = dayList(days, now).map((day) => ({ day, items: 0, right: 0, hinted: 0, wrong: 0 }));
  const idx = new Map(perDay.map((d, i) => [d.day, i]));
  for (const a of list) {
    const i = idx.get(localDay(ms(a.at)));
    if (i == null) continue;
    perDay[i].items += 1;
    if (!a.correct) perDay[i].wrong += 1; else if (a.hinted) perDay[i].hinted += 1; else perDay[i].right += 1;
  }
  const recent = list.slice(-last).reverse().map((a) => ({
    at: a.at, kind: a.kind, mode: a.mode, correct: !!a.correct, hinted: !!a.hinted, self: !!a.self,
    // A self-graded translate answer stores the learner's own grade, not what they wrote.
    given: a.self ? `graded ${String(a.answer ?? '').replace(/^self:\s*/, '')}` : String(a.answer ?? ''),
    expected: String(a.expected ?? ''), confused_with: a.confused_with ?? null, item_key: a.item_key ?? '',
  }));
  const { trail, stageChanges, learnPasses } = progressTrail(list, { now });
  return { total, read: list.length, windowed: total > list.length, counts, perDay, recent, trail, stageChanges, learnPasses };
}

/**
 * How stability and stage moved, replayed over the attempts with the very
 * scheduler that wrote them — `skill_state` keeps only today's row, so the
 * shape of the curve can only come from the log.
 *
 * Two transitions the log records only implicitly are replayed too (G3-05),
 * because without them the replay starts from the wrong state and every later
 * point inherits the error:
 *
 * - **Learn's pass.** Learn-mode attempts never move stability, but the end of
 *   a run of them does: `finishBlocked` tests `learnCriterion` over the last
 *   ten and, on a pass, calls `passLearn` (stage ≥ 2, stability 1 day, due
 *   tomorrow). So a run of learn attempts is buffered and judged exactly where
 *   the flow judged it — when the mode changes back to practice, or at the end
 *   of the log. The first practice answer then counts as *early* (× 1.2), as
 *   the live scheduler counted it, instead of as a due review (× 1.7 / × 2.2).
 * - **A self-graded "partly".** `drill_attempts.self` (migration 0017) keeps
 *   the learner's own grade, so a translate item graded *partly* replays as the
 *   × 1 hold the scheduler applied, not as a hinted correct.
 *
 * "Add to mixed practice" needs no replay: it sets `due_at` to now, which is
 * what a fresh row's null `due_at` already means to `applyAnswer`.
 *
 * Returns `{ trail, stageChanges, learnPasses }`. Pure.
 */
export function progressTrail(attempts, { now = Date.now() } = {}) {
  const list = (attempts || []).filter(Boolean);
  if (!list.length) return { trail: [], stageChanges: [], learnPasses: 0 };
  let state = newState(list[0].skill ?? 'skill', ms(list[0].at) || now);
  const trail = [];
  const stageChanges = [];
  let learnRun = [];       // the consecutive learn-mode attempts not yet judged
  let learnPasses = 0;
  const noteStage = (before, at) => { if (state.stage !== before) stageChanges.push({ at, from: before, to: state.stage }); };
  /**
   * The end of a run of Learn attempts: the criterion over its last ten,
   * exactly as `finishBlocked` runs it. The pass belongs to the last attempt of
   * the run, so that point on the curve is redrawn with it.
   */
  const closeLearnRun = () => {
    if (!learnRun.length) return;
    const run = learnRun;
    learnRun = [];
    if (!learnCriterion(run).passed) return;
    const lastAt = run[run.length - 1]?.at;
    const before = state.stage;
    state = passLearn(state, ms(lastAt) || now);
    learnPasses += 1;
    noteStage(before, lastAt);
    const point = trail[trail.length - 1];
    if (point) { point.stability = Number(state.stability_days) || 0; point.stage = state.stage; point.state = state.state; }
  };
  for (const a of list) {
    const at = ms(a.at) || now;
    if (a.mode === 'learn') {
      learnRun.push(a);
    } else {
      closeLearnRun();   // the pass happened at the last Learn attempt, before this answer was judged
      const before = state.stage;
      state = applyAnswer(state, { correct: !!a.correct, hinted: !!a.hinted, partial: a.partial === true || a.self === 'partly', ms: a.ms ?? null, now: at });
      noteStage(before, a.at);
    }
    trail.push({ at: a.at, stability: Number(state.stability_days) || 0, stage: state.stage, state: state.state, correct: !!a.correct });
  }
  closeLearnRun();   // a log that ends inside Learn: the pass still counts, and its last point moves with it
  return { trail, stageChanges, learnPasses };
}

/**
 * The confusions that touch one skill, either way round, most confused first:
 * `[{ other, count, mine }]` — `mine` is the count of this skill answered as
 * the other. Pure.
 */
export function confusionsOf(skill, rows, skills) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || !(r.count > 0)) continue;
    const other = r.skill_a === skill ? r.skill_b : r.skill_b === skill ? r.skill_a : null;
    if (!other || other === skill || (skills && !skills.has(other))) continue;
    const cur = out.get(other) ?? { other, count: 0, mine: 0 };
    cur.count += Number(r.count) || 0;
    if (r.skill_a === skill) cur.mine += Number(r.count) || 0;
    out.set(other, cur);
  }
  return [...out.values()].sort((x, y) => y.count - x.count || (x.other < y.other ? -1 : 1));
}

/** A stability said plainly: "under an hour" / "18 hours" / "3 days" / "2 months". Pure. */
export function fmtStability(d) {
  const n = Number(d) || 0;
  if (n <= 0) return '—';
  if (n < 1 / 24) return 'under an hour';
  if (n < 1) return `${Math.round(n * 24)} hours`;
  if (n < 1.5) return '1 day';
  if (n < 60) return `${Math.round(n)} days`;
  return `${Math.round(n / 30)} months`;
}


export const fmtPct = (n) => (n == null ? '—' : `${n}%`);
export const fmtMin = (msTotal) => { const s = (msTotal || 0) / 1000; if (s < 45) return 'under a minute'; const m = Math.max(1, Math.round(s / 60)); return `${m} min`; };
