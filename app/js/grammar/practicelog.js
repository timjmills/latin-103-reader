// How much each skill, lesson part and table has been practised, read off the synced attempt log (2026-10-23:
// "a chart to show which skills have been practised. Have this save across devices"). The device's own counters
// (practised.js) never leave the device; drill_attempts does, so counts made from it agree on every device.
//
// A **round** is a sitting: the answers to one skill (or one part, one table) with no gap of more than half an
// hour between them. A game played to its end is logged as one attempt, so it is one round by itself.
//
//   practiceLog(attempts) → {
//     skill(id)       → { rounds, answers, right, last }   last = ms of the latest answer, 0 when never
//     part(id, step)  → rounds
//     table(tableId)  → rounds   (games on a table, meta.table)
//     tablePart(id)   → rounds   (games on a skill's own part of a table, meta.game)
//   }
//   needsPractice(state, log, now) → null | { why, rank }   what is still to do, and how pressing it is
// Pure: no DOM, no storage.

export const ROUND_GAP_MS = 30 * 60 * 1000;

const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(n) ? n : 0; };

export function practiceLog(attempts = []) {
  const rows = [...(attempts ?? [])].filter((a) => a && a.skill).sort((a, b) => ms(a.at) - ms(b.at));
  const skills = new Map();
  const rounds = new Map();   // key → { n, last }
  const bump = (key, t, single = false) => {
    const r = rounds.get(key) ?? { n: 0, last: -Infinity };
    if (single || t - r.last > ROUND_GAP_MS) r.n += 1;
    r.last = t;
    rounds.set(key, r);
  };
  for (const a of rows) {
    const t = ms(a.at);
    const s = skills.get(a.skill) ?? { rounds: 0, answers: 0, right: 0, last: 0 };
    s.answers += 1;
    if (a.correct) s.right += 1;
    s.last = Math.max(s.last, t);
    skills.set(a.skill, s);
    const game = a.meta?.game === true;
    bump(`skill:${a.skill}`, t, game);
    if (Number.isInteger(a.meta?.step)) bump(`part:${a.skill}:${a.meta.step}`, t);
    if (game) bump(`tablepart:${a.skill}`, t, true);
    if (game && a.meta?.table) bump(`table:${a.meta.table}`, t, true);
  }
  for (const [id, s] of skills) s.rounds = rounds.get(`skill:${id}`)?.n ?? 0;
  const n = (key) => rounds.get(key)?.n ?? 0;
  return {
    skill: (id) => skills.get(id) ?? { rounds: 0, answers: 0, right: 0, last: 0 },
    part: (id, step) => n(`part:${id}:${step}`),
    table: (tableId) => n(`table:${tableId}`),
    tablePart: (id) => n(`tablepart:${id}`),
    /** The same counts by practised.js key: skill:id, part:id:step, table:id, tablepart:id. */
    count: (key) => n(String(key)),
  };
}

/**
 * Is there still something to do on this skill, and how pressing is it? `state` is the scheduler's row
 * (decay already applied: state, due_at); `log` the skill's entry from practiceLog. The rank orders a to-do
 * list: due reviews first, then a lesson begun and not finished, then one never practised.
 */
export function needsPractice(state, log = {}, now = Date.now()) {
  const st = state?.state ?? 'new';
  const due = ms(state?.due_at);
  if (st === 'lapsed') return { why: 'Overdue for review', rank: 0 };
  if ((st === 'practising' || st === 'mastered') && due && due <= now) return { why: 'Due for review', rank: 1 };
  if (st === 'learning') return { why: 'Lesson not finished', rank: 2 };
  if (st === 'new' && (log.answers ?? 0) > 0) return { why: 'Started, not learned', rank: 3 };
  if (st === 'new') return { why: 'Not started', rank: 4 };
  return null;
}
