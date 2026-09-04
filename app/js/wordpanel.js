// Word popup (phone, anchored at the word) / side panel (tablet + desktop).
// Renders learner-first entries per PROMPT.md §2, grammar-focus notes and
// per-sentence notes. One <dialog> (modal, focus-trapped, Esc closes) and
// one <aside>; which one is used depends on the viewport.
//
// From 768px the aside holds a *stack* for the current sentence: its grammar
// note (if any), the grammar-focus highlights tapped in it and every word
// looked up in it, each a collapsed row that expands in place. The stack is
// remembered per sentence for the session (`stacks`), so coming back to a
// sentence restores its rows. Phones keep the one-entry popup.

import { plainDisclosure, unitRef } from './reader.js';

const ENCLITIC = { que: '-que "and" is attached to the end', ne: '-ne turns the sentence into a yes/no question', ve: '-ve "or" is attached to the end' };

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
};

/* ------------------------------------------------------- pure: stack */
// A row is { kind: 'note', unit } | { kind: 'hl', hl } | { kind: 'word', form, text, unitId, hl, result, index }.
const KIND_ORDER = { note: 0, hl: 1, word: 2 };

/** Identity of a row inside one sentence's stack: one note, one row per highlight, one per form. Pure. */
export function rowKey(row) {
  if (row.kind === 'note') return 'note';
  if (row.kind === 'hl') return `hl:${row.hl?.label ?? ''}␟${row.hl?.text ?? ''}`;
  return `word:${row.form}`;
}

/**
 * The stack with `row` added: the note first, then highlights, then words —
 * within a kind in the order the words stand in the sentence (`pos`, the
 * character offset; highlights use their span start), so the panel reads
 * top to bottom like the sentence itself. Rows without a position go last in
 * tap order. A row already present (same key) is left where it is and the
 * same array comes back. Pure.
 */
export function stackWith(rows, row) {
  const key = rowKey(row);
  if (rows.some((r) => rowKey(r) === key)) return rows;
  const at = (r) => (Number.isFinite(r.pos) ? r.pos : Number.isFinite(r.hl?.start) ? r.hl.start : Infinity);
  return [...rows, row].sort((a, b) => ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) || (at(a) - at(b)));
}

/** The stack without the row whose key is `key`. Pure. */
export function stackWithout(rows, key) {
  return rows.filter((r) => rowKey(r) !== key);
}

/**
 * The panel header for a sentence: "Pars I · line 4, sentence 2" when the
 * text has line numbers, otherwise the id's own tail ("b3.2" for w07:b3.2). Pure.
 */
export function sentenceTitle(unit, { hasLineNumbers = true } = {}) {
  if (!unit) return 'This sentence';
  const ref = unitRef(unit.id);
  let where;
  if (ref && hasLineNumbers) where = `line ${unit.line_no ?? ref.line}, sentence ${ref.n}`;
  else {
    const tail = String(unit.id ?? '').split(':').pop();
    where = tail && tail !== String(unit.id) ? tail : unit.order != null ? `sentence ${unit.order + 1}` : 'sentence';
  }
  return unit.part ? `${unit.part} · ${where}` : where;
}

/** The first line of a note, for the collapsed row (CSS shortens it further). Pure. */
export function firstLine(text) {
  return String(text ?? '').split('\n').map((s) => s.trim()).find(Boolean) ?? '';
}

