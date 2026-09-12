// node --test tests/ — long-press defines, tap answers (GRAMMAR-CONTRACT.md §17.4).
//
// The pointer dictionary opens on hover, and a finger cannot hover. Tap was
// already taken: on a tap item, tapping a word *chooses* it. The learner's
// decision (2026-09-12) was one gesture for the whole app — hold a word and
// the dictionary answers; a quick tap still means what it meant.
//
// `attachHoverGloss` is plain DOM and plain events, so this drives it rather
// than reading the source: a small fake root, synthesised PointerEvents, and
// the real module. What the fake has to be honest about is the bit the bug
// lives in — an event that travels capture-then-bubble through a real tree,
// so a window-capture listener can stop a click before the word's own
// `onclick` ever sees it. Everything else is as small as it can be.
//
// The four source assertions at the end are for the two rules that are not
// reachable from a fake DOM at all (a stylesheet, and a section's wiring).
// Comment lines are stripped before every one of them: a test in this repo
// has passed against its own explanatory comment before.
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

/* ------------------------------------------------------------ a fake DOM */

class Ev {
  constructor(type, props = {}) {
    Object.assign(this, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }, props);
    this.type = type;
    this.defaultPrevented = false;
    this._stop = false;
    this._stopNow = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class Target {
  constructor() { this._on = { capture: new Map(), bubble: new Map() }; }
  addEventListener(type, fn, capture = false) {
    const m = this._on[capture ? 'capture' : 'bubble'];
    if (!m.has(type)) m.set(type, []);
    m.get(type).push(fn);
  }
  removeEventListener(type, fn, capture = false) {
    const l = this._on[capture ? 'capture' : 'bubble'].get(type) || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  _run(e, phase) {
    for (const fn of [...(this._on[phase].get(e.type) || [])]) {
      fn.call(this, e);
      if (e._stopNow) return;
    }
  }
}

class El extends Target {
  constructor(tag, cls = '') {
    super();
    this.tagName = tag.toUpperCase();
    this.className = cls;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.isConnected = true;
    this.textContent = '';
  }
  get classList() {
    return {
      contains: (c) => this.className.split(/\s+/).includes(c),
      add: (c) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
      remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' '); },
    };
  }
  append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } return this; }
  matches(sel) {
    return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((s) => (
      s.startsWith('.') ? this.classList.contains(s.slice(1)) : s.toUpperCase() === this.tagName
    ));
  }
  closest(sel) { for (let n = this; n; n = n.parentNode) if (n.matches?.(sel)) return n; return null; }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  /** capture from the top down, then the target, then bubble back up — the real order. */
  dispatchEvent(e) {
    e.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    path.push(globalThis.document, globalThis.window);
    for (let i = path.length - 1; i > 0; i -= 1) { path[i]._run(e, 'capture'); if (e._stop) return !e.defaultPrevented; }
    this._run(e, 'capture');
    if (e._stop) return !e.defaultPrevented;
    this._run(e, 'bubble');
    for (let i = 1; i < path.length; i += 1) { if (e._stop) break; path[i]._run(e, 'bubble'); }
    return !e.defaultPrevented;
  }
}

/** A root holding two Latin words, plus everything the module reaches for on `document`/`window`. */
function stage({ skip = () => false, busy = null, hold = 5, delay = 5, cut = null, la = '.g-la', attachFn = null } = {}) {
  const doc = new Target();
  doc.documentElement = new El('html');
  doc.elementFromPoint = () => null;
  globalThis.window = new Target();
  globalThis.document = doc;
  const root = new El('div', 'root');
  const p = new El('p', 'g-la');
  p.parentNode = root; root.children.push(p);
  const mk = (text, cls) => { const w = new El('button', cls); w.textContent = text; p.append(w); return w; };
  const one = mk('cornicula', 'g-w g-w--pick');
  const two = mk('rīvulum', 'g-w g-w--pick');
  const log = { show: [], hide: 0, clicks: [] };
  for (const w of [one, two]) w.addEventListener('click', () => log.clicks.push(w.textContent));
  root.addEventListener('click', (e) => log.clicks.push(`root:${e.target.textContent}`));
  const gloss = (attachFn ?? attach)({ root, word: '.g-w, .g-wx', la, skip, busy, cut, hold, delay, show: (w) => log.show.push(w.textContent), hide: () => { log.hide += 1; } });
  return { root, p, one, two, log, gloss, doc };
}

