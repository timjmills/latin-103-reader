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
//   attachHoverGloss() the delegated open-on-rest / close-on-leave machine
//
// Nothing here builds a popup or knows what a word means. Each section keeps
// its own popup, its own lookup, and — through `skip` — its own answer to the
// one question that has a different answer in each: *which words must the
// pointer keep quiet on?* In Grammar that is a tap item's words, because the
// entry for the word names the case the item is asking for (72a973b). Both
// sections must answer it; neither may answer it by silence.

/**
 * True only where hovering is something a pointer really does. On a touch
 * screen the "hover" is the tap that was meant to choose the word, so the
 * gloss would open on every tap and the tap would lose its own meaning.
 * `mm` is `window.matchMedia` (injected for tests); no matchMedia at all —
 * an old engine, a test harness — is treated as a mouse, which is what the
 * Grammar section shipped with.
 */
export function pointerHovers(mm = typeof window !== 'undefined' ? window.matchMedia : null) {
  if (typeof mm !== 'function') return true;
  return !!mm('(hover: hover) and (pointer: fine)').matches;
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
 * @returns {{ detach: Function, cancel: Function }}
 */
export function attachHoverGloss({ root, word, show, hide, skip, la = '[lang="la"]', cut = null, pop = null, busy = null, delay = 140 }) {
  if (typeof skip !== 'function') throw new TypeError('attachHoverGloss: `skip` must say which words keep quiet (() => false when none do)');
  let timer = null;
  let at = null;          // the word the pointer is on, so crossing it again is not a re-open
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  function onIn(e) {
    if (!pointerHovers()) return;
    let w = e.target?.closest?.(word);
    // Not on a word yet, but on Latin: cut it into words and find the one under the pointer.
    if (!w && cut) {
      const el = e.target?.closest?.(la);
      if (el && root.contains(el) && cut(el)) w = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(word);
    }
    if (!w || w === at || !root.contains(w)) return;
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
    const w = e.target?.closest?.(word);
    if (!w) return;
    const to = e.relatedTarget;
    if (to && (w.contains(to) || (pop && to.closest?.(pop)))) return;   // into the popup itself, or the word's own punctuation
    cancel();
    at = null;
    hide();
  }
  root.addEventListener('mouseover', onIn);
  root.addEventListener('mouseout', onOut);
  return {
    detach() { root.removeEventListener('mouseover', onIn); root.removeEventListener('mouseout', onOut); cancel(); at = null; },
    cancel() { cancel(); at = null; },
  };
}
