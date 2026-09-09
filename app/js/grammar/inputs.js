// Two inputs for the drills (GRAMMAR-CONTRACT.md "Inputs added"), DOM only,
// same feedback pattern as type / choice / chart / tap (ui.js):
//
//   orderInput({ chunks, scrambled, onSubmit })   tap words into a row (undo by
//     tapping a placed word or the Undo button); drag on pointer devices;
//     keyboard: arrow keys move focus along the bank, Enter / Space places,
//     Backspace undoes the last. Submits an array of chunk indexes.
//   matchInput({ pairs, right, onSubmit })         tap-tap pairs (a word, then a
//     meaning); a paired row can be tapped again to unpair; keyboard: Tab /
//     arrows between buttons, Enter / Space picks. Submits { left: rightIndex }.
//
// Both return { node, focus() }. Every button is ≥ 44 px under a coarse pointer (grammar.css).

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
};
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
const roving = (list, i, dir) => { const n = list.length; if (!n) return; const j = ((i + dir) % n + n) % n; list[j].focus(); };

export function orderInput({ chunks, display = null, scrambled, onSubmit, live = null }) {
  // What a chip *says* may differ from the chunk it stands for: the last word's full stop is not printed on it, so the
  // bank does not announce which word ends the sentence (stage3.js `display`). Judging always uses `chunks`.
  const label = (idx) => (display?.[idx] ?? chunks[idx]);
  const placed = [];                       // chunk indexes in the row
  const bank = h('div', { class: 'g-order__bank', role: 'group', 'aria-label': 'Words to place' });
  const row = h('div', { class: 'g-order__row', role: 'group', 'aria-label': 'Your sentence' });
  const empty = h('span', { class: 'g-order__empty', text: 'Tap the words in order' });
  const undo = h('button', { type: 'button', class: 'btn btn--quiet g-order__undo', text: 'Undo', disabled: true, onclick: () => unplace() });
  const check = h('button', { type: 'submit', class: 'btn btn--primary', text: 'Check', disabled: true });
  const say = (t) => { if (live) live.textContent = t; };
  const bankBtns = new Map();
  const paint = () => {
    // replaceChildren takes varargs, not an array: an array would be stringified into the row.
    row.replaceChildren(...(placed.length ? placed.map((idx, at) => h('button', { type: 'button', class: 'g-order__w is-placed', lang: 'la', text: label(idx), 'aria-label': `${label(idx)}: remove from the sentence`, draggable: finePointer() ? 'true' : null, 'data-at': String(at), onclick: () => unplace(at) })) : [empty]));
    for (const [idx, b] of bankBtns) { b.disabled = placed.includes(idx); b.classList.toggle('is-used', placed.includes(idx)); }
    undo.disabled = !placed.length;
    check.disabled = placed.length !== chunks.length;
  };
  // Two identical words in a row would set the live region to the same string twice, which most readers swallow, so the position is named (m11).
  const place = (idx) => { if (placed.includes(idx)) return; placed.push(idx); paint(); say(`${label(idx)} placed ${placed.length}, ${chunks.length - placed.length} left.`); if (placed.length === chunks.length) check.focus({ preventScroll: true }); else { const next = [...bankBtns.values()].find((b) => !b.disabled); next?.focus({ preventScroll: true }); } };
  const unplace = (at = placed.length - 1) => { if (at < 0 || at >= placed.length) return; const [idx] = placed.splice(at, 1); paint(); say(`${label(idx)} back in the bank, ${chunks.length - placed.length} left.`); bankBtns.get(idx)?.focus({ preventScroll: true }); };
  for (const idx of scrambled) {
    const b = h('button', { type: 'button', class: 'g-order__w', lang: 'la', text: label(idx), 'aria-label': `${label(idx)}: place next`, draggable: finePointer() ? 'true' : null, onclick: () => place(idx) });
    bankBtns.set(idx, b);
    bank.append(b);
  }
  // Keyboard: arrows move along the bank (Home / End to the ends); Enter / Space is the click; Backspace undoes.
  const form = h('form', { class: 'g-order', onsubmit: (e) => { e.preventDefault(); if (placed.length === chunks.length) onSubmit([...placed]); } }, row, bank, h('div', { class: 'g-order__acts' }, check, undo), h('p', { class: 'g-keys', text: 'Arrow keys move between the words; Enter places one; Backspace takes the last one back.' }));
  form.addEventListener('keydown', (e) => {
    const inBank = [...bankBtns.values()].filter((b) => !b.disabled);
    const inRow = [...row.querySelectorAll('button')];
    const list = inBank.includes(e.target) ? inBank : inRow.includes(e.target) ? inRow : null;
    if (!list) return;
    const i = list.indexOf(e.target);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); roving(list, i, 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); roving(list, i, -1); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    // Backspace takes back the word that has focus when one of the placed words does; otherwise the last placed (CR m11).
    else if (e.key === 'Backspace' && placed.length) { e.preventDefault(); unplace(list === inRow && i >= 0 ? i : placed.length - 1); }
  });
  // Drag on pointer devices: a bank word dropped on the row is placed (at the drop point); a placed word dragged back to the bank is removed.
  if (finePointer()) {
    let dragging = null;   // { idx, from: 'bank' | 'row', at }
    form.addEventListener('dragstart', (e) => {
      const b = e.target.closest?.('.g-order__w'); if (!b) return;
      const idx = [...bankBtns.entries()].find(([, el]) => el === b)?.[0];
      dragging = b.dataset.at != null ? { from: 'row', at: Number(b.dataset.at), idx: placed[Number(b.dataset.at)] } : { from: 'bank', idx };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', b.textContent); } catch { /* ignore */ }
    });
    const over = (e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };
    row.addEventListener('dragover', over); bank.addEventListener('dragover', over);
    row.addEventListener('dragenter', () => row.classList.add('is-over'));
    row.addEventListener('dragleave', () => row.classList.remove('is-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('is-over');
      if (!dragging) return;
      const target = e.target.closest?.('.g-order__w');
      let at = target?.dataset.at != null ? Number(target.dataset.at) : placed.length;
      if (dragging.from === 'row') { const [idx] = placed.splice(dragging.at, 1); if (at > dragging.at) at -= 1; placed.splice(at, 0, idx); }
      else if (!placed.includes(dragging.idx)) placed.splice(at, 0, dragging.idx);
      dragging = null; paint();
      say(`${placed.length} of ${chunks.length} placed.`);
    });
    bank.addEventListener('drop', (e) => { e.preventDefault(); if (dragging?.from === 'row') { placed.splice(dragging.at, 1); paint(); } dragging = null; });
    form.addEventListener('dragend', () => { dragging = null; row.classList.remove('is-over'); });
  }
  paint();
  return { node: form, focus: () => bank.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }) };
}

