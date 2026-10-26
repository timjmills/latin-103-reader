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

/**
 * A goal (2026-10-26: "a goal timer, where I can set 5–60 minutes; when on, the clock turns green and counts down as
 * long as I am working; the timer stops" when I am not): minutes of active time, counted down by the same seconds as
 * the day's total. Kept on this device ('l103.goal': { total, left, met }), so a reload carries on.
 */
const GOAL_KEY = 'l103.goal';
export const GOALS = [5, 10, 15, 20, 30, 45, 60];
export function goal() { try { const g = JSON.parse(localStorage.getItem(GOAL_KEY) || 'null'); return g && g.total > 0 ? g : null; } catch { return null; } }
export function setGoal(minutes) {
  try { if (minutes) localStorage.setItem(GOAL_KEY, JSON.stringify({ total: minutes * 60, left: minutes * 60, met: false })); else localStorage.removeItem(GOAL_KEY); } catch { /* this visit only */ }
  for (const v of views) paint(v);
}

function tick() {
  if (isActive()) {
    const m = read();
    const k = today();
    m[k] = (m[k] ?? 0) + 1;
    const keys = Object.keys(m).sort();
    while (keys.length > KEEP_DAYS) delete m[keys.shift()];
    write(m);
    const g = goal();
    if (g && !g.met) {
      g.left = Math.max(0, g.left - 1);
      if (!g.left) { g.met = true; for (const v of views) v.dispatchEvent(new CustomEvent('goalmet', { bubbles: true })); }
      try { localStorage.setItem(GOAL_KEY, JSON.stringify(g)); } catch { /* this visit only */ }
    }
  }
  for (const v of [...views]) { if (!v.isConnected) { views.delete(v); continue; } paint(v); }
}
function paint(v) {
  const { today: t, week } = activeSeconds();
  const on = isActive();
  const g = goal();
  v.dataset.on = String(on);
  v.dataset.goal = g ? (g.met ? 'met' : 'on') : '';
  if (g && !g.met) {
    v.textContent = `⏳ ${clockText(g.left)}${on ? '' : ' ⏸'}`;
    v.title = `Goal: ${g.total / 60} min of active time — ${clockText(g.left)} to go${on ? '' : ' (paused: type, click or scroll to carry on)'}. Today: ${clockText(t)}.`;
    v.setAttribute('aria-label', `Goal timer, ${clockText(g.left)} to go${on ? '' : ', paused'}. Change the goal`);
  } else if (g) {
    v.textContent = `✓ ${g.total / 60} min`;
    v.title = `Goal met: ${g.total / 60} minutes of active time. Today: ${clockText(t)}.`;
    v.setAttribute('aria-label', `Goal of ${g.total / 60} minutes met. Set another`);
  } else {
    v.textContent = `⚡ ${clockText(t)}`;
    v.title = `Active today: ${clockText(t)} · last 7 days: ${clockText(week)}. It counts while you type, click, tap or scroll; after a minute with none it pauses. Tap to set a goal.`;
    v.setAttribute('aria-label', `Active time today ${clockText(t)}${on ? '' : ', paused'}. Set a goal`);
  }
}
/** The menu under the timer: today and the week, and a goal to set or clear. */
function openMenu(v) {
  document.querySelector('.at-pop')?.remove();
  const { today: t, week } = activeSeconds();
  const g = goal();
  const pop = document.createElement('div');
  pop.className = 'at-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Active time and goal');
  const p = (text, cls = '') => { const e = document.createElement('p'); e.className = cls; e.textContent = text; return e; };
  const b = (text, on, fn, cls = 'at-pop__goal') => { const e = document.createElement('button'); e.type = 'button'; e.className = cls; e.textContent = text; if (on) e.setAttribute('aria-pressed', 'true'); e.addEventListener('click', () => { fn(); close(); }); return e; };
  pop.append(p(`Active today: ${clockText(t)}`, 'at-pop__big'), p(`Last 7 days: ${clockText(week)}`, 'at-pop__q'),
    p(g ? (g.met ? `Goal met: ${g.total / 60} min ✓` : `Goal: ${g.total / 60} min — ${clockText(g.left)} to go`) : 'Set a goal of active time:', 'at-pop__h'));
  const row = document.createElement('div');
  row.className = 'at-pop__goals';
  for (const m of GOALS) row.append(b(`${m}`, g && !g.met && g.total === m * 60, () => setGoal(m)));
  pop.append(row, p('minutes. It counts down only while you type, click, tap or scroll.', 'at-pop__q'));
  if (g) pop.append(b(g.met ? 'Clear' : 'Stop the goal', false, () => setGoal(0), 'at-pop__clear'));
  const r = v.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  (v.closest('dialog') ?? document.body).append(pop);   // in a game (a modal dialog) it must be in the dialog to be seen
  // Under the timer, its right edges lined up, and never past either side of the screen.
  const w = pop.offsetWidth;
  pop.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`;
  v.setAttribute('aria-expanded', 'true');
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== v) close(); };
  const esc = (e) => { if (e.key === 'Escape') { close(); v.focus(); } };
  function close() { pop.remove(); v.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); }
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); });
  pop.querySelector('button')?.focus();
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
  const v = document.createElement('button');
  v.type = 'button';
  v.className = 'g-activetime';
  v.setAttribute('aria-haspopup', 'dialog');
  v.setAttribute('aria-expanded', 'false');
  v.addEventListener('click', () => (document.querySelector('.at-pop') ? document.querySelector('.at-pop').remove() : openMenu(v)));
  // Met: a moment's flourish, and said aloud.
  v.addEventListener('goalmet', () => { if (v.isConnected && v.offsetParent && !document.querySelector('.at-confetti')) confetti(v.closest('dialog') ?? document.body); v.classList.add('is-met'); setTimeout(() => v.classList.remove('is-met'), 2400); const live = document.createElement('p'); live.className = 'visually-hidden'; live.setAttribute('role', 'status'); live.textContent = 'Goal met.'; document.body.append(live); setTimeout(() => live.remove(), 4000); });
  views.add(v);
  paint(v);
  return v;
}

/** Confetti for a goal met (2026-10-26: "confetti if it meets"): a burst of paper, gone in a few seconds; none with reduced motion. */
export function confetti(where = document.body) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'at-confetti';
  box.setAttribute('aria-hidden', 'true');
  const colours = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#8338ec', '#ff006e', '#3a86ff'];
  for (let i = 0; i < 140; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colours[i % colours.length];
    p.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 240)}px`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 1080 - 540)}deg`);
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    box.append(p);
  }
  where.append(box);
  setTimeout(() => box.remove(), 4600);
}
