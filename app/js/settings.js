// Settings: type size (8 steps, 16–44px), face, theme, compact labels, plus the
// tools that live in the same menu (the Audio section for the current
// week — upload, align, play chapter — and Sign out).
// The inline script in index.html applies the localStorage mirror before
// first paint; this module keeps <html> attributes + the store in step.

import { SIZE_MIN, SIZE_MAX, clampSize } from './sync.js';
export { SIZE_MIN, SIZE_MAX, clampSize };

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

/** Apply theme/size/face to <html> so CSS tokens pick them up. */
export function applyToDocument(settings, root = document.documentElement) {
  root.dataset.size = String(clampSize(settings.size));
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

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`;
}

/**
 * Wire the settings dialog. `opts.get()` returns current settings,
 * `opts.set(patch)` persists and returns the new settings.
 * `opts.audio` (may be null → section hidden) is the Audio tool hook:
 *   { weekLabel(), info() → {hasAudio, alignedCount, total}, upload(file),
 *     align(), play(), stop(), onState(cb) }.
 * `opts.onSignOut` signs out.
 */
export function initSettings(dialog, opts) {
  const $ = (sel) => dialog.querySelector(sel);
  const sizeDown = $('[data-size-step="-1"]');
  const sizeUp = $('[data-size-step="1"]');
  const sizeDots = [...dialog.querySelectorAll('.size-dot')];
  const faceInputs = [...dialog.querySelectorAll('input[name="face"]')];
  const themeInputs = [...dialog.querySelectorAll('input[name="theme"]')];
  const compact = $('input[name="compact"]');
  const signOut = $('[data-action="signout"]');

  function render(s) {
    const size = clampSize(s.size);
    sizeDown.disabled = size <= SIZE_MIN;
    sizeUp.disabled = size >= SIZE_MAX;
    sizeDots.forEach((d, i) => d.classList.toggle('is-on', i < size));
    $('.size-value').textContent = `${size} of ${SIZE_MAX}`;
    faceInputs.forEach((i) => { i.checked = i.value === s.face; });
    themeInputs.forEach((i) => { i.checked = i.value === s.theme; });
    compact.checked = !!s.compact;
    applyToDocument(s);
  }

  async function update(patch) {
    const next = await opts.set(patch);
    render(next);
    opts.onChange?.(next, patch);
  }

  // The size a click steps from: the last one asked for, so a second click
  // before the first save resolves still moves one more step.
  let sizeAsked = null;
  function stepSize(dir) {
    const size = clampSize((sizeAsked ?? clampSize(opts.get().size)) + dir);
    sizeAsked = size;
    render({ ...opts.get(), size });
    update({ size }).finally(() => { if (sizeAsked === size) sizeAsked = null; });
  }
  sizeDown.addEventListener('click', () => stepSize(-1));
  sizeUp.addEventListener('click', () => stepSize(1));
  faceInputs.forEach((i) => i.addEventListener('change', () => i.checked && update({ face: i.value })));
  themeInputs.forEach((i) => i.addEventListener('change', () => i.checked && update({ theme: i.value })));
  compact.addEventListener('change', () => update({ compact: compact.checked }));

  signOut.addEventListener('click', () => { dialog.close(); opts.onSignOut?.(); });

  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  // Click on the backdrop closes.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* ------------------------------------------------------------ audio */
  const audioUI = initAudioSection(dialog, opts.audio);

  render(opts.get());
  return {
    render,
    /** Open the dialog and refresh the Audio section for the current week. */
    open() { dialog.showModal(); audioUI?.refresh(); },
    refreshAudio: () => audioUI?.refresh(),
  };
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
