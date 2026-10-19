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
// The table's settings play too (2026-10-19: "the game mode should work with all the settings, endings only etc."):
// the parts switched on are the items, and Endings only asks a split form's ending after its stem, as the table
// does — switchable in the game as well, and kept in step with the table (`endings`, `onEndings`). And at any
// moment "Review" lays the misses so far out with their right forms, then Continue or Quit ("you should be able
// at any time to review the ones you got wrong and then continue or quit"); the clock stops while it is open.
//
// Ways to play (2026-10-19: "think of modes that would be good for learning"), chosen under ⚙ and kept on the
// device: Type it (recall, the default); Choose (pick the form from four of the same table — recognition, the
// easier first step with a new table); Flash (the form shows a moment, then goes — type it back: study, then
// recall); What is it? (the form shown, its person or case to pick — the reader's own question). With them,
// Shuffle (random order, so the column's rhythm cannot carry the answer) and Redo misses (a form missed comes
// back at the end of the round until it is right).
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
export const MODES = [
  ['type', 'Type it', 'Type each form.'],
  ['choose', 'Choose', 'Pick the form from four.'],
  ['flash', 'Flash', 'See the form a moment, then type it back.'],
  ['parse', 'What is it?', 'See a form, pick what it is.'],
];
const modeOf = (m) => (MODES.some(([k]) => k === m) ? m : 'type');
const shuffled = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * Up to three wrong choices beside the right one, shuffled: `text(y)` what a choice shows, `right(t)` whether a
 * text is a right answer (such a text is never offered as a wrong one). Null when the table has no wrong choice.
 */
export function choicesFor(x, pool, text, right) {
  const want = text(x);
  const seen = new Set([want]);
  const wrong = [];
  for (const y of shuffled(pool)) {
    const t = text(y);
    if (!t || seen.has(t) || right(t)) continue;
    seen.add(t); wrong.push(t);
    if (wrong.length === 3) break;
  }
  return wrong.length ? shuffled([want, ...wrong]) : null;
}

