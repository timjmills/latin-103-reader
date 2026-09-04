// Reader: passage view + sentence view.
// The top half is pure (tested in tests/ui.tokenize-highlights.test.mjs);
// createReader() below owns the DOM. Dependencies (tokenize, describe) are
// injected so this file has no static import of B's modules.

/* ----------------------------------------------------------------- pure */

/**
 * Resolve C's highlight rows ({text, occurrence?}) for one unit into
 * character ranges on `la`. Overlapping ranges: the earliest wins.
 * @returns {{ranges: Array, missing: Array}}
 */
export function resolveHighlights(la, highlights) {
  const found = [];
  const missing = [];
  for (const h of highlights) {
    const want = Math.max(1, h.occurrence ?? 1);
    let idx = -1;
    for (let n = 0; n < want; n++) {
      idx = la.indexOf(h.text, idx + 1);
      if (idx < 0) break;
    }
    if (idx < 0 || !h.text) { missing.push(h); continue; }
    found.push({ ...h, start: idx, end: idx + h.text.length });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges = [];
  let lastEnd = -1;
  for (const r of found) {
    if (r.start < lastEnd) { missing.push({ ...r, reason: 'overlap' }); continue; }
    ranges.push(r);
    lastEnd = r.end;
  }
  return { ranges, missing };
}

/**
 * Group tokens into runs that share a highlight range (or none).
 * A word token joins a range when it overlaps it at all; whitespace and
 * punctuation join only when fully inside, so glows hug the words.
 */
export function segmentUnit(tokens, ranges) {
  const groups = [];
  for (const t of tokens) {
    const range = ranges.find((r) =>
      (t.start >= r.start && t.end <= r.end) ||
      (t.isWord && t.start < r.end && t.end > r.start)) || null;
    const last = groups[groups.length - 1];
    if (last && last.range === range) last.tokens.push(t);
    else groups.push({ range, tokens: [t] });
  }
  return groups;
}

/** Forms that should carry the yellow underline: looked up and not yet learned. */
export function activeUnderlines(lookups) {
  const out = new Set();
  for (const [form, rec] of lookups) if (!rec.learned_at) out.add(form);
  return out;
}

/** Words the learner has looked up that belong to this unit, in text order. */
export function unitLookups(unitId, tokens, lookups) {
  const pos = new Map();
  tokens.forEach((t, i) => { if (t.isWord && !pos.has(t.form)) pos.set(t.form, i); });
  const out = [];
  for (const [form, rec] of lookups) {
    if (pos.has(form)) out.push({ form, rec, pos: pos.get(form) });
    else if (rec.first_seen_unit_id === unitId) out.push({ form, rec, pos: Infinity });
  }
  return out.sort((a, b) => a.pos - b.pos).map(({ form, rec }) => ({ form, rec }));
}

/** Accessible name for a note marker; block-based ids (w07:b3.2) have no line/sentence pair. */
export function noteLabel(unit) {
  const ref = unitRef(unit.id);
  if (ref && unit.line_no != null) return `Grammar note for sentence ${ref.n} on line ${unit.line_no}`;
  return 'Grammar note for this sentence';
}

/** Split "w01:25.2" → { line: 25, n: 2 } for display. */
export function unitRef(unitId) {
  const m = /:(\d+)\.(\d+)$/.exec(unitId);
  return m ? { line: Number(m[1]), n: Number(m[2]) } : null;
}

/** Margin notes of a unit, always an array of {line, la} with a non-empty `la`. */
export function marginNotes(unit) {
  const rows = Array.isArray(unit?.margin) ? unit.margin : [];
  return rows.filter((m) => m && typeof m.la === 'string' && m.la.trim())
    .map((m) => ({ line: m.line != null && Number.isFinite(Number(m.line)) ? Number(m.line) : null, la: m.la.trim() }));
}

/**
 * Gutter or inline presentation for margin notes. The gutter needs room for
 * the notes column *and* a readable prose column beside it.
 * @param {object} o
 * @param {boolean} o.wide       viewport >= 768px
 * @param {number}  o.available  width of the reading column's container, minus the reader's padding (px)
 * @param {number}  o.colPx      margin column + gap (px)
 * @param {number}  o.gutterPx   line-number gutter (px)
 * @param {number}  o.em         reading font size (px)
 * @param {number}  [o.minEm]    narrowest acceptable prose column, in reading ems
 */
export function marginMode({ wide, available, colPx, gutterPx, em, minEm = 18 }) {
  if (!wide) return 'inline';
  if (!(available > 0) || !(em > 0)) return 'inline';
  return available - colPx - gutterPx >= minEm * em ? 'gutter' : 'inline';
}

/**
 * Stack absolutely positioned margin blocks so none overlaps the one above.
 * `items` are in document order with the `top` they want (level with the
 * sentence's first line) and their measured `height`; returns the tops to use.
 * Pass 1 pushes a block down under the one above. Pass 2 (`maxUp` > 0) pulls
 * every run of touching blocks back up so its largest push and its smallest
 * are split evenly (the run's worst error is halved and shared between its
 * ends) — as far as the gap above the run allows and never more than `maxUp`
 * above a block's own sentence.
 */
export function stackMargin(items, gap = 0, { maxUp = 0 } = {}) {
  const tops = [];
  let floor = -Infinity;
  for (const it of items) {
    const top = Math.max(it.top, floor);
    tops.push(top);
    floor = top + it.height + gap;
  }
  if (!(maxUp > 0)) return tops;
  let prevBottom = 0;                                        // nothing is pulled above the column's top
  let i = 0;
  while (i < tops.length) {
    // A run: consecutive blocks each resting on the one above.
    let j = i;
    while (j + 1 < tops.length && tops[j + 1] <= tops[j] + items[j].height + gap + 0.5) j++;
    let lo = Infinity, hi = -Infinity;
    for (let k = i; k <= j; k++) { const p = tops[k] - items[k].top; lo = Math.min(lo, p); hi = Math.max(hi, p); }
    const room = tops[i] - prevBottom;                       // gap above the run
    const shift = Math.max(0, Math.min(Math.round((lo + hi) / 2), maxUp, room));
    for (let k = i; k <= j; k++) tops[k] -= shift;
    prevBottom = tops[j] + items[j].height + gap;
    i = j + 1;
  }
  return tops;
}

/**
 * Offset that puts a smaller note's first baseline on the sentence's first
 * baseline. `contentTop` is the content-area top of the sentence's first text
 * box (the first client rect of its Latin, relative to the .prose — the same
 * for inline and block units); the note sits in line boxes of `noteLineHeight`. Same family
 * for both, so the ascent scales with the font size (`ascent` ~ 0.72 for the
 * serif stack).
 */
export function marginTop({ contentTop, textSize, noteSize, noteLineHeight, ascent = 0.72 }) {
  const halfLeading = (noteLineHeight - noteSize) / 2;
  return Math.round(contentTop + ascent * (textSize - noteSize) - halfLeading);
}

/* ------------------------------------------------------------------ DOM */

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
};

