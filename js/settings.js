// Settings: type size (8 steps, 16–44px), notes size (7 steps, a factor over
// the glosses / captions / panel notes only), face, theme, compact labels, the
// Reading switches (the toolbar toggles again), plus the tools that live in
// the same menu (the Audio section for the current week — speed, upload,
// align, play chapter — and Sign out).
// The inline script in index.html applies the localStorage mirror before
// first paint; this module keeps <html> attributes + the store in step.

import { SIZE_MIN, SIZE_MAX, clampSize, NOTE_SIZE_MIN, NOTE_SIZE_MAX, clampNoteSize, RATE_STEPS, clampRate } from './sync.js';
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
  paint();
  return { refresh };
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
