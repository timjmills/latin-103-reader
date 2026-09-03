// Audio — per-sentence playback, follow-along, and the one-time alignment mode.
//
//   import { audio } from './audio.js';
//   audio.attach({ setPlayingUnit(unitId | null) {…} }, store);   // reader hook + the Store in use
//   await audio.playUnit('w01:4.2');   // from a click/tap handler (iOS needs a gesture)
//   await audio.playAll('w01:1.1');    // follow-along from a unit (or from the start)
//   audio.pause(); audio.resume(); audio.stop();
//   const rows = await audio.startAlignment(1);   // opens the alignment overlay; null if cancelled
//
// One <audio> element for the whole app. Week audio comes from
// store.getAudioUrl(weekN) (signed URL, private bucket; an object URL in the
// fixture store); alignment rows from store.getAlignment(weekN). The store is
// handed in by attach() so this module works with either store implementation;
// without one it falls back to './store.js'. Nothing here touches index.html —
// the alignment overlay is created on demand and styled with tokens from
// app/css/tokens.css.

import { weekOfUnit } from './sync.js';

// 0.05 s of silence — played synchronously inside the first user gesture so
// iOS/Safari treat later programmatic play() calls on this element as allowed.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const STOP_SLACK_MS = 40;

const state = {
  el: null,
  reader: null,
  weekN: null,
  url: null,
  units: [],
  rows: [],            // aligned rows sorted by start_ms
  startOf: new Map(),  // unit_id → start_ms
  mode: 'idle',        // idle | unit | all | align
  stopAt: null,
  raf: 0,
  unlocked: false,
  current: null,
  listeners: new Set(),
  loading: null,
  store: null,
  error: null,
};

async function getStore() {
  if (!state.store) state.store = (await import('./store.js')).store;
  return state.store;
}

/** Make everything behind an overlay inert (and restore on the returned fn). */
function inertBackground(overlay) {
  const els = [...document.body.children].filter((el) => el !== overlay && !('inert' in el && el.inert));
  for (const el of els) el.inert = true;
  return () => { for (const el of els) el.inert = false; };
}

// ---------------------------------------------------------------------------
// Element + helpers
// ---------------------------------------------------------------------------

function el() {
  if (state.el) return state.el;
  const a = document.createElement('audio');
  a.preload = 'auto';
  a.setAttribute('playsinline', '');
  a.hidden = true;
  a.addEventListener('ended', () => finish());
  a.addEventListener('pause', () => { cancelLoop(); notify(); });
  a.addEventListener('play', () => { startLoop(); notify(); });
  a.addEventListener('error', () => { state.error = 'The recording could not be played.'; notify(); });
  document.body.appendChild(a);
  state.el = a;
  return a;
}

function unlock() {
  if (state.unlocked) return;
  const a = el();
  try {
    a.src = SILENT_WAV;
    const p = a.play();
    if (p?.catch) p.catch(() => {});
  } catch { /* ignore */ }
  state.unlocked = true;
}

function notify() {
  const snap = status();
  for (const cb of state.listeners) { try { cb(snap); } catch (e) { console.error(e); } }
}

function status() {
  const a = state.el;
  return {
    mode: state.mode,
    weekN: state.weekN,
    playing: Boolean(a && !a.paused && !a.ended),
    currentUnit: state.current,
    currentTimeMs: a ? Math.round(a.currentTime * 1000) : 0,
    durationMs: a && Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null,
    error: state.error,
  };
}

function setPlaying(unitId) {
  if (state.current === unitId) return;
  state.current = unitId;
  try { state.reader?.setPlayingUnit?.(unitId); } catch (e) { console.error(e); }
  notify();
}

async function loadWeek(weekN) {
  const n = Number(weekN);
  if (state.weekN === n && state.url) return true;
  if (state.loading) await state.loading;
  if (state.weekN === n && state.url) return true;
  state.loading = (async () => {
    const store = await getStore();
    const url = await store.getAudioUrl(n);
    if (!url) return false;
    const [units, rows] = await Promise.all([store.getUnits(n), store.getAlignment(n)]);
    state.weekN = n;
    state.url = url;
    state.units = units;
    setAlignment(rows);
    const a = el();
    if (a.src !== url) { state.error = null; a.src = url; a.load(); }
    return true;
  })();
  try { return await state.loading; } finally { state.loading = null; }
}

function setAlignment(rows) {
  state.rows = [...rows].sort((a, b) => a.start_ms - b.start_ms);
  state.startOf = new Map(state.rows.map((r) => [r.unit_id, r.start_ms]));
}