/**
 * @param {object} o
 * @param {HTMLElement} o.root       the <article class="reader">
 * @param {Function}    o.tokenize   B's tokenize(la)
 * @param {Function}    o.describeForm  form → {meaning, parse, lemma} | null (for the sentence-view list)
 * @param {HTMLElement} o.live       aria-live region for navigation announcements
 */
export function createReader({ root, tokenize, describeForm, live }) {
  const listeners = {};
  const on = (ev, cb) => { (listeners[ev] ??= []).push(cb); };
  const emit = (ev, detail) => { for (const cb of listeners[ev] ?? []) cb(detail); };

  const state = {
    week: null, units: [], byId: new Map(), hl: new Map(),
    lookups: new Map(), seen: new Set(), view: 'passage', current: 0,
    audio: false, playing: null, tokens: new Map(), marginTokens: new Map(),
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function tokensFor(unit) {
    if (!state.tokens.has(unit.id)) state.tokens.set(unit.id, tokenize(unit.la));
    return state.tokens.get(unit.id);
  }

  /* --- Latin text → spans ------------------------------------------ */
  function renderLatin(unit) {
    return renderTokens(tokensFor(unit), state.hl.get(unit.id) ?? []);
  }
  function renderTokens(tokens, ranges) {
    const frag = document.createDocumentFragment();
    const groups = segmentUnit(tokens, ranges);
    for (const g of groups) {
      const parent = g.range
        ? h('span', { class: 'hl', 'data-hl-label': g.range.label, 'data-hl-note': g.range.note, 'data-hl-text': g.range.text })
        : frag;
      for (const t of g.tokens) {
        if (!t.isWord) { parent.append(t.text); continue; }
        parent.append(h('span', {
          class: 'w' + (state.seen.has(t.form) ? ' w--seen' : ''),
          role: 'button', tabindex: '0', 'data-form': t.form, 'data-start': String(t.start), text: t.text,
        }));
      }
      if (g.range) frag.append(parent);
    }
    return frag;
  }

  function noteMark(unit) {
    if (!unit.note) return null;
    return h('button', {
      type: 'button', class: 'notemark', 'data-note-for': unit.id, 'aria-label': noteLabel(unit),
    }, h('span', { 'aria-hidden': 'true', text: '†' }));
  }

  function playButton(unit) {
    // state.audio: false | true (every unit) | Set of aligned unit ids.
    if (!state.audio || (state.audio instanceof Set && !state.audio.has(unit.id))) return null;
    return h('button', { type: 'button', class: 'playbtn', 'data-play': unit.id, 'aria-label': 'Play this sentence' });
  }

  /* --- margin notes ------------------------------------------------ */
  // One block per unit: each gloss on its own line, the book line number in
  // front when the text has them. Words are tokenised and tappable like the
  // reading text; `data-for`/`data-order` let the delegated handlers find the unit.
  // Notes are tokenised once per unit (both copies, every render) and dropped with the week.
  function marginTokensFor(unit) {
    if (!state.marginTokens.has(unit.id)) state.marginTokens.set(unit.id, marginNotes(unit).map((m) => ({ ...m, tokens: tokenize(m.la) })));
    return state.marginTokens.get(unit.id);
  }
  function marginBlock(unit, cls) {
    const notes = marginTokensFor(unit);
    if (!notes.length) return null;
    const block = h('span', { class: cls, lang: 'la', 'data-for': unit.id, 'data-order': String(unit.order), role: 'group', 'aria-label': 'Margin notes' });
    for (const m of notes) {
      block.append(h('span', { class: 'mnotes__item' },
        h('span', { class: 'mnotes__mark', 'aria-hidden': 'true', text: '\u00b6' }),
        m.line != null && state.week?.has_line_numbers ? h('span', { class: 'mnotes__line', text: String(m.line) }) : null,
        renderTokens(m.tokens, [])));
    }
    return block;
  }

  /* --- passage view ------------------------------------------------ */
  function renderPassage() {
    const container = h('div', { class: 'passage' });
    const parts = state.week?.parts?.length ? state.week.parts : [{ part: null, lines: null }];
    for (const p of parts) {
      const units = state.units.filter((u) => (p.part ? u.part === p.part : true));
      if (!units.length) continue;
      const section = h('section', { class: 'part' });
      if (p.part) {
        section.append(h('h2', { class: 'part__title' },
          p.part, p.lines ? h('span', { class: 'part__lines', text: ` · lines ${p.lines}` }) : null));
      }
      const prose = h('div', { class: 'prose' });
      units.forEach((u, i) => {
        const unitEl = h('span', {
          class: 'unit' + (u.unit_type === 'verse' ? ' unit--verse' : '') + (u.unit_type === 'turn' ? ' unit--turn' : '') + (state.playing === u.id ? ' is-playing' : ''),
          'data-id': u.id, 'data-order': String(u.order), 'data-type': u.unit_type,
        });
        if (state.week?.has_line_numbers && u.block_start && u.line_no != null) {
          unitEl.append(h('span', { class: 'lineno', 'aria-hidden': 'true', text: String(u.line_no) }));
        }
        if (u.unit_type === 'turn' && u.speaker) unitEl.append(h('span', { class: 'speaker', text: u.speaker }), ' ');
        const la = h('span', { class: 'la', lang: 'la' }, renderLatin(u));
        const margin = marginBlock(u, 'mnotes');
        if (margin) unitEl.classList.add('has-margin');
        unitEl.append(...[la, noteMark(u), playButton(u), margin, h('span', { class: 'en', lang: 'en', text: u.en })].filter(Boolean));
        prose.append(unitEl);
        if (i < units.length - 1) prose.append(' ');
      });
      // The gutter copy: hidden by CSS in the inline mode, positioned by positionMargin().
      const gutter = h('div', { class: 'margin' }, units.map((u) => marginBlock(u, 'mnote')));
      if (gutter.childElementCount) prose.append(gutter);
      section.append(prose);
      container.append(section);
    }
    return container;
  }

  /* --- sentence view ---------------------------------------------- */
  function renderSentence() {
    const u = state.units[state.current];
    if (!u) return h('p', { class: 'empty', text: 'Nothing to read yet.' });
    const ref = unitRef(u.id);
    const wrap = h('div', { class: 'sentence' + (state.playing === u.id ? ' is-playing' : ''), 'data-id': u.id, tabindex: '-1' });
    const meta = [u.part, u.line_no != null && state.week?.has_line_numbers ? `line ${u.line_no}` : null, `${state.current + 1} of ${state.units.length}`]
      .filter(Boolean).join(' · ');
    wrap.append(h('p', { class: 'sentence__meta', text: meta }));
    const la = h('div', { class: 'sentence__la', lang: 'la' });
    if (u.unit_type === 'turn' && u.speaker) la.append(h('span', { class: 'speaker', text: u.speaker }), ' ');
    la.append(...[renderLatin(u), playButton(u)].filter(Boolean));
    wrap.append(la);
    const margin = marginBlock(u, 'mnotes mnotes--sentence');
    if (margin) wrap.append(margin);
    wrap.append(h('p', { class: 'sentence__en en', lang: 'en', text: u.en }));
    if (u.note) {
      wrap.append(h('section', { class: 'sentence__note', 'aria-label': 'Grammar note' },
        h('h3', { class: 'sentence__h', text: 'Note' }), h('p', { text: u.note })));
    }
    const looked = unitLookups(u.id, tokensFor(u), state.lookups);
    const list = h('section', { class: 'sentence__lookups', 'aria-label': 'Words you looked up in this sentence' },
      h('h3', { class: 'sentence__h', text: 'Words you looked up in this sentence' }));
    if (!looked.length) {
      list.append(h('p', { class: 'sentence__hint', text: 'None yet — tap any word above.' }));
    } else {
      const ul = h('ul', { class: 'lookups' });
      for (const { form, rec } of looked) {
        const d = describeForm?.(form);
        const tok = tokensFor(u).find((t) => t.form === form);
        ul.append(h('li', { class: 'lookups__item' + (rec.learned_at ? ' is-learned' : '') },
          h('button', { type: 'button', class: 'lookups__form w' + (!rec.learned_at ? ' w--seen' : ''), 'data-form': form, lang: 'la', text: tok?.text ?? form }),
          d ? h('span', { class: 'lookups__meaning', text: d.meaning }) : h('span', { class: 'lookups__meaning lookups__meaning--miss', text: 'not in the dictionary' }),
          d?.parse ? h('span', { class: 'lookups__parse', text: d.parse }) : null,
          d?.lemma ? h('span', { class: 'lookups__lemma', lang: 'la', text: d.lemma }) : null,
        ));
      }
      list.append(ul);
    }
    wrap.append(list);
    wrap.append(h('nav', { class: 'sentence__nav', 'aria-label': 'Sentence navigation' },
      h('button', { type: 'button', class: 'btn', 'data-nav': '-1', disabled: state.current === 0 }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'Previous'),
      h('span', { class: 'sentence__keys', 'aria-hidden': 'true', text: 'j / k' }),
      h('button', { type: 'button', class: 'btn', 'data-nav': '1', disabled: state.current >= state.units.length - 1 }, 'Next', h('span', { 'aria-hidden': 'true', text: ' →' })),
    ));
    return wrap;
  }

  function render() {
    root.replaceChildren(state.view === 'passage' ? renderPassage() : renderSentence());
    root.dataset.view = state.view;
    reflow();
  }

  function reflow() {
    layoutMargin();
    dedupeLineNumbers();
  }

  // Gutter vs inline margin notes: first the room beside the prose
  // (marginMode), then, part by part, the density of the glosses — a part
  // whose stacked notes would still sit more than ~a line below their
  // sentences after the pull-up is shown inline instead. <article data-margin-mode> carries the
  // overall answer (gutter while any part keeps the gutter), every .part its own.
  const DRIFT_LINES = 0.9;   // same bound as the pull-up: a note stays within a text line of its sentence either way
  const probe = h('span', { class: 'margin-probe', 'aria-hidden': 'true' });
  function layoutMargin() {
    if (state.view !== 'passage') { delete root.dataset.marginMode; return; }
    const prose = root.querySelector('.prose');
    if (!prose) return;
    if (!probe.isConnected) root.append(probe);
    const rs = getComputedStyle(root);
    const main = root.parentElement ?? root;
    const available = main.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight);
    const em = parseFloat(rs.fontSize);
    let mode = marginMode({
      wide: wide.matches, available, em,
      colPx: probe.offsetWidth, gutterPx: parseFloat(getComputedStyle(prose).paddingLeft),
    });
    const parts = [...root.querySelectorAll('.part')];
    if (mode === 'gutter' && root.dataset.margin !== 'off') {
      if (root.dataset.marginMode !== 'gutter') root.dataset.marginMode = 'gutter';   // measure with the column in place
      const lineHeight = parseFloat(rs.lineHeight) || em * 1.55;
      if (!positionMargin(parts, em, lineHeight)) mode = 'inline';
    } else {
      for (const p of parts) { p.dataset.marginMode = 'inline'; for (const pr of p.querySelectorAll('.prose')) pr.style.removeProperty('min-height'); }
    }
    if (root.dataset.marginMode !== mode) root.dataset.marginMode = mode;
  }
  // Content-area top of a unit's first text box, relative to its .prose. A
  // Range over the Latin finds the first line whatever the unit's display
  // (inline, verse/turn blocks, interleaved translation); offsetTop would be
  // the line-box top for block units and sit the note too high.
  function firstLineTop(unit, proseTop) {
    const la = unit.querySelector('.la') ?? unit;
    try {
      const range = document.createRange();
      range.selectNodeContents(la);
      for (const r of range.getClientRects()) if (r.height > 0) return r.top - proseTop;
    } catch { /* fall through */ }
    return unit.offsetTop;
  }
  /** Lay every part out as a gutter, keep the ones whose notes stay beside their sentences. Returns whether any did. */
  function positionMargin(parts, textSize, textLineHeight) {
    let anyGutter = false;
    for (const part of parts) part.dataset.marginMode = 'gutter';
    for (const part of parts) {
      const gutter = part.querySelector('.margin');
      if (!gutter) continue;                       // nothing to place: follows the article
      const prose = gutter.parentElement;
      prose.style.removeProperty('min-height');
      const blocks = [...gutter.children];
      if (!blocks.length) continue;
      const proseTop = prose.getBoundingClientRect().top;
      const ns = getComputedStyle(blocks[0]);
      const noteSize = parseFloat(ns.fontSize);
      const noteLineHeight = parseFloat(ns.lineHeight) || noteSize * 1.3;
      const items = blocks.map((el) => {
        const unit = prose.querySelector(`.unit[data-id="${CSS.escape(el.dataset.for)}"]`);
        const contentTop = unit ? firstLineTop(unit, proseTop) : 0;
        return { el, top: marginTop({ contentTop, textSize, noteSize, noteLineHeight }), height: el.offsetHeight };
      });
      const tops = stackMargin(items, Math.round(noteLineHeight * 0.4), { maxUp: Math.round(textLineHeight * 0.9) });   // pulled up, but never a full line above its sentence
      const drift = Math.max(...items.map((it, i) => tops[i] - it.top));
      if (drift > DRIFT_LINES * textLineHeight) {
        // Too dense for the column here: glosses go under their sentences.
        part.dataset.marginMode = 'inline';
        continue;
      }
      let bottom = 0;
      items.forEach((it, i) => { it.el.style.top = `${tops[i]}px`; bottom = Math.max(bottom, tops[i] + it.height); });
      // Reserve the height the stack ends up needing so the last notes never paint over the next part.
      prose.style.minHeight = `${Math.ceil(bottom)}px`;
      anyGutter = true;
    }
    return anyGutter;
  }

  // Two blocks that start on the same visual line would print two margin
  // numbers on top of each other; keep the first. Re-run whenever the text reflows.
  function dedupeLineNumbers() {
    if (state.view !== 'passage') return;
    let prevTop = null;
    for (const el of root.querySelectorAll('.lineno')) {
      el.classList.remove('lineno--dup');
      const top = Math.round(el.getBoundingClientRect().top);
      if (prevTop != null && Math.abs(top - prevTop) < 2) el.classList.add('lineno--dup');
      else prevTop = top;
    }
  }
  const wide = matchMedia('(min-width: 768px)');
  let reflowRaf = 0;
  const scheduleReflow = () => { cancelAnimationFrame(reflowRaf); reflowRaf = requestAnimationFrame(reflow); };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(scheduleReflow);
    ro.observe(root);
    if (root.parentElement) ro.observe(root.parentElement);
  }
  wide.addEventListener('change', scheduleReflow);
  if (document.fonts?.ready) document.fonts.ready.then(scheduleReflow);

  function announce() {
    const u = state.units[state.current];
    if (!u || !live) return;
    live.textContent = `Sentence ${state.current + 1} of ${state.units.length}${u.line_no != null ? `, line ${u.line_no}` : ''}. ${u.la}`;
  }

  /* --- events (delegated) ----------------------------------------- */
  function wordFrom(el) {
    const unitEl = el.closest('[data-id], [data-for]');
    const hlEl = el.closest('.hl');
    return {
      form: el.dataset.form, text: el.textContent, el,
      unitId: unitEl?.dataset.id ?? unitEl?.dataset.for ?? state.units[state.current]?.id,
      hl: hlEl ? { label: hlEl.dataset.hlLabel, note: hlEl.dataset.hlNote, text: hlEl.dataset.hlText } : null,
    };
  }
  root.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (w) { setCurrentFrom(w); emit('word', wordFrom(w)); return; }
    const nm = e.target.closest('.notemark');
    if (nm) { setCurrentFrom(nm); emit('note', { unit: state.byId.get(nm.dataset.noteFor), el: nm }); return; }
    const pb = e.target.closest('.playbtn');
    if (pb) { emit('play', { unitId: pb.dataset.play, weekN: state.week?.n }); return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) { api.goTo(state.current + Number(nav.dataset.nav)); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('.w') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setCurrentFrom(e.target);
      emit('word', wordFrom(e.target));
    }
  });
  function setCurrentFrom(el) {
    const unitEl = el.closest('[data-order]');
    if (unitEl) state.current = Number(unitEl.dataset.order);
  }

  // Swipe between sentences on touch.
  let touch = null;
  root.addEventListener('touchstart', (e) => { if (state.view === 'sentence') touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (!touch || state.view !== 'sentence') return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) api.goTo(state.current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  /* --- public API --------------------------------------------------- */
  const api = {
    on,
    /** Replace the week. `extra.audio` / `extra.lookups` are applied before the single render. */
    setWeek(week, units, highlights, extra = {}) {
      if ('audio' in extra) state.audio = extra.audio instanceof Set ? extra.audio : !!extra.audio;
      if (extra.lookups) { state.lookups = extra.lookups; state.seen = activeUnderlines(extra.lookups); }
      state.week = week;
      state.units = [...units].sort((a, b) => a.order - b.order);
      state.byId = new Map(state.units.map((u) => [u.id, u]));
      state.tokens.clear();
      state.marginTokens.clear();
      state.hl.clear();
      const byUnit = new Map();
      for (const hl of highlights ?? []) (byUnit.get(hl.unit_id) ?? byUnit.set(hl.unit_id, []).get(hl.unit_id)).push(hl);
      for (const [id, rows] of byUnit) {
        const u = state.byId.get(id);
        if (!u) { console.warn('[reader] highlight for unknown unit', id); continue; }
        const { ranges, missing } = resolveHighlights(u.la, rows);
        if (missing.length) console.warn('[reader] unresolved highlights in', id, missing.map((m) => m.text));
        state.hl.set(id, ranges);
      }
      state.current = Math.min(state.current, Math.max(0, state.units.length - 1));
      render();
    },
    setLookups(map) {
      state.lookups = map;
      state.seen = activeUnderlines(map);
      if (state.view === 'sentence') { render(); return; }
      for (const el of root.querySelectorAll('.w')) el.classList.toggle('w--seen', state.seen.has(el.dataset.form));
    },
    setView(view) {
      if (view === state.view) return;
      state.view = view;
      render();
      if (view === 'sentence') announce();
      else api.scrollToCurrent();
    },
    getView: () => state.view,
    goTo(order) {
      if (order < 0 || order >= state.units.length) return;
      state.current = order;
      if (state.view === 'sentence') {
        // Keep keyboard focus on the same Next/Previous control across the re-render.
        const nav = document.activeElement?.closest?.('[data-nav]')?.dataset.nav;
        render();
        announce();
        const sentence = root.querySelector('.sentence');
        const target = (nav && root.querySelector(`[data-nav="${nav}"]:not([disabled])`)) || sentence;
        target?.focus({ preventScroll: true });
        sentence?.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
      }
      emit('navigate', { unit: state.units[order], order });
    },
    next: () => api.goTo(state.current + 1),
    prev: () => api.goTo(state.current - 1),
    currentUnit: () => state.units[state.current],
    scrollToCurrent() {
      const el = root.querySelector(`[data-order="${state.current}"]`);
      el?.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
    },
    /** E's hook: mark the unit now playing (null clears). */
    setPlayingUnit(unitId) {
      state.playing = unitId;
      root.querySelector('.is-playing')?.classList.remove('is-playing');
      if (!unitId) return;
      const el = root.querySelector(`[data-id="${CSS.escape(unitId)}"]`);
      if (el) { el.classList.add('is-playing'); el.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' }); }
    },
    /** Show per-unit play buttons: false, true (all units) or a Set of aligned unit ids. */
    setAudioAvailable(flag) {
      const next = flag instanceof Set ? flag : !!flag;
      if (next === state.audio) return;
      state.audio = next;
      render();
    },
    rerender: render,
    /** Re-measure margin notes and line numbers (after a display toggle or font change). */
    reflow: scheduleReflow,
    unitElement: (unitId) => root.querySelector(`[data-id="${CSS.escape(unitId)}"]`),
  };
  return api;
}
