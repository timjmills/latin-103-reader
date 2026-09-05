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

/** Margin notes of a unit, always an array of {line, la, en} with a non-empty `la`; `en` (the English rendering) is a trimmed string or null. */
export function marginNotes(unit) {
  const rows = Array.isArray(unit?.margin) ? unit.margin : [];
  return rows.filter((m) => m && typeof m.la === 'string' && m.la.trim())
    .map((m) => ({ line: m.line != null && Number.isFinite(Number(m.line)) ? Number(m.line) : null, la: m.la.trim(), en: plainWords(m.en) }));
}

/** A plain-words text (`unit.note_simple`, `highlight.simple`, `margin[].en`): the trimmed string, or null when absent/blank. Pure. */
export function plainWords(text) {
  return typeof text === 'string' && text.trim() ? text.trim() : null;
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
 * How far the stacked margin blocks sit below where they want to be, in px
 * (the worst case). Blocks resting under a *pinned* one (a picture, which
 * stays beside its own sentence whatever the notes do) are measured from the
 * block above them, not from their own sentence — the note under the picture,
 * the note under that one, and so on while each rests on the chain: glosses
 * flowing under the illustration are the book's own arrangement, not
 * crowding. The chain ends at the first block that sits at its own sentence
 * again; notes crowding notes count as before. A picture joins a chain only
 * under another picture of the same sentence (`unit`): displaced by anything
 * else, it is no longer beside its sentence and counts in full. Pure.
 */
export function marginDrift(items, tops, gap = 0) {
  let floor = -Infinity;      // bottom of the chain so far (+ gap)
  let chained = false;
  let prev = null;
  let worst = 0;
  items.forEach((it, i) => {
    const pushed = chained && tops[i] > it.top && tops[i] <= floor + 0.5;   // pushed onto the chain, not placed at its own sentence
    const resting = pushed && (!it.pinned || (prev?.pinned && prev.unit != null && prev.unit === it.unit));
    const want = resting ? floor : it.top;
    worst = Math.max(worst, tops[i] - want);
    chained = it.pinned || resting;
    floor = chained ? tops[i] + it.height + gap : -Infinity;
    prev = it;
  });
  return worst;
}

/**
 * Picture rows grouped by the sentence they stand beside: Map unit_id →
 * rows in `sort` order (ties by id). Rows without a unit id are dropped. Pure.
 */
export function groupPictures(rows) {
  const out = new Map();
  for (const p of rows || []) {
    if (!p || !p.unit_id) continue;
    (out.get(p.unit_id) ?? out.set(p.unit_id, []).get(p.unit_id)).push(p);
  }
  const by = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id));
  for (const list of out.values()) list.sort(by);
  return out;
}

/** The image's alternative text: its caption, else a generic line. Pure. */
export function pictureAlt(p) {
  return plainWords(p?.caption) ?? 'Illustration from the textbook';
}

/* --- book lines (CONTRACT.md "Book lines") ---------------------------- */

/**
 * A unit's printed-line data as a clean, sorted list of `{ line, start }`:
 * integer line numbers, integer character offsets into `la`, duplicates and
 * unusable entries dropped. `[]` for a unit without any (Fabellae Latinae,
 * an unmapped unit). Pure.
 */
export function unitLines(unit) {
  const rows = Array.isArray(unit?.lines) ? unit.lines : [];
  const clean = [];
  const seen = new Set();
  for (const r of rows) {
    const line = Math.round(Number(r?.line));
    const start = Math.round(Number(r?.start));
    if (!Number.isFinite(line) || !Number.isFinite(start) || start < 0 || seen.has(start)) continue;
    seen.add(start);
    clean.push({ line, start });
  }
  // Monotonic by line as well: an entry naming a line at or before the one
  // kept last (the same line from a second offset, or out of order) is dropped.
  const out = [];
  for (const e of clean.sort((a, b) => a.start - b.start)) {
    if (out.length && e.line <= out[out.length - 1].line) continue;
    out.push(e);
  }
  return out;
}

/**
 * Where each printed line begins inside a tokenised unit, for book mode:
 * `[{ index, line }]` — `index` is the token that opens the line (the split
 * always falls between tokens: the word containing the offset, else the
 * first token at or after it, never a whitespace one), `line` its printed
 * number. An entry whose offset lands inside a word (a data slip: the
 * pipeline emits word starts) puts the break before that word. An offset
 * of 0 is the unit's own first line (no break, just the number). Entries
 * past the text, or that resolve to the same token, are dropped. Pure.
 */
export function lineStarts(tokens, lines) {
  const out = [];
  let last = -1;
  for (const { line, start } of unitLines({ lines })) {
    let i = tokens.findIndex((t) => t.isWord && t.start <= start && start < t.end);   // the word containing the offset…
    if (i < 0) i = tokens.findIndex((t) => t.start >= start);                        // …else the first token at or after it
    if (i < 0) continue;
    while (i < tokens.length && !tokens[i].isWord && !tokens[i].text.trim()) i++;   // never open a line with whitespace
    if (i >= tokens.length || i <= last) continue;
    out.push({ index: i, line });
    last = i;
  }
  return out;
}

/**
 * How the non-word token before a printed-line break is divided between the
 * two lines: `{ head, tail }` around its last whitespace run — `; "` → `;`
 * ends the line above, `"` opens the new one; ` ` → both empty. null when the
 * text has no whitespace (nothing to divide: it stays whole on the line above). Pure.
 */
export function breakSplit(text) {
  const m = /^([\s\S]*?)\s+(\S*)$/.exec(String(text ?? ''));
  return m ? { head: m[1], tail: m[2] } : null;
}

/** The last printed line a unit occupies, or null without line data. Pure. */
export function lastLine(unit) {
  const rows = unitLines(unit);
  return rows.length ? rows[rows.length - 1].line : null;
}

/**
 * Whether a printed line ends with `unit` so that `next` opens a new one:
 * both mapped — `next` starts on a later line than `unit` ends; otherwise
 * (either unmapped) a block start opens a paragraph. `lastMapped` is the
 * last printed line seen so far in the part: an unmapped `unit` in the
 * middle of a mapped block (the pipeline gives `lines: []` to a sentence it
 * cannot place) stands on that line, so a mapped `next` starting later still
 * opens a new one. False without `next`. Pure.
 */
export function breakAfter(unit, next, lastMapped = null) {
  if (!unit || !next) return false;
  const end = lastLine(unit) ?? lastMapped;
  const first = unitLines(next)[0]?.line ?? null;
  if (end != null && first != null) return first > end;
  return !!next.block_start;
}

/** Whether any unit of the week carries printed-line data (the Settings switch's hint says when none does). Pure. */
export function weekHasLines(units) {
  return (units || []).some((u) => unitLines(u).length > 0);
}

/**
 * The printed lines of a run of units (one part, in order) rebuilt from
 * their line data — what book mode's column has to hold: `[{ line, text,
 * ends }]`, the line's text as printed (units sharing a line joined by a
 * space, the whitespace at a break dropped) and `ends`, how many units end
 * on it (each may carry a † and a play button). An unmapped unit inside a
 * mapped block (`lines: []`, not a block start) stands on the last line
 * seen, as breakAfter() lays it out; a block start without data, and what
 * follows it until the next mapped unit, is flow text and is left out. Pure.
 */
export function printedLines(units) {
  const lines = new Map();
  let cur = null;
  const add = (line, text) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    const L = lines.get(line) ?? lines.set(line, { line, text: '', ends: 0 }).get(line);
    if (t) L.text = L.text ? `${L.text} ${t}` : t;
    return L;
  };
  for (const u of units || []) {
    if (!u) continue;
    const rows = unitLines(u);
    if (!rows.length) {
      if (u.block_start || cur == null) { cur = null; continue; }
      add(cur, u.la).ends++;
      continue;
    }
    const la = String(u.la ?? '');
    rows.forEach((r, i) => { add(r.line, la.slice(r.start, rows[i + 1]?.start ?? la.length)); cur = r.line; });
    lines.get(cur).ends++;
  }
  return [...lines.values()];
}

/**
 * Which line numbers to hide so every screen line shows its number once:
 * `items` = `[{ top, line }]` in document order (the number's screen top and
 * its printed line, a string or a number). A number on the same screen line
 * as the last one shown (within 2 px), or naming the same printed line as it
 * (a sentence continuing a line that wrapped, two verses sharing a printed
 * line), is a duplicate. Returns one boolean per item. Pure.
 */
