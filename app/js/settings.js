// Settings: type size (8 steps, 16–44px), notes size (7 steps, a factor over
// the glosses / captions / panel notes only), face, theme, compact labels, the
// Reading switches (the toolbar toggles again), plus the tools that live in
// the same menu (the Audio section for the current week — speed, upload,
// align, play chapter — and Sign out).
// The inline script in index.html applies the localStorage mirror before
// first paint; this module keeps <html> attributes + the store in step.

import { SIZE_MIN, SIZE_MAX, clampSize, NOTE_SIZE_MIN, NOTE_SIZE_MAX, clampNoteSize, RATE_STEPS, clampRate, localDay, weekOfUnit, cleanMs, lastReadOf, readsOf } from './sync.js';

export { readsOf };   // the one `reads` coercion (sync.js), re-exported for the study-log callers and tests
export { SIZE_MIN, SIZE_MAX, clampSize, NOTE_SIZE_MIN, NOTE_SIZE_MAX, clampNoteSize, RATE_STEPS, clampRate };

/** "0.8×" — one decimal, always. Pure. */
export function fmtRate(rate) {
  return `${clampRate(rate).toFixed(1)}×`;
}

/**
 * Fill `container` with one chip per RATE_STEPS value (the same row serves the
 * transport bar and Settings → Audio). `onPick(rate)` fires on a tap; use
 * paintRateChips() to show which one is on.
 */
export function renderRateChips(container, onPick) {
  if (!container) return;
  container.replaceChildren(...RATE_STEPS.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rate-chip';
    b.dataset.rate = String(r);
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `${r.toFixed(1)} times speed`);
    b.textContent = r === 1 ? '1×' : r.toFixed(1);
    b.addEventListener('click', () => onPick(r));
    return b;
  }));
}

/** Mark the chip for `rate` as pressed (and no other). */
export function paintRateChips(container, rate) {
  if (!container) return;
  const r = clampRate(rate);
  for (const b of container.querySelectorAll('.rate-chip')) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === r));
}

/**
 * The one speed menu, used three times (the transport, the listen bar and
 * Settings → Audio): `row` gets the chips (`onPick(rate)` on a tap); `value`
 * (default: `[data-rate-value]` inside `btn`) shows "0.8×". With a `btn` the
 * row is a disclosure — the button toggles it (`aria-expanded`), opening
 * focuses the pressed chip and closes every other open row, a pick closes it
 * and refocuses the button, Escape closes it wherever focus is (and returns
 * focus to the button when it was inside `scope`, default: the button's
 * parent), ArrowLeft/Right (Home/End) move between the chips; without a
 * `btn` the row is always shown (the dialog). Returns { paint(rate),
 * open(bool), close() }.
 */
const openMenus = new Set();   // the rate menus whose row is open right now (opening one closes the others)
export function rateMenu({ btn = null, row, value = null, scope = null, onPick }) {
  if (!row) return null;
  // Picking a chip is the end of the interaction: the row closes and the
  // button takes the focus back (the value on it says what was picked).
  renderRateChips(row, (r) => { onPick(r); if (btn) { open(false); btn.focus(); } });
  const valueEl = value ?? btn?.querySelector('[data-rate-value]') ?? null;
  const menu = { paint, open, close: () => open(false) };
  function open(on) {
    if (!btn) return;
    if (on) for (const other of openMenus) if (other !== menu) other.close();   // one row open at a time
    row.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) { openMenus.add(menu); row.querySelector('[aria-pressed="true"]')?.focus(); }
    else openMenus.delete(menu);
  }
  function paint(rate) {
    const r = clampRate(rate);
    if (valueEl) valueEl.textContent = fmtRate(r);
    btn?.setAttribute('aria-label', `Playback speed ${fmtRate(r)}`);
    paintRateChips(row, r);
  }
  if (btn) {
    btn.addEventListener('click', () => open(row.hidden));
    // Escape anywhere closes the open row; when focus was inside it, the
    // button gets it back (a focus elsewhere stays where it is).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || row.hidden) return;
      const inside = (scope ?? btn.parentElement ?? btn).contains(e.target);
      if (inside) { e.preventDefault(); e.stopPropagation(); }
      open(false);
      if (inside) btn.focus();
    });
    // Arrow keys move between the chips (wrapping); Home / End to the first / last.
    row.addEventListener('keydown', (e) => {
      const chips = [...row.querySelectorAll('.rate-chip')];
      const i = chips.indexOf(e.target);
      if (i < 0) return;
      const next = { ArrowRight: (i + 1) % chips.length, ArrowDown: (i + 1) % chips.length, ArrowLeft: (i - 1 + chips.length) % chips.length, ArrowUp: (i - 1 + chips.length) % chips.length, Home: 0, End: chips.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      chips[next].focus();
    });
  }
  return menu;
}

