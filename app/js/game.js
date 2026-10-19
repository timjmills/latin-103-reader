// Game mode for a table (the learner, 2026-10-19): "a practice mode … almost like a game mode where it zooms
// in on the word you're on in the chart, while still showing the ones below or above … when you get it right it
// moves down to the next, turning green; when you get it wrong it turns red and goes blank so you can try again".
//
// playTable({ title, subtitle, items, id, onNext, nextLabel }) opens a full-screen focus view over the page —
// the same on a computer and a phone. One form at a time, large and centred, the two answered above it (green)
// and the two to come below (dimmed), the column gliding up as the learner goes. Down each column, as a chart
// is chanted. Right: green, a moment, the next. Wrong: red, a shake, the box empties for another try — tries are
// unlimited and Show is there — but a miss on the first try is kept, for "Replay the ones I missed" at the end
// and, on this device, the next time the table is played. A streak, a score, a timer and the table's best; soft
// sounds and a buzz behind a speaker switch that starts off. The end: a result card, the misses again, the next
// word where the caller has one.
//
// items: [{ key, cue, en, answers, stem, ending, group }] — `cue` the row and part ("we · imperfect active"),
// `en` its English, `answers` the forms accepted (wordpanel.js cellAnswers), `group` the column it belongs to.

import { cellRight } from './wordpanel.js';

const LS = 'l103.game.';
const read = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* not kept */ } };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return n;
};

/* ---------------------------------------------------------------- sound */
let audio = null;
function tone(freq, ms, type = 'sine', gain = 0.06) {
  if (!read('sound', false)) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* no sound to be had */ }
}
const sounds = {
  right: () => tone(880, 120, 'sine'),
  wrong: () => { tone(196, 220, 'triangle', 0.08); if (read('sound', false)) try { navigator.vibrate?.(60); } catch { /* none */ } },
  done: () => { tone(660, 140); setTimeout(() => tone(990, 220), 130); },
};

/** A game sound by name ('right' | 'wrong' | 'done'), behind the same speaker switch (Grammar's drill game). */
export function gameSound(kind) { sounds[kind]?.(); }
/** The speaker switch, for a game drawn elsewhere: true when sounds are on. */
export const soundOn = () => !!read('sound', false);
export function setSound(on) { write('sound', !!on); }

/** The misses kept for a table on this device: the `key`s missed on the first try the last time it was played. */
export function savedMisses(id) { return id ? read(`misses.${id}`, []) : []; }

