// How many times something has been practised (2026-10-23: "have a brief way to know how many times a
// skill / lesson part / table has been practised — maybe a small number"). A count of finished rounds, kept
// on this device: a skill's session or Learn ten, a lesson part practised on its own (or its check answered in
// Learn), a table's game played to its end.
//
//   skill:<id>        part:<id>:<step>        table:<catalogue table id>        tablepart:<skill id>

const KEY = 'l103.practised';
let memo = null;
const load = () => {
  if (memo) return memo;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); memo = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { memo = {}; }
  return memo;
};

/** How many times `key` has been practised (0 when never). */
export function practised(key) {
  const n = Number(load()[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** One more round of each key given (a key, or a list; empty ones are skipped). */
export function notePractised(keys) {
  const m = load();
  let changed = false;
  for (const k of [].concat(keys ?? [])) { if (typeof k !== 'string' || !k) continue; m[k] = practised(k) + 1; changed = true; }
  if (!changed) return;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode: the count is kept for this visit only */ }
}

/** "×3", or '' for never. */
export const timesText = (n) => (n > 0 ? `×${n}` : '');
