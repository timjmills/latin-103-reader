// node --test tests/ — a paradigm that does not fit its box stacks instead of scrolling sideways
// (docs/GRAMMAR-CONTRACT.md §26).
//
//   "For the phone, parts of paradym charts should stack underneith each other so that you dont
//    have to scroll sidewise."
//
// Two things here are pure and are driven for real rather than read off the source:
//
//   - **the decision.** `stackStep` is the whole of "does it fit", and the thing that has to be
//     proved about it is that it *settles*: stacking narrows the content, so a watcher that simply
//     re-asked the stacked layout whether it fits would unstack it, overflow, stack it again, for
//     ever. The remembered width is what breaks that, and the tests below run the loop.
//   - **the labelling.** A table names a cell by a row and a column. Stacked, the column heading
//     goes to the block and the row label stays on the line, so `stackPlan` is where "which cell is
//     this" is decided.
//
// `foldable` is DOM work, but it is the part the drill chart's inputs live or die by, so it is
// driven too — against a small fake document that is honest about the one thing that matters: a
// cell is *moved*, so the very node that held the learner's typing is the node in the block.
//
// The source assertions at the end are for wiring a fake DOM cannot reach (three call sites, three
// stylesheets). Comment lines are stripped before every one of them: a test in this repo has passed
// against its own explanatory comment before.
//
// No Latin from the book appears here: the words below are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(ROOT, p), 'utf8')
  .split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

/* ------------------------------------------------------------- a fake DOM */
// Only what wordpanel.js's `h()` and `foldable()` touch: children, text, classes, cloning, and the
// three table collections. `moveBefore` is deliberately absent, which is the fallback path.

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.kids = []; this.attrs = {}; this.cls = new Set(); this.parentNode = null; }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this.cls;
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => (on ?? !s.has(c) ? s.add(c) : s.delete(c)) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.root === true; }
  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      if (typeof n === 'string') { this.kids.push(n); continue; }
      if (n.parentNode) n.parentNode.kids.splice(n.parentNode.kids.indexOf(n), 1);
      n.parentNode = this;
      this.kids.push(n);
    }
  }
  remove() { if (this.parentNode) { this.parentNode.kids.splice(this.parentNode.kids.indexOf(this), 1); this.parentNode = null; } }
  get textContent() { return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); }
  set textContent(v) { this.kids = [String(v)]; }
  cloneNode() { const c = new El(this.tagName); c.cls = new Set(this.cls); c.attrs = { ...this.attrs }; c.kids = this.kids.map((k) => (typeof k === 'string' ? k : k.cloneNode(true))); c.kids.forEach((k) => { if (typeof k !== 'string') k.parentNode = c; }); return c; }
  el(tag) { return this.kids.filter((k) => typeof k !== 'string' && k.tagName === tag); }
  get children() { return this.kids.filter((k) => typeof k !== 'string'); }
  get caption() { return this.el('CAPTION')[0] ?? null; }
  get tHead() { return this.el('THEAD')[0] ?? null; }
  get tBodies() { return this.el('TBODY'); }
  get rows() { return this.el('TR'); }
  get cells() { return this.children.filter((k) => k.tagName === 'TD' || k.tagName === 'TH'); }
}

const withDom = (fn) => {
  const had = 'document' in globalThis;
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => new El(t) };
  try { return fn(); } finally { if (had) globalThis.document = prev; else delete globalThis.document; }
};

const { stackStep, stackPlan, foldable } = await withDom(() => import('../app/js/wordpanel.js'));

