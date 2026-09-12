// The dictionary on the pointer, shared by the Grammar section and the reader.
//
// 5d2f8c7 built this for Grammar alone ("you should not have to click on the
// word in the grammar section to have the dictionary entry pop up"). The ask
// was wider than one section — "All Latin text throughout should be
// mouse-overable for the meaning" — and the reader is the other half of the
// app, with its own words, its own dictionary and its own settings. So the
// three parts that are the same wherever the pointer rests live here:
//
//   pointerHovers()    is a hover a real thing on this device, or is it a tap
//   cutLatinWords()    Latin drawn as plain text, cut into words on demand
//   attachHoverGloss() the delegated open-on-rest / close-on-leave machine,
//                      and beside it the finger's own way in: long-press
//
// A finger cannot hover, and in this app it cannot spare a tap either — on a
// tap item the tap *is* the answer. So the learner chose one gesture for the
// whole app (2026-09-12): **hold a word and the dictionary answers; a quick
// tap still means what it always meant.** It lives here and not in either
// section for the same reason the rest does: one machine, two sections, and no
// second way of asking the same question. GRAMMAR-CONTRACT.md §17.4.
//
// Nothing here builds a popup or knows what a word means. Each section keeps
// its own popup, its own lookup, and — through `skip` — its own answer to the
// one question that has a different answer in each: *which words must the
// pointer keep quiet on?* In Grammar that is a tap item's words, because the
// entry for the word names the case the item is asking for (72a973b). Both
// sections must answer it; neither may answer it by silence.

/** The pointer kinds that rest on a thing without choosing it. */
export const HOVERS = new Set(['mouse', 'pen']);

/**
 * True only where hovering is something *this* pointer really does. On a touch
 * screen the "hover" is the tap that was meant to choose the word, so the
 * gloss would open on every tap and the tap would lose its own meaning.
 *
 * The question is asked of the **event**, never of the device. The first
 * version asked `matchMedia('(hover: hover) and (pointer: fine)')`, and those
 * queries describe only the *primary* input: a Windows laptop with a
 * touchscreen answers "coarse, cannot hover" with a mouse plugged into it, so
 * the feature was simply off for the reader who asked for it (5599f09). A
 * pointer event carries what it actually is, and the same machine can then
 * answer a mouse and ignore a finger. An event with no `pointerType` — an old
 * engine, a synthesised event, a test — is taken as a mouse, which is what the
 * Grammar section shipped with.
 */
export function pointerHovers(e) {
  return !e || !e.pointerType || HOVERS.has(e.pointerType);
}

/**
 * How long a finger must stay on a word before the dictionary answers, in ms.
 *
 * 450 is the learner's own number, and it sits in the one gap that matters:
 * above the ~200 ms a deliberate tap takes to lift, and just *below* the
 * ~500 ms at which Android Chrome raises its context menu and iOS Safari puts
 * up its selection callout. Opening first is what lets us take those away
 * (`contextmenu` / `selectstart` below) while the press is still ours.
 */
export const HOLD_MS = 450;
/**
 * How far the finger may drift in that time and still be a press, in CSS px.
 * 10 is a shade over the 8 px slop a touch engine itself allows before it
 * calls a press a scroll: a long reading page must never answer a flick.
 */
export const HOLD_SLIP = 10;
/**
 * How long the click the opening lift fires may take to arrive, in ms. The
 * swallower below is a one-shot — it goes the moment it eats that click — so
 * this only bounds the wait when no click comes at all.
 */
export const HOLD_CLICK_MS = 500;

let touchSeen = false;
let watchingForTouch = false;

/**
 * True once a pointer that cannot hover has actually been used here. The same
 * fact is put on `<html data-touch="1">` so a stylesheet can say something
 * only a finger can act on — the "hold a word" sentence in an item's key help
 * line — without a media query ever being asked about the *device* (§17.2).
 *
 * The honest limit: it is false until the first touch. That is acceptable
 * because a learner on a touch screen cannot reach an item without tapping
 * something first, and the flag is watched from the document, not from a
 * section's root, so *any* tap anywhere in the app sets it.
 */
export function touchUsed() { return touchSeen; }

function sawTouch() {
  if (touchSeen) return;
  touchSeen = true;
  document.documentElement.dataset.touch = '1';
}

function watchForTouch() {
  if (watchingForTouch || typeof document === 'undefined') return;
  watchingForTouch = true;
  const look = (e) => { if (!pointerHovers(e)) { sawTouch(); document.removeEventListener('pointerdown', look, true); } };
  document.addEventListener('pointerdown', look, true);
}

