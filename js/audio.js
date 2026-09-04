// Audio — per-sentence playback, follow-along, and the one-time alignment mode.
//
//   import { audio } from './audio.js';
//   audio.attach({ setPlayingUnit(unitId | null) {…}, setPlayingWord(unitId, i | null) {…}, wordTexts(unitId) {…} }, store);
//   await audio.playUnit('w01:4.2');   // from a click/tap handler (iOS needs a gesture)
//   await audio.playAll('w01:1.1');    // follow-along from a unit (or from the start)
//   audio.pause(); audio.resume(); audio.stop();
//   audio.setRate(0.8);                // playback speed (settings.audioRate), pitch preserved
//   const rows = await audio.startAlignment(1);   // opens the alignment overlay; null if cancelled
//
// One <audio> element for the whole app. Week audio comes from
// store.getAudioUrl(weekN) (signed URL, private bucket; an object URL in the
// fixture store); alignment rows from store.getAlignment(weekN). The store is
// handed in by attach() so this module works with either store implementation;
// without one it falls back to './store.js'. Nothing here touches index.html —
// the alignment overlay is created on demand and styled with tokens from
// app/css/tokens.css.
//
// Word cursor: rows may carry `words: [{t, s, e}]` (absolute ms, from the
// pipeline's Whisper / TTS alignment). While playing, the word being spoken is
// handed to reader.setPlayingWord(unitId, tokenIndex) — the alignment words
// are matched to the unit's rendered word tokens (reader.wordTexts) by order,
// with mapWordsToTokens() below; a word that does not match is skipped, never
// guessed. Rows without words (a manual alignment) fall back to the
// sentence-level highlight alone. Rows may also carry `end_ms` (where the
// unit's audio ends; null = until the next row starts — the pipeline sets it
// on the last unit of a recording two weeks share) and `synth` (true when a
// synthesised voice reads the unit; the listen bar says so).

import { weekOfUnit, clampRate } from './sync.js';

// ---------------------------------------------------------------------------
// Word cursor — pure helpers (tested in tests/ui.audio-cursor.test.mjs)
// ---------------------------------------------------------------------------

/** Comparable form of a word: lowercase, macrons/accents stripped, v→u, j→i, letters only. */
export function normaliseWord(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/v/g, 'u').replace(/j/g, 'i')
    .replace(/[^a-z]/g, '');
}

/**
 * Map alignment words to a unit's word tokens by order: the longest common
 * subsequence of the two normalised sequences (difflib-style). Returns one
 * token index per word, -1 where the word has no match (mis-heard, merged or
 * split by the recogniser) — never a guess.
 * @param {string[]} words   alignment words, text order
 * @param {string[]} tokens  the unit's rendered word tokens, text order
 * @returns {number[]}
 */
export function mapWordsToTokens(words, tokens) {
  const a = (words || []).map(normaliseWord);
  const b = (tokens || []).map(normaliseWord);
  const n = a.length, m = b.length;
  const out = new Array(n).fill(-1);
  if (!n || !m) return out;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] && a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { out[i] = j; i++; j++; }
    else if (lcs[i + 1][j] > lcs[i][j + 1]) i++;   // a tie keeps the word and skips the token: the earliest spoken word wins
    else j++;
  }
  return out;
}

/**
 * The word spoken at `ms` in a flat list sorted by start (binary search):
 * the last word that has started, as long as it ended less than `hold` ms ago
 * — a pause longer than that (or the end of the row) shows no cursor.
 * @param {{s:number,e:number}[]} words
 */
export function wordAt(words, ms, hold = WORD_HOLD_MS) {
  let lo = 0, hi = words.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s <= ms) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const w = words[hit];
  return ms > w.e + hold ? null : w;
}
export const WORD_HOLD_MS = 350;

/**
 * Where the aligned speech ends, in ms: the latest row end, word end or row
 * start across the rows — a lower bound on the recording's length, enough for
 * the listen bar's "14 min" before the file itself has been fetched, and the
 * week's own length when two weeks share one recording. 0 without rows.
 * @param {{start_ms:number, end_ms?:number|null, words?:{e:number}[]}[]} rows
 */
export function alignmentEndMs(rows) {
  let end = 0;
  for (const r of rows || []) {
    for (const v of [r?.start_ms, r?.end_ms]) {
      const n = Number(v);
      if (v != null && Number.isFinite(n)) end = Math.max(end, n);
    }
    for (const w of Array.isArray(r?.words) ? r.words : []) {
      const e = Number(w?.e);
      if (Number.isFinite(e)) end = Math.max(end, e);
    }
  }
  return end;
}

