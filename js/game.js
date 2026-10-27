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
// the parts switched on are the items. A box takes the whole form or its ending alone, always, with no setting for
// it (2026-10-23: "always accept full spelling or just the correct ending"). And at any
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
// The word's charts (2026-10-21: "a simple way once a word is selected to pick which paradigm charts you will play
// … and when something ends to practise more with the neighbouring paradigms or a list of all the options"; "at
// the top, where the timer is"; "on the initial play it has that one selected plus a menu of more"). `charts`:
// { list: [{ id, section, col, n }], on: [ids], play(ids), noun? } (noun: what one is called, 'chart' by default) — every chart of the word's table (a column of one
// part: present indicative · active; cases · plural), the ones this game plays, and how to play others. The bar's
// Charts button names what is playing and opens them all; the end offers the next chart and the whole list.
//
// `how(item)`: how that one form is made for this word (wordrule.js formRule), behind the ? before Show — the
// steps without their examples, since the examples are the answers.
//
// items: [{ key, cue, en, answers, stem, ending, group, form }] — `cue` the row and part ("we · imperfect active"),
// `en` its English, `answers` the forms accepted (wordpanel.js cellAnswers), `group` the column it belongs to.

import { activeTimer } from './activetime.js';
import { cellRight } from './wordpanel.js';
import { ruleCard } from './wordrule.js';
import { notePractised } from './practised.js';

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

/** The order of the cases in a game. */
export const CASE_ORDER = ['nom', 'gen', 'dat', 'abl', 'acc', 'voc', 'loc'];
/**
 * A cue in colours (2026-10-27: "have the word, its declension, the case and its person and number each differentiated
 * by background / foreground highlighting colour throughout the game"): the word, its type (2nd declension, 3rd
 * conjugation …), case, person, number, tense, mood, voice and gender each a tag of its own colour (panels.css .gm-k).
 * Anything else ("cases", "·") stays plain.
 */
const CUE_KINDS = [
  [/^(nominative|genitive|dative|accusative|ablative|vocative|locative)$/i, 'case'],
  [/^(singular|plural|sg\.?|pl\.?)$/i, 'number'],
  [/^(present|imperfect|future|perfect|pluperfect)$/i, 'tense'],
  [/^(indicative|subjunctive|imperative|infinitive|participle|gerund|gerundive|supine)$/i, 'mood'],
  [/^(active|passive)$/i, 'voice'],
  [/^(masculine|feminine|neuter|common)$/i, 'gender'],
];
const CUE_PERSON = /^(I|we|they|you(\s*\((sg|pl)\.\))?|he\s*\/\s*she\s*\/\s*it|(1st|2nd|3rd) person( (singular|plural))?)$/;
const CUE_TYPE = /\b((1st|2nd|3rd|4th|5th)\s+(declension|decl\.|conjugation|conj\.)(\s*\([^)]*\))?(\s+(noun|verb|adjective))?|(irregular|deponent|semi-deponent)\s+verb)/gi;
const cueTag = (kind, text) => el('span', { class: `gm-k gm-k--${kind}`, text });
function plainWords(text) {
  return String(text).split(/(\s+)/).filter((w) => w !== '').map((w) => {
    const kind = CUE_KINDS.find(([re]) => re.test(w))?.[1];
    return kind ? cueTag(kind, w) : w;
  });
}
/** Free text (a game's subtitle): its types, cases, numbers … tagged, the rest plain. */
export function cueWords(text) {
  const t = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of t.matchAll(CUE_TYPE)) {
    out.push(...plainWords(t.slice(last, m.index)), cueTag('type', m[0]));
    last = m.index + m[0].length;
  }
  out.push(...plainWords(t.slice(last)));
  return out;
}
/** A card's cue ("factum (2nd decl., neuter) · ablative · cases plural"), each part in its colour. */
export function cueNodes(cue) {
  const out = [];
  String(cue ?? '').split(' · ').forEach((seg, i) => {
    if (i) out.push(' · ');
    const s = seg.trim();
    if (CUE_PERSON.test(s)) { out.push(cueTag('person', s)); return; }
    // "factum (2nd decl., neuter)": the word, then its type.
    const m = i === 0 ? s.match(/^([^()]+?)\s+\((.+)\)$/) : null;
    if (m && !CUE_KINDS.some(([re]) => re.test(m[1]))) { out.push(el('span', { class: 'gm-k gm-k--word', lang: 'la', text: m[1] }), ' ', cueTag('type', `(${m[2]})`)); return; }
    out.push(...cueWords(seg));
  });
  return out;
}
/** The colours' key, for the game's menus. */
export const cueLegend = () => el('p', { class: 'gm-legend', 'aria-label': 'Colour key' },
  ...[['word', 'word'], ['type', 'declension / conjugation'], ['case', 'case'], ['person', 'person'], ['number', 'number'], ['tense', 'tense'], ['mood', 'mood'], ['voice', 'voice'], ['gender', 'gender']].map(([k, t]) => cueTag(k, t)));

/* ---------------------------------------------------------------- the game */
export const MODES = [
  ['type', 'Type it', 'Type each form.'],
  ['choose', 'Choose', 'Pick the form from four.'],
  ['flash', 'Flash', 'See the form a moment, then type it back.'],
  ['parse', 'What is it?', 'See a form, pick what it is.'],
];
const modeOf = (m) => (MODES.some(([k]) => k === m) ? m : 'type');
/**
 * Forms of one group (a column: active, passive; singular, plural) together, the groups in first-come order — and
 * every active form before any passive one (2026-10-23: "have all the active first then all the passive … don't
 * jump between active and passive"), read off each form's key. Stable: a table's own order otherwise.
 */