/** A built `.pt` table, as renderParadigm and chartInput build one. `cell(row, col)` makes the <td>. */
function ptTable({ caption = 'cases', hiddenCaption = false, headers = ['singular', 'plural'], rowLabels = ['nominative', 'genitive'], cell }) {
  const el = (tag, cls) => { const e = new El(tag); if (cls) e.className = cls; return e; };
  const table = el('table', 'pt');
  const cap = el('caption', hiddenCaption ? 'visually-hidden' : 'pt__caption');
  cap.textContent = caption;
  table.append(cap);
  const head = el('thead');
  const hr = el('tr');
  hr.append(el('th', 'pt__corner'), ...headers.map((h) => { const th = el('th'); th.textContent = h; return th; }));
  head.append(hr);
  table.append(head);
  const body = el('tbody');
  rowLabels.forEach((label, r) => {
    const tr = el('tr');
    const th = el('th', '');
    th.setAttribute('scope', 'row');
    th.textContent = label;
    tr.append(th, ...headers.map((_, c) => cell(r, c)));
    body.append(tr);
  });
  table.append(body);
  const host = new El('div');
  host.className = 'pt__scroll';
  host.root = true;              // the fake document's ground, so `isConnected` means something
  host.append(table);
  return { table, host, el };
}

/* ------------------------------------------------ the decision: does it fit */

/** The watcher's own loop, exactly as settle() runs it: measure, act, measure again while asked. */
function run(box, state = { stacked: false, need: 0 }, { reset = false } = {}) {
  for (let i = 0; i < 8; i++) {
    const r = stackStep({ ...state, scrollWidth: box.scrollWidth(state.stacked), clientWidth: box.clientWidth, reset: i === 0 && reset });
    const flips = r.stacked !== state.stacked;
    state = { stacked: r.stacked, need: r.need };
    if (flips) box.flips = (box.flips ?? 0) + 1;
    if (!r.again) return state;
  }
  throw new Error('the fit decision never settled');
}

/** A table 520px wide laid out as a table, and 180px wide once its columns are stacked. */
const box = (clientWidth) => ({ clientWidth, flips: 0, scrollWidth: (stacked) => (stacked ? Math.min(180, clientWidth) : Math.max(520, clientWidth)) });

test('a table wider than its box stacks; one that fits is left alone — the box decides, not a width', () => {
  assert.deepEqual(run(box(375)), { stacked: true, need: 520 }, 'a phone kept the sideways scroll');
  assert.deepEqual(run(box(500)), { stacked: true, need: 520 }, 'a box 20px short of the table kept the sideways scroll');
  assert.deepEqual(run(box(760)), { stacked: false, need: 0 }, 'a table with room to spare was stacked anyway');
});

test('stacking settles: the narrower stacked layout never talks the watcher into unstacking it', () => {
  const b = box(375);
  const first = run(b);
  assert.equal(first.stacked, true);
  // Every later measurement of the same box — the observer fires on the height change stacking caused,
  // and on every scroll, keyboard and orientation event after it.
  let st = first;
  for (let i = 0; i < 20; i++) st = run(b, st);
  assert.deepEqual(st, { stacked: true, need: 520 });
  assert.equal(b.flips, 1, 'the layout kept flipping between stacked and not');
});

test('it unstacks only when the box is as wide as the table asked for, and corrects itself if it was not', () => {
  const narrow = run(box(375));                       // need = 520
  assert.deepEqual(run({ ...box(519), flips: 0 }, narrow), { stacked: true, need: 520 }, 'one pixel short and it unstacked');
  assert.deepEqual(run({ ...box(700), flips: 0 }, narrow), { stacked: false, need: 0 }, 'the box grew and the table did not come back');
  // A table that turns out to need *more* than it said (a longer form drawn into a cell): the watcher
  // unstacks, sees the overflow, and remembers the larger width — which is why it cannot loop.
  const grew = { clientWidth: 600, flips: 0, scrollWidth: (s) => (s ? 180 : 640) };
  const after = run(grew, narrow);
  assert.deepEqual(after, { stacked: true, need: 640 });
  assert.equal(grew.flips, 2, 'the correction took more than one unstack-and-stack');
  assert.deepEqual(run({ ...grew, flips: 0 }, after), { stacked: true, need: 640 }, 'and then it settled');
});

