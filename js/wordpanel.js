// Word popup (phone, anchored at the word) / side panel (tablet + desktop).
// Renders learner-first entries per PROMPT.md §2, grammar-focus notes and
// per-sentence notes. One <dialog> (modal, focus-trapped, Esc closes) and
// one <aside>; which one is used depends on the viewport.

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

export function createWordPanel({ dialog, aside, layout, lookup, describe, paradigm, store, getSettings, getLookupRecord, entryIndex, onLookupsChanged, live }) {
  const wide = matchMedia('(min-width: 768px)');
  let anchor = null;
  let current = null;           // { kind:'word', form, text, unitId, hl, result, index } | { kind:'note', unit }
  const emptyState = aside.firstElementChild?.cloneNode(true) ?? document.createElement('div');
  const resetAside = () => aside.replaceChildren(emptyState.cloneNode(true));

  const isWide = () => wide.matches;
  const hostEl = () => (isWide() ? aside : dialog);

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

  function close() {
    if (dialog.open) { dialog.close(); return; }   // 'close' handler restores focus
    if (layout.dataset.panel === 'open') {
      layout.dataset.panel = 'closed';
      resetAside();
      current = null;
      anchor?.focus?.();
    }
  }
  dialog.addEventListener('close', () => { current = null; anchor?.focus?.(); });
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

  function focusBlock(hl) {
    if (!hl) return null;
    return h('section', { class: 'focus', 'aria-label': 'Grammar focus' },
      h('p', { class: 'focus__label', text: hl.label }),
      h('p', { class: 'focus__note', text: hl.note }));
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

  function entryContent() {
    const { form, text, hl, result, index } = current;
    const settings = getSettings();
    const root = h('div', { class: 'panel__content entry', tabindex: '-1' });
    root.append(closeButton());
    if (hl) root.append(focusBlock(hl));
    root.append(h('h2', { class: 'entry__form', lang: 'la', text: text }));
    if (result.enclitic && ENCLITIC[result.enclitic]) root.append(h('p', { class: 'entry__enclitic', text: ENCLITIC[result.enclitic] }));

    if (!result.entries.length) {
      root.append(h('p', { class: 'entry__meaning entry__meaning--miss', text: 'Not in the dictionary' }));
      if (navigator.onLine) {
        root.append(h('p', { class: 'entry__fallback' },
          h('a', { href: `https://logeion.uchicago.edu/${encodeURIComponent(form)}`, target: '_blank', rel: 'noopener', text: 'Look it up on Logeion' }),
          h('span', { class: 'entry__ext', 'aria-hidden': 'true', text: ' ↗' })));
      }
      bindTerms(root);
      return root;
    }

    if (result.entries.length > 1) {
      const sw = h('div', { class: 'entry__switch', role: 'group', 'aria-label': `${text}: ${result.entries.length} entries` });
      result.entries.forEach((e, i) => {
        sw.append(h('button', { type: 'button', class: 'entry__alt', 'aria-pressed': String(i === index), 'data-alt': String(i), text: e.senses?.[0] ?? e.lemma ?? `entry ${i + 1}` }));
      });
      root.append(sw);
    }

    const entry = result.entries[index];
    const d = describe(entry, { compact: !!settings.compact, form });
    // "to/for the labyrinth · in/by the labyrinth" → one reading per line.
    const readings = String(d.meaning ?? '').split(/\s+·\s+/).filter(Boolean);
    root.append(h('p', { class: 'entry__meaning' }, readings.map((r, i) => [i ? h('br') : null, h('span', { class: 'entry__reading', text: r })])));
    if (d.parse) root.append(h('p', { class: 'entry__parse' }, markTerms(d.parse, d.glosses, 'gp')));
    root.append(h('p', { class: 'entry__lemma' },
      h('span', { lang: 'la', class: 'entry__cite', text: d.lemma }),
      d.category ? [h('span', { class: 'entry__sep', 'aria-hidden': 'true', text: ' · ' }), h('span', { class: 'entry__cat' }, markTerms(d.category, d.glosses, 'gc'))] : null));
    if (d.senses?.length) {
      root.append(h('ol', { class: 'entry__senses', 'aria-label': 'Meanings' }, d.senses.map((s) => h('li', { text: s }))));
    }
    if (d.usage) root.append(h('p', { class: 'entry__usage' }, markTerms(d.usage, d.glosses, 'gu')));
    const p = d.paradigm ?? paradigm?.(entry, entry.parses ?? null);
    const pt = renderParadigm(p);
    if (pt) root.append(pt);
    root.append(actions(form));
    bindTerms(root);
    return root;
  }

  /* ---------------------------------------------------- note content */
  function noteContent(unit, title) {
    const root = h('div', { class: 'panel__content note', tabindex: '-1' });
    root.append(closeButton());
    root.append(h('p', { class: 'note__meta', text: title }));
    root.append(h('p', { class: 'note__la', lang: 'la', text: unit.la }));
    root.append(h('p', { class: 'note__text', text: unit.note }));
    return root;
  }

  /* --------------------------------------------------------- events */
  function handle(e) {
    const t = e.target;
    if (t.closest('.panel__close')) { close(); return; }
    const alt = t.closest('[data-alt]');
    if (alt && current?.kind === 'word') { current.index = Number(alt.dataset.alt); entryIndex?.set?.(current.form, current.index); rerender(); return; }
    const act = t.closest('[data-act]');
    if (act && current?.kind === 'word') {
      const form = current.form;
      const fn = { learned: () => store.markLearned(form), unlearn: () => store.unlearn(form), remove: () => store.removeLookup(form) }[act.dataset.act];
      Promise.resolve(fn()).then(async () => {
        await onLookupsChanged();
        if (live) live.textContent = { learned: `${current?.text ?? form} marked as learned`, unlearn: `${current?.text ?? form} back to underlined`, remove: `${current?.text ?? form} removed from your list` }[act.dataset.act];
        if (act.dataset.act === 'remove') close(); else rerender(true);
      });
    }
  }
  dialog.addEventListener('click', handle);
  aside.addEventListener('click', handle);

  function rerender(keepFocus = false) {
    if (!current) return;
    const focused = document.activeElement?.dataset?.act;
    const content = current.kind === 'word' ? entryContent() : noteContent(current.unit, current.title);
    hostEl().replaceChildren(content);
    place(anchor);
    if (keepFocus && focused) (content.querySelector('[data-act]') ?? content).focus();
    else content.focus({ preventScroll: true });
  }

  // Re-home content if the viewport crosses the breakpoint while open.
  wide.addEventListener('change', () => {
    if (!current) return;
    const content = current.kind === 'word' ? entryContent() : noteContent(current.unit, current.title);
    if (dialog.open) dialog.close();
    layout.dataset.panel = 'closed';
    resetAside();
    open(content, anchor, current.kind === 'word' ? `Word: ${current.text}` : 'Grammar note');
  });

  return {
    async showWord({ form, text, unitId, el, hl }) {
      const result = lookup(form);
      const remembered = entryIndex?.get?.(form);
      current = { kind: 'word', form, text, unitId, hl, result, index: remembered != null && result.entries[remembered] ? remembered : 0 };
      if (result.entries.length) {
        // Tapping a yellow (looked-up, not yet learned) word clears its underline
        // everywhere: the second look is the learner saying "I know this now".
        const rec = getLookupRecord(form);
        if (rec && !rec.learned_at) await store.markLearned(form);
        else await store.addLookup(form, unitId);
        await onLookupsChanged();
      }
      if (!current || current.form !== form) return;   // closed meanwhile
      open(entryContent(), el, `Word: ${text}`);
    },
    showNote({ unit, el }) {
      const ref = /:(\d+)\.(\d+)$/.exec(unit.id);
      current = { kind: 'note', unit, title: ref ? `Note · line ${unit.line_no ?? ref[1]}, sentence ${ref[2]}` : 'Note' };
      open(noteContent(unit, current.title), el, 'Grammar note');
    },
    refresh() { if (current?.kind === 'word') rerender(true); },
    close,
    isOpen: () => dialog.open || layout.dataset.panel === 'open',
  };
}
