// How many times something has been practised (2026-10-23: "have a brief way to know how many times a
// skill / lesson part / table has been practised — maybe a small number"). A count of finished rounds, kept
// on this device: a skill's session or Learn ten, a lesson part practised on its own (or its check answered in
// Learn), a table's game played to its end.
//
//   skill:<id>        part:<id>:<step>        table:<catalogue table id>        tablepart:<skill id>
//   typed:<any of those>   the same round, played to its end in the game's Type it

const KEY = 'l103.practised';
let memo = null;
const load = () => {
  if (memo) return memo;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); memo = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { memo = {}; }
  return memo;
};

// The synced count (grammar/practicelog.js, from the attempt log every device shares), set by the Grammar section
// once it has its store. The higher of it and this device's own counter is the count: a round played on another
// device shows here, and one this device counted before the log knew of it is not lost.
let synced = null;
export function setSyncedCounts(fn) { synced = typeof fn === 'function' ? fn : null; }

const local = (key) => { const n = Number(load()[key]); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
/** How many times `key` has been practised (0 when never). */
export function practised(key) {
  let s = 0;
  try { s = Number(synced?.(key)) || 0; } catch { s = 0; }
  return Math.max(local(key), s);
}

/** One more round of each key given (a key, or a list; empty ones are skipped). */
export function notePractised(keys) {
  const m = load();
  let changed = false;
  for (const k of [].concat(keys ?? [])) { if (typeof k !== 'string' || !k) continue; m[k] = local(k) + 1; changed = true; }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode: the count is kept for this visit only */ }
  noteToday(keys);
}

// What was practised today (the plan's checklist, grammar/plan.js): the keys counted since midnight, this device.
const DAY_KEY = 'l103.today';
const dayNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readDay = () => { try { const v = JSON.parse(localStorage.getItem(DAY_KEY) ?? 'null'); return v && v.date === dayNow() && Array.isArray(v.keys) ? v : { date: dayNow(), keys: [] }; } catch { return { date: dayNow(), keys: [] }; } };
let dayMemo = null;
function noteToday(keys) {
  const v = readDay();
  for (const k of [].concat(keys ?? [])) if (typeof k === 'string' && k && !v.keys.includes(k)) v.keys.push(k);
  dayMemo = v;
  try { localStorage.setItem(DAY_KEY, JSON.stringify(v)); } catch { /* this visit only */ }
}
/** Was `key` practised today? A prefix ending in ':' asks whether any key of that kind was. */
export function practisedToday(key) {
  const v = dayMemo && dayMemo.date === dayNow() ? dayMemo : (dayMemo = readDay());
  return String(key).endsWith(':') ? v.keys.some((k) => k.startsWith(key)) : v.keys.includes(key);
}

/** "×3", or '' for never. */
export const timesText = (n) => (n > 0 ? `×${n}` : '');

/**
 * The hardest way each was played to the end (2026-10-27: "shade a green … gradients depending on how done the skill is
 * and if it's been typed or just flash"): 1 What is it? · 2 Choose · 3 Flash · 4 Type it · 5 Type it, shuffled. Kept
 * beside the counts as best:<key>, the highest only.
 */
export function noteBest(keys, level) {
  const m = load();
  let changed = false;
  for (const k of [].concat(keys ?? [])) { if (typeof k !== 'string' || !k) continue; const b = `best:${k}`; if ((Number(m[b]) || 0) < level) { m[b] = level; changed = true; } }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* this visit only */ }
}
export const bestOf = (key) => Number(load()[`best:${key}`]) || 0;