test('a box that has not been laid out decides nothing — a closed <details> is not a table that fits', () => {
  assert.deepEqual(stackStep({ stacked: false, need: 0, scrollWidth: 0, clientWidth: 0 }), { stacked: false, need: 0, again: false });
  assert.deepEqual(stackStep({ stacked: true, need: 520, scrollWidth: 0, clientWidth: 0 }), { stacked: true, need: 520, again: false }, 'a hidden panel unstacked its table behind the learner');
});

test('a type-size change forgets the remembered width: it was measured of a different font', () => {
  const smaller = { clientWidth: 375, flips: 0, scrollWidth: (s) => (s ? 180 : 300) };   // the type size came down
  assert.deepEqual(run(smaller, { stacked: true, need: 520 }, { reset: true }), { stacked: false, need: 0 }, 'the table stayed stacked in a box it now fits');
  const bigger = { clientWidth: 375, flips: 0, scrollWidth: (s) => (s ? 180 : 900) };
  assert.deepEqual(run(bigger, { stacked: true, need: 520 }, { reset: true }), { stacked: true, need: 900 }, 'the larger type did not re-measure what the table needs');
});

/* --------------------------------------------- the labelling of a stacked cell */

test('one block per value column, in the table’s own order — singular, then plural', () => {
  const plan = stackPlan({ caption: 'cases', headers: ['singular', 'plural'], rowLabels: ['nominative', 'genitive'] });
  assert.deepEqual(plan.map((b) => b.head), ['singular', 'plural']);
  assert.deepEqual(plan.map((b) => b.col), [0, 1]);
});

test('a verb stacks by whatever the table’s own columns are, and three genders make three blocks', () => {
  assert.deepEqual(stackPlan({ caption: 'imperfect subjunctive', headers: ['active', 'passive'], rowLabels: ['I', 'we'] }).map((b) => b.head), ['active', 'passive']);
  assert.deepEqual(stackPlan({ caption: 'cases', headers: ['masculine', 'feminine', 'neuter'], rowLabels: ['nominative'] }).map((b) => b.head), ['masculine', 'feminine', 'neuter']);
});

test('a stacked cell is still named by its row and its column, and by the table it came from', () => {
  const [, plural] = stackPlan({ caption: 'cases', headers: ['singular', 'plural'], rowLabels: ['nominative', 'dative'] });
  assert.equal(plural.name, 'cases · plural');
  assert.deepEqual(plural.rows.map((r) => r.name), ['cases · plural · nominative', 'cases · plural · dative']);
  // What the eye sees is the heading; what a screen reader hears in front of it is the rest of the name.
  assert.equal(`${plural.pre}${plural.head}`, plural.name, 'the caption on screen and the name read aloud have come apart');
  const [act] = stackPlan({ caption: 'perfect indicative', headers: ['active', 'passive'], rowLabels: ['we'] });
  assert.equal(act.rows[0].name, 'perfect indicative · active · we');
});

test('one value column has nothing to tell apart: the block takes the whole name and says it once', () => {
  const [only] = stackPlan({ caption: 'participles', headers: ['form'], rowLabels: ['present active'] });
  assert.equal(only.head, 'participles · form');
  assert.equal(only.pre, '', 'the caption would have been printed twice');
});

test('a table with no caption and no headings still names every block', () => {
  const plan = stackPlan({ caption: '', headers: [], rowLabels: ['a'], cols: 2 });
  assert.deepEqual(plan.map((b) => b.head), ['column 1', 'column 2']);
  assert.equal(stackPlan({ caption: '', headers: [], rowLabels: [], cols: 0 }).length, 0);
});

/* ------------------------------------------- the cells are moved, not rebuilt */