/**
 * Where playback of one row stops, in ms: its own `end_ms` when the row
 * carries one, else the next row's start, else null (play to the end of the
 * file). `rows` are sorted by start_ms; `idx` is the row's position. Pure.
 */
export function unitStopMs(rows, idx) {
  const row = rows?.[idx];
  if (!row) return null;
  if (row.end_ms != null && Number.isFinite(Number(row.end_ms))) return Number(row.end_ms);
  const next = rows[idx + 1];
  return next && Number.isFinite(Number(next.start_ms)) ? Number(next.start_ms) : null;
}

/**
 * Where chapter playback stops: the last row's `end_ms` when it has one (two
 * weeks may share a recording — week 13 must not run on into week 14), else
 * null (the end of the file). Pure.
 */
export function chapterStopMs(rows) {
  const last = rows?.[rows.length - 1];
  return last && last.end_ms != null && Number.isFinite(Number(last.end_ms)) ? Number(last.end_ms) : null;
}

// 0.05 s of silence — played synchronously inside the first user gesture so
// iOS/Safari treat later programmatic play() calls on this element as allowed.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const STOP_SLACK_MS = 40;
// A cached week URL older than this is asked of the store again before the
// next play: store.js signs URLs for an hour and reuses them for 50 minutes,
// so a range request on an older one would go out with an expired token.
const URL_MAX_AGE_MS = 50 * 60 * 1000;

const state = {
  el: null,
  reader: null,
  weekN: null,
  url: null,
  urlAt: 0,            // Date.now() when state.url was fetched
  pending: null,       // the one seekAndPlay() waiting for loadedmetadata (m5: never stacked)
  units: [],
  rows: [],            // aligned rows sorted by start_ms
  startOf: new Map(),  // unit_id → start_ms
  words: [],           // every timed word of the week, {s, e, unit_id, wi}, sorted by s
  wordMap: new Map(),  // unit_id → mapWordsToTokens() result (built on first use)
  word: null,          // "unit_id#tokenIndex" of the word under the cursor
  mode: 'idle',        // idle | unit | all | align
  rate: 1,             // playbackRate applied to the element (setRate); the cursor reads currentTime, so it follows at any rate
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
  a.addEventListener('pause', () => { cancelLoop(); setWord(null); notify(); });
  a.addEventListener('play', () => { startLoop(); notify(); });
  a.addEventListener('error', () => {
    // A fatal media error (expired signed URL, dropped connection) leaves the
    // element "not paused": drop the cached URL so the next play re-signs,
    // stop the cursor loop and return to idle — unless the alignment overlay
    // is open, which keeps its own mode and shows the error itself.
    state.error = 'The recording could not be played.';
    state.url = null;
    clearPending();
    cancelLoop();
    try { a.pause(); } catch { /* ignore */ }
    finish();
    notify();
  });
  document.body.appendChild(a);
  state.el = a;
  applyRate(a);
  return a;
}

/** Put state.rate on the element. Slower speech keeps its pitch (preservesPitch; the WebKit name for older Safari). */
function applyRate(a) {
  if (!a) return;
  try { a.preservesPitch = true; } catch { /* read-only in some engines */ }
  try { if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = true; } catch { /* ignore */ }
  a.defaultPlaybackRate = state.rate;   // survives a later src change + load()
  a.playbackRate = state.rate;
}

/** Playback speed for every mode (sentence, chapter, alignment); clamped to 0.5–1.2. Returns the rate in use. */
function setRate(rate) {
  const r = clampRate(rate, state.rate);
  if (r !== state.rate) { state.rate = r; if (state.el) applyRate(state.el); }
  return state.rate;
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
    rate: state.rate,
    error: state.error,
  };
}

function setPlaying(unitId) {
  if (state.current === unitId) return;
  state.current = unitId;
  try { state.reader?.setPlayingUnit?.(unitId); } catch (e) { console.error(e); }
  notify();
}

/** The cached URL is usable: same week, present, and younger than the store's signing window. */
function urlFresh(n) {
  return state.weekN === n && !!state.url && Date.now() - state.urlAt < URL_MAX_AGE_MS;
}

async function loadWeek(weekN) {
  const n = Number(weekN);
  if (urlFresh(n)) return true;
  if (state.loading) await state.loading;
  if (urlFresh(n)) return true;
  state.loading = (async () => {
    const store = await getStore();
    const url = await store.getAudioUrl(n);
    if (!url) return false;
    const [units, rows] = await Promise.all([store.getUnits(n), store.getAlignment(n)]);
    state.weekN = n;
    state.url = url;
    state.urlAt = Date.now();
    state.units = units;
    setAlignment(rows);
    const a = el();
    if (a.src !== url) { clearPending(); state.error = null; a.src = url; a.load(); }
    return true;
  })();
  try { return await state.loading; } finally { state.loading = null; }
}