const down = (el, o = {}) => el.dispatchEvent(new Ev('pointerdown', o));
const up = (el, o = {}) => el.dispatchEvent(new Ev('pointerup', o));
const move = (el, o = {}) => el.dispatchEvent(new Ev('pointermove', o));
const click = (el) => el.dispatchEvent(new Ev('click', { pointerType: undefined }));
const rest = (ms) => new Promise((r) => { setTimeout(r, ms); });

// The module reads `document` lazily, inside its functions, so the globals above may be set after
// the import — but `attach` must be resolved after them all the same, hence the indirection.
const { attachHoverGloss: attach, HOLD_MS, HOLD_SLIP } = await import('../app/js/hovergloss.js');

/* ------------------------------------------------------------ the gesture */

test('a hold opens the gloss', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, ['cornicula'], 'holding a word did not ask the dictionary');
});

test('a quick tap does not open it, and the click still reaches the word', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  up(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, [], 'a tap that chooses a word also defined it');
  click(s.one);
  assert.deepEqual(s.log.clicks, ['cornicula', 'root:cornicula'], 'the tap no longer chooses the word');
});

test('the opening press does not also choose the word: the lift’s click is swallowed', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, ['cornicula']);
  up(s.one, { clientX: 40, clientY: 40 });
  const e = new Ev('click', { pointerType: undefined });
  s.one.dispatchEvent(e);
  assert.deepEqual(s.log.clicks, [], 'one gesture gave a definition AND committed an answer');
  assert.equal(e.defaultPrevented, true, 'the click was let through with its default intact');
});

test('the swallower is one shot: the learner’s next tap is their own', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  up(s.one, { clientX: 40, clientY: 40 });
  click(s.one);                       // eaten
  down(s.two, { clientX: 90, clientY: 40 });
  up(s.two, { clientX: 90, clientY: 40 });
  click(s.two);
  assert.deepEqual(s.log.clicks, ['rīvulum', 'root:rīvulum'], 'the swallower ate a second, ordinary tap');
});

test('a scroll is not a press: movement mid-hold opens nothing, and the click survives', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  move(s.one, { clientX: 40, clientY: 40 + HOLD_SLIP + 5 });
  await rest(30);
  assert.deepEqual(s.log.show, [], 'a flick past a word opened its gloss');
  up(s.one, { clientX: 40, clientY: 90 });
  click(s.one);
  assert.deepEqual(s.log.clicks, ['cornicula', 'root:cornicula'], 'an abandoned press still ate the click');
});

test('a drift smaller than the slip is still a press', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  move(s.one, { clientX: 40 + HOLD_SLIP - 1, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, ['cornicula'], 'a steady hand was read as a scroll');
});

test('the lift does not close what the hold opened', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  up(s.one, { clientX: 40, clientY: 40 });
  s.one.dispatchEvent(new Ev('pointerout', { relatedTarget: null }));
  assert.equal(s.log.hide, 0, 'the touch’s own pointerout closed the gloss the gesture had just opened');
});

test('a press elsewhere puts it away', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  up(s.one, { clientX: 40, clientY: 40 });
  assert.equal(s.log.hide, 0);
  down(s.two, { clientX: 90, clientY: 40 });
  assert.equal(s.log.hide, 1, 'the gloss stayed over the word the learner went to next');
});

test('a word the section keeps quiet on stays quiet under a finger too', async () => {
  const s = stage({ skip: (w) => w.textContent === 'cornicula' });
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, [], 'the hold went round `skip` — a touch learner would get more than a mouse one');
  down(s.two, { clientX: 90, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, ['rīvulum']);
});

test('a popup the learner opened themselves is left alone, by a finger as by a mouse', async () => {
  const s = stage({ busy: () => true });
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, []);
});