export function byGroup(xs) {
  const order = new Map();
  for (const x of xs) if (!order.has(x.group ?? null)) order.set(x.group ?? null, order.size);
  const voice = (x) => (x?.form && typeof x.form === 'object' && x.form.voice === 'pass' ? 1 : 0);
  // Within a column, the cases in the order nominative, genitive, dative, ablative, accusative, vocative (2026-10-27).
  const caseAt = (x) => { const c = x?.form && typeof x.form === 'object' ? x.form.case : null; const i = CASE_ORDER.indexOf(c); return i < 0 ? CASE_ORDER.length : i; };
  return xs.map((x, i) => [x, i]).sort((a, b) => voice(a[0]) - voice(b[0]) || order.get(a[0].group ?? null) - order.get(b[0].group ?? null) || caseAt(a[0]) - caseAt(b[0]) || a[1] - b[1]).map(([x]) => x);
}
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

/** The ways to play, easiest first (2026-10-23: "typing is harder than flash, flash is harder than multiple choice";
 * "shuffled type is the hardest"). */
export const LADDER = [['parse', false], ['choose', false], ['flash', false], ['type', false], ['type', true]];
const rung = (mode, shuffle) => { const i = LADDER.findIndex(([m, sh]) => m === mode && sh === (mode === 'type' && !!shuffle)); return i < 0 ? LADDER.findIndex(([m]) => m === mode) : i; };
export const ladderLabel = (mode, shuffle) => `${MODES.find(([k]) => k === mode)?.[1] ?? mode}${mode === 'type' && shuffle ? ', shuffled' : ''}`;
/** The way to play `d` steps along the ladder from `mode` (and shuffle): { mode, shuffle, label } or null past either end. */
export function stepThan(mode, shuffle = false, d = 1) {
  const i = rung(mode, shuffle);
  const j = i + d;
  if (i < 0 || j < 0 || j >= LADDER.length) return null;
  const [m, sh] = LADDER[j];
  return { mode: m, shuffle: sh, label: ladderLabel(m, sh) };
}
/** One step harder, or null at the top: What is it? → Choose → Flash → Type it → Type it, shuffled. */
export const harderThan = (mode, shuffle = false) => stepThan(mode, shuffle, 1);
/** The way to play last chosen ({ mode, shuffle, label }), and setting it, for a screen outside the game (ui.js's end). */
export const playWay = () => { const mode = modeOf(read('mode', 'type')); const shuffle = mode === 'type' && !!read('shuffle', false); return { mode, shuffle, label: ladderLabel(mode, shuffle) }; };
export function setPlayWay({ mode, shuffle = false }) { write('mode', modeOf(mode)); write('shuffle', !!shuffle); }