/** Aligned unit whose start_ms ≤ t (binary search); null before the first. */
function unitAt(ms) {
  const rows = state.rows;
  let lo = 0, hi = rows.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].start_ms <= ms) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return hit >= 0 ? rows[hit].unit_id : null;
}

function seekAndPlay(ms) {
  const a = el();
  const go = () => {
    a.currentTime = Math.max(0, ms / 1000);
    const p = a.play();
    if (p?.catch) p.catch((e) => { state.error = e?.name === 'NotAllowedError' ? 'Tap play again to start the audio.' : 'The recording could not be played.'; finish(); });
  };
  if (a.readyState >= 1) go();
  else a.addEventListener('loadedmetadata', go, { once: true });
}

function startLoop() {
  cancelLoop();
  const tick = () => {
    const a = state.el;
    if (!a || a.paused) return;
    const ms = a.currentTime * 1000;
    if (state.mode === 'unit' && state.stopAt != null && ms >= state.stopAt - STOP_SLACK_MS) {
      a.pause();
      finish();
      return;
    }
    if (state.mode === 'all') setPlaying(unitAt(ms));
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function cancelLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function finish() {
  cancelLoop();
  if (state.mode === 'align') return;
  state.mode = 'idle';
  state.stopAt = null;
  setPlaying(null);
  notify();
}

// ---------------------------------------------------------------------------
// Public playback API
// ---------------------------------------------------------------------------

function attach(reader, store) {
  state.reader = reader || null;
  if (store) state.store = store;
}

/** Forget the cached URL/alignment for a week (call after an upload or a new alignment). */
function invalidate(weekN) {
  if (state.weekN === Number(weekN)) { state.url = null; state.rows = []; state.startOf = new Map(); }
}

function onState(cb) {
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}

async function hasAudio(weekN) {
  return Boolean(await (await getStore()).getAudioUrl(weekN));
}

async function isAligned(weekN) {
  return (await (await getStore()).getAlignment(weekN)).length > 0;
}

/** Play one unit: from its start_ms to the next aligned unit's start_ms. */
async function playUnit(unitId, maybeUnitId) {
  if (maybeUnitId != null) unitId = maybeUnitId;   // tolerate playUnit(weekN, unitId)
  const n = weekOfUnit(unitId);
  if (n == null) throw new Error(`Bad unit id: ${unitId}`);
  unlock();
  state.error = null;
  if (!(await loadWeek(n))) throw new Error('No recording for this week yet. Upload one in Audio settings.');
  const start = state.startOf.get(unitId);
  if (start == null) throw new Error('This week has not been aligned yet. Run "Align audio" first.');
  const idx = state.rows.findIndex((r) => r.unit_id === unitId);
  const next = state.rows[idx + 1];
  state.mode = 'unit';
  state.stopAt = next ? next.start_ms : null;
  setPlaying(unitId);
  seekAndPlay(start);
}

/** Play the whole chapter from a unit (or the beginning), highlighting as it goes. */
async function playAll(fromUnitId = null) {
  const n = fromUnitId ? weekOfUnit(fromUnitId) : state.weekN;
  if (n == null) throw new Error('Pick a week first');
  unlock();
  state.error = null;
  if (!(await loadWeek(n))) throw new Error('No recording for this week yet. Upload one in Audio settings.');
  if (!state.rows.length) throw new Error('This week has not been aligned yet. Run "Align audio" first.');
  const start = fromUnitId ? (state.startOf.get(fromUnitId) ?? 0) : 0;
  state.mode = 'all';
  state.stopAt = null;
  setPlaying(unitAt(start));
  seekAndPlay(start);
}

function pause() {
  state.el?.pause();
}

function resume() {
  const a = state.el;
  if (!a || !a.src || a.src === SILENT_WAV) return;
  const p = a.play();
  if (p?.catch) p.catch(() => {});
}

function stop() {
  const a = state.el;
  if (a) a.pause();
  finish();
}

// ---------------------------------------------------------------------------
// Alignment mode
// ---------------------------------------------------------------------------

const ALIGN_STYLE = `
.audio-align{position:fixed;inset:0;z-index:var(--z-modal,30);display:grid;grid-template-rows:auto 1fr auto;gap:var(--s-4,1rem);padding:var(--s-4,1rem);background:var(--bg,#fdfcfa);color:var(--ink,#222);font-family:var(--face-ui,system-ui,sans-serif)}
.audio-align__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--s-2,.5rem)}
.audio-align__title{margin:0;font-size:var(--ui-lg,1.0625rem);font-weight:600}
.audio-align__meta{font-variant-numeric:tabular-nums;color:var(--ink-3,#777);font-size:var(--ui-sm,.8125rem)}
.audio-align__body{overflow:auto;max-width:var(--measure,34em);width:100%;margin:0 auto;display:grid;align-content:center;gap:var(--s-4,1rem)}
.audio-align__prev{margin:0;color:var(--ink-3,#777);font-family:var(--face-reading,Georgia,serif);font-size:var(--reading-size,1.25rem);line-height:var(--reading-leading,1.55)}
.audio-align__cur{margin:0;font-family:var(--face-reading,Georgia,serif);font-size:calc(var(--reading-size,1.25rem) * 1.25);line-height:var(--reading-leading,1.55);color:var(--ink,#222)}
.audio-align__cur small{display:block;font-family:var(--face-ui,system-ui);font-size:var(--ui-sm,.8125rem);color:var(--rubric-ink,#7a2a1f);margin-bottom:var(--s-1,.25rem)}
.audio-align__hint{margin:0;color:var(--ink-2,#555);font-size:var(--ui-md,.9375rem)}
.audio-align__controls{display:grid;gap:var(--s-2,.5rem);max-width:var(--measure,34em);width:100%;margin:0 auto}
.audio-align__row{display:flex;flex-wrap:wrap;gap:var(--s-2,.5rem)}
.audio-btn{font:inherit;min-height:var(--tap,44px);padding:0 var(--s-4,1rem);border-radius:var(--radius,8px);border:1px solid var(--line-strong,#aaa);background:var(--bg-raised,#fff);color:var(--ink,#222);cursor:pointer;flex:1 1 auto}
.audio-btn:focus-visible{outline:2px solid var(--focus,#2a6db5);outline-offset:2px}
.audio-btn[disabled]{opacity:.5;cursor:not-allowed}
.audio-btn--primary{min-height:calc(var(--tap,44px) * 1.8);font-size:var(--ui-lg,1.0625rem);font-weight:700;color:#fff;background:var(--rubric,#7a2a1f);border-color:transparent}
.audio-btn--primary:hover{opacity:.94}
.audio-btn--danger{color:var(--danger,#b3261e)}
.audio-align__error{margin:0;color:var(--danger,#b3261e);font-size:var(--ui-sm,.8125rem)}
.audio-align__error:empty{display:none}
`;

function ensureAlignStyles() {
  if (document.getElementById('audio-align-styles')) return;
  const s = document.createElement('style');
  s.id = 'audio-align-styles';
  s.textContent = ALIGN_STYLE;
  document.head.appendChild(s);
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Full-chapter playback with a big "starts now" button. Records start_ms per
 * unit in reading order; undo-last, pause, skip back. Saves through
 * store.saveAlignment(weekN, rows). Resolves with the rows, or null on cancel.
 */
async function startAlignment(weekN) {
  const n = Number(weekN);
  ensureAlignStyles();
  unlock();
  stop();
  const store = await getStore();
  const ok = await loadWeek(n);
  const units = ok ? state.units : await store.getUnits(n);
  const a = el();
  const previouslyFocused = document.activeElement;

  return new Promise((resolve) => {
    const rows = [];
    let idx = 0;
    let started = false;

    const root = document.createElement('section');
    root.className = 'audio-align';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'audio-align-title');
    root.innerHTML = `
      <header class="audio-align__head">
        <h2 class="audio-align__title" id="audio-align-title">Align audio — week ${n}</h2>
        <span class="audio-align__meta" aria-live="off"><span data-progress>0 / ${units.length}</span> · <span data-time>0:00</span></span>
      </header>
      <div class="audio-align__body">
        <p class="audio-align__prev" data-prev aria-label="Previous sentence"></p>
        <p class="audio-align__cur" data-cur aria-live="polite"></p>
        <p class="audio-align__hint" data-hint></p>
        <p class="audio-align__error" data-error role="alert"></p>
      </div>
      <div class="audio-align__controls">
        <button type="button" class="audio-btn audio-btn--primary" data-next>Start playback</button>
        <div class="audio-align__row">
          <button type="button" class="audio-btn" data-undo disabled>Undo last (Z)</button>
          <button type="button" class="audio-btn" data-back>Back 5 s</button>
          <button type="button" class="audio-btn" data-pause disabled>Pause (P)</button>
        </div>
        <div class="audio-align__row">
          <button type="button" class="audio-btn" data-finish disabled>Finish and save</button>
          <button type="button" class="audio-btn audio-btn--danger" data-cancel>Cancel (Esc)</button>
        </div>
      </div>`;

    const q = (sel) => root.querySelector(sel);
    const nextBtn = q('[data-next]');
    const undoBtn = q('[data-undo]');
    const pauseBtn = q('[data-pause]');
    const finishBtn = q('[data-finish]');
    const errEl = q('[data-error]');

    const render = () => {
      const cur = units[idx];
      const prev = units[idx - 1];
      q('[data-progress]').textContent = `${rows.length} / ${units.length}`;
      q('[data-prev]').textContent = prev ? prev.la : '';
      if (cur) {
        q('[data-cur]').innerHTML = `<small>Sentence ${idx + 1}${cur.line_no ? ` · line ${cur.line_no}` : ''}</small>`;
        q('[data-cur]').appendChild(document.createTextNode(cur.la));
        q('[data-hint]').textContent = started
          ? 'Press the button (or Space) the moment this sentence begins.'
          : 'Playback starts from the beginning. Press the button as soon as the first sentence starts.';
      } else {
        q('[data-cur]').textContent = 'All sentences marked.';
        q('[data-hint]').textContent = 'Save to enable tap-to-play and follow-along for this week.';
      }
      nextBtn.textContent = !started ? 'Start playback' : cur ? 'This sentence starts now (Space)' : 'Done';
      nextBtn.disabled = started && !cur;
      undoBtn.disabled = rows.length === 0;
      finishBtn.disabled = rows.length === 0;
      pauseBtn.disabled = !started;
      pauseBtn.textContent = a.paused ? 'Resume (P)' : 'Pause (P)';
    };

    const timer = setInterval(() => { q('[data-time]').textContent = fmt(a.currentTime * 1000); }, 250);

    let restoreInert = () => {};
    const close = (result) => {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey, true);
      a.removeEventListener('pause', render);
      a.removeEventListener('play', render);
      a.pause();
      state.mode = 'idle';
      setPlaying(null);
      root.remove();
      restoreInert();
      if (previouslyFocused?.focus) previouslyFocused.focus();
      resolve(result);
    };

    const mark = () => {
      if (!started) {
        if (!ok) { errEl.textContent = 'No recording for this week yet. Upload one first.'; return; }
        started = true;
        state.mode = 'align';
        seekAndPlay(0);
        render();
        return;
      }
      const cur = units[idx];
      if (!cur) return;
      rows.push({ unit_id: cur.id, start_ms: Math.round(a.currentTime * 1000) });
      idx += 1;
      setPlaying(cur.id);
      render();
      if (!units[idx]) finishBtn.focus();
    };

    const undo = () => {
      if (!rows.length) return;
      const last = rows.pop();
      idx -= 1;
      a.currentTime = Math.max(0, (last.start_ms - 2000) / 1000);
      setPlaying(units[idx - 1]?.id ?? null);
      render();
    };

    const togglePause = () => {
      if (!started) return;
      if (a.paused) a.play().catch(() => {}); else a.pause();
      render();
    };

    const finishSave = async () => {
      if (!rows.length) return;
      finishBtn.disabled = true;
      finishBtn.textContent = 'Saving…';
      try {
        await store.saveAlignment(n, rows);
        setAlignment(rows);
        close(rows);
      } catch (e) {
        errEl.textContent = `Could not save: ${e?.message || e}`;
        finishBtn.disabled = false;
        finishBtn.textContent = 'Finish and save';
      }
    };

    const cancel = () => {
      if (rows.length && !window.confirm('Discard this alignment?')) return;
      close(null);
    };

    const onKey = (ev) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); ev.stopPropagation(); mark(); }
      else if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); undo(); }
      else if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); ev.stopPropagation(); togglePause(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    };

    nextBtn.addEventListener('click', mark);
    undoBtn.addEventListener('click', undo);
    pauseBtn.addEventListener('click', togglePause);
    q('[data-back]').addEventListener('click', () => { a.currentTime = Math.max(0, a.currentTime - 5); });
    finishBtn.addEventListener('click', finishSave);
    q('[data-cancel]').addEventListener('click', cancel);
    a.addEventListener('pause', render);
    a.addEventListener('play', render);
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(root);
    restoreInert = inertBackground(root);
    render();
    nextBtn.focus();
  });
}

export const audio = {
  attach, onState, status, invalidate,
  hasAudio, isAligned,
  playUnit, playAll, pause, resume, stop,
  startAlignment,
};