test('the browser’s own long press is refused while ours is running, and only then', async () => {
  const s = stage();
  down(s.one, { clientX: 40, clientY: 40 });
  for (const t of ['contextmenu', 'selectstart']) {
    const e = new Ev(t);
    s.one.dispatchEvent(e);
    assert.equal(e.defaultPrevented, true, `the browser's ${t} would put its own UI over the gloss`);
  }
  up(s.one, { clientX: 40, clientY: 40 });
  for (const t of ['contextmenu', 'selectstart']) {
    const e = new Ev(t, { pointerType: 'mouse' });
    s.one.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, `a mouse's ${t} on a word is no longer the browser's own`);
  }
});

test('the words stop being selectable only while a finger is down on one', async () => {
  const s = stage();
  assert.equal(s.doc.documentElement.dataset.hold, undefined);
  down(s.one, { clientX: 40, clientY: 40 });
  assert.equal(s.doc.documentElement.dataset.hold, '1', 'the selection handles have nothing stopping them');
  up(s.one, { clientX: 40, clientY: 40 });
  assert.equal(s.doc.documentElement.dataset.hold, undefined, 'Latin stays unselectable after the finger has gone');
});

test('a mouse is untouched: it hovers, it leaves, and it never starts a hold', async () => {
  const s = stage();
  s.one.dispatchEvent(new Ev('pointerover', { pointerType: 'mouse', clientX: 40, clientY: 40 }));
  await rest(30);
  assert.deepEqual(s.log.show, ['cornicula'], 'the mouse lost the hover it already had');
  s.one.dispatchEvent(new Ev('pointerout', { pointerType: 'mouse', relatedTarget: null }));
  assert.equal(s.log.hide, 1, 'the mouse leaving no longer closes the gloss');
  down(s.one, { pointerType: 'mouse', clientX: 40, clientY: 40 });
  await rest(30);
  click(s.one);
  assert.deepEqual(s.log.clicks, ['cornicula', 'root:cornicula'], 'holding the mouse button down swallowed a click');
});

test('a finger having been seen is recorded, off a real event', async () => {
  // A fresh copy of the module: the flag is a fact about the machine, so it is remembered for the
  // life of the page and no later `stage()` can un-see the first test's finger.
  const fresh = await import('../app/js/hovergloss.js?first-touch');
  const s = stage({ attachFn: fresh.attachHoverGloss });
  assert.equal(fresh.touchUsed(), false, 'a machine is called a touch machine before any finger has been used');
  assert.equal(s.doc.documentElement.dataset.touch, undefined);
  s.one.dispatchEvent(new Ev('pointerover', { pointerType: 'mouse', clientX: 40, clientY: 40 }));
  down(s.one, { pointerType: 'mouse', clientX: 40, clientY: 40 });
  assert.equal(fresh.touchUsed(), false, 'a mouse was taken for a finger');
  down(s.one, { clientX: 40, clientY: 40 });
  assert.equal(fresh.touchUsed(), true);
  assert.equal(s.doc.documentElement.dataset.touch, '1', 'the help line will never say how to reach the dictionary');
});

test('detach takes the finger’s listeners with it', async () => {
  const s = stage();
  s.gloss.detach();
  down(s.one, { clientX: 40, clientY: 40 });
  await rest(30);
  assert.deepEqual(s.log.show, []);
  up(s.one, { clientX: 40, clientY: 40 });
  click(s.one);
  assert.deepEqual(s.log.clicks, ['cornicula', 'root:cornicula']);
});

test('plain Latin is cut into words at the hold, not at the tap', async () => {
  let cuts = 0;
  const s = stage({ cut: () => { cuts += 1; return true; } });
  s.doc.elementFromPoint = () => s.two;
  down(s.p, { clientX: 90, clientY: 40 });
  up(s.p, { clientX: 90, clientY: 40 });
  await rest(30);
  assert.equal(cuts, 0, 'a quick tap rewrote the DOM under the finger');
  down(s.p, { clientX: 90, clientY: 40 });
  await rest(30);
  assert.equal(cuts, 1);
  assert.deepEqual(s.log.show, ['rīvulum'], 'Latin drawn as plain text does not answer a hold');
});