export function playTable({ title = '', subtitle = '', items = [], id = null, onNext = null, nextLabel = 'Next word →', onClose = null, rule = null, ruleFirst = true, charts = null, how = null, onDone = null, countKey = null, continueLabel = null, suggest = null, settings = null, study = null } = {}) {
  // In order, a column at a time (2026-10-23: "unless it's on shuffle have all the active first then all the passive"):
  // each group's forms together, the groups in the order they first come, the forms in each as given.
  const base = byGroup(items.filter((x) => x && x.answers?.length));
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
  // The whole form or its ending alone is right, always (2026-10-23: "always accept full spelling or just the correct
  // ending — don't have it as separate settings"); the box is the whole form's, with no stem printed before it.
  const reviewBtn = el('button', { type: 'button', class: 'gm__tool gm__text gm__review', hidden: true, onclick: () => openReview() });
  const modeBtn = el('button', { type: 'button', class: 'gm__tool gm__text gm__modebtn', 'aria-haspopup': 'dialog', onclick: () => openSettings() });
  // ◂ Easier · Harder ▸ (2026-10-23: "an easier / harder setting button to shuffle through the ways to practise"):
  // one step along the ladder, from the form on screen; kept on the device like the ⚙ choice.
  // Named apart from "Easier or harder skill?" (another skill): these change the way to play the same forms.
  const easierBtn = el('button', { type: 'button', class: 'gm__tool gm__step', title: 'Easier way to play', 'aria-label': 'Easier way to play', onclick: () => stepMode(-1) }, '◂');
  const harderBtn = el('button', { type: 'button', class: 'gm__tool gm__step', title: 'Harder way to play', 'aria-label': 'Harder way to play', onclick: () => stepMode(1) }, '▸');
  // The word's type and the rule for its forms (wordrule.js): the game opens on it, and 📖 brings it back.
  const ruleBtn = rule ? el('button', { type: 'button', class: 'gm__tool', 'aria-label': 'How its forms are made', title: 'How its forms are made', onclick: () => openRule() }, '📖') : null;
  // The word's charts: by part, in the table's order; a part of one column is one chart.
  const chartList = charts?.list?.length > 1 ? charts.list : null;
  // What one chart is called: a column of the word's table, or (a skill's every-word game) a word.
  const noun = charts?.noun ?? 'chart';
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const chartOn = new Set((charts?.on ?? []).filter((c) => chartList?.some((x) => x.id === c)));
  const parts = [];
  for (const c of chartList ?? []) { const last = parts[parts.length - 1]; if (last && last.section === c.section) last.cols.push(c); else parts.push({ section: c.section, cols: [c] }); }
  const chartName = (ids) => {
    const set = new Set(ids);
    if (!chartList || !set.size) return '';
    if (set.size === chartList.length) return `every ${noun}`;
    const whole = parts.filter((p) => p.cols.every((c) => set.has(c.id)));
    if (whole.length === 1 && whole[0].cols.length === set.size) return whole[0].section;
    if (set.size === 1) { const c = chartList.find((x) => set.has(x.id)); const p = parts.find((x) => x.cols.includes(c)); return p.cols.length > 1 && c.col ? `${c.section} · ${c.col}` : c.section; }
    return `${set.size} of ${chartList.length} ${noun}s`;
  };
  const chartsBtn = chartList ? el('button', { type: 'button', class: 'gm__tool gm__text gm__chartsbtn', 'aria-haspopup': 'dialog', 'aria-label': `${Noun}s — playing ${chartName(chartOn)}. Choose others`, onclick: () => openCharts() },
    el('span', { class: 'gm__chartskey', text: `${Noun}s ` }), el('span', { class: 'gm__chartsname', text: chartName(chartOn) })) : null;
  /** The next chart along the table: the next part when whole parts are playing, else the next column. */
  const nextCharts = () => {
    if (!chartList || !chartOn.size) return null;
    const onParts = parts.filter((p) => p.cols.some((c) => chartOn.has(c.id)));
    if (onParts.every((p) => p.cols.every((c) => chartOn.has(c.id)))) {
      const nx = parts[parts.indexOf(onParts[onParts.length - 1]) + 1];
      return nx ? nx.cols.map((c) => c.id) : null;
    }
    const last = Math.max(...[...chartOn].map((c) => chartList.findIndex((x) => x.id === c)));
    return chartList[last + 1] ? [chartList[last + 1].id] : null;
  };
  /** Every chart as a switch, by part: a part's name switches all its columns. `sel` is changed in place. */
  function chartPicker(sel, onChange) {
    const box = el('div', { class: 'gm__charts' });
    const paint = () => {
      for (const b of box.querySelectorAll('[data-chart]')) b.setAttribute('aria-pressed', String(sel.has(b.dataset.chart)));
      for (const b of box.querySelectorAll('[data-part]')) b.setAttribute('aria-pressed', String(parts[Number(b.dataset.part)].cols.every((c) => sel.has(c.id))));
      onChange?.();
    };
    const chip = (text, attrs, cls, click) => el('button', { type: 'button', class: `gm__chip${cls ? ` ${cls}` : ''}`, ...attrs, onclick: () => { click(); paint(); } }, text);
    const toggle = (c) => (sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id));
    box.append(
      el('div', { class: 'gm__chartquick' },
        chip('All', {}, 'gm__chip--quiet', () => chartList.forEach((c) => sel.add(c.id))),
        chip('None', {}, 'gm__chip--quiet', () => sel.clear())),
      ...parts.map((p, i) => el('div', { class: 'gm__chartpart', role: 'group', 'aria-label': p.section },
        p.cols.length > 1
          ? [chip(p.section, { 'data-part': String(i), 'aria-label': `All of ${p.section}` }, 'gm__chip--part', () => { const all = p.cols.every((c) => sel.has(c.id)); p.cols.forEach((c) => (all ? sel.delete(c.id) : sel.add(c.id))); }),
            ...p.cols.map((c) => chip(c.col || c.section, { 'data-chart': c.id, 'aria-label': `${p.section} · ${c.col}` }, '', () => toggle(c)))]
          : [chip(p.section, { 'data-chart': p.cols[0].id }, 'gm__chip--part', () => toggle(p.cols[0]))])));
    paint();
    return box;
  }
  const formsIn = (sel) => (chartList ?? []).filter((c) => sel.has(c.id)).reduce((n, c) => n + (c.n ?? 0), 0);
  const sameAs = (sel) => sel.size === chartOn.size && [...sel].every((c) => chartOn.has(c));
  const playCharts = (ids) => { close(true); charts.play([...ids]); };
  /** A picker and its Play button, for the Charts panel and the end. With `resume`, the charts already playing go back to the game. */
  function chartChooser(sel, { resumeLabel = '', resume = null } = {}) {
    const go = el('button', { type: 'button', class: 'btn btn--primary gm__chartgo', onclick: () => { if (resume && sameAs(sel)) resume(); else if (sel.size) playCharts(sel); } });
    const paintGo = () => {
      go.disabled = !sel.size;
      go.textContent = !sel.size ? `Choose a ${noun}` : resume && sameAs(sel) ? resumeLabel : `Play ${chartName(sel)} (${formsIn(sel)} forms) ▶`;
    };
    const picker = chartPicker(sel, () => paintGo());
    return { picker, go };
  }
  function openCharts() {
    if (!chartList || panel) return;
    const sel = new Set(chartOn);
    const fresh = !rows.some(isDone) && !firstMiss.size;
    const { picker, go } = chartChooser(sel, { resumeLabel: ended ? 'Back' : fresh ? 'Start ▶' : 'Back to the game', resume: () => node.resume() });
    const node = el('section', { class: 'gm__end gm__panel gm__chartsp', role: 'region', 'aria-labelledby': 'gm-charts-h' },
      el('h2', { id: 'gm-charts-h', class: 'gm__endh', text: `Which ${noun}s?` }),
      el('p', { class: 'gm__sub' }, el('span', { lang: 'la', text: title }), ' — switch on the ones to play. A part’s name switches all its columns.'),
      picker,
      el('div', { class: 'gm__acts' }, go, el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => node.resume() }, 'Cancel')));
    openPanel(node, go);
  }
  // The title is the way to change what is played (2026-10-26: "when you click up here I want it to bring the menu of
  // options of what is being played so you can change the settings: it says passive only, I want options to do passive
  // and active, or to switch what is being practised"). `settings()` is the caller's: a node of choices. A button in it
  // starts something else, and closes this game first, unless it sits in a [data-stay] (a chip that only ticks a box).
  function titlesNode() {
    const inner = [el('p', { class: 'gm__title', lang: 'la', text: title }), subtitle ? el('p', { class: 'gm__sub' }, cueWords(subtitle)) : null];
    if (!settings && !chartList) return el('div', { class: 'gm__titles' }, inner);
    return el('button', { type: 'button', class: 'gm__titles gm__titlesbtn', 'aria-haspopup': 'dialog', title: 'Change what is played', 'aria-label': `${title}${subtitle ? ` — ${subtitle}` : ''}. Change what is played`, onclick: () => openWhat() },
      inner, el('span', { class: 'gm__titlesmore', 'aria-hidden': 'true', text: ' ⚙ change ▾' }));
  }
  function openWhat() {
    if (panel?.querySelector('#gm-set-h')) return;
    panel?.resume();   // the rule, Review or ⚙ open: this one takes its place
    const back = el('button', { type: 'button', class: 'btn btn--primary', 'data-stay': '', onclick: () => node.resume() }, ended ? 'Back' : 'Back to the game');
    let picker = null;
    if (chartList) { const c = chartChooser(new Set(chartOn), { resumeLabel: ended ? 'Back' : 'Back to the game', resume: () => node.resume() }); picker = el('div', { class: 'gm__setsec', 'data-stay': '' }, el('h3', { class: 'gm__seth', text: `Which ${noun}s` }), c.picker, el('div', { class: 'gm__acts' }, c.go)); }
    let more = null;
    try { more = settings?.() ?? null; } catch { more = null; }
    const node = el('section', { class: 'gm__end gm__panel gm__setsp', role: 'region', 'aria-labelledby': 'gm-set-h' },
      el('div', { class: 'gm__sethead' }, el('h2', { id: 'gm-set-h', class: 'gm__endh', text: 'What you are playing' }),
        el('button', { type: 'button', class: 'btn btn--quiet', 'data-stay': '', onclick: () => node.resume() }, ended ? '← Back' : '← Back to the game')),
      el('p', { class: 'gm__sub' }, el('span', { lang: 'la', text: title }), subtitle ? [' — ', cueWords(subtitle)] : ''),
      cueLegend(),
      picker, more,
      el('div', { class: 'gm__acts' }, back));
    // A choice that starts something else leaves this game first (quietly: no grading of a half-played round).
    node.addEventListener('click', (e) => { const b = e.target.closest?.('button, a[href]'); if (b && !b.disabled && !b.closest('[data-stay]')) close(true); }, true);
    openPanel(node, back);
  }
  // Its place in lesson mode (2026-10-26: "a link at the top in the game to the correct study section part").
  // In the 📖 explanation (the rule's panel); in the bar only when the game has no explanation.
  const studyGo = () => { close(true); study.go(); };
  const studyBtn = study && !rule ? el('button', { type: 'button', class: 'gm__tool gm__text gm__studybtn', title: study.title ?? 'Open this in lesson mode', onclick: studyGo }, study.label ?? '📖 Study it') : null;
  const closeBtn = el('button', { type: 'button', class: 'gm__tool gm__close', 'aria-label': 'Leave the game', title: 'Leave (Esc)', onclick: () => close() }, '✕');
  const live = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const track = el('ol', { class: 'gm__track', 'aria-label': 'Forms' });
  const input = el('input', { type: 'text', class: 'gm__in', lang: 'la', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Your answer: the whole word, or just its ending' });
  const showBtn = el('button', { type: 'button', class: 'gm__show', onclick: () => reveal() }, 'Show');
  // A wrong answer is tried again until it is right, or skipped (2026-10-20: "when you get it wrong mark red but force
  // to do again unless skip is pressed, then review at the end of that section of table; if gotten correct then turn
  // green"). Skip is the way past a form the first time round; Show is only for a form come back for review.
  const skipBtn = el('button', { type: 'button', class: 'gm__show gm__skip', onclick: () => skip() }, 'Skip');
  const passBtn = (r) => (r.again ? showBtn : skipBtn);
  const howBtn = how ? el('button', { type: 'button', class: 'gm__how', 'aria-haspopup': 'dialog', 'aria-label': 'How this form is made', title: 'How this form is made', onclick: () => openHow() }, '?') : null;
  const stage = el('div', { class: 'gm__stage' }, track);
  // The table being built (2026-10-27: "on a computer, in game mode, a growing list of the words on the side so we can
  // see a table being built with each word; colour them green or red whether correct or incorrect / skipped"): every
  // form of the round in its column, filled in as it is answered — green right the first time, red missed, skipped or
  // shown, … still to come. Beside the wheel on a wide screen only (panels.css).
  const built = el('aside', { class: 'gm__built', 'aria-label': 'The table so far' });
  // A <dialog> shown modal: it stacks above the word popup (itself a modal dialog, in the top layer, where no
  // z-index reaches), keeps the focus inside, and Escape closes it.
  const root = el('dialog', { class: 'gm', 'aria-label': `Game: ${title}` },
    el('header', { class: 'gm__bar' },
      titlesNode(),
      el('div', { class: 'gm__stats' }, progress, streakEl, scoreEl, clock, activeTimer()),
      el('div', { class: 'gm__tools' }, studyBtn, reviewBtn, chartsBtn, ruleBtn, easierBtn, modeBtn, harderBtn, closeBtn),
      meter),
    stage, built, live);

  /* ---- the rows: one per form, in play order; a redo is a row of its own */
  const rows = [];
  const comeBack = new Map();   // key → how many times Redo misses has brought it back
  const makeRow = (x, again = false) => {
    const slot = el('span', { class: 'gm__slot' });
    const li = el('li', { class: `gm__row${again ? ' gm__row--again' : ''}` },
      el('span', { class: 'gm__cue' }, again ? el('span', { class: 'gm__againtag', text: '↻ again' }) : null, el('span', { class: 'gm__label' }, cueNodes(x.cue)), x.en ? el('span', { class: 'gm__en', text: x.en }) : null),
      slot);
    return { li, slot, x, again, missed: false, requeued: false, sec: null, reviewOf: null };
  };
  // A thin rule where one column ends and the next begins (active → passive, singular → plural), and where the
  // redos begin; none in a shuffled round, which has no columns.
  const paintGroups = () => rows.forEach((r, i) => r.li.classList.toggle('gm__row--newgroup', i > 0 && (r.again !== rows[i - 1].again || (!shuffle && !r.again && r.x.group !== rows[i - 1].x.group))));
  for (const x of shuffle ? shuffled(base) : base) { const r = makeRow(x); rows.push(r); track.append(r.li); }
  paintGroups();
  /** Shuffle switched mid-round: the forms still to come are put in the new order; those answered stay. */
  function reorderRest() {
    // Only the unanswered forms after the one on screen change places (the wheel can be turned back, so some
    // before it may be unanswered too: they stay where they are).
    const slots = rows.map((r, i) => i).filter((i) => i > at && !rows[i].again && !isDone(rows[i]));
    const these = slots.map((i) => rows[i]);
    const order = shuffle ? shuffled(these) : these.sort((a, b) => base.indexOf(a.x) - base.indexOf(b.x));
    slots.forEach((i, k) => { rows[i] = order[k]; });
    paintGroups();
    place();
  }

  const isDone = (r) => r.li.dataset.state === 'right' || r.li.dataset.state === 'shown' || r.li.dataset.state === 'skipped';
  const formNode = (x) => (splits(x) ? [el('span', { class: 'pt__stem', text: x.stem }), el('span', { class: 'pt__ending', text: x.ending })] : [x.answers[0]]);
  const paintBuilt = () => {
    const groups = new Map();
    for (const x of base) { const g = x.group ?? ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
    const answered = (x) => rows.some((r) => r.x === x && isDone(r) && r.li.dataset.state !== 'skipped');
    const short = (x) => { const parts = String(x.cue ?? '').split(' · '); return (x.col && parts.length > 1 && parts[parts.length - 1] === x.col ? parts.slice(0, -1) : parts).join(' · '); };
    built.replaceChildren(el('p', { class: 'gm__builth', text: 'The table so far' }),
      ...[...groups.values()].map((xs) => el('div', { class: 'gm__builtg' }, xs[0].col ? el('p', { class: 'gm__builtc' }, cueWords(xs[0].col)) : null,
        el('ol', { class: 'gm__builtl' }, xs.map((x) => {
          const done = answered(x);
          const st = firstMiss.has(x.key) ? 'miss' : done ? 'right' : 'todo';
          return el('li', { class: `gm__builtr is-${st}`, title: st === 'right' ? 'Right the first time' : st === 'miss' ? 'Missed, skipped or shown' : 'Still to come' },
            el('span', { class: 'gm__builtq' }, cueNodes(short(x))), el('span', { class: 'gm__builtf', lang: 'la', text: done ? x.answers[0] : '…' }));
        })))));
  };
  const paintStats = () => {
    paintBuilt();
    const answered = rows.filter(isDone).length;
    progress.textContent = `${Math.min(at + 1, rows.length)} / ${rows.length}`;
    meterFill.style.width = `${Math.round((answered / rows.length) * 100)}%`;   // how many are answered: the wheel can be turned either way
    streakEl.textContent = streak >= 2 ? `🔥 ${streak}` : '';
    scoreEl.textContent = `⭐ ${score}`;
    reviewBtn.hidden = ended || !firstMiss.size;
    reviewBtn.textContent = `Review ${firstMiss.size} missed`;
    root.classList.toggle('gm--parse', mode === 'parse');   // What is it?: a form's person or case is the question, so no row to come shows its own
    modeBtn.textContent = `⚙ ${ladderLabel(mode, shuffle)}`;
    modeBtn.setAttribute('aria-label', `Ways to play — now ${ladderLabel(mode, shuffle)}`);
    const down = stepThan(mode, shuffle, -1);
    const up = stepThan(mode, shuffle, 1);
    easierBtn.disabled = !down; harderBtn.disabled = !up;
    easierBtn.setAttribute('aria-label', down ? `Easier way to play: ${down.label}` : 'Already the easiest way to play'); easierBtn.title = easierBtn.getAttribute('aria-label');
    harderBtn.setAttribute('aria-label', up ? `Harder way to play: ${up.label}` : 'Already the hardest way to play'); harderBtn.title = harderBtn.getAttribute('aria-label');
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
  // The whole word or just its ending, always (2026-10-26: "in game mode one should always be able to write the whole
  // word or just the correct ending"): an ending may be typed with its dash ("-unt").
  const endOf = (t) => String(t ?? '').trim().replace(/^[-–—]\s*/, '');
  const isRight = (x, t) => cellRight(t, x.answers) || (splits(x) && !!endOf(t) && (cellRight(x.stem + endOf(t), x.answers) || cellRight(endOf(t), [x.ending])));
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
        : choicesFor(r.x, base, (y) => y.answers[0], (t) => isRight(r.x, t));
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
          parse ? null : howBtn, list, passBtn(r)];
        r.slot.replaceChildren(...kids.filter(Boolean));
        place(); paintStats();
        focusIn(list.querySelector('button'));
        return;
      }
      // A table too small for wrong choices is typed instead.
      r.li.classList.remove('is-parse');
    }
    input.value = '';
    input.setAttribute('aria-label', splits(r.x) ? `${cue} — the whole word, or just its ending` : cue);
    input.placeholder = splits(r.x) ? 'the word, or its ending' : '';
    if (mode === 'flash') {
      // A look first: the form a moment, then the box. A key or a tap skips the look.
      const look = el('button', { type: 'button', class: 'gm__look', lang: 'la', 'aria-label': `Remember it: ${r.x.answers[0]}. Then type it.` }, el('span', { class: 'gm__form' }, formNode(r.x)), el('span', { class: 'gm__looktag', text: 'Remember it…' }));
      const toBox = () => { if (tok !== seq || !look.isConnected) return; r.slot.replaceChildren(...[input, howBtn, passBtn(r)].filter(Boolean)); focusIn(input); };
      look.addEventListener('click', toBox);
      look.addEventListener('keydown', (e) => { if (e.key.length === 1 || e.key === 'Enter') { e.preventDefault(); toBox(); } });
      r.slot.replaceChildren(look);
      place(); paintStats();
      focusIn(look);
      setTimeout(toBox, reduced ? 2200 : 1800);
      return;
    }
    r.slot.replaceChildren(...[input, howBtn, passBtn(r)].filter(Boolean));
    place(); paintStats();
    focusIn(input);
  }
  /**
   * Turning the wheel (2026-10-19: "have it to where you can scroll up and down and it moves the wheel to the next or
   * before"): the form `i` comes to the middle. One still to answer is asked; one answered is shown as it was
   * answered. The form left keeps nothing half done: its box, choices or look go, and its red with them.
   */
  function go(i) {
    if (closed || ended || panel) return;
    const to = Math.max(0, Math.min(rows.length - 1, i));
    if (to === at) return;
    const was = rows[at];
    if (was && !isDone(was)) {
      seq += 1;   // its timers stand down
      if (was.slot.contains(document.activeElement)) root.focus({ preventScroll: true });
      was.slot.replaceChildren();
      was.li.classList.remove('is-parse');
      delete was.li.dataset.state;
    }
    at = to;
    hintSeen();
    if (isDone(rows[at])) { seq += 1; place(); paintStats(); live.textContent = `${rows[at].x.cue}: ${rows[at].x.answers[0]}.`; root.focus({ preventScroll: true }); }
    else ask();
  }
  /** After an answer: the next form still to answer after this one, else the first one before it; else the redos; else the end. */
  function advance() {
    const next = rows.findIndex((r, i) => i > at && !isDone(r));
    const back = next < 0 ? rows.findIndex((r) => !isDone(r)) : -1;
    if (next >= 0 || back >= 0) { at = next >= 0 ? next : back; ask(); return; }
    at = rows.length;
    if (redo) {
      // Redo misses: each form missed this round comes back at the end — twice at most, so Show on every one
      // cannot keep the round going for ever.
      const back = rows.filter((r) => r.missed && !r.requeued && (comeBack.get(r.x.key) ?? 0) < 2);
      for (const r of back) { r.requeued = true; comeBack.set(r.x.key, (comeBack.get(r.x.key) ?? 0) + 1); const n = makeRow(r.x, true); rows.push(n); track.append(n.li); }
      if (back.length) { paintGroups(); live.textContent = `${back.length} more: the ones missed, again.`; }
    }
    if (at >= rows.length) { finish(); return; }
    ask();
  }
  // A timer for the form on screen: it stands down if the wheel has been turned or the form answered meanwhile.
  const later = (fn, ms) => { const tok = seq; setTimeout(() => { if (!closed && tok === seq) fn(); }, ms); };
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
    if (r.reviewOf && r.reviewOf.li.dataset.state === 'skipped') {
      // The skipped form, got right on review: it turns green where it stands too.
      r.reviewOf.missed = false;
      settle(r.reviewOf, 'right');
      r.reviewOf.li.classList.add('is-reviewed');
    }
    sounds.right();
    live.textContent = `Right: ${r.x.answers[0]}${mode === 'parse' ? `, ${r.x.cue}` : ''}.`;
    paintStats();
    later(advance, reduced ? 120 : 380);
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
    if (!r || !r.slot.contains(input) || input.readOnly) return;   // not while the right form is flashed
    const typed = input.value.trim();
    if (!typed) return;
    // In Endings only the box holds the ending; the whole form typed anyway is right too.
    if (isRight(r.x, typed)) { right(r); return; }
    wrong(r);
    // The right form flashes in the box for half a second, then the box empties for another try (2026-10-26: "if one
    // gets it wrong in the game mode show the correct answer for .5 a second and clear it") — unless the learner has
    // already moved on, answered, or started again.
    const shown = splits(r.x) ? r.x.ending : r.x.answers[0];
    const tok = seq;
    setTimeout(() => {
      if (closed || tok !== seq || rows[at] !== r || r.li.dataset.state !== 'wrong' || input.value.trim() !== typed) return;
      input.value = shown;
      input.readOnly = true;
      input.classList.add('gm__in--answer');
      live.textContent = `The form is ${r.x.answers[0]}.`;
      setTimeout(() => {
        input.readOnly = false;
        input.classList.remove('gm__in--answer');
        if (closed || tok !== seq || rows[at] !== r) return;
        if (input.value === shown) input.value = '';
        delete r.li.dataset.state;
        focusIn(input);
      }, 500);
    }, 250);
  }
  /** The section a form is in: its column of the table (one section in all when shuffled, which has no columns). */
  const secOf = (row) => (row.again ? row.sec : (shuffle ? '*' : row.x.group ?? '*'));
  function skip() {
    const r = rows[at];
    if (!r || isDone(r)) return;
    firstMiss.add(r.x.key);
    r.missed = true;
    r.requeued = true;   // it comes back at its section's end, not again at the round's
    streak = 0;
    seq += 1;
    if (r.slot.contains(document.activeElement)) root.focus({ preventScroll: true });
    r.li.dataset.state = 'skipped';
    r.li.setAttribute('data-missed', '');
    r.li.classList.remove('is-parse');
    r.slot.replaceChildren(el('span', { class: 'gm__skipped', text: 'Skipped — it comes back at the end of this section' }));
    // Its review goes after the last form of its section (and after any review already there).
    const sec = secOf(r);
    let end = at;
    for (let i = at + 1; i < rows.length; i++) { const y = rows[i]; if (secOf(y) === sec && (!y.again || y.sec === sec)) end = i; else if (!y.again && secOf(y) !== sec) break; }
    const back = makeRow(r.x, true);
    back.sec = sec;
    back.reviewOf = r;
    back.li.querySelector('.gm__againtag').textContent = '↻ review';
    rows.splice(end + 1, 0, back);
    track.append(back.li);
    paintGroups();
    place();
    live.textContent = 'Skipped. It comes back at the end of this section.';
    paintStats();
    later(advance, reduced ? 120 : 500);
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
    later(advance, reduced ? 300 : 1400);
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  // Typing again after a miss is a new try: the red goes at once, and the pending clear stands down.
  // (2026-10-21, on a phone: "when I put in the correct answer it did not automatically move down … I still had to
  // press enter".)
  // Right moves on by itself (2026-10-20: "if you type the correct answer or ending it will automatically move on
  // without pressing enter"): the moment the box holds an accepted answer it is taken. A wrong one still waits for
  // Enter, so a word half typed is never marked wrong; a keyboard still composing a word is waited for.
  const autoTake = (e) => {
    if (e?.isComposing || !read('auto', true)) return;
    const r = rows[at];
    if (r && r.slot.contains(input) && r.li.dataset.state !== 'right' && input.value.trim() && isRight(r.x, input.value.trim())) submit();
  };
  input.addEventListener('input', (e) => { const r = rows[at]; if (r?.li.dataset.state === 'wrong') { seq += 1; delete r.li.dataset.state; } autoTake(e); });
  input.addEventListener('compositionend', () => autoTake());

  /* ---- turning the wheel: a scroll, a swipe, the arrow keys, a tap on a band */
  let wheelSum = 0;
  let wheelLock = 0;
  // The end card scrolls as a page does: the wheel's own scroll and swipe stop with the round.
  stage.addEventListener('wheel', (e) => {
    if (ended) return;
    e.preventDefault();
    if (Date.now() < wheelLock) return;
    wheelSum += e.deltaY;
    if (Math.abs(wheelSum) < 40) return;   // a trackpad's small steps add up to one turn
    go(at + Math.sign(wheelSum));
    wheelSum = 0;
    wheelLock = Date.now() + 220;          // one turn per flick, not one per event
  }, { passive: false });
  let touchY = null;
  stage.addEventListener('touchstart', (e) => { touchY = !ended && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  stage.addEventListener('touchmove', (e) => { if (touchY != null) e.preventDefault(); }, { passive: false });   // the swipe is the wheel's, not the page's
  stage.addEventListener('touchend', (e) => {
    if (touchY == null) return;
    const dy = e.changedTouches[0].clientY - touchY;
    touchY = null;
    if (Math.abs(dy) < 36) return;   // a tap, not a swipe
    // A swipe up brings the next form up into the middle, as a list scrolls; a long swipe turns two.
    go(at + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 220 ? 2 : 1));
  });
  track.addEventListener('click', (e) => {
    const li = e.target.closest('.gm__row');
    const i = rows.findIndex((r) => r.li === li);
    if (i >= 0 && i !== at) go(i);
  });
  // The first time, a word on how: it goes once the wheel has been turned.
  const hint = read('hinted', false) ? null : el('p', { class: 'gm__hint', 'aria-hidden': 'true', text: '↕ Scroll or swipe to turn the wheel' });
  if (hint) stage.append(hint);
  function hintSeen() { if (hint?.isConnected) { hint.remove(); write('hinted', true); } }

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
      // A look aside (the ?) leaves the form as it was: what is typed stays, the choices stay, no second Flash.
      if (node.keep && r?.slot.childNodes.length) { focusIn(r.slot.querySelector('.gm__in, .gm__choice:not(:disabled), .gm__look') ?? root); return; }
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
        el('span', { class: 'gm__cue' }, el('span', { class: 'gm__label' }, cueNodes(x.cue)), x.en ? el('span', { class: 'gm__en', text: x.en }) : null),
        el('span', { class: 'gm__form', lang: 'la' }, formNode(x))))),
      el('div', { class: 'gm__acts' }, goOn, el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Quit the game')));
    openPanel(node, goOn);
  }
  function openRule() {
    if (!rule) return;
    const fresh = !rows.some(isDone) && !firstMiss.size;
    const goOn = el('button', { type: 'button', class: 'btn btn--primary gm__start', onclick: () => node.resume() }, fresh ? 'Start ▶' : 'Back to the game');
    // What this game plays, and a way to others, before it starts.
    const playing = chartList ? el('p', { class: 'gm__playing' }, 'Playing ', el('strong', { text: chartName(chartOn) }), ' ',
      el('button', { type: 'button', class: 'btn btn--quiet gm__change', onclick: () => { node.resume(); openCharts(); } }, `Change ${noun}s`)) : null;
    const node = el('section', { class: 'gm__end gm__panel gm__rulep', role: 'region', 'aria-labelledby': 'gm-rule-h' },
      el('h2', { id: 'gm-rule-h', class: 'gm__endh', lang: 'la', text: title }),
      playing,
      ruleCard(rule, { open: true }),
      el('div', { class: 'gm__acts' }, goOn, study ? el('button', { type: 'button', class: 'btn gm__studylink', title: study.title ?? '', onclick: studyGo }, `${study.label ?? '📖 Study it'}: ${study.title ?? 'in lesson mode'}`) : null));
    openPanel(node, goOn);
  }
  // ? How this form is made: its own steps for this word, over the column; the clock stops while it is open.
  function openHow() {
    const r = rows[at];
    const card = r && how ? how(r.x) : null;
    if (!card) return;
    const goOn = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => node.resume() }, 'Back to it');
    const node = el('section', { class: 'gm__end gm__panel gm__howp', role: 'region', 'aria-labelledby': 'gm-how-h' },
      el('h2', { id: 'gm-how-h', class: 'gm__endh', text: 'How it’s made' }),
      el('p', { class: 'gm__howcue' }, el('span', { class: 'gm__label' }, cueNodes(r.x.cue)), r.x.en ? el('span', { class: 'gm__en', text: r.x.en }) : null),
      ruleCard(card, { open: true, heading: 'For this word' }),
      el('div', { class: 'gm__acts' }, goOn));
    node.keep = true;
    openPanel(node, goOn);
  }
  /** One step easier (-1) or harder (+1): the form on screen is asked again the new way; a change of shuffle orders the next round. */
  function stepMode(d) {
    const to = stepThan(mode, shuffle, d);
    if (!to || panel || closed) return;
    const reorders = to.shuffle !== shuffle;
    mode = to.mode; shuffle = to.shuffle;
    write('mode', mode); write('shuffle', shuffle);
    paintStats();
    live.textContent = `${d > 0 ? 'Harder' : 'Easier'}: ${to.label}${reorders ? (shuffle ? ' — the next round is shuffled' : ' — the next round goes in order') : ''}.`;
    const r = rows[at];
    if (!ended && r && r.li.dataset.state !== 'right' && r.li.dataset.state !== 'shown') ask();
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
        null,   // (Endings only is no longer a switch: the whole form or its ending is always right)
        sw('Shuffle', 'Mix up the order.', shuffle, (v) => { shuffle = v; write('shuffle', v); if (!ended) reorderRest(); }),
        sw('Redo misses', 'Missed forms come back at the end.', redo, (v) => { redo = v; write('redo', v); }),
        sw('Move on when right', 'No need to press Enter for a right answer.', read('auto', true), (v) => { write('auto', v); }),
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
    // ↑ ↓ turn the wheel (in the box too, where they do nothing else).
    else if (!panel && !ended && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); go(at + (e.key === 'ArrowDown' ? 1 : -1)); }
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
    // A caller playing its own boxes (a lesson's chart, ui.js) is told which were missed on the first try.
    try { onDone?.({ firstMiss: new Set(firstMiss), shown: new Set(shown), typed: mode === 'type' }); } catch (e) { console.warn('[game] onDone', e); }
    notePractised(countKey);   // the table's "×N" (practised.js): a game played to its end
    // Played to its end by typing (Type it, shuffled or not): marked too, so menus can show it green (2026-10-26:
    // "change the colour of a skill to a green background if it's been practised by the typing option").
    if (mode === 'type') notePractised([].concat(countKey ?? []).filter((k) => typeof k === 'string' && k).map((k) => `typed:${k}`));
    root.classList.add('gm--ended');
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
    const again = (its, sub, gid) => () => { close(true); playTable({ title, subtitle: sub, items: its, id: gid, onNext, nextLabel, onClose, rule, ruleFirst: false, charts, how, countKey, continueLabel, suggest, onDone, settings, study }); };
    // More of the word: the next chart along, or any of them.
    const nx = nextCharts();
    const nextChartBtn = nx ? el('button', { type: 'button', class: misses.length ? 'btn' : 'btn btn--primary', onclick: () => playCharts(nx) }, `Next: ${chartName(nx)} →`) : null;
    let more = null;
    if (chartList) {
      const { picker, go } = chartChooser(new Set());
      more = el('details', { class: 'gm__more' }, el('summary', { class: 'gm__moresum', text: `Choose another ${noun} (${chartList.length})` }), picker, el('div', { class: 'gm__acts' }, go));
    }
    const acts = el('div', { class: 'gm__acts' },
      misses.length ? el('button', { type: 'button', class: 'btn btn--primary', onclick: again(misses, 'The ones missed', null) }, `Replay the ${misses.length} I missed`) : null,
      nextChartBtn,
      onNext ? el('button', { type: 'button', class: misses.length || nx ? 'btn' : 'btn btn--primary', onclick: () => { close(true); onNext(); } }, nextLabel) : null,
      // A game played inside something (a lesson's chart): the way back into it is the way on.
      continueLabel && !onNext ? el('button', { type: 'button', class: misses.length || nx ? 'btn' : 'btn btn--primary', onclick: () => close() }, continueLabel) : null,
      el('button', { type: 'button', class: 'btn', onclick: again(base, subtitle, id) }, 'Play again'),
      el('button', { type: 'button', class: 'btn btn--quiet', onclick: () => close() }, 'Close'));
    // Nothing goes on by itself (2026-10-23: "in game mode make it so the person must press a button to continue to
    // the next thing"); beside the way on, the same forms again a step harder ("OR that they practise the same thing
    // using a harder setting — typing is harder than flash, flash is harder than multiple choice"; "shuffled type is
    // the hardest"). The ladder: What is it? → Choose → Flash → Type it → Type it, shuffled.
    const up = harderThan(mode, shuffle);
    if (up) acts.insertBefore(el('button', { type: 'button', class: 'btn gm__harder', onclick: () => { write('mode', up.mode); write('shuffle', up.shuffle); again(base, subtitle, id)(); } }, `Same again, harder: ${up.label} ↑`), acts.querySelector('button:nth-last-child(2)'));
    const stars = clean === base.length ? 3 : clean >= base.length * 0.7 ? 2 : clean > 0 ? 1 : 0;
    const card = el('section', { class: 'gm__end', 'aria-labelledby': 'gm-end-h' },
      el('p', { class: 'gm__stars', 'aria-label': `${stars} of 3 stars` }, [0, 1, 2].map((i) => el('span', { class: i < stars ? 'is-on' : '', 'aria-hidden': 'true', text: '★' }))),
      el('h2', { id: 'gm-end-h', class: 'gm__endh', text: clean === base.length ? 'Every form, first time!' : `${clean} of ${base.length} first time` }),
      el('dl', { class: 'gm__result' },
        el('div', {}, el('dt', { text: 'Score' }), el('dd', { text: `${score}${isBest && id ? ' · best' : best ? ` · best ${best.score}` : ''}` })),
        el('div', {}, el('dt', { text: 'Longest streak' }), el('dd', { text: String(bestStreak) })),
        el('div', {}, el('dt', { text: 'Time' }), el('dd', { text: mmss(secs) }))),
      misses.length ? el('div', { class: 'gm__misses' }, el('p', { class: 'gm__sub', text: 'Missed on the first try:' }),
        el('ul', {}, misses.map((x) => el('li', {}, el('span', { class: 'gm__label' }, cueNodes(x.cue)), ' ', el('span', { class: 'gm__form', lang: 'la' }, formNode(x)))))) : null,
      acts,
      // The end of the line (the last word, nothing after it): the skills to go to next — on the path, under it, beside it.
      // …and always the other ways on (2026-10-23: "they can also go to the next skill/part OR the recommendations"):
      // the skills to go to next — on the path, under it, beside it, in the chapter.
      suggest?.length ? el('section', { class: 'gm__suggest', 'aria-label': 'Or another skill' }, el('p', { class: 'gm__sub', text: onNext || nx || continueLabel ? 'Or another skill:' : 'What next?' }),
        // A `{ head }` entry starts a group under its own heading (its tables, easier or harder, what next…).
        suggest.map((x, i) => (x.head ? el('p', { class: 'gm__sub gm__suggesthead', text: x.head })
          : el('button', { type: 'button', class: i === 0 && !misses.length && !onNext && !nx && !continueLabel ? 'btn btn--primary' : 'btn gm__suggestbtn', onclick: () => { close(true); x.go(); } }, typeof x.label === 'function' ? x.label() : x.label)))) : null,   // a function: read at the end, so a count includes this round
      more);
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
  // The rule first, where there is one (a replay goes straight in); the clock starts with Start.
  requestAnimationFrame(() => { if (rule && ruleFirst) { place(); openRule(); } else ask(); });
  return { close };
}