/**
 * Latin that was drawn as plain text — a chip, a cited form, a table cell, a
 * picture caption, a chapter title — becomes words the first time the pointer
 * crosses it. Marked-up Latin is the whole of what this touches (the caller
 * hands in a `lang="la"` element), so an English sentence is never cut into
 * words that happen to look Latin. Done once per element, and never to a
 * control whose text is its value; `dataset.laWords` is the mark, set before
 * the work so nothing is ever cut twice.
 *
 * @param {Element}  el          the `lang="la"` element under the pointer
 * @param {object}   o
 * @param {Function} o.tokenize  tokenize(text) → [{ text, form, isWord }]
 * @param {string}   o.cls       class for the word spans (`g-wx` / `r-wx`)
 * @param {string}   o.skip      selector for what must not be cut, nor cut inside
 * @returns {boolean} true when the element now holds word spans
 */
export function cutLatinWords(el, { tokenize, cls, skip }) {
  if (!el || el.dataset.laWords === '1') return false;
  el.dataset.laWords = '1';
  if (el.matches(skip) || el.closest('input, textarea, select')) return false;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const text = [];
  while (walk.nextNode()) {
    const n = walk.currentNode;
    if (n.parentElement !== el && n.parentElement?.closest(skip)) continue;
    if (/\p{L}/u.test(n.textContent)) text.push(n);
  }
  let cut = false;
  for (const n of text) {
    const frag = document.createDocumentFragment();
    for (const t of tokenize(n.textContent)) {
      if (t.isWord) {
        const span = document.createElement('span');
        span.className = cls;
        span.lang = 'la';
        span.dataset.form = t.form;
        span.textContent = t.text;
        frag.append(span);
        cut = true;
      } else frag.append(t.text);
    }
    if (cut) n.replaceWith(frag);
  }
  return cut;
}

/**
 * The pointer resting on a Latin word opens its gloss; leaving the word closes
 * it. Delegated from one root, so it covers every word that root ever draws,
 * now and later — and a click still means exactly what it meant.
 *
 * @param {object}   o
 * @param {Element}  o.root    the section root; nothing outside it answers
 * @param {string}   o.word    selector for a word element
 * @param {Function} o.show    show(wordEl) — build and place the tooltip
 * @param {Function} o.hide    hide() — take a tooltip the pointer opened away
 * @param {Function} o.skip    skip(wordEl) → true: this word gets no tooltip.
 *                             Required, and deliberately so: every section has
 *                             to say which of its words must stay quiet, even
 *                             when the answer is "none of them".
 * @param {string}   [o.la]    selector for Latin drawn as plain text
 * @param {Function} [o.cut]   cut(el) → bool: make words of one `la` element
 * @param {string}   [o.pop]   selector for the tooltip: the pointer crossing
 *                             into one is not a leave
 * @param {Function} [o.busy]  busy() → true: something the reader opened
 *                             themselves is on screen; the pointer leaves it be
 * @param {number}   [o.delay] ms the pointer must rest — long enough that
 *                             crossing a sentence does not strobe
 * @param {number}   [o.hold]  ms a finger must stay still before the gloss
 *                             opens; the tests shorten it, nothing else does
 * @returns {{ detach: Function, cancel: Function }}
 */