/** A drill chart's cell: the `<td>` holds the wrap, the input, the ✓/✗ mark and the "?" button. */
function chartCell(r, c) {
  const td = new El('td');
  td.className = 'pt__cell g-chart__in';
  const wrap = new El('span'); wrap.className = 'g-cellwrap';
  const input = new El('input');
  input.className = 'g-input g-input--cell';
  input.setAttribute('aria-label', `cell ${r}-${c}`);
  input.value = `typed-${r}-${c}`;
  const mark = new El('span'); mark.className = 'g-cellmark';
  const hint = new El('button'); hint.className = 'g-hintb'; hint.textContent = '?';
  wrap.append(input, mark, hint);
  td.append(wrap);
  return td;
}

const inputsOf = (node) => { const out = []; const walk = (n) => { if (n.tagName === 'INPUT') out.push(n); n.children.forEach(walk); }; walk(node); return out; };

test('folding moves the very cell the learner typed into — the same node, with its value and its label', () => withDom(() => {
  const { table, host } = ptTable({ cell: chartCell });
  const before = inputsOf(table);
  assert.equal(before.length, 4);
  const f = foldable(table);
  f.fold(host);
  const stack = f.stack();
  const after = inputsOf(stack);
  assert.equal(after.length, 4, 'a cell was left behind in the table');
  for (const inp of before) assert.ok(after.includes(inp), 'a cell was rebuilt instead of moved: the learner’s writing is gone');
  assert.deepEqual(after.map((i) => i.value).sort(), ['typed-0-0', 'typed-0-1', 'typed-1-0', 'typed-1-1']);
  assert.deepEqual(after.map((i) => i.getAttribute('aria-label')).sort(), ['cell 0-0', 'cell 0-1', 'cell 1-0', 'cell 1-1']);
  // The ✓/✗ mark and the "?" travel inside the cell, so a graded cell keeps its colour and its hint.
  for (const inp of after) {
    const wrap = inp.parentNode;
    assert.equal(wrap.className, 'g-cellwrap');
    assert.deepEqual(wrap.children.map((c) => c.className), ['g-input g-input--cell', 'g-cellmark', 'g-hintb']);
  }
  assert.ok(table.classList.contains('pt--folded'), 'the emptied table is still on screen');
}));

test('the blocks read down the column, each line keeping the table’s row label', () => withDom(() => {
  const { table, host } = ptTable({ caption: 'cases', headers: ['singular', 'plural'], rowLabels: ['nominative', 'dative'], cell: chartCell });
  const f = foldable(table);
  f.fold(host);
  const blocks = f.stack().children.filter((c) => c.tagName === 'TABLE');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.caption.textContent), ['cases · singular', 'cases · plural']);
  for (const b of blocks) {
    assert.deepEqual(b.tBodies[0].rows.map((r) => r.cells[0].textContent), ['nominative', 'dative'], 'a stacked line does not say which cell it is');
    for (const r of b.tBodies[0].rows) assert.equal(r.cells[0].getAttribute('scope'), 'row', 'the row label stopped being a row heading');
  }
  // Column-major, and the first block is the first column: singular before plural, down each block.
  assert.deepEqual(inputsOf(f.stack()).map((i) => i.value), ['typed-0-0', 'typed-1-0', 'typed-0-1', 'typed-1-1']);
  // Tab follows the document, so the document is the order on screen.
  assert.deepEqual(f.plan.map((b) => b.head), ['singular', 'plural']);
}));

test('unfolding puts every cell back in its own row, in its own column, and folding again still works', () => withDom(() => {
  const { table, host } = ptTable({ headers: ['singular', 'plural'], rowLabels: ['nominative', 'dative'], cell: chartCell });
  const f = foldable(table);
  const shape = () => table.tBodies[0].rows.map((r) => r.cells.map((c) => (c.tagName === 'TH' ? c.textContent : inputsOf(c)[0].value)));
  const was = shape();
  f.fold(host);
  assert.deepEqual(table.tBodies[0].rows.map((r) => r.cells.length), [1, 1], 'the cells never left the table');
  f.unfold();
  assert.deepEqual(shape(), was, 'a cell came back in the wrong place');
  assert.ok(!table.classList.contains('pt--folded'));
  assert.equal(f.stack().parentNode, null, 'the empty blocks were left in the page');
  f.fold(host);
  assert.deepEqual(inputsOf(f.stack()).map((i) => i.value), ['typed-0-0', 'typed-1-0', 'typed-0-1', 'typed-1-1'], 'the second fold did not rebuild the blocks correctly');
}));

