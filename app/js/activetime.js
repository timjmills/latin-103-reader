/**
 * Active time (2026-10-26: "a timer to track my active usage: track this by words typed / answer clicking, keep it as
 * the timer at the top; also on lesson pages, as there is some reading, if the page is being skimmed and clicks are
 * happening"). A second counts while the page is shown and something was typed, clicked, tapped or scrolled in the
 * last IDLE seconds; kept on this device by day (localStorage 'l103.active': { 'YYYY-MM-DD': seconds }).
 */
const KEY = 'l103.active';
const IDLE = 60_000;   // a minute of reading between scrolls still counts; longer is away
const KEEP_DAYS = 120;
let last = 0;
let started = false;
const views = new Set();

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function write(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* this visit only */ } }

/** Seconds active today, and in the last seven days. */
export function activeSeconds() {
  const m = read();
  const now = new Date();
  let week = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - i); week += m[today(d)] ?? 0; }
  return { today: m[today(now)] ?? 0, week };
}
/** "12:05" under an hour, "1 h 05" over. */
export function clockText(s) {
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = Math.floor(s % 60);
  return h ? `${h} h ${String(mi).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`;
}
const isActive = () => document.visibilityState === 'visible' && Date.now() - last < IDLE;

function tick() {
  if (isActive()) {
    const m = read();
    const k = today();
    m[k] = (m[k] ?? 0) + 1;
    const keys = Object.keys(m).sort();
    while (keys.length > KEEP_DAYS) delete m[keys.shift()];
    write(m);
  }
  for (const v of [...views]) { if (!v.isConnected) { views.delete(v); continue; } paint(v); }
}
function paint(v) {
  const { today: t, week } = activeSeconds();
  const on = isActive();
  v.textContent = `⏱ ${clockText(t)}`;
  v.dataset.on = String(on);
  v.title = `Active today: ${clockText(t)} · last 7 days: ${clockText(week)}. It counts while you type, click, tap or scroll; after a minute with none it pauses.`;
  v.setAttribute('aria-label', `Active time today ${clockText(t)}${on ? '' : ', paused'}`);
}
/** Starts the count (once): typing, clicking, tapping and scrolling anywhere in the app keep it going. */
export function startActiveTime() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const note = () => { last = Date.now(); };
  for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart', 'input']) document.addEventListener(ev, note, { capture: true, passive: true });
  document.addEventListener('scroll', note, { capture: true, passive: true });
  note();
  setInterval(tick, 1000);
}
/** The timer for the top of a page: a span kept up to date while it is in the document. */
export function activeTimer() {
  startActiveTime();
  const v = document.createElement('span');
  v.className = 'g-activetime';
  v.setAttribute('role', 'timer');
  views.add(v);
  paint(v);
  return v;
}