export function attachHoverGloss({ root, word, show, hide, skip, la = '[lang="la"]', cut = null, pop = null, busy = null, delay = 140, hold = HOLD_MS }) {
  if (typeof skip !== 'function') throw new TypeError('attachHoverGloss: `skip` must say which words keep quiet (() => false when none do)');
  watchForTouch();
  let timer = null;
  let at = null;          // the word the pointer is on, so crossing it again is not a re-open
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  /** The word at a point: the one under the pointer, or the one that appears when the Latin it is on is cut. */
  function wordAt(x, y, target) {
    let w = target?.closest?.(word) ?? null;
    // Not on a word yet, but on Latin: cut it into words and find the one under the pointer.
    if (!w && cut) {
      const el = target?.closest?.(la);
      if (el && root.contains(el) && cut(el)) w = document.elementFromPoint(x, y)?.closest?.(word) ?? null;
    }
    return w && root.contains(w) ? w : null;
  }
  function onIn(e) {
    if (!pointerHovers(e)) return;
    const w = wordAt(e.clientX, e.clientY, e.target);
    if (!w || w === at) return;
    // Before the word is taken as the one being hovered, so that the moment it stops being
    // a word to keep quiet on the pointer resting where it already is opens it.
    if (skip(w)) return;
    cancel();
    at = w;
    if (busy?.()) return;
    timer = setTimeout(() => {
      timer = null;
      if (w.isConnected) show(w);
    }, delay);
  }
  function onOut(e) {
    // Asked of the event, as everything here is (§17.2). A touch fires `pointerout` at the lift,
    // *after* the hold has opened the gloss — unguarded, the gesture would close what it opened.
    if (!pointerHovers(e)) return;
    const w = e.target?.closest?.(word);
    if (!w) return;
    const to = e.relatedTarget;
    if (to && (w.contains(to) || (pop && to.closest?.(pop)))) return;   // into the popup itself, or the word's own punctuation
    cancel();
    at = null;
    hide();
  }

  /* ------------------------------------------------------------- the finger */

  let press = null;       // the touch in progress: { id, x, y, target, opened, timer }
  let opened = false;     // a gloss a hold put on screen, still waiting to be dismissed

  /**
   * Swallow the one click the lift is about to fire. Without this the learner gets a definition
   * *and* a committed answer out of a single gesture, which is the whole reason a tap item could
   * not simply be given the gloss on tap. Capture on the window, so it stops the event before it
   * reaches the word's own `onclick` or a section's delegated `click`; one shot, so the next tap
   * the learner makes is their own.
   */
  function eatClick() {
    let t = null;
    const kill = (e) => { e.preventDefault(); e.stopImmediatePropagation(); off(); };
    const off = () => { clearTimeout(t); window.removeEventListener('click', kill, true); };
    window.addEventListener('click', kill, true);
    t = setTimeout(off, HOLD_CLICK_MS);
  }
  function endPress() {
    if (!press) return;
    if (press.timer) clearTimeout(press.timer);
    press = null;
    delete document.documentElement.dataset.hold;
  }
  function onDown(e) {
    if (pointerHovers(e)) return;          // a mouse's press is the mouse's own; the hover path has it
    // A press anywhere puts the last hold's gloss away. Each section already closes its popup on a
    // pointerdown, but both make an exception for a word — so without this, holding one word and
    // then tapping the next would leave the first word's gloss standing over the second.
    if (opened) { opened = false; hide(); }
    endPress();
    const on = e.target?.closest?.(word) ?? (cut ? e.target?.closest?.(la) : null);
    if (!on || !root.contains(on)) return;
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target, opened: false, timer: null };
    press = p;
    // While a finger is down on a word the words stop being selectable, so the browser's own long
    // press cannot put selection handles over the gloss. Only while it is down: a mouse never sets
    // this, so selecting Latin with a mouse on a touchscreen laptop is exactly what it was.
    document.documentElement.dataset.hold = '1';
    p.timer = setTimeout(() => {
      p.timer = null;
      // The Latin is cut into words *here* and not at the press, so a quick tap never touches the DOM.
      const w = wordAt(p.x, p.y, p.target);
      if (!w || skip(w) || busy?.()) return;
      p.opened = true;
      cancel();
      at = null;
      show(w);
    }, hold);
  }
  function onMove(e) {
    const p = press;
    // Once it has opened, drift is just the hand settling; before that, drift is a scroll starting.
    if (!p || e.pointerId !== p.id || p.opened) return;
    if (Math.abs(e.clientX - p.x) > HOLD_SLIP || Math.abs(e.clientY - p.y) > HOLD_SLIP) endPress();
  }
  function onUp(e) {
    const p = press;
    if (!p || (e && e.pointerId !== p.id)) return;
    endPress();
    if (!p.opened) return;   // a quick tap: the click goes through and still means what it meant
    opened = true;
    eatClick();
  }
  /**
   * The browser's own long press, taken away while ours is running — and only then, so a right-click
   * on a word and a mouse selection of a sentence are untouched. iOS raises no `contextmenu`; its
   * callout is refused in CSS (`-webkit-touch-callout`), which a mouse never sees either.
   */
  function onNative(e) { if (press) e.preventDefault(); }

  // The pointer pair, not the mouse pair: a `mouseover` carries no `pointerType`, so the guard above
  // would be blind and every touch would open a gloss.
  root.addEventListener('pointerover', onIn);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('contextmenu', onNative);
  root.addEventListener('selectstart', onNative);
  return {
    detach() {
      root.removeEventListener('pointerover', onIn);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.removeEventListener('contextmenu', onNative);
      root.removeEventListener('selectstart', onNative);
      cancel();
      endPress();
      at = null;
      opened = false;
    },
    cancel() { cancel(); endPress(); at = null; },
  };
}