test('a caption only a screen reader hears is not printed above the blocks, but is still said before each', () => withDom(() => {
  const { table, host } = ptTable({ caption: 'the two cells on fīcta and dūctus', hiddenCaption: true, headers: ['fīcta', 'dūctus'], rowLabels: ['nominative'], cell: chartCell });
  const f = foldable(table);
  f.fold(host);
  const stack = f.stack();
  assert.ok(!stack.children.some((c) => c.classList.contains('pt__stackcap')), 'a caption meant for a screen reader was printed on the page');
  const caps = stack.children.filter((c) => c.tagName === 'TABLE').map((b) => b.caption);
  assert.deepEqual(caps.map((c) => c.textContent), ['the two cells on fīcta and dūctus · fīcta', 'the two cells on fīcta and dūctus · dūctus']);
  assert.deepEqual(caps.map((c) => c.children[0].className), ['visually-hidden', 'visually-hidden'], 'the table’s own name is read twice on screen');
}));

test('a visible caption is printed once above the blocks, and heard in front of each of them', () => withDom(() => {
  const { table, host } = ptTable({ caption: 'present indicative', headers: ['active', 'passive'], rowLabels: ['I'], cell: chartCell });
  const f = foldable(table);
  f.fold(host);
  const stack = f.stack();
  const cap = stack.children.find((c) => c.classList.contains('pt__stackcap'));
  assert.ok(cap, 'the table’s caption vanished when it stacked');
  assert.equal(cap.textContent, 'present indicative');
  assert.deepEqual(stack.children.filter((c) => c.tagName === 'TABLE').map((b) => b.caption.textContent), ['present indicative · active', 'present indicative · passive']);
}));

test('a table that cannot be stacked sensibly keeps the box it had', () => withDom(() => {
  const empty = new El('table');
  empty.append(new El('tbody'));
  assert.equal(foldable(empty), null, 'a table with no rows was restructured');
  const { table } = ptTable({ cell: chartCell });
  table.tBodies[0].rows[1].cells[1].remove();      // a ragged table: the columns no longer line up
  assert.equal(foldable(table), null, 'a ragged table was stacked, which would lose a cell');
  const labelsOnly = new El('table');
  const tb = new El('tbody'); const tr = new El('tr'); const th = new El('th'); th.textContent = 'a';
  tr.append(th); tb.append(tr); labelsOnly.append(tb);
  assert.equal(foldable(labelsOnly), null, 'a table with no value column was stacked into nothing');
}));

/* -------------------------------------------------------- the wiring */

const WP = code('app/js/wordpanel.js');
const UI = code('app/js/grammar/ui.js');
const PANELS = code('app/css/panels.css');
const GRAMMAR = code('app/css/grammar.css');
const PRINT = code('app/css/print.css');