/* ------------------------------------------ the thresholds, as they ship */

test('the gesture ships at the numbers the learner was given', () => {
  assert.equal(HOLD_MS, 450, 'the hold is no longer the ~450 ms that was put to the learner');
  assert.equal(HOLD_SLIP, 10, 'the slip no longer clears a touch engine’s own 8 px');
  assert.match(code('app/js/hovergloss.js'), /hold = HOLD_MS/, 'the default hold is no longer the exported one');
});

/* -------------------------------- what a fake DOM cannot reach: the rules */

test('the help line teaches the hold, and only where a finger has been used', () => {
  const ui = code('app/js/grammar/ui.js');
  const css = code('app/css/grammar.css');
  assert.match(ui, /class: 'g-keys__hold', text: ' Hold a word to see what it means\.'/, 'the key help line no longer says how to reach the dictionary');
  assert.equal((ui.match(/keyHelp\(/g) || []).length, 7, 'a key help line was built without the hold sentence');
  assert.ok(!/class: 'g-keys'/.test(ui) && !/class: 'g-keys g-keys--tap'/.test(ui), 'a `.g-keys` is still built by hand, so it carries no hold sentence');
  assert.match(css, /\.g-keys__hold \{ display: none; \}/, 'the hold sentence is shown on a mouse, where the gesture does not exist');
  assert.match(css, /:root\[data-touch="1"\] \.g-keys__hold \{ display: inline; \}/, 'the hold sentence is never shown');
  // m12: the keyboard model stays in the accessibility tree on a coarse pointer. What is clipped
  // there must be the keyboard *half*, or the hold sentence goes with it on exactly the machine it
  // is for — which is what hiding the whole paragraph used to do.
  assert.match(css, /\.g-keys:not\(\.g-keys--tap\) \.g-keys__main \{ position: absolute;/, 'the whole help line is hidden on a coarse pointer again, hold sentence and all');
});

test('the touch flag is asked of the event, never of the device (§17.2)', () => {
  const hover = code('app/js/hovergloss.js');
  assert.ok(!/matchMedia/.test(hover), 'the device is being asked again');
  assert.match(hover, /const look = \(e\) => \{ if \(!pointerHovers\(e\)\) \{ sawTouch\(\)/, 'the flag no longer comes off a real pointer event');
  for (const f of ['app/css/grammar.css', 'app/css/reader.css']) {
    assert.ok(!/@media[^{]*(hover: none|pointer: coarse)[^{]*\{[^}]*data-hold/.test(code(f)), `${f} gates the press rules on a media query`);
  }
});

test('both sections’ words refuse the browser’s own long press, and a mouse keeps its selection', () => {
  for (const [f, sel] of [['app/css/grammar.css', '\\.g-w, \\.g-wx'], ['app/css/reader.css', '\\.w, \\.r-wx']]) {
    const css = code(f);
    assert.match(css, new RegExp(`${sel} \\{ -webkit-touch-callout: none; \\}`), `${f}: iOS will put a share sheet over the gloss`);
    assert.match(css, new RegExp(`:root\\[data-hold="1"\\] .*user-select: none`), `${f}: a long press will select the word instead of defining it`);
    assert.ok(!new RegExp(`^${sel} \\{[^}]*user-select: none`, 'm').test(css), `${f}: a mouse can no longer select and copy the Latin`);
  }
});

test('the parse rule is the same rule for a finger as for a mouse (§17.2, c590389)', () => {
  const ui = code('app/js/grammar/ui.js');
  // The long press goes through `show`/`skip`, so it inherits this rather than restating it. The
  // assertion is that there is still only one statement of it to inherit.
  assert.match(ui, /const held = w\.classList\.contains\('g-w--pick'\) && !answered\(w\);/, 'the held-back parse is gone');
  assert.match(ui, /showGloss\(w, w\.dataset\.form \?\? w\.textContent, w\.textContent, ctxLa, \{ hover: true, parse: !held \}\);/, 'the hover no longer holds the parse back on an unanswered tap item');
  assert.equal((ui.match(/parse: !held/g) || []).length, 1, 'the rule is stated twice, so a finger and a mouse can drift apart');
});