/* ---------------------------------------------------------------- the game */
export function playTable({ title = '', subtitle = '', items = [], id = null, onNext = null, nextLabel = 'Next word →', onClose = null } = {}) {
  const list = items.filter((x) => x && x.answers?.length);
  if (!list.length) return null;
  const opener = document.activeElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let at = 0;
  let streak = 0;
  let bestStreak = 0;
  let score = 0;
  const firstMiss = new Set();
  const shown = new Set();
  const started = Date.now();
  let timer = 0;
  let closed = false;

  const progress = el('span', { class: 'gm__progress' });
  const streakEl = el('span', { class: 'gm__streak', 'aria-label': 'Streak' });
  const scoreEl = el('span', { class: 'gm__score' });
  const clock = el('span', { class: 'gm__clock', hidden: !read('timer', true) });
  const soundBtn = el('button', { type: 'button', class: 'gm__tool', 'aria-pressed': String(!!read('sound', false)), 'aria-label': 'Sound', title: 'Sound', onclick: () => { const on = !read('sound', false); write('sound', on); soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.textContent = on ? '🔊' : '🔈'; if (on) sounds.right(); } }, read('sound', false) ? '🔊' : '🔈');
  const timerBtn = el('button', { type: 'button', class: 'gm__tool', 'aria-pressed': String(!!read('timer', true)), 'aria-label': 'Timer', title: 'Timer', onclick: () => { const on = !read('timer', true); write('timer', on); timerBtn.setAttribute('aria-pressed', String(on)); clock.hidden = !on; } }, '⏱');
  const closeBtn = el('button', { type: 'button', class: 'gm__tool gm__close', 'aria-label': 'Leave the game', title: 'Leave (Esc)', onclick: () => close() }, '✕');
  const live = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const track = el('ol', { class: 'gm__track', 'aria-label': 'Forms' });
  const input = el('input', { type: 'text', class: 'gm__in', lang: 'la', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Your answer' });
  const showBtn = el('button', { type: 'button', class: 'gm__show', onclick: () => reveal() }, 'Show');
  const stage = el('div', { class: 'gm__stage' }, track);
  // A <dialog> shown modal: it stacks above the word popup (itself a modal dialog, in the top layer, where no
  // z-index reaches), keeps the focus inside, and Escape closes it.
  const root = el('dialog', { class: 'gm', 'aria-label': `Game: ${title}` },
    el('header', { class: 'gm__bar' },
      el('div', { class: 'gm__titles' }, el('p', { class: 'gm__title', lang: 'la', text: title }), subtitle ? el('p', { class: 'gm__sub', text: subtitle }) : null),
      el('div', { class: 'gm__stats' }, progress, streakEl, scoreEl, clock),
      el('div', { class: 'gm__tools' }, timerBtn, soundBtn, closeBtn)),
    stage, live);

  const rows = list.map((x, i) => {
    const slot = el('span', { class: 'gm__slot' });
    const li = el('li', { class: 'gm__row', 'data-i': String(i), 'data-group': x.group ?? '' },
      el('span', { class: 'gm__cue' }, el('span', { class: 'gm__label', text: x.cue }), x.en ? el('span', { class: 'gm__en', text: x.en }) : null),
      slot);
    track.append(li);
    return { li, slot, x };
  });
  // A thin rule where one column ends and the next begins (active → passive, singular → plural).
  rows.forEach((r, i) => { if (i && r.x.group !== rows[i - 1].x.group) r.li.classList.add('gm__row--newgroup'); });

  const formNode = (x) => (x.stem != null && x.ending != null && (x.stem || x.ending)
    ? [x.stem ? el('span', { class: 'pt__stem', text: x.stem }) : null, el('span', { class: 'pt__ending', text: x.ending })]
    : [x.answers[0]]);
  const paintStats = () => {
    progress.textContent = `${Math.min(at + 1, list.length)} / ${list.length}`;
    streakEl.textContent = streak >= 2 ? `🔥 ${streak}` : '';
    scoreEl.textContent = `${score} pts`;
  };
  const tick = () => { const s = Math.floor((Date.now() - started) / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  timer = setInterval(tick, 500);
  tick();

  // The column glides so the current form sits a third of the way down — above where a phone's keyboard comes up.
  function place() {
    rows.forEach((r, i) => {
      const d = i - at;
      r.li.dataset.pos = d === 0 ? 'current' : Math.abs(d) <= 2 ? (d < 0 ? 'above' : 'below') : 'far';
      r.li.dataset.dist = String(Math.min(Math.abs(d), 3));
    });
    const cur = rows[at]?.li;
    if (!cur) return;
    const stageH = stage.clientHeight || window.innerHeight;
    const y = cur.offsetTop + cur.offsetHeight / 2 - stageH * 0.36;
    track.style.transform = `translateY(${-Math.max(0, y)}px)`;
  }
  function focusCurrent() {
    const r = rows[at];
    if (!r) return;
    r.slot.replaceChildren(input, showBtn);
    input.value = '';
    input.setAttribute('aria-label', `${r.x.cue}${r.x.en ? ` — ${r.x.en}` : ''}`);
    place();
    paintStats();
    input.focus({ preventScroll: true });
  }
  function advance() {
    at += 1;
    if (at >= list.length) { finish(); return; }
    focusCurrent();
  }
  function settle(r, state) {
    r.li.dataset.state = state;
    r.slot.replaceChildren(el('span', { class: 'gm__form', lang: 'la' }, formNode(r.x)), el('span', { class: 'gm__mark', 'aria-hidden': 'true', text: state === 'right' ? '✓' : '·' }));
  }
  function submit() {
    const r = rows[at];
    if (!r) return;
    const typed = input.value.trim();
    if (!typed) return;
    if (cellRight(typed, r.x.answers)) {
      const clean = !firstMiss.has(r.x.key) && !shown.has(r.x.key);
      streak = clean ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
      if (clean) score += 10 + Math.min(streak, 10);
      settle(r, 'right');
      sounds.right();
      live.textContent = `Right: ${r.x.answers[0]}.`;
      paintStats();
      setTimeout(() => { if (!closed) advance(); }, reduced ? 120 : 380);
    } else {
      firstMiss.add(r.x.key);
      streak = 0;
      r.li.dataset.state = 'wrong';
      r.li.classList.remove('gm__shake'); void r.li.offsetWidth; r.li.classList.add('gm__shake');
      sounds.wrong();
      live.textContent = 'Not that. Try again.';
      paintStats();
      input.select();
      setTimeout(() => { if (closed || rows[at] !== r) return; input.value = ''; delete r.li.dataset.state; input.focus({ preventScroll: true }); }, 750);
    }
  }
  function reveal() {
    const r = rows[at];
    if (!r) return;
    firstMiss.add(r.x.key);
    shown.add(r.x.key);
    streak = 0;
    settle(r, 'shown');
    live.textContent = `It is ${r.x.answers[0]}.`;
    paintStats();
    setTimeout(() => { if (!closed) advance(); }, reduced ? 300 : 1100);
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  root.addEventListener('cancel', (e) => { e.preventDefault(); close(); });   // Escape
  window.addEventListener('resize', place);

  function finish() {
    clearInterval(timer);
    sounds.done();
    const secs = Math.round((Date.now() - started) / 1000);
    const clean = list.filter((x) => !firstMiss.has(x.key)).length;
    const misses = list.filter((x) => firstMiss.has(x.key));
    let best = id ? read(`best.${id}`, null) : null;
    const isBest = !best || score > best.score || (score === best.score && secs < best.secs);
    if (id && isBest) { best = { score, secs, at: new Date().toISOString() }; write(`best.${id}`, best); }
    if (id) write(`misses.${id}`, misses.map((x) => x.key));
    const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const acts = el('div', { class: 'gm__acts' },
      misses.length ? el('button', { type: 'button', class: 'btn btn--primary', onclick: () => { close(true); playTable({ title, subtitle: 'The ones missed', items: misses, id: null, onNext, nextLabel, onClose }); } }, `Replay the ${misses.length} I missed`) : null,
      onNext ? el('button', { type: 'button', class: misses.length ? 'btn' : 'btn btn--primary', onclick: () => { close(true); onNext(); } }, nextLabel) : null,
      el('button', { type: 'button', class: 'btn', onclick: () => { close(true); playTable({ title, subtitle, items: list, id, onNext, nextLabel, onClose }); } }, 'Play again'),
      el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Close'));
    const card = el('section', { class: 'gm__end', 'aria-labelledby': 'gm-end-h' },
      el('h2', { id: 'gm-end-h', class: 'gm__endh', text: clean === list.length ? 'Every form, first time' : `${clean} of ${list.length} first time` }),
      el('dl', { class: 'gm__result' },
        el('div', {}, el('dt', { text: 'Score' }), el('dd', { text: `${score}${isBest && id ? ' · best' : best ? ` · best ${best.score}` : ''}` })),
        el('div', {}, el('dt', { text: 'Longest streak' }), el('dd', { text: String(bestStreak) })),
        el('div', {}, el('dt', { text: 'Time' }), el('dd', { text: mmss(secs) }))),
      misses.length ? el('div', { class: 'gm__misses' }, el('p', { class: 'gm__sub', text: 'Missed on the first try:' }),
        el('ul', {}, misses.map((x) => el('li', {}, el('span', { class: 'gm__label', text: x.cue }), ' ', el('span', { class: 'gm__form', lang: 'la' }, formNode(x)))))) : null,
      acts);
    stage.replaceChildren(card);
    progress.textContent = `${list.length} / ${list.length}`;
    live.textContent = card.querySelector('h2').textContent;
    acts.querySelector('button')?.focus({ preventScroll: true });
  }
  function close(silent = false) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    window.removeEventListener('resize', place);
    try { root.close(); } catch { /* already closed */ }
    root.remove();
    document.documentElement.classList.remove('gm-open');
    if (!silent) { opener?.focus?.({ preventScroll: true }); onClose?.(); }
  }

  document.documentElement.classList.add('gm-open');
  document.body.append(root);
  try { root.showModal(); } catch { root.setAttribute('open', ''); }
  requestAnimationFrame(() => focusCurrent());
  return { close };
}