export function lineNumberDups(items) {
  let prevTop = null;
  let prevLine = null;
  return (items || []).map((it) => {
    const top = Number(it?.top);
    const line = it?.line != null ? String(it.line) : null;
    const dup = (prevTop != null && Number.isFinite(top) && Math.abs(top - prevTop) < 2) || (line != null && line === prevLine);
    if (dup) return true;
    if (Number.isFinite(top)) prevTop = top;
    prevLine = line;
    return false;
  });
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

/**
 * A part's section summary: `{ en, la }` (trimmed strings, '' when missing),
 * or null when the part carries neither `summary_en` nor `summary_la`.
 */
export function partSummary(part) {
  const pick = (v) => (typeof v === 'string' ? v.trim() : '');
  const en = pick(part?.summary_en);
  const la = pick(part?.summary_la);
  return en || la ? { en, la } : null;
}

/**
 * localStorage key remembering whether a part's summary disclosure is open:
 * `l103.summary.<week id>.<part slug>`. Pure.
 */
export function summaryStorageKey(weekId, part) {
  const slug = String(part ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'part';
  return `l103.summary.${weekId || 'week'}.${slug}`;
}

/** First unit (in order) not in `progress` (a Map / Set of unit ids), or null once every one is read. Pure. */
export function firstUnread(units, progress) {
  for (const u of units || []) if (u && !progress?.has?.(u.id)) return u;
  return null;
}

/** What a progress Map / Set holds for a unit: the row (or read_at string), `true` for a Set entry, null for unread. Pure. */
export function progressValueOf(progress, id) {
  return progress?.get?.(id) ?? (progress?.has?.(id) ? true : null);
}

/** How many passes a progress value records (the same rule as readsOf() in sync.js, which this module does not import). Pure. */
const readsOf = (value) => (value && typeof value === 'object' ? Math.max(1, Math.floor(Number(value.reads)) || 1) : 1);

/**
 * The faint tick in sentence view's meta line for a read sentence: "read",
 * or "read · reviewed" / "read · reviewed ×2" once later passes have covered
 * it (`value` a progress row with `reads`, or anything else = one pass). Pure.
 */
export function readTickText(value) {
  const reviews = readsOf(value) - 1;
  return reviews <= 0 ? 'read' : reviews === 1 ? 'read · reviewed' : `read · reviewed ×${reviews}`;
}

/** Sentence view: the current sentence counts as read after this long, and a *review* by Next / j needs it too (nextCounts). */
export const READ_DWELL_MS = 2000;

/**
 * Whether moving past the current sentence with Next / j counts it as read:
 * a first read (`value` null: no row yet) counts at once, as CONTRACT.md
 * says; a review (`value` a row, not settled) only after the sentence has
 * been current for `dwellMs` — hammering j through a read week is paging,
 * not re-reading. `settled` is readSettled(value). Pure.
 */
export function nextCounts({ value, settled, heldMs, dwellMs = READ_DWELL_MS } = {}) {
  if (settled) return false;
  if (value == null || value === false) return true;
  return heldMs >= dwellMs;
}

/**
 * Read-batching: adds to `queue` (a Set) every id in `ids` that is neither
 * settled nor queued, and returns the ids it added. `isSettled(value)` judges
 * the progress value (progressValueOf): by default any entry is settled (read
 * for good); main.js passes readSettled() from sync.js, so a sentence read
 * ≥ 30 min ago is queued again as a review (CONTRACT.md "Reviews"). main.js
 * fills the queue from the reader's `read` events and flushes it to
 * store.markRead() in one call. Pure apart from the queue it fills.
 */
export function queueReads(queue, ids, progress, isSettled = (value) => value != null) {
  const added = [];
  for (const id of ids || []) {
    if (typeof id !== 'string' || !id || queue.has(id) || isSettled(progressValueOf(progress, id))) continue;
    queue.add(id);
    added.push(id);
  }
  return added;
}

/**
 * Where a unit's audio ends, from the alignment rows (start_ms order): its
 * own `end_ms`, else the next row's start, else `fallback` (the recording's
 * length, or null). null for a unit that has no row. Pure.
 */
export function unitEndMs(rows, unitId, fallback = null) {
  const i = (rows || []).findIndex((r) => r && r.unit_id === unitId);
  if (i < 0) return null;
  const own = rows[i].end_ms;
  if (own != null && Number.isFinite(Number(own))) return Number(own);
  const next = rows[i + 1];
  if (next && Number.isFinite(Number(next.start_ms))) return Number(next.start_ms);
  return fallback != null && Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

/**
 * Whether playback has *read* the sentence that was under the cursor
 * (`prevId`) now that the cursor is on `nextId` (null: playback is over).
 * Two ways only — the cursor moved on to the row after it in the alignment
 * (chapter playback passed it), or it stopped where that sentence ends
 * (`atMs`, the element's time, within `slackMs` of unitEndMs; the
 * recording's `durationMs` stands in for a last row without end_ms) — and
 * in both the time it was actually playing (`playedMs`: pauses excluded)
 * must reach `minMs`, or 80% of the sentence when that is shorter. A Stop
 * partway, a tap on another sentence, an error, a sentence with no row:
 * false. Pure.
 */
export function playbackRead({ prevId, nextId = null, playedMs = 0, atMs = null, rows, durationMs = null, error = null, minMs = 1500, slackMs = 400 }) {
  if (!prevId || error) return false;
  const list = rows || [];
  const i = list.findIndex((r) => r && r.unit_id === prevId);
  if (i < 0) return false;
  const end = unitEndMs(list, prevId, durationMs);
  const start = Number(list[i].start_ms) || 0;
  const need = end != null && end > start ? Math.min(minMs, 0.8 * (end - start)) : minMs;
  if (!((Number(playedMs) || 0) >= need)) return false;
  if (nextId != null) return list[i + 1]?.unit_id === nextId;
  return end != null && atMs != null && Number(atMs) >= end - slackMs;
}

/**
 * The unit nearest a horizontal line `y` (viewport px): the one whose box
 * straddles it, else the one with the smallest distance from either edge.
 * `boxes`: [{ id, top, bottom }] in document order; empty boxes are skipped.
 * Returns the id, or null. Pure — the passage view's "current sentence
 * while scrolling" (the line is the top third of the viewport).
 */
export function nearestUnit(boxes, y) {
  let best = null;
  let bestD = Infinity;
  for (const b of boxes || []) {
    if (!b || !(b.bottom > b.top)) continue;
    const d = b.top <= y && b.bottom >= y ? 0 : Math.min(Math.abs(b.top - y), Math.abs(b.bottom - y));
    if (d < bestD) { bestD = d; best = b.id; if (d === 0) break; }
  }
  return best;
}

/**
 * Whether a unit counts as in view for reading progress: at least `ratio`
 * (80%) of it is visible — or, for a unit taller than the viewport, that much
 * of the viewport is filled by it. Pure.
 */
export function inViewEnough(visibleHeight, unitHeight, viewportHeight, ratio = 0.8) {
  const need = Math.min(Number(unitHeight) || 0, Number(viewportHeight) || 0);
  return need > 0 && (Number(visibleHeight) || 0) >= ratio * need - 0.5;
}

/* ------------------------------------------------------------------ DOM */

/**
 * "In plain words": a native disclosure under a grammar note holding its
 * simpler second layer (CONTRACT.md "Plain-words layer"). Null without text.
 * `plain` is `{ get() → bool, set(bool) }` for settings.plainOpen — the
 * learner's last choice, so once opened it stays open on every note.
 */
export function plainDisclosure(text, plain = null) {
  const body = plainWords(text);
  if (!body) return null;
  const details = h('details', { class: 'plain', open: !!plain?.get?.() },
    h('summary', { class: 'plain__toggle' }, h('span', { class: 'plain__word', text: 'In plain words' })),
    h('p', { class: 'plain__text', lang: 'en', text: body }));
  details.addEventListener('toggle', () => { if (plain?.set && details.open !== !!plain.get?.()) plain.set(details.open); });
  return details;
}

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
 * @param {HTMLElement} [o.listen]   the listen bar (#listen, owned by main.js): moved into every render —
 *                                   top of the passage (under the first part title) / above the sentence
 * @param {object}      [o.plain]    `{ get() → bool, set(bool) }` for settings.plainOpen (the "In plain words" disclosures)
 * @param {HTMLElement} [o.progressBar]  the reading-progress line (#progress, owned by main.js): moved into every render
 * @param {Function}    [o.readSettled]  progress value → true when the sentence needs no timer now (sync.js readSettled: read within 30 min; default: any entry)
 *                                   like the listen bar — above it in passage view, under the meta line in sentence view
 */
export function createReader({ root, tokenize, describeForm, live, listen = null, plain = null, progressBar = null, readSettled = (value) => value != null }) {
  const listeners = {};
  const on = (ev, cb) => { (listeners[ev] ??= []).push(cb); };
  const emit = (ev, detail) => { for (const cb of listeners[ev] ?? []) cb(detail); };

  const state = {
    week: null, units: [], byId: new Map(), hl: new Map(),
    lookups: new Map(), seen: new Set(), view: 'passage', current: 0, lineMode: 'flow',   // lineMode: settings.lineMode (setLineMode)
    audio: false, playing: null, playingWord: null, tokens: new Map(), marginTokens: new Map(), summaryTokens: new Map(),
    glossOpen: new Set(),   // margin glosses whose English is shown ("<unit id>#<index>"), across re-renders and both copies
    pictures: new Map(),    // unit id → picture rows (groupPictures)
    picTokens: new Map(),   // picture id → caption tokens
    progress: new Map(),    // unit id → read_at (store.getProgress): the sentences already read
    readTimer: 0,           // sentence view: the current sentence counts as read after READ_DWELL_MS
    io: null,               // passage view: IntersectionObserver over the units
    ioTimers: new Map(),    // unit id → timer while the unit has been ≥ 80% in view
    inView: new Set(),      // unit ids ≥ 80% in view right now
    skipped: new Set(),     // units in view at a reset: not timed until they have left and come back (whatever pauses and resumes meanwhile)
    scrollRaf: 0,
    settleUntil: 0,         // ignore scroll tracking until then (a programmatic scroll is in flight)
    bookMaxMarks: 0,        // book mode: the most sentences with marks († / play) ending on one printed line, as rendered (layoutMargin sizes the marks column)
    shownOrder: -1,         // the order last rendered as current, and since when (currentSince): a review by Next needs READ_DWELL_MS of it
    currentSince: 0,
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // A sentence read within the last 30 min gets no timer; one read earlier is watched again for a review (CONTRACT.md "Reviews").
  const settled = (id) => readSettled(progressValueOf(state.progress, id));

  function tokensFor(unit) {
    if (!state.tokens.has(unit.id)) state.tokens.set(unit.id, tokenize(unit.la));
    return state.tokens.get(unit.id);
  }

  /* --- Latin text → spans ------------------------------------------ */
  // Book mode (passage view): the unit's printed lines — a break before the
  // token that opens each line after the first, the whitespace at the break
  // dropped, and every line's number in the gutter before its first token.
  // A line opens at its first *word* (the pipeline's `start` is the first
  // letter), so the non-word token before it (`; "`, ` (`, ` — ‘`) is split
  // at its last whitespace run: the head (`;`) ends the line above, the tail
  // (`"`) opens the new one after its number.
  const bookUnit = (unit) => state.lineMode === 'book' && state.view === 'passage' && unitLines(unit).length > 0;
  function renderLatin(unit) {
    const tokens = tokensFor(unit);
    return renderTokens(tokens, state.hl.get(unit.id) ?? [], bookUnit(unit) ? lineStarts(tokens, unit.lines) : []);
  }
  const lineNumber = (n) => h('span', { class: 'lineno', 'aria-hidden': 'true', 'data-line': String(n), text: String(n) });
  function renderTokens(tokens, ranges, starts = []) {
    const frag = document.createDocumentFragment();
    const groups = segmentUnit(tokens, ranges);
    const opens = new Map(starts.map((s) => [s.index, s.line]));
    const split = new Map();     // the non-word token just before a break → { head, tail } around its last whitespace run (pure whitespace: both '')
    for (const s of starts) {
      const prev = s.index > 0 ? tokens[s.index - 1] : null;
      const parts = prev && !prev.isWord ? breakSplit(prev.text) : null;
      if (parts) split.set(s.index - 1, parts);

    }
    let i = 0;
    for (const g of groups) {
      const parent = g.range
        ? h('span', { class: 'hl', 'data-hl-label': g.range.label, 'data-hl-note': g.range.note, 'data-hl-text': g.range.text, 'data-hl-simple': plainWords(g.range.simple) })
        : frag;
      for (const t of g.tokens) {
        const idx = i++;
        if (split.has(idx)) { if (split.get(idx).head) parent.append(split.get(idx).head); continue; }
        if (opens.has(idx)) {
          if (idx > 0) parent.append(h('br', { class: 'lb' }));
          parent.append(lineNumber(opens.get(idx)));
          const tail = split.get(idx - 1)?.tail;
          if (tail) parent.append(tail);
        }
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
    // data-line: the first gloss's printed line — in book mode the gutter copy is set level with that line (positionMargin).
    const block = h('span', { class: cls, lang: 'la', 'data-for': unit.id, 'data-order': String(unit.order), 'data-line': notes[0].line != null ? String(notes[0].line) : null, role: 'group', 'aria-label': 'Margin notes' });
    notes.forEach((m, i) => {
      // A gloss with an English rendering gets a small "en" chip after the
      // Latin; a tap shows the English beneath (settings.showGlossEnglish shows
      // every one and hides the chips — CSS on <article data-gloss-en>).
      const key = `${unit.id}#${i}`;
      const open = !!m.en && state.glossOpen.has(key);
      block.append(h('span', { class: 'mnotes__item' + (open ? ' is-en-open' : ''), 'data-gloss': m.en ? key : null },
        h('span', { class: 'mnotes__mark', 'aria-hidden': 'true', text: '\u00b6' }),
        m.line != null && state.week?.has_line_numbers ? h('span', { class: 'mnotes__line', text: String(m.line) }) : null,
        renderTokens(m.tokens, []),
        m.en ? h('button', { type: 'button', class: 'mnotes__en-btn', 'data-gloss-toggle': key, 'aria-expanded': String(open), 'aria-label': 'In English' }, h('span', { 'aria-hidden': 'true', text: 'en' })) : null,
        m.en ? h('span', { class: 'mnotes__en', lang: 'en', text: m.en }) : null));
    });
    return block;
  }
  /** Show / hide one gloss's English in every copy of its block (gutter and inline). */
  function toggleGloss(key) {
    const open = !state.glossOpen.has(key);
    if (open) state.glossOpen.add(key); else state.glossOpen.delete(key);
    for (const item of root.querySelectorAll(`[data-gloss="${CSS.escape(key)}"]`)) {
      item.classList.toggle('is-en-open', open);
      item.querySelector('.mnotes__en-btn')?.setAttribute('aria-expanded', String(open));
    }
    scheduleReflow();   // the gutter blocks change height
  }

  /* --- pictures ---------------------------------------------------- */
  // The textbook's illustrations beside the sentence they stand next to
  // (CONTRACT.md "Pictures"). Like margin notes, two copies are rendered in
  // passage view — .pic--inline inside the unit (phones, or a part shown
  // inline) and .mpic in the gutter, positioned with the notes — and CSS shows
  // one. The caption is tokenised Latin (tappable, recorded against the
  // sentence through data-for); its English sits beneath, behind the same
  // "en" chip as a margin gloss (settings.showGlossEnglish shows it outright).
  function picTokensFor(p) {
    if (!state.picTokens.has(p.id)) state.picTokens.set(p.id, tokenize(plainWords(p.caption) ?? ''));
    return state.picTokens.get(p.id);
  }
  function pictureImg(p) {
    const alt = pictureAlt(p);
    const img = h('img', {
      class: 'pic__img', src: p.url || null, alt, loading: 'lazy', decoding: 'async',
      width: p.width != null ? String(p.width) : null, height: p.height != null ? String(p.height) : null,
    });
    // A URL that no longer answers (an expired signature offline): the alt text takes the frame.
    img.addEventListener('error', () => { img.replaceWith(h('span', { class: 'pic__missing', role: 'img', 'aria-label': alt, text: alt })); }, { once: true });
    // A row without width/height takes its size only once the image is in: the gutter and the line numbers move.
    if (p.width == null || p.height == null) img.addEventListener('load', scheduleReflow, { once: true });
    return img;
  }
  function pictureFigure(unit, p, cls) {
    const key = `pic:${p.id}`;
    const en = plainWords(p.caption_en);
    const open = !!en && state.glossOpen.has(key);
    const alt = pictureAlt(p);
    const fig = h('figure', {
      class: `pic ${cls}` + (open ? ' is-en-open' : ''), 'data-pic': p.id, 'data-for': unit.id, 'data-order': String(unit.order), 'data-gloss': en ? key : null,
    },
      h('button', { type: 'button', class: 'pic__btn', 'data-pic-open': p.id, 'aria-label': `Enlarge: ${alt}` }, pictureImg(p)),
      p.caption || en ? h('figcaption', { class: 'pic__cap' },
        p.caption ? h('span', { class: 'pic__la', lang: 'la' }, renderTokens(picTokensFor(p), [])) : null,
        en ? h('button', { type: 'button', class: 'mnotes__en-btn', 'data-gloss-toggle': key, 'aria-expanded': String(open), 'aria-label': 'In English' }, h('span', { 'aria-hidden': 'true', text: 'en' })) : null,
        en ? h('span', { class: 'pic__en', lang: 'en', text: en }) : null) : null);
    return fig;
  }
  /** Every picture of a unit as figures, or [] */
  function pictureBlocks(unit, cls) {
    return (state.pictures.get(unit.id) ?? []).map((p) => pictureFigure(unit, p, cls));
  }
  /** `unit id → picture ids` of a grouped map, as one string, to tell "the same pictures, new URLs" from a real change. */
  const pictureShape = (grouped) => [...grouped].map(([u, list]) => `${u}:${list.map((p) => p.id).join(',')}`).join('|');
  // Re-signed URLs land on the figures already on the page: only an <img>
  // whose URL changed gets a new src (no re-render, no refetch of the rest),
  // and a frame that had fallen back to the alt text gets its image back.
  function swapPictureUrls(prevGrouped) {
    const prevUrl = new Map();
    for (const list of prevGrouped.values()) for (const p of list) prevUrl.set(p.id, p.url ?? null);
    for (const list of state.pictures.values()) {
      for (const p of list) {
        const url = p.url ?? null;
        if (url === prevUrl.get(p.id)) continue;
        for (const fig of root.querySelectorAll(`figure[data-pic="${CSS.escape(p.id)}"]`)) {
          const btn = fig.querySelector('.pic__btn');
          const img = btn?.querySelector('img.pic__img');
          if (!btn) continue;
          if (img && url) img.src = url;
          else if (url) btn.replaceChildren(pictureImg(p));   // the alt-text frame: an image again
          else if (img) img.removeAttribute('src');
        }
      }
    }
  }
  // A tap on the image: the picture at its full size in a native dialog.
  // Escape and the backdrop close it; focus goes back to the button that opened it.
  let lightbox = null;
  let lightboxOpener = null;
  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = h('dialog', { class: 'lightbox', 'aria-label': 'Illustration' },
      h('button', { type: 'button', class: 'lightbox__close', 'aria-label': 'Close' }, h('span', { 'aria-hidden': 'true', text: '×' })),
      h('img', { class: 'lightbox__img', alt: '' }),
      h('p', { class: 'lightbox__cap' }));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('.lightbox__close')) lightbox.close(); });
    lightbox.addEventListener('keydown', (e) => e.stopPropagation());   // the reader's letter shortcuts stay out while it is open (Escape still closes: the dialog's own cancel)
    lightbox.addEventListener('close', () => {
      lightbox.querySelector('.lightbox__img').removeAttribute('src');
      const back = lightboxOpener;
      lightboxOpener = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    });
    document.body.append(lightbox);
    return lightbox;
  }
  function openPicture(id, opener) {
    let p = null;
    for (const list of state.pictures.values()) { p = list.find((x) => x.id === id) ?? p; if (p) break; }
    if (!p || !p.url) return;
    const box = ensureLightbox();
    const img = box.querySelector('.lightbox__img');
    img.alt = pictureAlt(p);
    if (p.width != null) img.width = p.width; else img.removeAttribute('width');
    if (p.height != null) img.height = p.height; else img.removeAttribute('height');
    img.src = p.url;
    const cap = box.querySelector('.lightbox__cap');
    const en = plainWords(p.caption_en);
    cap.replaceChildren(...[
      p.caption ? h('span', { lang: 'la', text: p.caption }) : null,
      p.caption && en ? h('span', { class: 'lightbox__sep', 'aria-hidden': 'true', text: ' · ' }) : null,
      en ? h('span', { class: 'lightbox__en', lang: 'en', text: en }) : null,
      p.page != null ? h('span', { class: 'lightbox__page', text: ` — page ${p.page}` }) : null,
    ].filter(Boolean));
    lightboxOpener = opener ?? null;
    if (!box.open) box.showModal();
    box.querySelector('.lightbox__close').focus({ preventScroll: true });
  }

  /* --- section summaries ------------------------------------------- */
  // week.parts[].summary_en / summary_la (CONTRACT.md "Section summaries").
  // The Latin is tokenised once per part and rendered as tappable words like
  // the reading text; the block carries the part's first unit (`data-for` /
  // `data-order`) so a lookup inside it is recorded against that sentence.
  function summaryTokensFor(part) {
    const key = part.part ?? '';
    if (!state.summaryTokens.has(key)) state.summaryTokens.set(key, tokenize(partSummary(part)?.la ?? ''));
    return state.summaryTokens.get(key);
  }
  function firstUnitOf(part) {
    return state.units.find((u) => (part.part ? u.part === part.part : true)) ?? null;
  }
  /** The part's Latin summary as tappable words, in a `lang="la"` span; null without one. */
  function summaryLatin(part) {
    const s = partSummary(part);
    if (!s?.la) return null;
    const first = firstUnitOf(part);
    return h('span', { class: 'summary__la', lang: 'la', 'data-part': part.part ?? '', 'data-for': first?.id, 'data-order': first ? String(first.order) : null },
      renderTokens(summaryTokensFor(part), []));
  }
  /** English paragraph, "In Latin" sub-heading, Latin — the same body in the passage disclosure and the panel. */
  function summaryBody(part) {
    const s = partSummary(part);
    if (!s) return null;
    const la = summaryLatin(part);
    return h('div', { class: 'summary__body' },
      s.en ? h('p', { class: 'summary__en', lang: 'en', text: s.en }) : null,
      la ? h('h3', { class: 'summary__h', text: 'In Latin' }) : null,
      la ? h('p', { class: 'summary__p' }, la) : null);
  }
  const rememberOpen = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
  function summaryBlock(part) {
    const body = summaryBody(part);
    if (!body) return null;
    const key = summaryStorageKey(state.week?.id, part.part);
    const details = h('details', { class: 'summary', open: rememberOpen(key) },
      h('summary', { class: 'summary__toggle' },
        h('span', { class: 'summary__word', text: 'Summary' }),
        part.part ? h('span', { class: 'visually-hidden', text: ` of ${part.part}` }) : null),
      body);
    details.addEventListener('toggle', () => {
      try { localStorage.setItem(key, details.open ? '1' : '0'); } catch { /* ignore */ }
      scheduleReflow();
    });
    return details;
  }

  /* --- passage view ------------------------------------------------ */
  function renderPassage() {
    const container = h('div', { class: 'passage' });
    state.bookMaxMarks = 0;
    const parts = state.week?.parts?.length ? state.week.parts : [{ part: null, lines: null }];
    for (const p of parts) {
      const units = state.units.filter((u) => (p.part ? u.part === p.part : true));
      if (!units.length) continue;
      const section = h('section', { class: 'part' });
      if (p.part) {
        section.append(h('h2', { class: 'part__title' },
          p.part, p.lines ? h('span', { class: 'part__lines', text: ` · lines ${p.lines}` }) : null));
      }
      const summary = summaryBlock(p);
      if (summary) section.append(summary);
      if (!container.childElementCount) {
        if (progressBar) section.append(progressBar);   // "42 of 93 read · Continue →": under the first part's title (and its summary)
        if (listen) section.append(listen);   // the listen bar: under that, above the first sentence
      }
      const prose = h('div', { class: 'prose' });
      // Book mode: the printed line, not the sentence, is the unit of layout.
      // Pass 1 — which units end a printed line (breakAfter, carrying the
      // last mapped line past an unmapped unit); pass 2 groups the mapped
      // inline units of a line (`unit--line`): the line's inline pictures
      // stand above it and its sentences' inline notes (`mnotes--line`)
      // below it, so a sentence boundary never cuts a printed line in two
      // (a sentence with notes is not a block in this mode). Verse / turn
      // blocks and unmapped units keep the flow layout.
      const book = state.lineMode === 'book';
      const mapped = units.map((u) => bookUnit(u));
      let lastMapped = null;   // the last printed line a mapped unit of this part ended on
      const eol = units.map((u, i) => {
        const next = units[i + 1];
        const e = book && (mapped[i] || (next != null && mapped[i + 1])) && breakAfter(u, next, lastMapped);
        if (mapped[i]) lastMapped = lastLine(u);
        return e;
      });
      const inLine = (i) => i >= 0 && i < units.length && mapped[i] && units[i].unit_type !== 'verse' && units[i].unit_type !== 'turn';
      let pendingNotes = [];
      let marksLine = null;   // the printed line the last marks were on, and how many sets it holds
      let marksOnLine = 0;
      units.forEach((u, i) => {
        const lined = inLine(i);
        const opensLine = lined && (i === 0 || eol[i - 1] || !inLine(i - 1));
        // The inline copy of the pictures stands in the prose just before the
        // sentence (not inside it) — in book mode before the printed line that
        // holds it: the line starts fresh under the plate, its number beside the text.
        if (opensLine) {
          for (let j = i; inLine(j); j++) { prose.append(...pictureBlocks(units[j], 'pic--inline')); if (eol[j]) break; }
        } else if (!lined) prose.append(...pictureBlocks(u, 'pic--inline'));
        if (lined && lastLine(u) !== marksLine) { marksLine = lastLine(u); marksOnLine = 0; }
        const unitEl = h('span', {
          class: 'unit' + (u.unit_type === 'verse' ? ' unit--verse' : '') + (u.unit_type === 'turn' ? ' unit--turn' : '') + (lined ? ' unit--line' : '') + (state.playing === u.id ? ' is-playing' : ''),
          'data-id': u.id, 'data-order': String(u.order), 'data-type': u.unit_type,
        });
        // Flow layout: the block's number beside its first line. Book mode numbers every printed line from inside renderLatin() instead — for the units that have line data; the rest keep this.
        if (state.week?.has_line_numbers && u.block_start && u.line_no != null && !mapped[i]) {
          unitEl.append(lineNumber(u.line_no));
        }
        if (u.unit_type === 'turn' && u.speaker) unitEl.append(h('span', { class: 'speaker', text: u.speaker }), ' ');
        const la = h('span', { class: 'la', lang: 'la' }, renderLatin(u));
        const margin = marginBlock(u, lined ? 'mnotes mnotes--line' : 'mnotes');
        if (margin && !lined) unitEl.classList.add('has-margin');
        // Dagger + play button stay on the sentence's last line, together: a
        // word joiner glues them to the text and .marks does not wrap inside.
        // On a printed line (book mode, wide screens) CSS moves them into a
        // column at the line's right end; --mark-i is the slot of a second
        // sentence ending on the same line.
        const marks = [noteMark(u), playButton(u)].filter(Boolean);
        const marksEl = marks.length ? h('span', { class: 'marks', style: lined && marksOnLine ? `--mark-i: ${marksOnLine}` : null }, '⁠', ...marks) : null;
        if (lined && marks.length) state.bookMaxMarks = Math.max(state.bookMaxMarks, ++marksOnLine);
        // Book mode: a printed line that ends with this sentence ends the screen
        // line too (a trailing break, after the marks: it collapses when the
        // unit or what follows is a block — CSS hides it there besides).
        unitEl.append(...[la, marksEl, eol[i] ? h('br', { class: 'lb lb--unit' }) : null, lined ? null : margin, h('span', { class: 'en', lang: 'en', text: u.en })].filter(Boolean));
        prose.append(unitEl);
        if (lined && margin) pendingNotes.push(margin);
        if (lined && (eol[i] || !inLine(i + 1)) && pendingNotes.length) { prose.append(...pendingNotes); pendingNotes = []; }   // the line's notes, under it
        if (i < units.length - 1) prose.append(' ');
      });
      // The gutter copy: hidden by CSS in the inline mode, positioned by
      // positionMargin(). A unit's pictures come before its notes, so the
      // notes stack beneath the illustration as in the book's margin.
      const gutter = h('div', { class: 'margin' }, units.map((u) => [...pictureBlocks(u, 'mpic'), marginBlock(u, 'mnote')]));
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
    const part = state.week?.parts?.find((p) => p.part && p.part === u.part) ?? null;
    const metaEl = h('p', { class: 'sentence__meta' }, h('span', { text: meta }));
    // A faint "read" tick once the sentence counts as read (kept in step by paintReadTick()).
    metaEl.append(h('span', { class: 'sentence__read', hidden: !state.progress.has(u.id) },
      h('span', { class: 'sentence__meta-sep', 'aria-hidden': 'true', text: ' · ' }), h('span', { 'data-read-label': '', text: readTickText(progressValueOf(state.progress, u.id)) }), h('span', { 'aria-hidden': 'true', text: ' ✓' })));
    if (part && partSummary(part)) {
      metaEl.append(h('span', { class: 'sentence__meta-sep', 'aria-hidden': 'true', text: ' · ' }),
        h('button', { type: 'button', class: 'sentence__summary', 'data-summary': part.part, 'aria-label': `Section summary: ${part.part}` }, 'Section summary'));
    }
    wrap.append(metaEl);
    if (progressBar) wrap.append(progressBar);   // the week's progress line, above the listen bar
    if (listen) wrap.append(listen);   // "Play sentence" / "Play from here" live in the bar; no inline play button here
    wrap.append(...pictureBlocks(u, 'pic--sentence'));   // the illustration above the Latin
    const la = h('div', { class: 'sentence__la', lang: 'la' });
    if (u.unit_type === 'turn' && u.speaker) la.append(h('span', { class: 'speaker', text: u.speaker }), ' ');
    la.append(renderLatin(u));
    wrap.append(la);
    const margin = marginBlock(u, 'mnotes mnotes--sentence');
    if (margin) wrap.append(margin);
    wrap.append(h('p', { class: 'sentence__en en', lang: 'en', text: u.en }));
    if (u.note) {
      wrap.append(h('section', { class: 'sentence__note', 'aria-label': 'Grammar note' },
        h('h3', { class: 'sentence__h', text: 'Note' }), h('p', { text: u.note }), plainDisclosure(u.note_simple, plain)));
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

  // A render rebuilds the whole article. The article keeps its height across
  // the swap (a min-height for the moment the old children are out), so the
  // document never shrinks under the viewport: Chromium clamps the scroll
  // offset to the short document and, even after the new content is in and
  // the offset put back, re-applies that clamp a frame or two later. The
  // offset is restored besides, and the margin blocks are excluded from the
  // page's scroll anchoring (reader.css: `.margin, .mnote, .mpic`) — anchoring
  // on a node the margin reflow then moves used to carry a page deep in a
  // chapter to the chapter's end. Anchoring stays on for everything else
  // (a picture decoding above the viewport, a summary toggled, fonts arriving)
  // but cannot span the swap itself (its anchor node is the one removed), so
  // passage view puts the first sentence in view back where it was on screen:
  // a re-render that changes the shape of the text above (play buttons or
  // pictures switched off, Book lines) would otherwise move the page by that much.
  function render() {
    clearReadTimers();
    if (state.current !== state.shownOrder) { state.shownOrder = state.current; state.currentSince = Date.now(); }
    const y = window.scrollY;
    const anchor = state.view === 'passage' && root.dataset.view === 'passage' ? firstUnitInView() : null;
    root.style.minHeight = `${root.offsetHeight}px`;
    root.replaceChildren(state.view === 'passage' ? renderPassage() : renderSentence());
    root.dataset.view = state.view;
    wordEls = { unitId: null, els: [] };
    applyPlayingWord();
    reflow();
    root.style.removeProperty('min-height');
    // The anchor sentence goes back where it was — now, and again while the
    // layout settles (holdScroll: the margin reflow, pictures decoding).
    if (anchor) holdScroll(() => restoreAnchor(anchor));
    else if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: 'auto' });
    emit('render', { view: state.view, unit: state.units[state.current] ?? null });   // main.js repaints the listen bar
    armReads();
    emitPosition();
  }

  /* --- reading progress (CONTRACT.md "Reading progress") ------------ */
  // The reader only *notices* reading; main.js batches the `read` events into
  // store.markRead(). Sentence view: the sentence shown counts after 2 s
  // (READ_DWELL_MS), or at once when moved past with Next / j (goTo). Passage
  // view: a unit that has been ≥ 80% in view for 2 s (an IntersectionObserver
  // below the sticky header + a timer per unit). Nothing counts while the tab
  // is hidden; nothing is ever un-marked. A sentence read ≥ 30 min ago is
  // timed again (settled()): that pass is a review, main.js / the store tell
  // it apart. Playback is main.js's (audio state).
  function emitRead(id, why) { emit('read', { unitIds: [id], why }); }
  function clearReadTimers() {
    clearTimeout(state.readTimer);
    state.readTimer = 0;
    for (const t of state.ioTimers.values()) clearTimeout(t);
    state.ioTimers.clear();
    state.inView.clear();
    state.skipped.clear();
    state.io?.disconnect();
    state.io = null;
  }
  function armReads() {
    clearReadTimers();
    if (state.view === 'sentence') { armSentence(); return; }
    observeUnits();
  }
  // Reading is not counted while the tab is hidden, nor while a modal dialog
  // (Settings, the weeks menu, the word popup, the lightbox) covers the text.
  const readsPaused = () => document.visibilityState !== 'visible' || !!document.querySelector('dialog[open]');
  function armSentence() {
    clearTimeout(state.readTimer);
    state.readTimer = 0;
    const u = state.units[state.current];
    if (!u || settled(u.id) || readsPaused()) return;
    state.readTimer = setTimeout(() => { state.readTimer = 0; if (state.units[state.current]?.id === u.id && !readsPaused()) emitRead(u.id, 'dwell'); }, READ_DWELL_MS);
  }
  function barHeight() {
    return parseFloat(document.documentElement.style.getPropertyValue('--bar-h')) || 0;
  }
  // `skipVisible` (after a reset): the units in view at that moment are noted
  // but not timed — they count again only once they have left and come back,
  // so a reset is never followed by "1 of 93" two seconds later.
  function observeUnits(skipVisible = false) {
    state.io?.disconnect();
    state.io = null;
    if (typeof IntersectionObserver !== 'function' || !state.units.length) return;
    const barH = Math.round(barHeight());
    let first = skipVisible;
    state.io = new IntersectionObserver((entries) => {
      const skip = first;
      first = false;
      for (const e of entries) {
        const id = e.target.dataset.id;
        const rootH = e.rootBounds?.height ?? (window.innerHeight - barH);
        const ok = e.isIntersecting && inViewEnough(e.intersectionRect.height, e.boundingClientRect.height, rootH);
        if (ok) { state.inView.add(id); if (skip) state.skipped.add(id); else armUnit(id); }
        else { state.inView.delete(id); state.skipped.delete(id); disarmUnit(id); }
      }
    }, { rootMargin: `-${barH}px 0px 0px 0px`, threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    for (const el of root.querySelectorAll('.unit')) state.io.observe(el);   // every unit: a read one becomes reviewable after 30 min, armUnit() judges it then
  }
  function armUnit(id) {
    if (state.ioTimers.has(id) || settled(id) || state.skipped.has(id) || readsPaused()) return;
    state.ioTimers.set(id, setTimeout(() => {
      state.ioTimers.delete(id);
      if (state.inView.has(id) && !readsPaused() && !settled(id)) emitRead(id, 'view');
    }, READ_DWELL_MS));
  }
  function disarmUnit(id) {
    clearTimeout(state.ioTimers.get(id));
    state.ioTimers.delete(id);
  }
  // The tab hidden / a dialog opened: every timer stops; shown / closed again: the units still in view start over.
  let pausedReads = readsPaused();
  function syncReadPause() {
    const paused = readsPaused();
    if (paused === pausedReads) return;
    pausedReads = paused;
    if (!paused) {
      if (state.view === 'sentence') armSentence();
      else for (const id of state.inView) armUnit(id);
    } else {
      clearTimeout(state.readTimer);
      state.readTimer = 0;
      for (const id of [...state.ioTimers.keys()]) disarmUnit(id);
    }
  }
  document.addEventListener('visibilitychange', syncReadPause);
  if (typeof MutationObserver === 'function') {
    new MutationObserver(syncReadPause).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  }
  function paintReadTick() {
    const el = root.querySelector('.sentence__read');
    const u = state.units[state.current];
    if (!el || !u) return;
    el.hidden = !state.progress.has(u.id);
    const label = el.querySelector('[data-read-label]');
    if (label) label.textContent = readTickText(progressValueOf(state.progress, u.id));
  }

  /* --- the current sentence (last position) ------------------------- */
  // `position` events carry the sentence the reader is on — sentence view's
  // sentence, passage view's tapped / played one or, while scrolling, the one
  // nearest the top third of the viewport (nearestUnit) — main.js debounces
  // them into settings.lastPosition. The same line is where scrollToCurrent()
  // puts a sentence, so the two views resume from the same place.
  function emitPosition() {
    const u = state.units[state.current];
    if (u) emit('position', { unit: u, view: state.view });
  }
  function thirdLine() {
    const barH = barHeight();
    return barH + (window.innerHeight - barH) / 3;
  }
  function trackScroll() {
    state.scrollRaf = 0;
    if (state.view !== 'passage' || !state.units.length || state.playing || performance.now() < state.settleUntil) return;
    const y = thirdLine();
    const boxes = [];
    for (const el of root.querySelectorAll('.unit')) {
      const r = el.getBoundingClientRect();
      boxes.push({ id: el.dataset.id, top: r.top, bottom: r.bottom });
    }
    const u = state.byId.get(nearestUnit(boxes, y));
    if (!u || u.order === state.current) return;
    state.current = u.order;
    emitPosition();
  }
  window.addEventListener('scroll', () => { if (!state.scrollRaf) state.scrollRaf = requestAnimationFrame(trackScroll); }, { passive: true });
  /** Scroll a unit's first line to the top third of the viewport (below the sticky header). */
  /**
   * Passage view's scroll anchor — the unit under the learner's eye, with
   * its on-screen top: the one at the third line (what trackScroll() reads
   * and scrollToCurrent() aims at), so a change that reflows the text above
   * it leaves *that* sentence where it is. At the head of the page (nothing
   * scrolled off) there is no anchor: the top stays the top. null when none.
   */
  function firstUnitInView() {
    if (window.scrollY < 1) return null;
    const y = thirdLine();
    const boxes = [];
    for (const u of root.querySelectorAll('.unit')) {
      const r = u.getBoundingClientRect();
      if (r.height > 0) boxes.push({ id: u.dataset.id, top: r.top, bottom: r.bottom });
    }
    const id = nearestUnit(boxes, y);
    const b = boxes.find((x) => x.id === id);
    if (!b) return null;
    // The text line itself, when the DOM survives the change (a size step,
    // a display toggle): a sentence spanning several lines has one top, but
    // the lines between it and the reading line change with the measure.
    const word = wordAt(root.querySelector(`.unit[data-id="${CSS.escape(b.id)}"]`), y);
    return { id: b.id, top: b.top, el: word, lineTop: word ? word.getBoundingClientRect().top : null };
  }
  /**
   * The word of `unitEl`'s Latin nearest the reading line `y` (viewport px):
   * the one whose box straddles it, else the closest by vertical distance.
   * Geometry, not hit-testing — keepInView() runs while the Settings dialog
   * is modal, and elementFromPoint / caretPositionFromPoint would find its
   * backdrop. A word never wraps inside, so its top is its line's top
   * whatever the measure. null without one.
   */
  function wordAt(unitEl, y) {
    if (!unitEl) return null;
    let best = null;
    let bestD = Infinity;
    for (const w of unitEl.querySelectorAll('.la .w')) {
      const r = w.getBoundingClientRect();
      if (!(r.height > 0)) continue;
      const d = r.top <= y && r.bottom >= y ? 0 : Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y));
      if (d < bestD) { bestD = d; best = w; if (d === 0) break; }
    }
    return best;
  }
  function scrollUnitToThird(el, behavior) {
    const top = window.scrollY + el.getBoundingClientRect().top - thirdLine();
    state.settleUntil = performance.now() + 800;   // the scroll in flight is not the learner's
    window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: behavior ?? (reduced.matches ? 'auto' : 'smooth') });
  }
  /** Put the anchor unit (firstUnitInView) back at the on-screen top it had. */
  function restoreAnchor(anchor) {
    if (state.view !== 'passage') return;
    let d = null;
    if (anchor.el?.isConnected && anchor.lineTop != null) {   // the same word, while it is still on the page (no re-render)
      const r = anchor.el.getBoundingClientRect();
      if (r.height > 0) d = r.top - anchor.lineTop;
    }
    if (d == null) {
      const el = root.querySelector(`.unit[data-id="${CSS.escape(anchor.id)}"]`);
      if (!el) return;
      d = el.getBoundingClientRect().top - anchor.top;
    }
    if (Math.abs(d) > 0.5) window.scrollTo({ top: window.scrollY + d, behavior: 'auto' });
  }

  /* --- scroll hold -------------------------------------------------- */
  // A change that reflows the text (a re-render, a settings save, Book
  // lines) is followed by layout the browser only finishes over the next
  // frames — the margin reflow (next frame, and again when the reserved
  // heights change), fonts, the lazy pictures decoding — each moving the
  // text under the viewport after any one synchronous correction.
  // holdScroll(place) runs `place()` now and again on the next two frames,
  // after every reflow(), after each picture that loads, at 200 ms and at
  // the end of the window (500 ms), with trackScroll() told those scrolls
  // are not the learner's (settleUntil) so the current sentence is never
  // re-labelled meanwhile. A wheel, a touch or a scrolling key outside a
  // dialog ends it early — closing Settings with Escape or Done does not.
  // One hold at a time: a new one replaces the last; a `sticky` hold (the
  // Book lines switch placing its sentence) is left alone by keepInView().
  const HOLD_MS = 500;
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  let hold = null;
  let holdSeq = 0;
  function holdScroll(place, { ms = HOLD_MS, sticky = false } = {}) {
    stopHold();
    const h = { seq: ++holdSeq, sticky, until: performance.now() + ms, timers: [], raf: 0 };
    const cancel = (e) => {
      if (e.type === 'keydown' && !SCROLL_KEYS.has(e.key)) return;
      if (e.target?.closest?.('dialog[open]')) return;   // scrolling inside Settings is not scrolling the text
      stopHold();
    };
    h.off = () => { for (const ev of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(ev, cancel, true); };
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.addEventListener(ev, cancel, { capture: true, passive: true });
    h.apply = () => {
      if (hold !== h) return;
      if (performance.now() > h.until + 50) { stopHold(); return; }
      state.settleUntil = Math.max(state.settleUntil, performance.now() + 150);
      place();
    };
    hold = h;
    h.apply();
    h.raf = requestAnimationFrame(() => { h.apply(); h.raf = requestAnimationFrame(h.apply); });
    h.timers.push(setTimeout(h.apply, 200), setTimeout(() => { h.apply(); stopHold(); }, ms));
    return h;
  }
  function stopHold() {
    if (!hold) return;
    const h = hold;
    hold = null;
    h.off();
    cancelAnimationFrame(h.raf);
    for (const t of h.timers) clearTimeout(t);
  }
  root.addEventListener('load', (e) => { if (e.target instanceof HTMLImageElement) hold?.apply(); }, true);   // a picture decoded: the text under it moved

  // The spoken-word cursor (audio.js → setPlayingWord): the unit's word
  // tokens in text order, margin notes and the lookups list excluded. The
  // element list is kept for the unit under the cursor and rebuilt per render.
  let wordEls = { unitId: null, els: [] };
  function applyPlayingWord() {
    root.querySelector('.w--now')?.classList.remove('w--now');
    const pw = state.playingWord;
    if (!pw) return;
    if (wordEls.unitId !== pw.unitId || !wordEls.els.length || !wordEls.els[0].isConnected) {
      const unitEl = root.querySelector(`[data-id="${CSS.escape(pw.unitId)}"]`);
      wordEls = { unitId: pw.unitId, els: unitEl ? [...unitEl.querySelectorAll('.la .w, .sentence__la .w')] : [] };
    }
    wordEls.els[pw.idx]?.classList.add('w--now');
  }

  function reflow() {
    layoutMargin();
    dedupeLineNumbers();
    hold?.apply();   // the layout just moved the text: the held sentence goes back
  }

  // Gutter vs inline margin notes: first the room beside the prose
  // (marginMode), then, part by part, the density of the glosses — a part
  // whose stacked notes would still sit more than ~a line below their
  // sentences after the pull-up is shown inline instead. <article data-margin-mode> carries the
  // overall answer (gutter while any part keeps the gutter), every .part its own.
  // Book mode keeps the gutter whatever the density (the glosses are placed
  // by line number and may stack below their line): an inline part would
  // make every sentence with notes a block and cut the printed lines.
  const DRIFT_LINES = 0.9;   // same bound as the pull-up: a note stays within a text line of its sentence either way
  const probe = h('span', { class: 'margin-probe', 'aria-hidden': 'true' });
  function layoutMargin() {
    if (state.view !== 'passage') { delete root.dataset.marginMode; clearBookColumn(); return; }
    const prose = root.querySelector('.prose');
    if (!prose) return;
    if (!probe.isConnected) root.append(probe);
    const rs = getComputedStyle(root);
    const main = root.parentElement ?? root;
    const padL = parseFloat(rs.paddingLeft);
    const padR = parseFloat(rs.paddingRight);
    const available = main.clientWidth - padL - padR;
    const em = parseFloat(rs.fontSize);
    const colPx = probe.offsetWidth;
    const gutterPx = parseFloat(getComputedStyle(prose).paddingLeft);
    // Book mode: the gutter needs room for a typical printed line and its marks beside the notes column, not just the 18 em of flow text.
    const need = state.lineMode === 'book' && weekHasLines(state.units) ? bookNeed(em) : null;
    let mode = marginMode({ wide: wide.matches, available, em, colPx, gutterPx, minEm: need ? Math.max(18, (need.typicalPx + need.marksW + need.pad) / em) : undefined });
    const book = !!need;
    const withColumn = mode === 'gutter' && root.dataset.margin !== 'off';
    if (need) sizeBookColumn(need, { available, colPx: withColumn ? colPx : 0, gutterPx, padL, padR });
    else clearBookColumn();
    const parts = [...root.querySelectorAll('.part')];
    if (withColumn) {
      if (root.dataset.marginMode !== 'gutter') root.dataset.marginMode = 'gutter';   // measure with the column in place
      const lineHeight = parseFloat(rs.lineHeight) || em * 1.55;
      if (!positionMargin(parts, em, lineHeight, { demote: !book })) mode = 'inline';
    } else {
      for (const p of parts) { p.dataset.marginMode = 'inline'; for (const pr of p.querySelectorAll('.prose')) pr.style.removeProperty('min-height'); }
    }
    if (root.dataset.marginMode !== mode) root.dataset.marginMode = mode;
  }
  // Book mode: the column is sized from the data — the widest printed line
  // of the week in the reading face (printedLines() per part, measured on a
  // canvas once per week, face and size) plus a column at the line's right
  // for the † and play buttons (CSS: .unit--line .marks, --marks-w per
  // slot, --marks-room for as many slots as the room allows, one at least)
  // — so no printed line wraps where the screen has the room. The article's
  // max-width says the rest: gutter, padding, the notes column when in use.
  // Where the room is short (a tablet, a very long line) the column takes
  // what there is and the longest lines wrap, their numbers staying single;
  // without the notes column the marks may stand over the article's own
  // right padding, and a second set on a line that has no slot for it stays
  // inline in the text (.marks--inline) rather than hang past the edge.
  const bookCache = { key: null, textPx: 0, typicalPx: 0 };
  function measurePrintedLines(font) {
    const key = `${state.week?.n ?? ''}|${font}`;
    if (bookCache.key === key) return bookCache;
    const widths = [];
    const ctx = document.createElement('canvas').getContext?.('2d');
    if (ctx) {
      ctx.font = font;
      const parts = state.week?.parts?.length ? state.week.parts : [{ part: null }];
      for (const p of parts) {
        for (const L of printedLines(state.units.filter((u) => (p.part ? u.part === p.part : true)))) widths.push(ctx.measureText(L.text).width);
      }
    }
    widths.sort((a, b) => a - b);
    const slack = (w) => Math.ceil(w * 1.01) + 2;   // a little for shaping / rounding
    bookCache.key = key;
    bookCache.textPx = widths.length ? slack(widths[widths.length - 1]) : 0;
    bookCache.typicalPx = widths.length ? slack(widths[Math.floor(0.9 * (widths.length - 1))]) : 0;   // the 90th percentile: what the gutter must leave room for
    return bookCache;
  }
  function bookNeed(em) {
    const ps = getComputedStyle(root.querySelector('.prose') ?? root);
    const { textPx, typicalPx } = measurePrintedLines(`${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`);
    let marksW = 0;
    for (const m of root.querySelectorAll('.unit--line .marks')) { m.classList.remove('marks--inline'); marksW = Math.max(marksW, m.getBoundingClientRect().width); }
    return { textPx, typicalPx, marksW: Math.ceil(marksW), pad: Math.round(0.4 * em) };   // pad: between the text and the marks
  }
  function sizeBookColumn({ textPx, marksW, pad }, { available, colPx, gutterPx, padL, padR }) {
    const over = colPx ? 0 : padR;                       // no notes column: the marks may stand over the article's right padding
    const room = available - gutterPx - colPx + over;    // for the text and the marks together
    const slots = marksW > 0 ? Math.max(1, Math.min(state.bookMaxMarks || 1, Math.floor((room - textPx - pad) / marksW))) : 0;
    const marksRoom = slots ? Math.max(0, slots * marksW + pad - over) : 0;
    root.style.setProperty('--marks-w', `${marksW}px`);
    root.style.setProperty('--marks-room', `${marksRoom}px`);
    root.style.maxWidth = `${Math.ceil(textPx + marksRoom + gutterPx + padL + padR + colPx)}px`;
    for (const m of root.querySelectorAll('.unit--line .marks[style]')) {
      if ((parseInt(m.style.getPropertyValue('--mark-i'), 10) || 0) >= slots) m.classList.add('marks--inline');
    }
  }
  function clearBookColumn() {
    root.style.removeProperty('--marks-w');
    root.style.removeProperty('--marks-room');
    root.style.removeProperty('max-width');
  }
  // Content-area top of a unit's first text box, relative to its .prose. A
  // Range over the Latin finds the first line whatever the unit's display
  // (inline, verse/turn blocks, interleaved translation); offsetTop would be
  // the line-box top for block units and sit the note too high.
  // In book mode a block whose glosses name a printed line (`line`) is set
  // level with that line when it is its own screen line: the line's number
  // (.lineno[data-line], in the unit, else anywhere in the prose) finds it,
  // and the first text after the number is measured. Else the first line.
  function firstLineTop(unit, proseTop, line = null) {
    const la = unit.querySelector('.la') ?? unit;
    let top = null;
    if (line != null && state.lineMode === 'book') {
      const sel = `.lineno[data-line="${CSS.escape(String(line))}"]`;
      const num = unit.querySelector(sel) ?? unit.closest('.prose')?.querySelector(sel);
      if (num) top = textTop(num.closest('.unit') ?? la, num);   // the number's own unit (a flow number stands outside .la): the walker's root must contain it
    }
    if (top == null) top = textTop(la);
    return top != null ? top - proseTop : unit.offsetTop;
  }
  /** Top of the first text box in `container` (after `after`, a node inside it, when given); line numbers are skipped. null without one. */
  function textTop(container, after = null) {
    try {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      if (after) walker.currentNode = after;
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('.lineno')) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.height > 0) return r.top;
      }
    } catch { /* fall through */ }
    return null;
  }
  /** Lay every part out as a gutter, keep the ones whose notes stay beside their sentences (`demote: false` keeps them all — book mode). Returns whether any did. */
  function positionMargin(parts, textSize, textLineHeight, { demote = true } = {}) {
    let anyGutter = false;
    for (const part of parts) part.dataset.marginMode = 'gutter';
    for (const part of parts) {
      const gutter = part.querySelector('.margin');
      if (!gutter) continue;                       // nothing to place: follows the article
      const prose = gutter.parentElement;
      prose.style.removeProperty('min-height');
      const blocks = [...gutter.children].filter((el) => el.offsetHeight > 0);   // pictures switched off take no room
      if (!blocks.length) continue;
      const proseTop = prose.getBoundingClientRect().top;
      const note = blocks.find((el) => el.classList.contains('mnote')) ?? blocks[0];
      const ns = getComputedStyle(note);
      const noteSize = parseFloat(ns.fontSize);
      const noteLineHeight = parseFloat(ns.lineHeight) || noteSize * 1.3;
      const gap = Math.round(noteLineHeight * 0.4);
      const items = blocks.map((el) => {
        const unit = prose.querySelector(`.unit[data-id="${CSS.escape(el.dataset.for)}"]`);
        const contentTop = unit ? firstLineTop(unit, proseTop, el.dataset.line ?? null) : 0;
        const pinned = el.classList.contains('mpic');   // a picture sits level with its sentence's first line; the notes flow under it
        return { el, pinned, unit: el.dataset.for, top: pinned ? Math.round(contentTop) : marginTop({ contentTop, textSize, noteSize, noteLineHeight }), height: el.offsetHeight };
      });
      const tops = stackMargin(items, gap, { maxUp: Math.round(textLineHeight * 0.9) });   // pulled up, but never a full line above its sentence
      const drift = marginDrift(items, tops, gap);
      if (demote && drift > DRIFT_LINES * textLineHeight) {
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
  // numbers on top of each other; keep the first. The same printed number
  // twice in a row (a line that wraps on a phone, then the sentence that
  // continues it) is one number too. Re-run whenever the text reflows.
  // Runs after layoutMargin() has settled every part's mode (the numbers are
  // measured in the layout they end up in), on every reflow and resize.
  function dedupeLineNumbers() {
    if (state.view !== 'passage') return;
    const els = [...root.querySelectorAll('.lineno')];
    for (const el of els) el.classList.remove('lineno--dup');
    const dups = lineNumberDups(els.map((el) => ({ top: Math.round(el.getBoundingClientRect().top), line: el.dataset.line ?? null })));
    els.forEach((el, i) => { if (dups[i]) el.classList.add('lineno--dup'); });
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
  window.addEventListener('resize', scheduleReflow);
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
      hl: hlEl ? { label: hlEl.dataset.hlLabel, note: hlEl.dataset.hlNote, text: hlEl.dataset.hlText, simple: hlEl.dataset.hlSimple ?? null } : null,
    };
  }
  root.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (w) { setCurrentFrom(w); emit('word', wordFrom(w)); return; }
    const gt = e.target.closest('[data-gloss-toggle]');
    if (gt) { toggleGloss(gt.dataset.glossToggle); return; }
    const po = e.target.closest('[data-pic-open]');
    if (po) { setCurrentFrom(po); openPicture(po.dataset.picOpen, po); return; }
    const nm = e.target.closest('.notemark');
    if (nm) { setCurrentFrom(nm); emit('note', { unit: state.byId.get(nm.dataset.noteFor), el: nm }); return; }
    const pb = e.target.closest('.playbtn');
    if (pb) { emit('play', { unitId: pb.dataset.play, weekN: state.week?.n }); return; }
    const sb = e.target.closest('[data-summary]');
    if (sb) {
      const part = state.week?.parts?.find((p) => p.part === sb.dataset.summary);
      if (part) emit('summary', { part, unitId: firstUnitOf(part)?.id ?? null, el: sb, body: summaryBody(part) });
      return;
    }
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
    if (!unitEl) return;
    const order = Number(unitEl.dataset.order);
    if (order === state.current) return;
    state.current = order;
    emitPosition();
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
    /** Replace the week. `extra.audio` / `extra.lookups` / `extra.pictures` (store.getPictures rows) are applied before the single render. */
    setWeek(week, units, highlights, extra = {}) {
      if ('audio' in extra) state.audio = extra.audio instanceof Set ? extra.audio : !!extra.audio;
      if (extra.lookups) { state.lookups = extra.lookups; state.seen = activeUnderlines(extra.lookups); }
      if (extra.progress) state.progress = extra.progress;
      const newWeek = state.week?.n !== week?.n;
      state.week = week;
      state.units = [...units].sort((a, b) => a.order - b.order);
      state.byId = new Map(state.units.map((u) => [u.id, u]));
      state.tokens.clear();
      state.marginTokens.clear();
      state.summaryTokens.clear();
      state.glossOpen.clear();
      state.picTokens.clear();
      state.pictures = groupPictures(extra.pictures ?? []);
      for (const id of state.pictures.keys()) if (!state.byId.has(id)) console.warn('[reader] picture for unknown unit', id);
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
      state.current = newWeek ? 0 : Math.min(state.current, Math.max(0, state.units.length - 1));
      if (newWeek && state.view === 'passage') window.scrollTo({ top: 0, behavior: 'auto' });   // a fresh week opens at its head (goToUnit() may then move on)
      render();
    },
    /** The sentences already read (store.getProgressRows(): unit id → row): the tick in sentence view, and no timers for the settled ones. */
    setProgress(map) {
      const prev = state.progress;
      state.progress = map ?? new Map();
      for (const id of [...state.inView]) if (settled(id)) { disarmUnit(id); state.inView.delete(id); }
      const u = state.units[state.current];
      if (state.view === 'sentence' && u && settled(u.id)) { clearTimeout(state.readTimer); state.readTimer = 0; }
      // A reset (ids gone from the map): passage view watches those units again — except the ones in view right now.
      if (state.view === 'passage' && [...prev.keys()].some((id) => !state.progress.has(id))) observeUnits(true);
      paintReadTick();
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
      if (state.playing) api.setPlayingUnit(state.playing);   // sentence view moves to the playing sentence; passage view scrolls to it
      if (view === 'sentence') announce();
      else if (!state.playing) api.scrollToCurrent();
    },
    getView: () => state.view,
    /**
     * settings.lineMode: 'book' lays passage view out one printed line per
     * line for the units with line data (CONTRACT.md "Book lines"); anything
     * else is the flow layout. A change re-renders passage view (sentence
     * view is untouched: the next setView renders). `settle` — the learner's
     * own switch — puts the current sentence back on its line afterwards;
     * a change arriving from another device leaves the viewport alone.
     */
    setLineMode(mode, { settle = false } = {}) {
      const next = mode === 'book' ? 'book' : 'flow';
      if (next === state.lineMode) return;
      state.lineMode = next;
      if (!state.week || state.view !== 'passage') return;
      const wanted = state.current;   // captured before the render: the sentence the learner was on
      render();
      if (!settle) return;
      // The whole passage changes shape: the current sentence is put back on
      // its line now and again while the layout settles (holdScroll: the
      // margin reflow, the pictures re-created by the render coming in
      // lazily). It stays the current sentence throughout — the tracker is
      // held off, and the place is forced rather than checked.
      holdScroll(() => {
        if (state.lineMode !== next || state.view !== 'passage' || state.playing) return;
        state.current = wanted;
        api.scrollToCurrent('auto');
      }, { sticky: true });
    },
    getLineMode: () => state.lineMode,
    /** The unit the reader is on (sentence view's sentence; the last tapped/played one in passage view). */
    getCurrentUnit: () => state.units[state.current] ?? null,
    goTo(order) {
      if (order < 0 || order >= state.units.length) return;
      if (state.view === 'sentence' && order > state.current) {   // moved past with Next / j: the sentence left behind counts as read (a review only after READ_DWELL_MS: nextCounts)
        const prev = state.units[state.current];
        if (prev && nextCounts({ value: progressValueOf(state.progress, prev.id), settled: settled(prev.id), heldMs: Date.now() - state.currentSince })) emitRead(prev.id, 'next');
      }
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
    /**
     * Go to a sentence by id in whichever view is on: sentence view navigates
     * to it (goTo: announced, focused); passage view scrolls it to the top
     * third and makes it current. `quiet` (boot resume): no announcement, no
     * focus, no smooth scroll. Returns false for an unknown id.
     */
    goToUnit(unitId, { quiet = false } = {}) {
      const u = state.byId.get(unitId);
      if (!u) return false;
      if (state.view === 'sentence') {
        if (!quiet) { api.goTo(u.order); return true; }
        state.current = u.order;
        render();
        root.querySelector('.sentence')?.scrollIntoView({ block: 'start', behavior: 'auto' });
      } else {
        state.current = u.order;
        api.scrollToCurrent(quiet ? 'auto' : undefined);
        emitPosition();
        if (!quiet) announce();
      }
      emit('navigate', { unit: u, order: u.order });
      return true;
    },
    /**
     * Run `fn` — a display change that reflows the text above the viewport
     * (play buttons or pictures switched off, the translation shown) — and
     * put the first sentence in view back where it was on screen. The
     * browser's own scroll anchoring compensates only for the node it picked;
     * this holds the text the learner is reading. No-op outside passage view.
     */
    keepInView(fn) {
      const anchor = state.view === 'passage' ? firstUnitInView() : null;
      const seq = holdSeq;
      fn();
      if (hold?.sticky && hold.seq > seq) return;   // fn placed its own sentence (the Book lines switch): leave that alone
      if (anchor) holdScroll(() => restoreAnchor(anchor));   // now, and again while the layout settles (frames, reflow, pictures)
    },
    /** Scroll passage view's current sentence to the top third of the viewport (the line trackScroll() reads). */

    scrollToCurrent(behavior) {
      const el = root.querySelector(`.unit[data-order="${state.current}"]`);
      if (el) scrollUnitToThird(el, behavior);
    },
    /**
     * Audio hook: mark the unit now playing (null clears). Sentence view
     * follows along to that sentence *silently* — the recording is what the
     * user is attending to, so unlike goTo() this neither announces the
     * sentence in the live region nor moves keyboard focus: a focus inside
     * the listen bar (Pause, the speed) stays on that control across the
     * re-render, and a focus on the old sentence moves to the new one without
     * scrolling.
     */
    setPlayingUnit(unitId) {
      state.playing = unitId;
      root.querySelector('.is-playing')?.classList.remove('is-playing');
      if (!unitId) { if (state.playingWord) { state.playingWord = null; applyPlayingWord(); } return; }
      if (state.view === 'sentence') {
        const u = state.byId.get(unitId);
        if (u && u.order !== state.current) {
          state.current = u.order;
          const focused = document.activeElement;
          const inListen = !!(listen && focused && listen.contains(focused));
          const inRoot = !inListen && !!(focused && root.contains(focused));
          render();   // re-renders with .is-playing; moves #listen (which blurs whatever it held)
          if (inListen && focused.isConnected && !focused.hidden) focused.focus({ preventScroll: true });
          else if (inListen || inRoot) root.querySelector('.sentence')?.focus({ preventScroll: true });
          root.querySelector('.sentence')?.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
          emit('navigate', { unit: u, order: u.order });
          return;
        }
      }
      const el = root.querySelector(`[data-id="${CSS.escape(unitId)}"]`);
      if (el) { el.classList.add('is-playing'); el.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' }); }
      const u = state.byId.get(unitId);
      if (u && u.order !== state.current) { state.current = u.order; emitPosition(); }   // the played sentence is the current one
    },
    /** Audio hook: the word being spoken — `idx` counts the unit's word tokens (wordTexts) in text order; null clears. */
    setPlayingWord(unitId, idx) {
      state.playingWord = unitId != null && idx != null && idx >= 0 ? { unitId, idx } : null;
      applyPlayingWord();
    },
    /** The unit's word tokens as rendered, in text order (what setPlayingWord's index counts). */
    wordTexts(unitId) {
      const u = state.byId.get(unitId);
      return u ? tokensFor(u).filter((t) => t.isWord).map((t) => t.text) : [];
    },
    /** The unit's resolved grammar-focus highlights ({text, label, note, simple, start, end}), in text order. */
    highlightsOf(unitId) {
      return [...(state.hl.get(unitId) ?? [])].sort((a, b) => a.start - b.start);
    },
    /** The unit's word tokens with their lookup form and character offset, in text order. */
    wordTokens(unitId) {
      const u = state.byId.get(unitId);
      return u ? tokensFor(u).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start })) : [];
    },
    /** Show per-unit play buttons: false, true (all units) or a Set of aligned unit ids. */
    setAudioAvailable(flag) {
      const next = flag instanceof Set ? flag : !!flag;
      if (next === state.audio) return;
      state.audio = next;
      render();
    },
    rerender: render,
    /**
     * Replace the week's pictures (store.getPictures rows). The same pictures
     * with new URLs (a re-sign) are swapped into the existing <img>s in place;
     * anything else (pictures added, removed, switched off) re-renders.
     */
    setPictures(rows) {
      const prev = state.pictures;
      state.pictures = groupPictures(rows ?? []);
      if (pictureShape(prev) === pictureShape(state.pictures)) { swapPictureUrls(prev); return; }
      state.picTokens.clear();
      render();
    },
    /** A part's summary (English, "In Latin", tappable Latin) as a fresh element for the panel; null without one. */
    summaryBody: (part) => summaryBody(part),
    /** Re-measure margin notes and line numbers (after a display toggle or font change). */
    reflow: scheduleReflow,
    unitElement: (unitId) => root.querySelector(`[data-id="${CSS.escape(unitId)}"]`),
  };
  return api;
}