export function matchInput({ pairs, right, onSubmit, live = null, onCells = null }) {
  const chosen = {};              // left index → right index
  const order = [];               // left indexes in the order they were paired: the badge number both halves carry
  let pendingLeft = null;
  let pendingRight = null;
  const say = (t) => { if (live) live.textContent = t; };
  const leftBtns = pairs.map((p, i) => h('button', { type: 'button', class: 'g-match__b g-match__b--la', lang: 'la', text: p.la, 'data-side': 'left', 'data-i': String(i), onclick: () => pickLeft(i) }));
  const rightBtns = right.map((r, j) => h('button', { type: 'button', class: 'g-match__b', text: r.text, 'data-side': 'right', 'data-i': String(j), onclick: () => pickRight(j) }));
  const check = h('button', { type: 'submit', class: 'btn btn--primary', text: 'Check', disabled: true });
  // The number a pair carries on screen: without it four grey boxes say nothing about which two go together.
  const badge = (i) => { const at = order.indexOf(i); return at < 0 ? null : String(at + 1); };
  const setBadge = (b, n) => { if (n) b.dataset.n = n; else delete b.dataset.n; };
  const paint = () => {
    const usedRight = new Set(Object.values(chosen));
    const rightOwner = new Map(Object.entries(chosen).map(([k, v]) => [v, Number(k)]));
    leftBtns.forEach((b, i) => { const r = chosen[i]; b.classList.toggle('is-paired', r != null); b.classList.toggle('is-pending', pendingLeft === i); b.setAttribute('aria-pressed', String(pendingLeft === i || r != null)); b.setAttribute('aria-label', r != null ? `Pair ${badge(i)}: ${pairs[i].la} — ${right[r].text}; tap to unpair` : `${pairs[i].la}: pick, then its meaning`); b.dataset.pair = r != null ? String(r) : ''; setBadge(b, badge(i)); });
    rightBtns.forEach((b, j) => { const owner = rightOwner.get(j); const n = owner == null ? null : badge(owner); b.classList.toggle('is-paired', usedRight.has(j)); b.classList.toggle('is-pending', pendingRight === j); b.setAttribute('aria-pressed', String(pendingRight === j || usedRight.has(j))); b.setAttribute('aria-label', owner == null ? `${right[j].text}: pick, then its Latin word` : `Pair ${n}: ${right[j].text} — ${pairs[owner].la}; tap to unpair`); setBadge(b, n); });
    check.disabled = Object.keys(chosen).length !== pairs.length;
  };
  const unpairLeft = (i) => { delete chosen[i]; const at = order.indexOf(i); if (at >= 0) order.splice(at, 1); };
  const pair = (i, j) => { for (const k of Object.keys(chosen)) if (chosen[k] === j) unpairLeft(Number(k)); chosen[i] = j; if (!order.includes(i)) order.push(i); pendingLeft = null; pendingRight = null; paint(); say(`${pairs[i].la} — ${right[j].text}. ${pairs.length - Object.keys(chosen).length} left.`); if (!check.disabled) check.focus({ preventScroll: true }); };
  const pickLeft = (i) => { if (chosen[i] != null) { unpairLeft(i); pendingLeft = null; paint(); say(`${pairs[i].la} unpaired.`); return; } if (pendingRight != null) { pair(i, pendingRight); return; } pendingLeft = pendingLeft === i ? null : i; paint(); say(pendingLeft === i ? `${pairs[i].la} picked; now its meaning.` : `${pairs[i].la} let go.`); };
  const pickRight = (j) => { if (pendingLeft != null) { pair(pendingLeft, j); return; } const owner = Object.keys(chosen).find((k) => chosen[k] === j); if (owner != null) { unpairLeft(Number(owner)); paint(); say(`${right[j].text} unpaired.`); return; } pendingRight = pendingRight === j ? null : j; paint(); say(pendingRight === j ? `${right[j].text} picked; now its Latin word.` : `${right[j].text} let go.`); };
  const cols = h('div', { class: 'g-match' }, h('div', { class: 'g-match__col', role: 'group', 'aria-label': 'Latin words' }, leftBtns), h('div', { class: 'g-match__col', role: 'group', 'aria-label': 'Meanings' }, rightBtns));
  const form = h('form', { class: 'g-match__form', onsubmit: (e) => { e.preventDefault(); if (Object.keys(chosen).length === pairs.length) onSubmit({ ...chosen }); } }, cols, h('div', { class: 'g-order__acts' }, check), h('p', { class: 'g-keys', text: 'Tab or the arrow keys move between the words; Enter picks a word, then its meaning.' }));
  form.addEventListener('keydown', (e) => {
    const b = e.target.closest?.('.g-match__b'); if (!b) return;
    const list = b.dataset.side === 'left' ? leftBtns : rightBtns;
    const other = b.dataset.side === 'left' ? rightBtns : leftBtns;
    const i = list.indexOf(b);
    if (e.key === 'ArrowDown') { e.preventDefault(); roving(list, i, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); roving(list, i, -1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); (other[i] ?? other[0])?.focus(); }
  });
  // Per-row results when the item is graded (GRAMMAR-CONTRACT.md §3): each pair carries its own green or
  // red, and the ✓ / ✗ says which without relying on the colour. A pairing is tapped, never "left", so
  // nothing is judged before the learner presses Check — that would make the item a game of trying tiles.
  onCells?.((cells) => {
    for (const r of cells) {
      const l = leftBtns[r.i];
      const j = chosen[r.i];
      const rb = j == null ? null : rightBtns[j];
      for (const b of [l, rb]) {
        if (!b) continue;
        b.classList.toggle('is-right', !!r.ok);
        b.classList.toggle('is-wrong', !r.ok);
        b.setAttribute('aria-invalid', String(!r.ok));
        if (!b.querySelector('.g-cellmark')) b.append(h('span', { class: `g-cellmark${r.ok ? ' is-ok' : ' is-bad'}`, 'aria-hidden': 'true', text: r.ok ? '✓' : '✗' }));
      }
    }
  });
  paint();
  return { node: form, focus: () => leftBtns[0]?.focus({ preventScroll: true }) };
}