function setAlignment(rows) {
  state.rows = [...rows].sort((a, b) => a.start_ms - b.start_ms);
  state.startOf = new Map(state.rows.map((r) => [r.unit_id, r.start_ms]));
  state.words = [];
  for (const r of state.rows) {
    (Array.isArray(r.words) ? r.words : []).forEach((w, wi) => state.words.push({ s: w.s, e: w.e, unit_id: r.unit_id, wi }));
  }
  state.words.sort((a, b) => a.s - b.s);
  state.wordMap = new Map();
  setWord(null);
}

/** Token index of an alignment word in its unit (-1: unmatched, or no reader). */
function tokenIndexFor(w) {
  let map = state.wordMap.get(w.unit_id);
  if (!map) {
    const row = state.rows.find((r) => r.unit_id === w.unit_id);
    const texts = state.reader?.wordTexts?.(w.unit_id) ?? [];
    map = mapWordsToTokens((row?.words ?? []).map((x) => x.t), texts);
    state.wordMap.set(w.unit_id, map);
  }
  const i = map[w.wi];
  return i == null ? -1 : i;
}

function setWord(hit) {
  const key = hit ? `${hit.unit_id}#${hit.idx}` : null;
  if (state.word === key) return;
  state.word = key;
  try { state.reader?.setPlayingWord?.(hit ? hit.unit_id : null, hit ? hit.idx : null); } catch (e) { console.error(e); }
}

/** Move the word cursor to whatever is spoken at `ms` inside the current unit. */
function updateWord(ms) {
  const w = state.words.length ? wordAt(state.words, ms) : null;
  if (!w || w.unit_id !== state.current) { setWord(null); return; }
  const idx = tokenIndexFor(w);
  setWord(idx >= 0 ? { unit_id: w.unit_id, idx } : null);
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

/** Forget a seekAndPlay() still waiting for metadata (a newer one, a new src, or stop). */
function clearPending() {
  if (state.pending && state.el) state.el.removeEventListener('loadedmetadata', state.pending);
  state.pending = null;
}

function seekAndPlay(ms) {
  const a = el();
  clearPending();
  const go = () => {
    if (state.pending === go) state.pending = null;
    a.currentTime = Math.max(0, ms / 1000);
    applyRate(a);   // a fresh src resets playbackRate to the default; make sure the chosen speed is on
    const p = a.play();
    if (p?.catch) p.catch((e) => { state.error = e?.name === 'NotAllowedError' ? 'Tap play again to start the audio.' : 'The recording could not be played.'; finish(); });
  };
  if (a.readyState >= 1) go();
  else { state.pending = go; a.addEventListener('loadedmetadata', go, { once: true }); }
}

function startLoop() {
  cancelLoop();
  const tick = () => {
    const a = state.el;
    if (!a || a.paused) return;
    const ms = a.currentTime * 1000;
    if (state.stopAt != null && ms >= state.stopAt - STOP_SLACK_MS) {   // the row's end_ms / the next row (unit) or the last row's end_ms (chapter)
      a.pause();
      finish();
      return;
    }
    if (state.mode === 'all') setPlaying(unitAt(ms));
    updateWord(ms);
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
  setWord(null);
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
  if (state.weekN === Number(weekN)) { state.url = null; setAlignment([]); }
}

function onState(cb) {
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}

/** Play one unit: from its start_ms to its end_ms, or to the next aligned unit's start_ms. */
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
  state.mode = 'unit';
  state.stopAt = unitStopMs(state.rows, idx);
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
  state.stopAt = chapterStopMs(state.rows);
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
  clearPending();
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
      setWord(null);
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

    // While the overlay is open it owns the keyboard: its own keys act, and
    // every key stops here so the reader's shortcuts (a, e, h, m, j, k …)
    // cannot toggle settings or stop playback underneath. Tab keeps its
    // default (focus moves inside the dialog; the page behind is inert).
    const onKey = (ev) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      ev.stopPropagation();
      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); mark(); }
      else if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'Backspace') { ev.preventDefault(); undo(); }
      else if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); togglePause(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
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
  attach, onState, status, invalidate, alignmentEndMs, unitStopMs, chapterStopMs,
  playUnit, playAll, pause, resume, stop, setRate,
  startAlignment,
};
