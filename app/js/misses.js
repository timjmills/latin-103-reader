/**
 * Forms missed, brought back until known (2026-10-27, the plan to 15 December: "review driven by your mistakes"):
 * a form missed on the first try in any game is kept and comes back the next day; typed right on its first try it
 * comes back in 3 days, then 7; right twice running it is known and leaves; missed again it starts over. Any game
 * that asks the form counts, not only the review of misses. Kept on this device ('l103.misses').
 */
const KEY = 'l103.misses';
const DAY = 864e5;
const STEPS = [1, 3, 7];   // days until it comes back
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const write = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* this visit only */ } };
// A card as it can be played again: what the game needs, none of the dictionary entry.
// The word goes in front of a cue that does not name it (a one-word game's "nominative · singular").
const wordOf = (x) => String(x.entry?.lemma ?? x.entry?.h ?? '').split(/[\s,]/)[0];
const cueOf = (x) => { const w = wordOf(x); return w && !String(x.cue ?? '').includes(w) ? `${w} · ${x.cue}` : x.cue; };
const keep = (x) => ({ key: x.key, cue: cueOf(x), en: x.en ?? '', answers: x.answers, stem: x.stem ?? null, ending: x.ending ?? null, group: x.group ?? null, col: x.col ?? null, form: x.form && typeof x.form === 'object' ? x.form : null });
const keepable = (x) => !!x?.key && !String(x.key).startsWith('box|') && Array.isArray(x.answers) && x.answers.length;

/** After a game (or a round left early): `cards` played, `missed` the keys missed on the first try, `typed` in Type it. */
export function noteRound(cards, missed, { typed = true, now = Date.now() } = {}) {
  const m = read();
  let changed = false;
  for (const x of cards ?? []) {
    if (!keepable(x)) continue;
    const had = m[x.key];
    if (missed.has(x.key)) { m[x.key] = { card: keep(x), step: 0, streak: 0, misses: (had?.misses ?? 0) + 1, due: now + STEPS[0] * DAY }; changed = true; continue; }
    if (!had || !typed) continue;   // right by choosing or flashing proves less: it stays as it was
    const streak = (had.streak ?? 0) + 1;
    if (streak >= 2) delete m[x.key];
    else { const step = Math.min((had.step ?? 0) + 1, STEPS.length - 1); m[x.key] = { ...had, step, streak, due: now + STEPS[step] * DAY }; }
    changed = true;
  }
  if (changed) write(m);
}
/** Every form kept, the most missed first; `due` only those due now. */
export function missedForms({ due = false, now = Date.now() } = {}) {
  return Object.values(read()).filter((r) => r?.card && (!due || r.due <= now)).sort((a, b) => (b.misses ?? 0) - (a.misses ?? 0) || a.due - b.due);
}
export const missedDue = (now = Date.now()) => missedForms({ due: true, now }).length;