test('every paradigm box on the page is watched — one rule, so none of them scrolls sideways', () => {
  const sites = [...WP.matchAll(/class: 'pt__scroll'/g), ...UI.matchAll(/class: 'pt__scroll'/g)];
  assert.equal(sites.length, 3, 'a .pt__scroll was added or removed; check it is watched too');
  const watched = (src) => (src.match(/fitParadigm\((?!scroll, table\)\s*\{)/g) ?? []).length;
  assert.equal(watched(WP) >= 1, true, 'renderParadigm no longer watches the box it builds');
  assert.match(UI, /fitParadigm\(scroll, table\)/, 'a teaching step’s reveal is not watched');
  assert.match(UI, /fitParadigm\(scroll, tbl\)/, 'the drill chart is not watched');
  assert.match(UI, /import \{ renderParadigm, fitParadigm \} from '\.\.\/wordpanel\.js';/);
});

test('the stacked table is hidden by a class the fit watcher sets, never by a width query', () => {
  assert.match(PANELS, /\.pt\.pt--folded \{ display: none; \}/, 'the emptied table is no longer hidden');
  assert.match(PANELS, /\.pt__stack \{[^}]*display: grid/, 'the blocks no longer stack');
  assert.match(PANELS, /\.pt__stack \.visually-hidden \{ inset-block-start: 0; inset-inline-start: 0; \}/, 'a block’s hidden prefix can widen the page again (QA M-7)');
  assert.match(PANELS, /\.pt__scroll \{[^}]*position: relative/s, 'the box a hidden prefix is pinned to is not a containing block');
  // The whole point of §26: no media query decides this.
  assert.ok(!/@media[^{]*\{[^{]*\.pt--folded/.test(PANELS), 'stacking was made a breakpoint after all');
  assert.ok(!/@media[^{]*\{[^{]*\.pt__stack/.test(PANELS), 'stacking was made a breakpoint after all');
});

test('a chart cell is a full touch target, and every coarse rule sits in grammar.css’s "touch last" block (§21.1)', () => {
  const last = GRAMMAR.indexOf('touch last');
  assert.ok(last > 0, 'the touch-last section is gone');
  for (const rule of ['.g-input--cell { min-height: var(--tap); }', '.pt :is(.g-chart__in, .g-chart__given):last-child']) {
    const at = GRAMMAR.indexOf(rule);
    assert.ok(at > 0, `the rule is gone: ${rule}`);
    assert.ok(at > last, `a coarse rule is written above "touch last", where it would be dead: ${rule}`);
  }
  assert.match(GRAMMAR.slice(last), /@media \(pointer: coarse\) \{ \.g-input--cell \{ min-height: var\(--tap\); \} \}/);
  assert.match(GRAMMAR, /\.g-chart__t, \.g-chart \.pt__stack \{ max-width: 32rem; \}/, 'the stacked blocks lost the chart’s measure');
});

test('the box a paradigm sits in is the box, so it can be asked whether the table fits it', () => {
  // Measured on a 375px phone before this: the catalogue's filled-in table made the page 463px wide, so
  // the `.pt__scroll` inside it was 445px, never overflowed, and could never be told to stack.
  assert.match(GRAMMAR, /#grammar :is\(\.g-lesson__pt, \.g-fb__pt, \.g-show, \.g-hint__body, \.g-cat__sec\) \{ min-width: 0; max-width: 100%; \}/);
  assert.match(GRAMMAR, /\.pt--stack \.g-cellwrap \.g-input--cell \{ flex: 1 1 auto; width: 6rem; \}/, 'a stacked chart box claims its own intrinsic width again, which squeezes the row label');
  assert.match(PANELS, /\.pt--stack tbody th \{ width: auto;/, 'the stacked row label is back on the 1% column and has no room');
});

test('print does not try to bring the emptied table back — its cells are somewhere else', () => {
  assert.ok(!/\.pt--folded\s*\{[^}]*display:\s*(table|block)/.test(PRINT), 'print shows the table whose cells were moved out of it: empty rows on paper');
  assert.match(PRINT, /pr-t/, 'print.js’s own tables are what reach paper');
});

test('Enter walks the boxes in the order they are on screen, not the order they were built in', () => {
  assert.match(UI, /compareDocumentPosition/, 'the next empty box is still found in build order, which a stacked chart reads out of order');
  assert.match(UI, /const next = \[\.\.\.inputs\.values\(\)\]\s*\n?\s*\.filter\(\(el\) => !el\.value\.trim\(\)\)/);
});