export function playTable({ title = '', subtitle = '', items = [], id = null, onNext = null, nextLabel = 'Next word →', onClose = null, endings = false, onEndings = null } = {}) {
  const base = items.filter((x) => x && x.answers?.length);
  if (!base.length) return null;
  const opener = document.activeElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = modeOf(read('mode', 'type'));
  let shuffle = !!read('shuffle', false);
  let redo = !!read('redo', false);
  let at = 0;
  let streak = 0;
  let bestStreak = 0;
  let score = 0;
  const firstMiss = new Set();
  const shown = new Set();
  let started = Date.now();   // moved on by the time a panel is open, so the clock counts only the playing
  let timer = 0;
  let panel = null;   // the open review or ⚙ panel
  let ended = false;
  let closed = false;
  let seq = 0;        // the form on screen's turn: a timer from an earlier one stands down

  const progress = el('span', { class: 'gm__progress' });
  const meterFill = el('span', { class: 'gm__meterfill' });
  const meter = el('div', { class: 'gm__meter', 'aria-hidden': 'true' }, meterFill);
  const streakEl = el('span', { class: 'gm__streak', 'aria-label': 'Streak' });
  const scoreEl = el('span', { class: 'gm__score' });
  const clock = el('span', { class: 'gm__clock', hidden: !read('timer', true) });
  // Endings only, as the table has it: a form the table splits into stem and ending is asked by its ending.
  const splits = (x) => !!x.stem && !!x.ending;
  const byEnding = (x) => endings && splits(x) && mode !== 'parse';
  const reviewBtn = el('button', { type: 'button', class: 'gm__tool gm__text gm__review', hidden: true, onclick: () => openReview() });
  const modeBtn = el('button', { type: 'button', class: 'gm__tool gm__text gm__modebtn', 'aria-haspopup': 'dialog', onclick: () => openSettings() });
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
      el('div', { class: 'gm__tools' }, reviewBtn, modeBtn, closeBtn),
      meter),
    stage, live);

  /* ---- the rows: one per form, in play order; a redo is a row of its own */
  const rows = [];
  const comeBack = new Map();   // key → how many times Redo misses has brought it back
  const makeRow = (x, again = false) => {
    const slot = el('span', { class: 'gm__slot' });
    const li = el('li', { class: `gm__row${again ? ' gm__row--again' : ''}` },
      el('span', { class: 'gm__cue' }, again ? el('span', { class: 'gm__againtag', text: '↻ again' }) : null, el('span', { class: 'gm__label', text: x.cue }), x.en ? el('span', { class: 'gm__en', text: x.en }) : null),
      slot);
    return { li, slot, x, again, missed: false, requeued: false };
  };
  // A thin rule where one column ends and the next begins (active → passive, singular → plural), and where the
  // redos begin; none in a shuffled round, which has no columns.
  const paintGroups = () => rows.forEach((r, i) => r.li.classList.toggle('gm__row--newgroup', i > 0 && (r.again !== rows[i - 1].again || (!shuffle && !r.again && r.x.group !== rows[i - 1].x.group))));
  for (const x of shuffle ? shuffled(base) : base) { const r = makeRow(x); rows.push(r); track.append(r.li); }
  paintGroups();
  /** Shuffle switched mid-round: the forms still to come are put in the new order; those answered stay. */
  function reorderRest() {
    const rest = rows.splice(at);
    const firsts = rest.filter((r) => !r.again);
    const agains = rest.filter((r) => r.again);
    const order = shuffle ? shuffled(firsts) : firsts.sort((a, b) => base.indexOf(a.x) - base.indexOf(b.x));
    rows.push(...order, ...agains);
    for (const r of rows.slice(at)) track.append(r.li);
    paintGroups();
  }

  const formNode = (x) => (splits(x) ? [el('span', { class: 'pt__stem', text: x.stem }), el('span', { class: 'pt__ending', text: x.ending })] : [x.answers[0]]);
  const paintStats = () => {
    progress.textContent = `${Math.min(at + 1, rows.length)} / ${rows.length}`;
    meterFill.style.width = `${Math.round((Math.min(at, rows.length) / rows.length) * 100)}%`;
    streakEl.textContent = streak >= 2 ? `🔥 ${streak}` : '';
    scoreEl.textContent = `⭐ ${score}`;
    reviewBtn.hidden = ended || !firstMiss.size;
    reviewBtn.textContent = `Review ${firstMiss.size} missed`;
    root.classList.toggle('gm--parse', mode === 'parse');   // What is it?: a form's person or case is the question, so no row to come shows its own
    modeBtn.textContent = `⚙ ${MODES.find(([k]) => k === mode)[1]}`;
    modeBtn.setAttribute('aria-label', `Ways to play — now ${MODES.find(([k]) => k === mode)[1]}`);
  };
  const tick = () => { const s = Math.floor((Date.now() - started) / 1000); clock.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  timer = setInterval(tick, 500);
  tick();

  // A reel (2026-10-19, a game-show wheel for the picture: "the center is clear with the current word and the ones
  // below and above are still larger but are faded a bit and the ones above and below that are smaller so 5 cells
  // are seen at once"). Each form is a band laid edge to edge with the next, the one in play in the middle of what
  // the screen shows (above a phone's keyboard), full size and clear; the bands either side tilt away round the
  // drum — the next ones large and a little faded, the outer ones smaller and fainter — and the reel rolls as the
  // learner goes. REEL[d]: [scale, tilt in degrees, opacity] at d bands from the middle.
  // Bigger off the middle than at first (2026-10-19: "the others that are off center … a bit bigger"), and only a
  // little faded ("more visible and less transparent"), so each band is read as a card of its own.
  const REEL = [[1, 0, 1], [0.97, 22, 0.95], [0.9, 42, 0.85], [0.8, 64, 0]];   // the opacities are the CSS's (data-dist)
  function place() {
    if (!rows[at]) return;
    const stageH = stage.clientHeight || window.innerHeight;
    const vv = window.visualViewport;
    const seen = vv ? Math.min(stageH, vv.offsetTop + vv.height - stage.getBoundingClientRect().top) : stageH;
    const mid = Math.max(seen, 120) / 2;
    const look = (d) => REEL[Math.min(Math.abs(d), 3)];
    const tall = (d, h) => { const [k, deg] = look(d); return h * k * Math.cos((deg * Math.PI) / 180); };   // its height on the drum
    // Each band's place first (the middle one's padding is larger), then its height, then where it goes.
    rows.forEach((r, i) => {
      const d = i - at;
      r.li.dataset.pos = d === 0 ? 'current' : Math.abs(d) <= 2 ? (d < 0 ? 'above' : 'below') : 'far';
      r.li.dataset.dist = String(Math.min(Math.abs(d), 3));
    });
    const hs = rows.map((r) => r.li.offsetHeight);
    const centre = new Array(rows.length);
    centre[at] = mid;
    for (let i = at + 1, edge = mid + hs[at] / 2; i < rows.length; i++) { const t = tall(i - at, hs[i]); centre[i] = edge + t / 2; edge += t; }
    for (let i = at - 1, edge = mid - hs[at] / 2; i >= 0; i--) { const t = tall(i - at, hs[i]); centre[i] = edge - t / 2; edge -= t; }
    track.style.perspectiveOrigin = `50% ${Math.round(mid)}px`;
    rows.forEach((r, i) => {
      const d = i - at;
      const [k, deg] = look(d);
      r.li.style.zIndex = String(10 - Math.min(Math.abs(d), 9));
      // A band above the middle leans its top away, one below its foot: the curve of the drum.
      r.li.style.transform = `translateY(${Math.round(centre[i] - hs[i] / 2)}px) rotateX(${d < 0 ? deg : -deg}deg) scale(${k})`;
    });
    // The first placing is not a roll: the reel starts where it is.
    if (!track.classList.contains('is-rolling')) requestAnimationFrame(() => track.classList.add('is-rolling'));
  }
  const focusIn = (n) => { if (!panel && !closed) n?.focus({ preventScroll: true }); };

  /* ---- asking: what the box (or the choices) holds for the form on screen, in the mode chosen */
  const isRight = (x, t) => cellRight(t, x.answers) || (byEnding(x) && cellRight(x.stem + t, x.answers));
  function ask() {
    const r = rows[at];
    if (!r) return;
    const tok = ++seq;
    delete r.li.dataset.state;
    r.li.classList.toggle('is-parse', mode === 'parse');
    const cue = `${r.x.cue}${r.x.en ? ` — ${r.x.en}` : ''}`;
    let kids = null;
    if (mode === 'choose' || mode === 'parse') {
      const parse = mode === 'parse';
      const form = r.x.answers[0];
      const opts = parse
        ? choicesFor(r.x, base, (y) => y.cue, (t) => base.some((y) => y.cue === t && cellRight(form, y.answers)))
        : choicesFor(r.x, base, (y) => (byEnding(y) ? y.ending : y.answers[0]), (t) => isRight(r.x, t));
      if (opts) {
        const pick = (b, t) => {
          if (tok !== seq || r.li.dataset.state === 'right') return;
          const ok = parse ? base.some((y) => y.cue === t && cellRight(form, y.answers)) : isRight(r.x, t);
          if (ok) { right(r); return; }
          b.disabled = true; b.classList.add('is-wrong');
          wrong(r);
          focusIn(r.slot.querySelector('.gm__choice:not(:disabled)'));
        };
        const list = el('div', { class: `gm__choices${parse ? ' gm__choices--cues' : ''}`, role: 'group', 'aria-label': parse ? `What is ${form}?` : `Choose: ${cue}` },
          opts.map((t, i) => { const b = el('button', { type: 'button', class: 'gm__choice', lang: parse ? null : 'la' }, el('span', { class: 'gm__key', 'aria-hidden': 'true', text: String(i + 1) }), t); b.addEventListener('click', () => pick(b, t)); return b; }));
        kids = [parse ? el('span', { class: 'gm__form gm__ask', lang: 'la', text: form }) : null,
          byEnding(r.x) && !parse ? el('span', { class: 'gm__given', lang: 'la', 'aria-hidden': 'true', text: `${r.x.stem}‑` }) : null,
          list, showBtn];
        r.slot.replaceChildren(...kids.filter(Boolean));
        place(); paintStats();
        focusIn(list.querySelector('button'));
        return;
      }
      // A table too small for wrong choices is typed instead.
      r.li.classList.remove('is-parse');
    }
    const given = byEnding(r.x) ? el('span', { class: 'gm__given', lang: 'la', 'aria-hidden': 'true', text: `${r.x.stem}‑` }) : null;
    input.value = '';
    input.setAttribute('aria-label', `${cue}${given ? ` — the ending after ${r.x.stem}` : ''}`);
    if (mode === 'flash') {
      // A look first: the form a moment, then the box. A key or a tap skips the look.
      const look = el('button', { type: 'button', class: 'gm__look', lang: 'la', 'aria-label': `Remember it: ${r.x.answers[0]}. Then type it.` }, el('span', { class: 'gm__form' }, formNode(r.x)), el('span', { class: 'gm__looktag', text: 'Remember it…' }));
      const toBox = () => { if (tok !== seq || !look.isConnected) return; r.slot.replaceChildren(...[given, input, showBtn].filter(Boolean)); focusIn(input); };
      look.addEventListener('click', toBox);
      look.addEventListener('keydown', (e) => { if (e.key.length === 1 || e.key === 'Enter') { e.preventDefault(); toBox(); } });
      r.slot.replaceChildren(look);
      place(); paintStats();
      focusIn(look);
      setTimeout(toBox, reduced ? 2200 : 1800);
      return;
    }
    r.slot.replaceChildren(...[given, input, showBtn].filter(Boolean));
    place(); paintStats();
    focusIn(input);
  }
  function advance() {
    at += 1;
    if (at >= rows.length && redo) {
      // Redo misses: each form missed this round comes back at the end — twice at most, so Show on every one
      // cannot keep the round going for ever.
      const back = rows.filter((r) => r.missed && !r.requeued && (comeBack.get(r.x.key) ?? 0) < 2);
      for (const r of back) { r.requeued = true; comeBack.set(r.x.key, (comeBack.get(r.x.key) ?? 0) + 1); const n = makeRow(r.x, true); rows.push(n); track.append(n.li); }
      if (back.length) { paintGroups(); live.textContent = `${back.length} more: the ones missed, again.`; }
    }
    if (at >= rows.length) { finish(); return; }
    ask();
  }
  function settle(r, state) {
    seq += 1;
    if (r.slot.contains(document.activeElement)) root.focus({ preventScroll: true });   // the box leaves; the focus stays in the game
    r.li.dataset.state = state;
    r.li.toggleAttribute('data-missed', r.missed);   // answered, it shows green for first time, red for missed
    r.li.classList.remove('is-parse');
    r.slot.replaceChildren(el('span', { class: 'gm__form', lang: 'la' }, formNode(r.x)), el('span', { class: 'gm__mark', 'aria-hidden': 'true', text: state === 'right' ? '✓' : '·' }));
    place();
  }
  function right(r) {
    const clean = !r.again && !firstMiss.has(r.x.key) && !shown.has(r.x.key);
    streak = clean ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    if (clean) score += 10 + Math.min(streak, 10);
    settle(r, 'right');
    sounds.right();
    live.textContent = `Right: ${r.x.answers[0]}${mode === 'parse' ? `, ${r.x.cue}` : ''}.`;
    paintStats();
    setTimeout(() => { if (!closed) advance(); }, reduced ? 120 : 380);
  }
  function wrong(r) {
    firstMiss.add(r.x.key);
    r.missed = true;
    streak = 0;
    r.li.dataset.state = 'wrong';
    r.li.classList.remove('gm__shake'); void r.li.offsetWidth; r.li.classList.add('gm__shake');
    sounds.wrong();
    live.textContent = 'Not that. Try again.';
    paintStats();
  }
  function submit() {
    const r = rows[at];
    if (!r || !r.slot.contains(input)) return;
    const typed = input.value.trim();
    if (!typed) return;
    // In Endings only the box holds the ending; the whole form typed anyway is right too.
    if (isRight(r.x, typed)) { right(r); return; }
    wrong(r);
    input.select();
    // The box empties a moment later — unless the learner has already moved on, answered, or started again.
    const tok = seq;
    setTimeout(() => {
      if (closed || tok !== seq || rows[at] !== r || r.li.dataset.state !== 'wrong') return;
      delete r.li.dataset.state;
      if (input.value.trim() === typed) input.value = '';
      focusIn(input);
    }, 750);
  }
  function reveal() {
    const r = rows[at];
    if (!r || r.li.dataset.state === 'right' || r.li.dataset.state === 'shown') return;
    firstMiss.add(r.x.key);
    shown.add(r.x.key);
    r.missed = true;
    streak = 0;
    settle(r, 'shown');
    live.textContent = `It is ${r.x.answers[0]}${mode === 'parse' ? `: ${r.x.cue}` : ''}.`;
    paintStats();
    setTimeout(() => { if (!closed) advance(); }, reduced ? 300 : 1400);
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  // Typing again after a miss is a new try: the red goes at once, and the pending clear stands down.
  input.addEventListener('input', () => { const r = rows[at]; if (r?.li.dataset.state === 'wrong') { seq += 1; delete r.li.dataset.state; } });

  /* ---- panels over the column: Review and ⚙. The clock stops while one is open. */
  function openPanel(node, focus) {
    if (panel || closed) return;
    const pausedAt = Date.now();
    clearInterval(timer);
    stage.inert = true; stage.setAttribute('aria-hidden', 'true');
    panel = node;
    panel.resume = (after) => {
      if (panel !== node) return;
      node.remove();
      panel = null;
      stage.inert = false; stage.removeAttribute('aria-hidden');
      if (!ended) { started += Date.now() - pausedAt; timer = setInterval(tick, 500); tick(); }
      after?.();
      if (ended) { stage.querySelector('.gm__acts button')?.focus({ preventScroll: true }); return; }
      const r = rows[at];
      if (r && r.li.dataset.state !== 'right' && r.li.dataset.state !== 'shown') ask(); else root.focus({ preventScroll: true });
    };
    root.append(node);
    live.textContent = node.querySelector('h2')?.textContent ?? '';
    focus?.focus({ preventScroll: true });
  }
  // Review, at any moment: the forms missed so far, each with its right form; then on with the game, or out of it.
  function openReview() {
    if (!firstMiss.size) return;
    const misses = base.filter((x) => firstMiss.has(x.key));
    const goOn = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => node.resume() }, 'Continue');
    const node = el('section', { class: 'gm__end gm__panel', role: 'region', 'aria-labelledby': 'gm-rev-h' },
      el('h2', { id: 'gm-rev-h', class: 'gm__endh', text: `The ${misses.length} you missed so far` }),
      el('ul', { class: 'gm__revlist' }, misses.map((x) => el('li', {},
        el('span', { class: 'gm__cue' }, el('span', { class: 'gm__label', text: x.cue }), x.en ? el('span', { class: 'gm__en', text: x.en }) : null),
        el('span', { class: 'gm__form', lang: 'la' }, formNode(x))))),
      el('div', { class: 'gm__acts' }, goOn, el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Quit the game')));
    openPanel(node, goOn);
  }
  // ⚙ Ways to play: the mode, and the switches. Each change is kept on the device and plays from the form on screen.
  function openSettings() {
    const sw = (label, note, on, set) => {
      const b = el('button', { type: 'button', class: 'gm__switch', 'aria-pressed': String(!!on) }, el('span', { class: 'gm__switchname', text: label }), el('span', { class: 'gm__switchnote', text: note }));
      b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); set(v); });
      return b;
    };
    const modes = el('div', { class: 'gm__modes', role: 'radiogroup', 'aria-label': 'Way to play' }, MODES.map(([k, name, note]) => {
      const b = el('button', { type: 'button', class: 'gm__modecard', role: 'radio', 'aria-checked': String(k === mode) }, el('span', { class: 'gm__switchname', text: name }), el('span', { class: 'gm__switchnote', text: note }));
      b.addEventListener('click', () => { mode = k; write('mode', k); for (const c of modes.children) c.setAttribute('aria-checked', String(c === b)); paintStats(); });
      return b;
    }));
    const done = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => node.resume() }, 'Play');
    const node = el('section', { class: 'gm__end gm__panel', role: 'region', 'aria-labelledby': 'gm-set-h' },
      el('h2', { id: 'gm-set-h', class: 'gm__endh', text: 'Ways to play' }),
      modes,
      el('div', { class: 'gm__switches' },
        base.some(splits) ? sw('Endings only', 'Type just the ending after the stem.', endings, (v) => { endings = v; onEndings?.(v); }) : null,
        sw('Shuffle', 'Mix up the order.', shuffle, (v) => { shuffle = v; write('shuffle', v); if (!ended) reorderRest(); }),
        sw('Redo misses', 'Missed forms come back at the end.', redo, (v) => { redo = v; write('redo', v); }),
        sw('Timer', 'Show the clock.', read('timer', true), (v) => { write('timer', v); clock.hidden = !v; }),
        sw('Sound', 'Beeps for right and wrong.', read('sound', false), (v) => { write('sound', v); if (v) sounds.right(); })),
      el('div', { class: 'gm__acts' }, done, el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Quit the game')));
    openPanel(node, modes.querySelector('[aria-checked="true"]'));
  }

  root.tabIndex = -1;   // between two forms the dialog itself holds the focus, so no key falls through to the page
  root.addEventListener('cancel', (e) => { e.preventDefault(); if (panel) panel.resume(); else close(); });   // Escape, where the browser sends it
  root.addEventListener('close', () => close());   // a close the browser makes on its own (a second Escape, Android back)
  // Every key stays in the game: the reader's letter shortcuts (e, h, m, a …) and its Escape (which closes the word
  // panel) listen on the document, and a learner typing the next form early must not reach them.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (panel) panel.resume(); else close(); }
    // 1–4 take a choice (Choose, What is it?).
    else if (!panel && /^[1-4]$/.test(e.key) && e.target !== input) {
      const b = rows[at]?.slot.querySelectorAll('.gm__choice')[Number(e.key) - 1];
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
  });
  window.addEventListener('resize', place);
  window.visualViewport?.addEventListener('resize', place);   // the keyboard coming up or going

  function finish() {
    ended = true;
    clearInterval(timer);
    sounds.done();
    const secs = Math.round((Date.now() - started) / 1000);
    const clean = base.filter((x) => !firstMiss.has(x.key)).length;
    const misses = base.filter((x) => firstMiss.has(x.key));
    let best = id ? read(`best.${id}`, null) : null;
    const isBest = !best || score > best.score || (score === best.score && secs < best.secs);
    if (id && isBest) { best = { score, secs, at: new Date().toISOString() }; write(`best.${id}`, best); }
    if (id) write(`misses.${id}`, misses.map((x) => x.key));
    const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const again = (its, sub, gid) => () => { close(true); playTable({ title, subtitle: sub, items: its, id: gid, onNext, nextLabel, onClose, endings, onEndings }); };
    const acts = el('div', { class: 'gm__acts' },
      misses.length ? el('button', { type: 'button', class: 'btn btn--primary', onclick: again(misses, 'The ones missed', null) }, `Replay the ${misses.length} I missed`) : null,
      onNext ? el('button', { type: 'button', class: misses.length ? 'btn' : 'btn btn--primary', onclick: () => { close(true); onNext(); } }, nextLabel) : null,
      el('button', { type: 'button', class: 'btn', onclick: again(base, subtitle, id) }, 'Play again'),
      el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Close'));
    const stars = clean === base.length ? 3 : clean >= base.length * 0.7 ? 2 : clean > 0 ? 1 : 0;
    const card = el('section', { class: 'gm__end', 'aria-labelledby': 'gm-end-h' },
      el('p', { class: 'gm__stars', 'aria-label': `${stars} of 3 stars` }, [0, 1, 2].map((i) => el('span', { class: i < stars ? 'is-on' : '', 'aria-hidden': 'true', text: '★' }))),
      el('h2', { id: 'gm-end-h', class: 'gm__endh', text: clean === base.length ? 'Every form, first time!' : `${clean} of ${base.length} first time` }),
      el('dl', { class: 'gm__result' },
        el('div', {}, el('dt', { text: 'Score' }), el('dd', { text: `${score}${isBest && id ? ' · best' : best ? ` · best ${best.score}` : ''}` })),
        el('div', {}, el('dt', { text: 'Longest streak' }), el('dd', { text: String(bestStreak) })),
        el('div', {}, el('dt', { text: 'Time' }), el('dd', { text: mmss(secs) }))),
      misses.length ? el('div', { class: 'gm__misses' }, el('p', { class: 'gm__sub', text: 'Missed on the first try:' }),
        el('ul', {}, misses.map((x) => el('li', {}, el('span', { class: 'gm__label', text: x.cue }), ' ', el('span', { class: 'gm__form', lang: 'la' }, formNode(x)))))) : null,
      acts);
    stage.replaceChildren(card);
    progress.textContent = `${rows.length} / ${rows.length}`;
    meterFill.style.width = '100%';
    paintStats();
    live.textContent = card.querySelector('h2').textContent;
    focusIn(acts.querySelector('button'));
  }
  function close(silent = false) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    window.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('resize', place);
    try { root.close(); } catch { /* already closed */ }
    root.remove();
    document.documentElement.classList.remove('gm-open');
    if (!silent) { opener?.focus?.({ preventScroll: true }); onClose?.(); }
  }

  document.documentElement.classList.add('gm-open');
  document.body.append(root);
  try { root.showModal(); } catch { root.setAttribute('open', ''); }
  paintStats();
  requestAnimationFrame(() => ask());
  return { close };
}
