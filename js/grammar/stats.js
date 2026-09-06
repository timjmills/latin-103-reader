// Grammar stats (GRAMMAR-CONTRACT.md "Grammar stats"): pure figures over the
// skill_state rows and the drill_attempts log. Never merged into the reading
// study log.

import { STATES } from './scheduler.js';

const DAY = 24 * 60 * 60 * 1000;
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
export const localDay = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push({ day: localDay(now - i * DAY), items: 0, right: 0 });
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

/** Confusion pairs, most confused first: [{ a, b, count }]. */
export function confusionList(rows, skills) {
  return (rows || []).filter((r) => r && r.count > 0 && skills.has(r.skill_a) && skills.has(r.skill_b))
    .map((r) => ({ a: r.skill_a, b: r.skill_b, count: Number(r.count) || 0 }))
    .sort((x, y) => y.count - x.count);
}

export const fmtPct = (n) => (n == null ? '—' : `${n}%`);
export const fmtMin = (msTotal) => { const s = (msTotal || 0) / 1000; if (s < 45) return 'under a minute'; const m = Math.max(1, Math.round(s / 60)); return `${m} min`; };
