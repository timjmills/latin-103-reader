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
    audio: false, playing: null, tokens: new Map(),
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function tokensFor(unit) {
    if (!state.tokens.has(unit.id)) state.tokens.set(unit.id, tokenize(unit.la));
    return state.tokens.get(unit.id);
  }

  /* --- Latin text → spans ------------------------------------------ */
  function renderLatin(unit) {
    const frag = document.createDocumentFragment();
    const groups = segmentUnit(tokensFor(unit), state.hl.get(unit.id) ?? []);
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
        unitEl.append(...[la, noteMark(u), playButton(u), h('span', { class: 'en', lang: 'en', text: u.en })].filter(Boolean));
        prose.append(unitEl);
        if (i < units.length - 1) prose.append(' ');
      });
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
    dedupeLineNumbers();
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
  let reflow = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { cancelAnimationFrame(reflow); reflow = requestAnimationFrame(dedupeLineNumbers); }).observe(root);
  }

  function announce() {
    const u = state.units[state.current];
    if (!u || !live) return;
    live.textContent = `Sentence ${state.current + 1} of ${state.units.length}${u.line_no != null ? `, line ${u.line_no}` : ''}. ${u.la}`;
  }

  /* --- events (delegated) ----------------------------------------- */
  function wordFrom(el) {
    const unitEl = el.closest('[data-id]');
    const hlEl = el.closest('.hl');
    return {
      form: el.dataset.form, text: el.textContent, el,
      unitId: unitEl?.dataset.id ?? state.units[state.current]?.id,
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
    unitElement: (unitId) => root.querySelector(`[data-id="${CSS.escape(unitId)}"]`),
  };
  return api;
}