/* -------------------------------------------------------- pure: terms */
/** Wrap every gloss term found in `text` with a tappable term button. Pure. */
export function markTerms(text, glosses, idBase = 'g') {
  const frag = document.createDocumentFragment();
  if (!glosses?.length) { frag.append(text); return frag; }
  const terms = [...glosses].sort((a, b) => b.term.length - a.term.length);
  const re = new RegExp(`(^|[^\\p{L}])(${terms.map((g) => g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'giu');
  let last = 0, n = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1].length;
    frag.append(text.slice(last, start));
    const g = terms.find((t) => t.term.toLowerCase() === m[2].toLowerCase());
    const id = `${idBase}-${n++}`;
    frag.append(h('span', { class: 'term' },
      h('button', { type: 'button', class: 'term__btn', 'aria-describedby': id, text: m[2] }),
      h('span', { class: 'term__tip', role: 'tooltip', id, text: g.gloss })));
    last = start + m[2].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** One paradigm cell: stem‑ending, an alternate after " / ", an em dash when empty. */
function cellContent(c) {
  if (!c || c.empty || (c.text === '—' && !c.ending)) return '—';
  const main = c.stem != null && c.ending != null && (c.stem || c.ending)
    ? [c.stem ? h('span', { class: 'pt__stem', text: c.stem }) : null, h('span', { class: 'pt__ending', text: c.ending })]
    : [c.text ?? '—'];
  return c.alt ? [...main, h('span', { class: 'pt__alt', text: ` / ${c.alt}` })] : main;
}

export function renderParadigm(p) {
  if (!p) return null;
  const details = h('details', { class: 'paradigm' },
    h('summary', { class: 'paradigm__summary' },
      h('span', { class: 'paradigm__label' }, 'Full paradigm', p.title ? h('span', { class: 'paradigm__title', lang: 'la', text: ` — ${p.title}` }) : null)));
  if (p.note) details.append(h('p', { class: 'paradigm__note', text: p.note }));
  for (const s of p.sections ?? []) {
    const table = h('table', { class: 'pt' });
    if (s.title) table.append(h('caption', { class: 'pt__caption', text: s.title }));
    if (s.headers?.length) table.append(h('thead', {}, h('tr', {}, s.headers.map((hd) => h('th', { scope: 'col', text: hd })))));
    const body = h('tbody');
    for (const r of s.rows) {
      body.append(h('tr', {}, h('th', { scope: 'row', text: r.label }),
        r.cells.map((c) => h('td', { class: 'pt__cell' + (c.hit ? ' is-hit' : '') + (c.empty ? ' is-empty' : ''), lang: 'la' }, cellContent(c)))));
    }
    table.append(body);
    details.append(h('div', { class: 'pt__scroll' }, table));
  }
  return details;
}

/**
 * `plain` — `{ get() → bool, set(bool) }` for settings.plainOpen: whether the
 * "In plain words" disclosure under a note (sentence note, grammar-focus
 * note) starts open. Every disclosure writes the learner's last choice back.
 * `getUnit(unitId)` / `getWeek()` (optional) let the stack name its sentence
 * and seed the note row before the † has been tapped.
 */
export function createWordPanel({ dialog, aside, layout, lookup, describe, paradigm, store, getSettings, getLookupRecord, entryIndex, onLookupsChanged, onWord, live, plain = null, getUnit = null, getWeek = null, getTokens = null, getLookups = null, getHighlights = null }) {
  const wide = matchMedia('(min-width: 768px)');
  let anchor = null;
  // The one thing the popup shows (phones), or a temporary single view in the
  // aside (the section summary). Null while the aside shows the stack.
  let current = null;           // { kind:'word', form, text, unitId, hl, result, index } | { kind:'note', unit, title } | { kind:'summary', title, body, unitId }
  const stacks = new Map();     // unitId → rows[] — every sentence's rows, for the session
  let stackUnit = null;         // the sentence whose stack the aside shows
  const expanded = new Set();   // expanded rows (rowKey) — several may be open; rows never fold on their own
  let seq = 0;                  // ids for aria-controls
  let switching = false;        // the breakpoint handler closes the dialog itself
  const emptyState = aside.firstElementChild?.cloneNode(true) ?? document.createElement('div');
  const resetAside = () => aside.replaceChildren(emptyState.cloneNode(true));

  const isWide = () => wide.matches;
  const hostEl = () => (isWide() ? aside : dialog);
  const asideOpen = () => layout.dataset.panel === 'open';

  function place(anchorEl) {
    if (!anchorEl || isWide()) return;
    const r = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
    const width = Math.min(380, vw - pad * 2);
    dialog.style.width = `${width}px`;
    dialog.style.maxHeight = `${Math.round(vh * 0.6)}px`;
    let hgt = dialog.offsetHeight;
    const below = vh - r.bottom - pad * 2;
    const above = r.top - pad * 2;
    let top;
    if (hgt <= below) top = r.bottom + pad;
    else if (hgt <= above) top = r.top - hgt - pad;
    else {
      // Neither side fits: take the roomier side and let the popup scroll.
      const side = Math.max(below, above, 160);
      dialog.style.maxHeight = `${Math.round(side)}px`;
      hgt = dialog.offsetHeight;
      top = below >= above ? r.bottom + pad : Math.max(pad, r.top - hgt - pad);
    }
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(pad, Math.min(left, vw - width - pad));
    dialog.style.top = `${Math.round(top)}px`;
    dialog.style.left = `${Math.round(left)}px`;
  }

  /** Show `content` in the host for this viewport (single view: the popup, or a temporary aside view). */
  function open(content, anchorEl, label) {
    anchor = anchorEl ?? anchor;
    if (label) dialog.setAttribute('aria-label', label);
    const host = hostEl();
    host.replaceChildren(content);
    if (isWide()) {
      if (dialog.open) dialog.close();
      layout.dataset.panel = 'open';
      aside.hidden = false;
    } else {
      layout.dataset.panel = 'closed';
      if (!dialog.open) dialog.showModal();
      place(anchorEl);
    }
    content.focus({ preventScroll: true });
  }

  // Focus back in the text: the tapped element, or (after a sentence-view
  // re-render has replaced it) the same word / the sentence / the reader.
  function focusText() {
    if (anchor?.isConnected) { anchor.focus?.(); return; }
    const reader = document.getElementById('reader');
    if (!reader) return;
    const form = anchor?.dataset?.form;
    const same = form ? reader.querySelector(`.w[data-form="${CSS.escape(form)}"]`) : null;
    (same ?? reader.querySelector('.sentence') ?? reader).focus?.({ preventScroll: true });
  }

  function close() {
    if (dialog.open) { dialog.close(); return; }   // 'close' handler restores focus
    if (asideOpen()) {
      layout.dataset.panel = 'closed';
      resetAside();
      current = null;
      stackUnit = null;
      expanded.clear();
      focusText();
    }
  }
  dialog.addEventListener('close', () => { if (switching) return; current = null; focusText(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  // Term tooltips: the tip is a role=tooltip the button already describes;
  // a tap pins it open (touch has no hover), a second tap or a tap elsewhere closes it.
  function bindTerms(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.term__btn');
      const open = [...el.querySelectorAll('.term__btn.is-open')];
      open.forEach((x) => x !== b && x.classList.remove('is-open'));
      if (b) b.classList.toggle('is-open');
    });
  }

  /* ------------------------------------------------------ word entry */
  function closeButton() {
    return h('button', { type: 'button', class: 'panel__close', 'aria-label': 'Close' }, h('span', { 'aria-hidden': 'true', text: '×' }));
  }

  /** The grammar-focus note; `label: false` when the row head already names it. */
  function focusBlock(hl, { label = true } = {}) {
    if (!hl) return null;
    return h('section', { class: 'focus', 'aria-label': 'Grammar focus' },
      label ? h('p', { class: 'focus__label', text: hl.label }) : null,
      h('p', { class: 'focus__note', text: hl.note }),
      plainDisclosure(hl.simple, plain));
  }

  function actions(form) {
    const rec = getLookupRecord(form);
    const row = h('div', { class: 'entry__actions' });
    if (!rec) return row;
    if (rec.learned_at) {
      row.append(h('span', { class: 'entry__learned', text: 'Learned' }),
        h('button', { type: 'button', class: 'btn btn--quiet', 'data-act': 'unlearn', text: 'Unlearn' }));
    } else {
      row.append(h('button', { type: 'button', class: 'btn', 'data-act': 'learned', text: 'Mark as learned' }));
    }
    row.append(h('button', { type: 'button', class: 'btn btn--quiet', 'data-act': 'remove', text: 'Forget' }));
    return row;
  }

  const entryOf = (item) => item.result.entries[item.index] ?? item.result.entries[0] ?? null;
  const describeItem = (item) => {
    const entry = entryOf(item);
    return entry ? describe(entry, { compact: !!getSettings().compact, form: item.form }) : null;
  };

  /**
   * The parts of a word entry, top to bottom. In the stack (`stack: true`)
   * the row head already shows the form and the meaning, and a highlight has
   * its own row, so those three are left out.
   */
  function entryParts(item, { stack = false } = {}) {
    const { form, text, hl, result } = item;
    const parts = [];
    if (hl && !stack) parts.push(focusBlock(hl));
    if (!stack) parts.push(h('h2', { class: 'entry__form', lang: 'la', text }));
    if (result.enclitic && ENCLITIC[result.enclitic]) parts.push(h('p', { class: 'entry__enclitic', text: ENCLITIC[result.enclitic] }));

    if (!result.entries.length) {
      if (!stack) parts.push(h('p', { class: 'entry__meaning entry__meaning--miss', text: 'Not in the dictionary' }));
      if (navigator.onLine) {
        parts.push(h('p', { class: 'entry__fallback' },
          h('a', { href: `https://logeion.uchicago.edu/${encodeURIComponent(form)}`, target: '_blank', rel: 'noopener', text: 'Look it up on Logeion' }),
          h('span', { class: 'entry__ext', 'aria-hidden': 'true', text: ' ↗' })));
      }
      return parts;
    }

    if (result.entries.length > 1) {
      const sw = h('div', { class: 'entry__switch', role: 'group', 'aria-label': `${text}: ${result.entries.length} entries` });
      result.entries.forEach((e, i) => {
        sw.append(h('button', { type: 'button', class: 'entry__alt', 'aria-pressed': String(i === item.index), 'data-alt': String(i), text: e.senses?.[0] ?? e.lemma ?? `entry ${i + 1}` }));
      });
      parts.push(sw);
    }

    const d = describeItem(item);
    if (!stack) {
      // "to/for the labyrinth · in/by the labyrinth" → one reading per line.
      const readings = String(d.meaning ?? '').split(/\s+·\s+/).filter(Boolean);
      parts.push(h('p', { class: 'entry__meaning' }, readings.map((r, i) => [i ? h('br') : null, h('span', { class: 'entry__reading', text: r })])));
    }
    if (d.parse) parts.push(h('p', { class: 'entry__parse' }, markTerms(d.parse, d.glosses, 'gp')));
    parts.push(h('p', { class: 'entry__lemma' },
      h('span', { lang: 'la', class: 'entry__cite', text: d.lemma }),
      d.category ? [h('span', { class: 'entry__sep', 'aria-hidden': 'true', text: ' · ' }), h('span', { class: 'entry__cat' }, markTerms(d.category, d.glosses, 'gc'))] : null));
    if (d.senses?.length) {
      parts.push(h('ol', { class: 'entry__senses', 'aria-label': 'Meanings' }, d.senses.map((s) => h('li', { text: s }))));
    }
    if (d.usage) parts.push(h('p', { class: 'entry__usage' }, markTerms(d.usage, d.glosses, 'gu')));
    const entry = entryOf(item);
    const p = d.paradigm ?? paradigm?.(entry, entry.parses ?? null);
    const pt = renderParadigm(p);
    if (pt) parts.push(pt);
    parts.push(actions(form));
    return parts;
  }

  function entryContent() {
    const root = h('div', { class: 'panel__content entry', tabindex: '-1' });
    root.append(closeButton(), ...entryParts(current));
    bindTerms(root);
    return root;
  }

  /* ---------------------------------------------------- note content */
  const noteTitle = (unit) => {
    const ref = unitRef(unit.id);
    return ref ? `Note · line ${unit.line_no ?? ref.line}, sentence ${ref.n}` : 'Note';
  };
  function noteContent(unit, title) {
    const root = h('div', { class: 'panel__content note', tabindex: '-1' });
    root.append(closeButton());
    root.append(h('p', { class: 'note__meta', text: title }));
    root.append(h('p', { class: 'note__la', lang: 'la', text: unit.la }));
    root.append(h('p', { class: 'note__text', text: unit.note }));
    const pd = plainDisclosure(unit.note_simple, plain);
    if (pd) root.append(pd);
    return root;
  }

  /* ------------------------------------------------- section summary */
  // The same content as the passage-view disclosure (reader.summaryBody):
  // English, "In Latin", the Latin as tappable words. A tap on one of those
  // words hands the lookup back through `onWord` (anchored on the button that
  // opened the summary, so the phone popup stays put). In the aside it is a
  // temporary view over the stack: "Back" returns to the sentence's rows.
  function summaryContent(title, body, { back = false } = {}) {
    const root = h('div', { class: 'panel__content note note--summary', tabindex: '-1' });
    root.append(closeButton());
    if (back) root.append(h('button', { type: 'button', class: 'btn btn--quiet stack__back', 'data-back': '' }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'Back to the sentence'));
    root.append(h('p', { class: 'note__meta', text: title }));
    root.append(body);
    return root;
  }
  function summaryWord(w) {
    if (!w || current?.kind !== 'summary' || !onWord) return false;
    onWord({ form: w.dataset.form, text: w.textContent, unitId: current.unitId ?? null, el: anchor, hl: null });
    return true;
  }

  /* ---------------------------------------------------------- stack */
  const hasLineNumbers = () => getWeek?.()?.has_line_numbers !== false;
  const unitOf = (unitId) => getUnit?.(unitId) ?? stacks.get(unitId)?.find((r) => r.kind === 'note')?.unit ?? null;

  /** The sentence's rows so far; a sentence with a grammar note starts with the note row. */
  function ensureStack(unitId) {
    if (!stacks.has(unitId)) {
      const unit = getUnit?.(unitId);
      stacks.set(unitId, unit?.note ? [{ kind: 'note', unit }] : []);
    }
    seedStack(unitId);
    return stacks.get(unitId);
  }
  /**
   * The stack already holds every word of this sentence the learner has looked
   * up and not yet marked learned (in sentence order), so the panel is
   * populated the moment a sentence becomes current — nothing needs re-tapping.
   */
  function seedStack(unitId) {
    let cur = stacks.get(unitId) ?? [];
    // Every grammar-focus highlight in the sentence, in text order.
    for (const h of getHighlights?.(unitId) ?? []) {
      cur = stackWith(cur, { kind: 'hl', hl: { label: h.label, note: h.note, text: h.text, simple: h.simple ?? null, start: h.start } });
    }
    stacks.set(unitId, cur);
    const toks = getTokens?.(unitId);
    const map = getLookups?.();
    if (!toks?.length || !map?.size) return;
    const seen = new Set();
    for (const t of toks) {
      if (!t.form || seen.has(t.form)) continue;
      const rec = map.get(t.form);
      if (!rec || rec.learned_at) continue;
      seen.add(t.form);
      const result = lookup(t.form);
      if (!result.entries.length) continue;
      const remembered = entryIndex?.get?.(t.form);
      cur = stackWith(cur, { kind: 'word', form: t.form, text: t.text, unitId, hl: null, result, pos: t.start,
                             index: remembered != null && result.entries[remembered] ? remembered : 0 });
    }
    stacks.set(unitId, cur);
  }
  function addRows(unitId, rows) {
    let cur = ensureStack(unitId);
    for (const r of rows) cur = stackWith(cur, r);
    stacks.set(unitId, cur);
  }
  const rowByKey = (key) => (stacks.get(stackUnit) ?? []).find((r) => rowKey(r) === key) ?? null;
  const rowEl = (key) => aside.querySelector(`[data-row="${CSS.escape(key)}"]`);

  function rowHead(row) {
    if (row.kind === 'note') {
      return [
        h('span', { class: 'stack__mark', 'aria-hidden': 'true', text: '†' }),
        h('span', { class: 'visually-hidden', text: 'Grammar note. ' }),
        h('span', { class: 'stack__line', text: firstLine(row.unit.note) }),
      ];
    }
    if (row.kind === 'hl') {
      return [
        h('span', { class: 'visually-hidden', text: 'Grammar focus. ' }),
        h('span', { class: 'stack__glow', lang: 'la', text: row.hl.text }),
        h('span', { class: 'stack__label', text: row.hl.label }),
      ];
    }
    const d = row.result.entries.length ? describeItem(row) : null;
    const learned = !!getLookupRecord(row.form)?.learned_at;
    return [
      h('span', { class: 'stack__form', lang: 'la', text: row.text }),
      h('span', { class: 'stack__sep', 'aria-hidden': 'true', text: ' — ' }),
      h('span', { class: 'stack__meaning' + (d ? '' : ' stack__meaning--miss'), text: d ? d.meaning : 'Not in the dictionary' }),
      learned ? h('span', { class: 'stack__learned', text: 'learned' }) : null,
    ];
  }
  function rowBody(row) {
    if (row.kind === 'note') {
      return [
        h('p', { class: 'note__la', lang: 'la', text: row.unit.la }),
        h('p', { class: 'note__text', text: row.unit.note }),
        plainDisclosure(row.unit.note_simple, plain),
      ];
    }
    if (row.kind === 'hl') return focusBlock(row.hl, { label: false });
    return entryParts(row, { stack: true });
  }
  function renderRow(row) {
    const key = rowKey(row);
    const open = expanded.has(key);
    const id = `stack-row-${++seq}`;
    const learned = row.kind === 'word' && !!getLookupRecord(row.form)?.learned_at;
    return h('li', { class: `stack__row stack__row--${row.kind}` + (open ? ' is-open' : '') + (learned ? ' is-learned' : ''), 'data-row': key },
      h('button', { type: 'button', class: 'stack__btn', 'aria-expanded': String(open), 'aria-controls': id }, rowHead(row)),
      h('div', { class: 'stack__body', id, hidden: !open }, open ? rowBody(row) : null));
  }
  function stackContent() {
    const rows = stacks.get(stackUnit) ?? [];
    const root = h('div', { class: 'panel__content stack', tabindex: '-1' });
    root.append(closeButton());
    root.append(h('p', { class: 'stack__title', text: sentenceTitle(unitOf(stackUnit), { hasLineNumbers: hasLineNumbers() }) }));
    if (!rows.length) root.append(h('p', { class: 'stack__hint', text: 'Nothing looked up here yet — tap any word in the sentence.' }));
    else root.append(h('ul', { class: 'stack__list' }, rows.map(renderRow)));
    bindTerms(root);
    return root;
  }
  /**
   * Show the stack for `unitId` in the aside. `focus`: a row key to focus
   * (scrolled into view), 'root' for the panel content, or null to leave
   * focus where it is — unless it was inside the aside, which is being replaced.
   */
  function showStack(unitId, { focus = null, expand = null } = {}) {
    const inside = aside.contains(document.activeElement);
    current = null;
    if (unitId !== stackUnit) expanded.clear();   // another sentence: its rows start collapsed
    if (expand) expanded.add(expand);
    stackUnit = unitId;
    ensureStack(unitId);
    const content = stackContent();
    if (dialog.open) dialog.close();
    aside.replaceChildren(content);
    layout.dataset.panel = 'open';
    aside.hidden = false;
    const target = focus && focus !== 'root' ? rowEl(focus)?.querySelector('.stack__btn') : null;
    if (target) { target.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true }); }
    else if (focus || inside) content.focus({ preventScroll: true });
  }
  /** Re-render one row in place (expanded state, learned state, chosen entry), keeping focus on the equivalent control. */
  function swapRow(key) {
    const row = rowByKey(key);
    const old = rowEl(key);
    if (!row || !old) return null;
    const active = document.activeElement;
    const inside = old.contains(active);
    const fresh = renderRow(row);
    old.replaceWith(fresh);
    if (inside) {
      const want = active.dataset.act != null ? `[data-act="${active.dataset.act}"]` : active.dataset.alt != null ? `[data-alt="${active.dataset.alt}"]` : null;
      const next = (want && fresh.querySelector(want)) || (active.dataset.act != null && fresh.querySelector('[data-act]')) || fresh.querySelector('.stack__btn');
      next?.focus({ preventScroll: true });
    }
    return fresh;
  }
  function toggleRow(key) {
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);   // other rows stay as they are
    const li = swapRow(key);
    if (expanded.has(key) && li) li.scrollIntoView({ block: 'nearest' });
  }
  function refreshStack() {
    if (!isWide() || !asideOpen() || current || stackUnit == null) return;
    for (const r of stacks.get(stackUnit) ?? []) swapRow(rowKey(r));
  }
  function removeRow(key) {
    stacks.set(stackUnit, stackWithout(stacks.get(stackUnit) ?? [], key));
    expanded.delete(key);
    const old = rowEl(key);
    if (!old) return;
    const inside = old.contains(document.activeElement);
    const next = old.nextElementSibling ?? old.previousElementSibling;
    if (!(stacks.get(stackUnit) ?? []).length) { showStack(stackUnit, { focus: inside ? 'root' : null }); return; }
    old.remove();
    if (inside) (next?.querySelector('.stack__btn') ?? aside.querySelector('.panel__content'))?.focus({ preventScroll: true });
  }

  /* --------------------------------------------------------- events */
  /** The word item a control inside the panel belongs to: its stack row, or the popup's entry. */
  function itemFor(el) {
    const li = el.closest('[data-row]');
    if (li) { const r = rowByKey(li.dataset.row); return r?.kind === 'word' ? r : null; }
    return current?.kind === 'word' ? current : null;
  }
  function handle(e) {
    const t = e.target;
    if (t.closest('.panel__close')) { close(); return; }
    if (t.closest('[data-back]')) { if (stackUnit != null) showStack(stackUnit, { focus: 'root' }); return; }
    const rowBtn = t.closest('.stack__btn');
    if (rowBtn) { toggleRow(rowBtn.closest('[data-row]').dataset.row); return; }
    if (summaryWord(t.closest('.w'))) return;
    const alt = t.closest('[data-alt]');
    if (alt) {
      const item = itemFor(alt);
      if (!item) return;
      item.index = Number(alt.dataset.alt);
      entryIndex?.set?.(item.form, item.index);
      if (item === current) rerender(); else swapRow(rowKey(item));
      return;
    }
    const act = t.closest('[data-act]');
    if (act) {
      const item = itemFor(act);
      if (!item) return;
      const form = item.form;
      const fn = { learned: () => store.markLearned(form), unlearn: () => store.unlearn(form), remove: () => store.removeLookup(form) }[act.dataset.act];
      Promise.resolve(fn()).then(async () => {
        await onLookupsChanged();
        if (live) live.textContent = { learned: `${item.text ?? form} marked as learned`, unlearn: `${item.text ?? form} back to underlined`, remove: `${item.text ?? form} removed from your list` }[act.dataset.act];
        if (item === current) { if (act.dataset.act === 'remove') close(); else rerender(true); }
        else if (act.dataset.act === 'remove') removeRow(rowKey(item));
        else swapRow(rowKey(item));
      });
    }
  }
  dialog.addEventListener('click', handle);
  aside.addEventListener('click', handle);
  const keyHandle = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.w') && summaryWord(e.target)) { e.preventDefault(); return; }
    // Rows: Up/Down (Home/End) move between them. Stopped here so sentence
    // view's document-level arrow navigation never also fires.
    if (e.target.matches?.('.stack__btn')) {
      const btns = [...aside.querySelectorAll('.stack__btn')];
      const i = btns.indexOf(e.target);
      const next = { ArrowDown: Math.min(btns.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: btns.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      btns[next]?.focus();
    }
  };
  dialog.addEventListener('keydown', keyHandle);
  aside.addEventListener('keydown', keyHandle);

  function content() {
    if (current.kind === 'word') return entryContent();
    if (current.kind === 'summary') return summaryContent(current.title, current.body, { back: isWide() && stackUnit != null });
    return noteContent(current.unit, current.title);
  }
  function rerender(keepFocus = false) {
    if (!current) return;
    const focused = document.activeElement?.dataset?.act;
    const content_ = content();
    hostEl().replaceChildren(content_);
    place(anchor);
    if (keepFocus && focused) (content_.querySelector('[data-act]') ?? content_).focus();
    else content_.focus({ preventScroll: true });
  }
  const label = () => (current.kind === 'word' ? `Word: ${current.text}` : current.kind === 'summary' ? current.title : 'Grammar note');

  /** Rows for a word tap: the highlight it sits in (if any), then the word. */
  const wordRows = (item) => [item.hl ? { kind: 'hl', hl: item.hl } : null, item].filter(Boolean);

  // Re-home content if the viewport crosses the breakpoint while open: the
  // popup's entry joins its sentence's stack; the stack's open row (or the
  // temporary view) becomes the popup.
  wide.addEventListener('change', () => {
    if (isWide()) {
      if (!dialog.open || !current) return;
      const item = current;
      switching = true;
      dialog.close();
      switching = false;
      if (item.kind === 'word') { addRows(item.unitId ?? '', wordRows(item)); showStack(item.unitId ?? '', { focus: rowKey(item) }); }
      else if (item.kind === 'note') { addRows(item.unit.id, [{ kind: 'note', unit: item.unit }]); showStack(item.unit.id, { focus: 'note', expand: 'note' }); }
      else { current = item; open(content(), anchor, label()); }
      return;
    }
    if (!asideOpen()) return;
    const last = [...expanded].pop();
    const item = current ?? (last ? rowByKey(last) : null);
    layout.dataset.panel = 'closed';
    resetAside();
    stackUnit = null;
    expanded.clear();
    current = item?.kind === 'note' ? { kind: 'note', unit: item.unit, title: noteTitle(item.unit) } : item?.kind === 'hl' ? null : item;
    if (current) open(content(), anchor, label());
  });

  return {
    async showWord({ form, text, unitId, el, hl }) {
      const result = lookup(form);
      const remembered = entryIndex?.get?.(form);
      const pos = Number(el?.dataset?.start);
      const item = { kind: 'word', form, text, unitId, hl, result, pos: Number.isFinite(pos) ? pos : undefined,
                     index: remembered != null && result.entries[remembered] ? remembered : 0 };
      const toStack = isWide();
      if (!toStack) current = item;
      if (result.entries.length) {
        // The tap cycle: the first tap looks the word up (yellow everywhere); the
        // next tap marks it learned (underline gone); the tap after that puts it
        // back on the learning list — no buttons needed.
        const rec = getLookupRecord(form);
        if (rec && !rec.learned_at) { await store.markLearned(form); if (live) live.textContent = `${text} marked as learned. Tap it again to bring it back.`; }
        else if (rec && rec.learned_at) { await store.unlearn(form); if (live) live.textContent = `${text} is back on your list.`; }
        else await store.addLookup(form, unitId ?? null);   // a word outside any sentence (a section summary) records no unit
        await onLookupsChanged();
      }
      if (toStack) {
        // The word joins its sentence's stack, collapsed: it stays quiet in
        // the panel until its row is pressed. A word in another sentence
        // switches the stack to that sentence.
        const uid = unitId ?? stackUnit ?? '';
        anchor = el ?? anchor;
        addRows(uid, wordRows(item));
        showStack(uid, { focus: rowKey(item) });
        return;
      }
      if (!current || current.form !== form) return;   // closed meanwhile
      open(entryContent(), el, `Word: ${text}`);
    },
    showNote({ unit, el }) {
      if (isWide()) {
        // The † is a toggle: it opens the note row in the sentence's stack, and a
        // second tap on the same † folds it back up (the panel stays).
        anchor = el ?? anchor;
        if (asideOpen() && !current && stackUnit === unit.id && expanded.has('note')) {
          toggleRow('note');
          if (live) live.textContent = 'Grammar note collapsed.';
          return;
        }
        addRows(unit.id, [{ kind: 'note', unit }]);
        showStack(unit.id, { focus: 'note', expand: 'note' });
        return;
      }
      current = { kind: 'note', unit, title: noteTitle(unit) };
      open(noteContent(unit, current.title), el, 'Grammar note');
    },
    /** A part's section summary. `body` is reader.summaryBody(part); `unitId` (may be null) is the part's first sentence, for lookups made inside. */
    showSummary({ part, body, unitId = null, el }) {
      if (!body) return;
      current = { kind: 'summary', title: part ? `${part} · Summary` : 'Section summary', body, unitId };
      open(content(), el, current.title);
    },
    /** Sentence view moved to another sentence: an open stack follows it (a closed panel stays closed). */
    showSentence(unitId, { open = false } = {}) {
      if (!isWide() || unitId == null) return;
      if (!asideOpen() && !open) return;          // in passage view a closed panel stays closed
      if (unitId === stackUnit && !current && asideOpen()) return;
      showStack(unitId);
    },
    /** Escape: a temporary view goes back to the stack, an expanded row collapses, then the panel closes (focus back in the text). */
    escape() {
      if (!isWide() || !asideOpen()) { close(); return; }
      if (current) {
        if (stackUnit != null) showStack(stackUnit, { focus: 'root' }); else close();
        return;
      }
      if (expanded.size) {
        const keys = [...expanded];
        const inside = aside.contains(document.activeElement);
        expanded.clear();
        let li = null;
        for (const key of keys) li = swapRow(key) ?? li;
        if (inside) li?.querySelector('.stack__btn')?.focus({ preventScroll: true });
        return;
      }
      close();
    },
    refresh() { if (current?.kind === 'word') rerender(true); else refreshStack(); },
    close,
    isOpen: () => dialog.open || asideOpen(),
  };
}