/** Side-panel width in px kept inside [min, max]; null/invalid → null (the CSS default). Pure. */
export function clampPanelWidth(px, min, max) {
  const n = Number(px);
  if (px == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(Math.max(n, min), Math.max(min, max)));
}
export const FACES = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'dyslexic', label: 'Dyslexia-friendly' },
];
export const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Apply theme/size/notes size/face to <html> so CSS tokens pick them up. */
export function applyToDocument(settings, root = document.documentElement) {
  root.dataset.size = String(clampSize(settings.size));
  root.dataset.noteSize = String(clampNoteSize(settings.noteSize));
  root.dataset.face = settings.face ?? 'serif';
  if (settings.theme && settings.theme !== 'system') root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
  root.dataset.compact = settings.compact ? '1' : '0';
}

/** One plain sentence for the Audio section. Pure. */
export function audioStateText({ hasAudio, alignedCount = 0, total = 0 } = {}) {
  if (!hasAudio) return 'No recording for this week yet.';
  if (!alignedCount) return 'Recording uploaded — not aligned yet.';
  if (total && alignedCount >= total) return `Aligned — all ${total} sentences.`;
  return `Aligned ${alignedCount} of ${total} sentences.`;
}

/** "14 min", "1 h 05 min", "under a minute"; '' for nothing usable. Pure. */
export function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60000) return 'under a minute';
  const min = Math.round(n / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/**
 * The listen bar's status line. `info` is main.js's audioInfo() (+ durationMs),
 * `playback` is audio.status() ({mode, playing}); `index` places the sentence
 * while the chapter plays. '' when there is nothing to say. Pure.
 */
export function listenStatusText({ hasAudio, alignedCount = 0, total = 0, durationMs = 0 } = {}, playback = { mode: 'idle' }, { index = -1 } = {}) {
  const where = index >= 0 && total ? `sentence ${index + 1} of ${total}` : '';
  if (playback.mode === 'all') return [playback.playing ? 'Playing' : 'Paused', where].filter(Boolean).join(' · ');
  if (playback.mode === 'unit') return playback.playing ? 'Playing this sentence' : 'Paused';
  if (!hasAudio || !alignedCount) return '';
  const aligned = total && alignedCount < total ? `Aligned ${alignedCount} of ${total}` : 'Aligned';
  return [aligned, fmtDuration(durationMs)].filter(Boolean).join(' · ');
}

/**
 * The listen bar's "synthesised voice" hint, or '' when the voice is the
 * recording. In sentence view it speaks of the sentence (`unitSynth`: the
 * current row's `synth`); in passage view of the week (`anySynth`: any row).
 * Pure.
 */
export function synthHintText({ sentence = false, unitSynth = false, anySynth = false } = {}) {
  if (sentence) return unitSynth ? 'This sentence is read by a synthesised voice' : '';
  return anySynth ? 'Some or all of this week is read by a synthesised voice' : '';
}

/**
 * Reading progress in a few words: "not started" (nothing read), "42 of 93
 * sentences" (`noun` names the count: "sentences" in the weeks menu, "read"
 * in the heading line), "finished ✓" (all read). Counts are clamped. Pure.
 */
export function progressText(read, total, { noun = 'sentences' } = {}) {
  const t = Math.max(0, Math.round(Number(total)) || 0);
  const r = Math.min(t, Math.max(0, Math.round(Number(read)) || 0));
  if (!t || r === 0) return 'not started';
  if (r >= t) return 'finished ✓';
  return `${r} of ${t} ${noun}`;
}

/** Settings → Progress state line: "Nothing read yet.", "42 of 93 sentences read.", "All 93 sentences read." Pure. */
export function progressStateText(read, total) {
  const t = Math.max(0, Math.round(Number(total)) || 0);
  const r = Math.min(t, Math.max(0, Math.round(Number(read)) || 0));
  if (!t || r === 0) return 'Nothing read yet.';
  if (r >= t) return `All ${t} sentences read.`;
  return `${r} of ${t} sentences read.`;
}

/* ------------------------------------------------------------ study log */
// CONTRACT.md "Study log": sentences per local day come from the progress
// Map's read_at (first passes only); reviews (CONTRACT.md "Reviews") from
// rows with reads > 1, on the day of their last_read_at; minutes per day
// from store.getStudyDays(). The progress Map's values may be whole rows
// (store.getProgressRows()) or bare read_at strings (store.getProgress():
// one pass each). Everything here is pure (tests/study.test.mjs); main.js
// feeds it and paints the results.

export const ROUGH_PACE = 60;              // sentences per active hour assumed before there is any data
export const PACE_MIN_MS = 2 * 60 * 1000;  // a pace is only trusted once this much active time stands behind it
const HOUR_MS = 3600 * 1000;

/** The first pass over a sentence from a progress Map value (a row or a bare read_at). Pure. */
export function readAtOf(value) {
  return value && typeof value === 'object' ? value.read_at ?? null : typeof value === 'string' ? value : null;
}

/** Sentences read (first passes) per local day: Map day → count, from a progress Map (unit_id → row | read_at). Pure. */
export function sentencesPerDay(progress) {
  const out = new Map();
  for (const v of progress?.values?.() ?? []) {
    const day = localDay(readAtOf(v));
    if (day) out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/**
 * Sentences reviewed per local day: Map day → count of the rows with
 * reads > 1 whose last_read_at falls on that day — each sentence once per
 * day, whatever its number of passes. Pure.
 */
export function reviewsPerDay(progress) {
  const out = new Map();
  for (const v of progress?.values?.() ?? []) {
    if (readsOf(v) < 2) continue;
    const day = localDay(lastReadOf(v));
    if (day) out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

/** Passes per week: Map week_n → the largest `reads` among its sentences (1 = read once). Pure. */
export function passesByWeek(progress) {
  const out = new Map();
  for (const [id, v] of progress?.entries?.() ?? []) {
    const n = weekOfUnit(id);
    if (n == null) continue;
    out.set(n, Math.max(out.get(n) ?? 0, readsOf(v)));
  }
  return out;
}

/** Sentences read (first passes) per local day and week: Map day → Map week_n → count. Pure. */
export function sentencesPerDayByWeek(progress) {
  const out = new Map();
  for (const [id, v] of progress?.entries?.() ?? []) {
    const day = localDay(readAtOf(v));
    const n = weekOfUnit(id);
    if (!day || n == null) continue;
    if (!out.has(day)) out.set(day, new Map());
    const m = out.get(day);
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return out;
}

/** Sentences per active hour, or null when the time behind it is too little to mean anything. Pure. */
export function paceRate(sentences, ms, minMs = PACE_MIN_MS) {
  if (!(ms >= minMs) || !(sentences > 0)) return null;
  return sentences / (ms / HOUR_MS);
}

/**
 * The pace the estimates use: sentences per active hour over the last
 * `recent` reading days, else over every reading day, else ROUGH_PACE
 * (`basis: 'rough'`). A reading day has active time *and* first reads
 * (CONTRACT.md "Study log merge"): a review-only day adds its minutes to the
 * totals but never to the pace, so a revision day cannot drag the estimates
 * down. `days` are [{ day, ms, sentences }] in any order. Pure.
 */
export function paceOf(days, { recent = 7, minMs = PACE_MIN_MS } = {}) {
  const active = (days || []).filter((d) => d && d.ms > 0 && d.sentences > 0).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const sum = (list) => list.reduce((acc, d) => ({ ms: acc.ms + d.ms, sentences: acc.sentences + (d.sentences || 0) }), { ms: 0, sentences: 0 });
  const last = sum(active.slice(-recent));
  let rate = paceRate(last.sentences, last.ms, minMs);
  if (rate) return { perHour: rate, basis: 'recent', days: Math.min(recent, active.length), ms: last.ms, sentences: last.sentences };
  const all = sum(active);
  rate = paceRate(all.sentences, all.ms, minMs);
  if (rate) return { perHour: rate, basis: 'overall', days: active.length, ms: all.ms, sentences: all.sentences };
  return { perHour: ROUGH_PACE, basis: 'rough', days: 0, ms: 0, sentences: 0 };
}

/** The `span` local days ending today, oldest first. Pure. */
export function lastDays(now = new Date(), span = 14) {
  const out = [];
  const d = now instanceof Date ? new Date(now) : new Date(now);
  d.setHours(12, 0, 0, 0);
  for (let i = span - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(localDay(x));
  }
  return out;
}

/**
 * Everything the Study log shows, from the progress Map (unit_id → row |
 * read_at) and the study-days Map (day → active_ms):
 *   today   { day, ms, sentences, reviews }
 *   days    the last `span` days, oldest first: { day, ms, sentences, reviews, pace }
 *   weeks   per week with any reading: { n, ms, sentences, passes, pace } —
 *           the week's minutes are each day's minutes shared out by the
 *           sentences read in each week that day (a day with time but no
 *           sentences is counted in no week); `passes` = the largest `reads`
 *           in the week; `n` ascending
 *   pace    paceOf() over every day (only the days with first reads count)
 *   overall { ms, sentences, reviews, pace } over every day
 * `sentences` and every pace are first reads only; `reviews` counts the
 * sentences whose latest pass (reads > 1) fell on the day (CONTRACT.md
 * "Reviews"). Pure.
 */
export function studyLog({ progress, studyDays, now = new Date(), span = 14 } = {}) {
  const perDay = sentencesPerDay(progress);
  const reviewed = reviewsPerDay(progress);
  const byWeek = sentencesPerDayByWeek(progress);
  const passes = passesByWeek(progress);
  const dayKeys = new Set([...perDay.keys(), ...reviewed.keys(), ...(studyDays?.keys?.() ?? [])]);
  const all = [...dayKeys].map((day) => ({ day, ms: cleanMs(studyDays?.get?.(day)), sentences: perDay.get(day) ?? 0, reviews: reviewed.get(day) ?? 0 }));
  const rowOf = (d) => ({ ...d, pace: paceRate(d.sentences, d.ms) });
  const blank = (day) => ({ day, ms: 0, sentences: 0, reviews: 0 });
  const byDay = new Map(all.map((d) => [d.day, d]));
  const today = localDay(now);
  const days = lastDays(now, span).map((day) => rowOf(byDay.get(day) ?? blank(day)));
  const weeks = new Map();
  for (const d of all) {
    const wk = byWeek.get(d.day);
    if (!wk) continue;
    for (const [n, count] of wk) {
      const w = weeks.get(n) ?? { n, ms: 0, sentences: 0, passes: passes.get(n) ?? 1 };
      w.sentences += count;
      w.ms += d.sentences ? (d.ms * count) / d.sentences : 0;
      weeks.set(n, w);
    }
  }
  const overall = all.reduce((acc, d) => ({ ms: acc.ms + d.ms, sentences: acc.sentences + d.sentences, reviews: acc.reviews + d.reviews }), { ms: 0, sentences: 0, reviews: 0 });
  return {
    today: rowOf(byDay.get(today) ?? blank(today)),
    days,
    weeks: [...weeks.values()].sort((a, b) => a.n - b.n).map((w) => rowOf({ ...w, ms: Math.round(w.ms) })),
    pace: paceOf(all),
    overall: { ...overall, pace: paceRate(overall.sentences, overall.ms) },
  };
}

/** Today's study-log line: "Today · 12 min · 14 read · 58 reviewed · 70/h" — minutes and reads always, reviews and the pace only when there are any; "Nothing yet today." when all is zero. Pure. */
export function todayLineText(today) {
  const t = today || {};
  if (!(t.ms > 0 || t.sentences > 0 || t.reviews > 0)) return 'Nothing yet today.';
  const parts = ['Today', fmtActive(t.ms), `${t.sentences ?? 0} read`];
  if (t.reviews > 0) parts.push(`${t.reviews} reviewed`);
  if (t.pace) parts.push(fmtPace(t.pace));
  return parts.join(' · ');
}

/** Milliseconds of reading left for `unread` sentences at `pace` (paceOf() shape or a number per hour). Pure. */
export function timeLeftMs(unread, pace) {
  const u = Math.max(0, Math.round(Number(unread)) || 0);
  const perHour = typeof pace === 'number' ? pace : pace?.perHour;
  return (u / (perHour > 0 ? perHour : ROUGH_PACE)) * HOUR_MS;
}

/**
 * "about 45 min left" / "about 1½ h left" / "about 2 h left" — "finished"
 * when nothing is unread, "(rough estimate)" appended while the pace is the
 * assumed one (`basis: 'rough'` or no pace at all). Pure.
 */
export function timeLeftText(unread, pace) {
  const u = Math.max(0, Math.round(Number(unread)) || 0);
  if (!u) return 'finished';
  const min = timeLeftMs(u, pace) / 60000;
  let t;
  if (min < 1) t = 'under a minute left';
  else if (min < 15) t = `about ${Math.max(1, Math.round(min))} min left`;
  else if (min < 57.5) t = `about ${Math.round(min / 5) * 5} min left`;
  else {
    const h = Math.round(min / 30) / 2;
    t = `about ${h % 1 ? `${Math.floor(h)}½` : h} h left`;
  }
  return !pace || pace.basis === 'rough' ? `${t} (rough estimate)` : t;
}

/** "12 min", "1 h 05 min", "0 min" (under a minute: "<1 min"). Pure. */
export function fmtActive(ms) {
  const n = cleanMs(ms);
  if (!n) return '0 min';
  if (n < 60000) return '<1 min';
  return fmtDuration(n);
}

/** "72 / h" for a pace, "—" for none. Pure. */
export function fmtPace(perHour) {
  return perHour > 0 ? `${Math.round(perHour)} / h` : '—';
}

/**
 * Sparkline geometry for `values` (numbers, oldest first) in a `w` × `h`
 * box: `d` is the SVG path (a flat baseline when every value is 0), `last`
 * the final point, `max` the top of the scale. Pure.
 */
export function sparklineSummary(days, today = localDay()) {
  const list = days || [];
  const active = list.filter((d) => d && d.ms > 0);
  if (!active.length) return `No reading time in the last ${list.length} days.`;
  const peak = active.reduce((best, d) => (d.ms > best.ms ? d : best), active[0]);
  const n = active.length;
  return `${n} active ${n === 1 ? 'day' : 'days'} of the last ${list.length}; peak ${Math.round(peak.ms / 60000)} min on ${fmtDay(peak.day, today)}.`;
}

/**
 * Sparkline geometry for `values` (minutes per day, oldest first): the path
 * `d`, the last point and the peak, for a `w` × `h` box with `pad`. Pure.
 */
export function sparklinePath(values, { w = 140, h = 28, pad = 2 } = {}) {
  const vs = (values || []).map((v) => (Number.isFinite(Number(v)) && v > 0 ? Number(v) : 0));
  const max = Math.max(0, ...vs);
  const n = vs.length;
  const x = (i) => (n > 1 ? pad + (i * (w - 2 * pad)) / (n - 1) : w / 2);
  const y = (v) => h - pad - (max > 0 ? (v / max) * (h - 2 * pad) : 0);
  const pts = vs.map((v, i) => [Math.round(x(i) * 10) / 10, Math.round(y(v) * 10) / 10]);
  if (!pts.length) return { d: '', points: [], last: null, max };
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
  return { d, points: pts, last: { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }, max };
}

/**
 * How much of one ticker interval counts as active time: the whole `dt`
 * when the tab is visible and there was activity within `idleMs` (or audio
 * is playing), else nothing. `dt` is capped at two ticks so a throttled
 * timer cannot bank a long absence. Pure.
 */
export function activeSlice({ visible = true, now, lastActivity, playing = false, dt, idleMs = 60000, tickMs = 15000 } = {}) {
  const slice = Math.max(0, Math.min(cleanMs(dt), tickMs * 2));
  if (!visible || !slice) return 0;
  if (playing) return slice;
  return Number.isFinite(now) && Number.isFinite(lastActivity) && now - lastActivity < idleMs ? slice : 0;
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`;
}

/**
 * Wire the settings dialog. `opts.get()` returns current settings,
 * `opts.set(patch)` persists and returns the new settings.
 * `opts.toggles` — the Reading switches: `{ english|highlights|underlines|
 *   margin|audio: { get(settings) → bool, set(on) → patch } }`, the same map
 *   the toolbar toggles use so the two stay in step. `opts.focusLabel()` (optional)
 *   names this week's grammar focus under the Grammar focus switch.
 * `opts.audio` (may be null → section hidden) is the Audio tool hook:
 *   { weekLabel(), info() → {hasAudio, alignedCount, total}, upload(file),
 *     align(), play(), stop(), onState(cb) }. The Speed chips in that section
 *   write `settings.audioRate` through opts.set like every other control.
 * `opts.onSignOut` signs out.
 */
export function initSettings(dialog, opts) {
  const $ = (sel) => dialog.querySelector(sel);
  // The two steppers (Type size, Notes): the same control over different
  // settings keys and ranges.
  const steppers = [
    stepper({ key: 'size', min: SIZE_MIN, max: SIZE_MAX, clamp: clampSize, down: $('[data-size-step="-1"]'), up: $('[data-size-step="1"]'), dots: [...dialog.querySelectorAll('.size-dot:not(.note-dot)')], value: $('.size-value') }),
    stepper({ key: 'noteSize', min: NOTE_SIZE_MIN, max: NOTE_SIZE_MAX, clamp: clampNoteSize, down: $('[data-note-step="-1"]'), up: $('[data-note-step="1"]'), dots: [...dialog.querySelectorAll('.note-dot')], value: $('.note-value') }),
  ].filter(Boolean);
  const faceInputs = [...dialog.querySelectorAll('input[name="face"]')];
  const themeInputs = [...dialog.querySelectorAll('input[name="theme"]')];
  const compact = $('input[name="compact"]');
  const signOut = $('[data-action="signout"]');
  const toggles = opts.toggles || {};
  const switches = [...dialog.querySelectorAll('input[data-setting-toggle]')].filter((i) => toggles[i.dataset.settingToggle]);
  const focusDesc = $('[data-focus-desc]');
  const speed = rateMenu({ row: $('[data-audio] [data-rate-chips]'), value: $('[data-audio] [data-rate-value]'), onPick: (r) => update({ audioRate: r }) });

  function render(s) {
    for (const st of steppers) st.paint(s);
    faceInputs.forEach((i) => { i.checked = i.value === s.face; });
    themeInputs.forEach((i) => { i.checked = i.value === s.theme; });
    compact.checked = !!s.compact;
    for (const i of switches) i.checked = !!toggles[i.dataset.settingToggle].get(s);
    const focus = opts.focusLabel?.();
    if (focusDesc) focusDesc.textContent = focus ? `This week: ${focus}` : "This week's grammar, highlighted";
    speed?.paint(s.audioRate);
    applyToDocument(s);
  }

  async function update(patch) {
    const next = await opts.set(patch);
    render(next);
    opts.onChange?.(next, patch);
  }

  for (const st of steppers) st.wire({ get: opts.get, render, update });
  faceInputs.forEach((i) => i.addEventListener('change', () => i.checked && update({ face: i.value })));
  themeInputs.forEach((i) => i.addEventListener('change', () => i.checked && update({ theme: i.value })));
  compact.addEventListener('change', () => update({ compact: compact.checked }));
  for (const i of switches) i.addEventListener('change', () => update(toggles[i.dataset.settingToggle].set(i.checked)));

  signOut.addEventListener('click', () => { dialog.close(); opts.onSignOut?.(); });

  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  // Click on the backdrop closes.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* ------------------------------------------------------------ audio */
  const audioUI = initAudioSection(dialog, opts.audio);
  const progressUI = initProgressSection(dialog, opts.progress);

  render(opts.get());
  return {
    render,
    /** Open the dialog and refresh the Audio and Progress sections for the current week. */
    open() { dialog.showModal(); audioUI?.refresh(); progressUI?.refresh(); },
    refreshAudio: () => audioUI?.refresh(),
    refreshProgress: () => progressUI?.refresh(),
  };
}

/**
 * One size stepper (Type size, Notes): `down` / `up` buttons, the dots and
 * the live "3 of 8" line over settings[`key`], clamped by `clamp` to
 * [min, max]. `paint(settings)` shows a value; `wire({ get, render, update })`
 * binds the clicks. Returns null when the markup is missing.
 */
function stepper({ key, min, max, clamp, down, up, dots, value }) {
  if (!down || !up) return null;
  // At either end the button stays in the tab order (aria-disabled, a no-op
  // click) so a keyboard user who reaches 1 or 8 keeps their place.
  function paint(s) {
    const n = clamp(s[key]);
    down.setAttribute('aria-disabled', String(n <= min));
    up.setAttribute('aria-disabled', String(n >= max));
    dots.forEach((d, i) => d.classList.toggle('is-on', i < n));
    if (value) value.textContent = `${n} of ${max}`;
  }
  function wire({ get, render, update }) {
    // The step a click moves from: the last one asked for, so a second click
    // before the first save resolves still moves one more step.
    let asked = null;
    function step(dir) {
      const n = clamp((asked ?? clamp(get()[key])) + dir);
      if (n === (asked ?? clamp(get()[key]))) return;   // already at the end
      asked = n;
      render({ ...get(), [key]: n });
      update({ [key]: n }).finally(() => { if (asked === n) asked = null; });
    }
    down.addEventListener('click', () => step(-1));
    up.addEventListener('click', () => step(1));
  }
  return { paint, wire };
}

/**
 * Settings → Progress (CONTRACT.md "Reading progress"): this week's count,
 * "Reset this week" / "Reset all progress" — each behind a native confirm()
 * — and the line saying lookups are never touched. `progress` is main.js's
 * hook: { weekLabel(), info() → { read, total, all }, resetWeek(), resetAll() }.
 */
function initProgressSection(dialog, progress) {
  const section = dialog.querySelector('[data-progress]');
  if (!section) return null;
  if (!progress) { section.hidden = true; return null; }
  section.hidden = false;
  const $ = (sel) => section.querySelector(sel);
  const weekEl = $('[data-progress-week]');
  const stateEl = $('[data-progress-state]');
  const msgEl = $('[data-progress-msg]');
  const resetWeek = $('[data-action="reset-week"]');
  const resetAll = $('[data-action="reset-all"]');
  let info = { read: 0, total: 0, all: 0 };
  let token = 0;

  const say = (text, tone) => {
    msgEl.textContent = text || '';
    if (tone) msgEl.dataset.tone = tone; else delete msgEl.dataset.tone;
  };
  function paint() {
    weekEl.textContent = progress.weekLabel?.() ?? 'this week';
    stateEl.textContent = progressStateText(info.read, info.total);
    stateEl.dataset.state = !info.read ? 'none' : info.read >= info.total ? 'done' : 'part';
    resetWeek.disabled = !info.read;
    resetAll.disabled = !info.all;
  }
  async function refresh() {
    const t = ++token;
    try {
      const next = await progress.info();
      if (t !== token) return;
      info = { read: 0, total: 0, all: 0, ...next };
    } catch (e) {
      if (t !== token) return;
      say(e?.message || 'Could not read the progress.', 'error');
    }
    paint();
  }
  async function reset(what) {
    const question = what === 'week'
      ? `Reset this week's reading progress? The ${info.read === 1 ? 'sentence' : `${info.read} sentences`} marked read will be unmarked. Looked-up words are kept.`
      : `Reset all reading progress, every week? Looked-up words are kept.`;
    if (!window.confirm(question)) return;
    say('');
    resetWeek.disabled = resetAll.disabled = true;
    try {
      // The hook may hand back the line to show; the dialog is modal, so the notice belongs here, not behind the backdrop.
      const done = await (what === 'week' ? progress.resetWeek() : progress.resetAll());
      say(typeof done === 'string' && done ? done : (what === 'week' ? 'Reading progress for this week reset.' : 'All reading progress reset.'), 'ok');
      await refresh();
    } catch (e) {
      say(e?.message || 'The reset failed.', 'error');
      paint();
    }
  }
  resetWeek.addEventListener('click', () => reset('week'));
  resetAll.addEventListener('click', () => reset('all'));
  const study = initStudyLog(section, progress.study ?? null);
  paint();
  return { refresh: async () => { await refresh(); study?.paint(); } };
}

/** "Today", "Yesterday", else "Mon 31 Aug" for a "YYYY-MM-DD" day. Pure. */
export function fmtDay(day, today = localDay()) {
  if (day === today) return 'Today';
  const [y, m, d] = String(day).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const t = today ? new Date(...String(today).split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) : null;
  if (t && Math.round((t - date) / 86400000) === 1) return 'Yesterday';
  try { return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return day; }
}

/**
 * The Study log block inside Settings → Progress (CONTRACT.md "Study log").
 * `study` is main.js's hook: { log() → studyLog(), clear() → the line to show }.
 * Today's line, the sparkline (minutes per day, the last 14), the active days
 * of those 14 as a table, the per-week rows, the pace the estimates use, and
 * "Clear study log" behind a confirm().
 */
function initStudyLog(section, study) {
  const root = section.querySelector('[data-study]');
  if (!root) return null;
  if (!study) { root.hidden = true; return null; }
  root.hidden = false;
  const $ = (sel) => root.querySelector(sel);
  const todayEl = $('[data-study-today]');
  const spark = $('[data-study-spark]');
  const sparkLine = $('[data-spark-line]');
  const sparkDot = $('[data-spark-dot]');
  const sparkCap = $('[data-spark-cap]');
  const sparkDesc = $('[data-spark-desc]');
  const sparkText = $('[data-spark-text]');
  const daysTable = $('[data-study-days]');
  const weeksTable = $('[data-study-weeks]');
  const paceEl = $('[data-study-pace]');
  const clearBtn = $('[data-action="clear-study"]');
  const msgEl = $('[data-study-msg]');
  const say = (text, tone) => {
    msgEl.textContent = text || '';
    if (tone) msgEl.dataset.tone = tone; else delete msgEl.dataset.tone;
  };
  const cell = (tag, text, num = false, nil = false) => { const el = document.createElement(tag); el.textContent = text; if (num) el.className = nil ? 'study__num study__nil' : 'study__num'; return el; };
  // Day · Min · Read · Reviewed · Pace, or Week · Min · Read · Passes · Pace ("93 read · 2 passes"); a day without reviews shows a dash.
  const row = (label, r, { head = false, passes = false } = {}) => {
    const tr = document.createElement('tr');
    const first = cell(head ? 'th' : 'td', label);
    if (head) first.scope = 'row';
    const extra = passes ? cell('td', String(r.passes ?? 1), true) : cell('td', r.reviews > 0 ? String(r.reviews) : '–', true, !(r.reviews > 0));
    if (!passes && !(r.reviews > 0)) extra.setAttribute('aria-label', 'none');   // the quiet dash reads as "none", not "dash" or nothing
    tr.append(first, cell('td', r.ms <= 0 ? '0' : r.ms < 60000 ? '<1' : String(Math.round(r.ms / 60000)), true), cell('td', String(r.sentences), true), extra, cell('td', fmtPace(r.pace), true));
    return tr;
  };
  function paint() {
    let log;
    try { log = study.log(); } catch (e) { say(e?.message || 'Could not read the study log.', 'error'); return; }
    if (!log) return;
    const { today, days, weeks, pace, overall } = log;
    const any = overall.ms > 0 || overall.sentences > 0 || overall.reviews > 0;
    todayEl.textContent = todayLineText(today);
    // Sparkline: minutes per day, oldest → today; the last point in the accent (dataviz: current period), the line in the de-emphasis ink.
    const mins = days.map((d) => d.ms / 60000);
    const { d, last, max } = sparklinePath(mins, { w: 160, h: 32, pad: 4 });
    spark.hidden = !any;
    sparkLine.setAttribute('d', d);
    if (last) { sparkDot.setAttribute('cx', String(last.x)); sparkDot.setAttribute('cy', String(last.y)); }
    if (last) sparkDot.removeAttribute('hidden'); else sparkDot.setAttribute('hidden', '');   // an SVG element has no `hidden` IDL property: the attribute is what [hidden] { display: none } matches
    sparkCap.textContent = max > 0 ? `Minutes per day · last ${days.length} days · peak ${Math.round(max)} min` : `Minutes per day · last ${days.length} days`;
    // What the picture says, for a screen reader: the <desc> the SVG is described by, and the same text once as a visually-hidden sentence after the figure.
    const summary = sparklineSummary(days, today.day);
    if (sparkDesc) sparkDesc.textContent = summary;
    if (sparkText) sparkText.textContent = summary;
    // The table lists only the days with anything in them, newest first.
    const active = days.filter((r) => r.ms > 0 || r.sentences > 0 || r.reviews > 0).reverse();
    daysTable.hidden = !active.length;
    daysTable.tBodies[0].replaceChildren(...active.map((r) => row(fmtDay(r.day, today.day), r, { head: true })));
    weeksTable.hidden = !weeks.length;
    weeksTable.tBodies[0].replaceChildren(...weeks.map((w) => row(`Week ${w.n}`, w, { head: true, passes: true })));
    if (!any) paceEl.textContent = `No study time recorded yet — estimates assume ${ROUGH_PACE} sentences an hour until there is.`;
    else if (pace.basis === 'rough') paceEl.textContent = `Too little reading time for a pace yet — estimates assume ${ROUGH_PACE} sentences an hour. Overall: ${overall.sentences} sentences in ${fmtActive(overall.ms)}.`;
    else {
      const basis = pace.basis === 'recent' ? `over the last ${pace.days === 1 ? 'day with new sentences' : `${pace.days} days with new sentences`}` : 'over every day with new sentences';
      paceEl.textContent = `Pace: ${Math.round(pace.perHour)} sentences an hour ${basis}. Overall: ${overall.sentences} sentences in ${fmtActive(overall.ms)}${overall.pace ? ` (${fmtPace(overall.pace)})` : ''}${overall.reviews > 0 ? `; ${overall.reviews} reviewed` : ''}.`;
    }
    clearBtn.disabled = !any;
  }
  clearBtn.addEventListener('click', async () => {
    if (!window.confirm('Clear the study log? Minutes per day are forgotten on every device. Reading progress and looked-up words are kept.')) return;
    say('');
    clearBtn.disabled = true;
    try {
      const done = await study.clear();
      say(typeof done === 'string' && done ? done : 'Study log cleared.', 'ok');
    } catch (e) {
      say(e?.message || 'Could not clear the study log.', 'error');
    }
    paint();
  });
  paint();
  return { paint };
}

function initAudioSection(dialog, audio) {
  const section = dialog.querySelector('[data-audio]');
  if (!section) return null;
  if (!audio) { section.hidden = true; return null; }
  section.hidden = false;
  const $ = (sel) => section.querySelector(sel);
  const weekEl = $('[data-audio-week]');
  const stateEl = $('[data-audio-state]');
  const msgEl = $('[data-audio-msg]');
  const file = $('[data-audio-file]');
  const uploadLabel = $('[data-audio-upload-label]');
  const alignBtn = $('[data-action="align"]');
  const playBtn = $('[data-action="play"]');
  const stopBtn = $('[data-action="stop"]');
  let info = { hasAudio: false, alignedCount: 0, total: 0 };
  let playback = { mode: 'idle', playing: false };
  let token = 0;

  const say = (text, tone) => {
    msgEl.textContent = text || '';
    if (tone) msgEl.dataset.tone = tone; else delete msgEl.dataset.tone;
  };

  function paint() {
    weekEl.textContent = audio.weekLabel?.() ?? 'this week';
    stateEl.textContent = audioStateText(info);
    stateEl.dataset.state = !info.hasAudio ? 'none' : info.alignedCount ? 'aligned' : 'uploaded';
    uploadLabel.textContent = info.hasAudio ? 'Replace recording…' : 'Upload chapter MP3…';
    alignBtn.disabled = !info.hasAudio;
    alignBtn.textContent = info.alignedCount ? 'Re-align audio…' : 'Align audio…';
    const active = playback.mode === 'all';
    playBtn.disabled = !(info.hasAudio && info.alignedCount) && !active;
    playBtn.textContent = active ? (playback.playing ? 'Pause' : 'Resume') : 'Play chapter';
    stopBtn.hidden = !active;
  }

  async function refresh() {
    const t = ++token;
    say('');
    try {
      const next = await audio.info();
      if (t !== token) return;
      info = next;
    } catch (e) {
      if (t !== token) return;
      say(e?.message || 'Could not read the audio state.', 'error');
    }
    paint();
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    file.disabled = true;
    file.closest('.audio__upload').classList.add('is-busy');
    say(`Uploading ${f.name} (${fmtSize(f.size)})…`);
    try {
      await audio.upload(f);
      await refresh();
      say(`Uploaded ${f.name}. ${info.alignedCount ? 'Re-align if the recording changed.' : 'Now align it so sentences can be played.'}`, 'ok');
    } catch (e) {
      say(`Upload failed: ${e?.message || e}`, 'error');
    } finally {
      file.value = '';
      file.disabled = false;
      file.closest('.audio__upload').classList.remove('is-busy');
    }
  });
  alignBtn.addEventListener('click', () => { dialog.close(); audio.align(); });
  playBtn.addEventListener('click', async () => {
    if (playback.mode === 'all') { if (playback.playing) audio.pause(); else audio.resume(); return; }
    dialog.close();
    try { await audio.play(); } catch (e) { say(e?.message || String(e), 'error'); }
  });
  stopBtn.addEventListener('click', () => audio.stop());
  audio.onState?.((st) => { playback = st; paint(); });

  paint();
  return { refresh };
}
