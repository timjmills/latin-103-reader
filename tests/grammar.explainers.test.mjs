// node --test tests/ — the two labels that now explain themselves (§23).
//
// The learner circled two lines of a chapter row and said "I don't kknow what
// these mean", then, when the words were put another way: "Yes but I still
// don't know waht 1 grammar skill is and 4 chapter sets I dont know what this
// means". Defining "skill" and "set" in other words only moves the problem, so
// the popup **names the things themselves** — for cap. XXVI, the one skill is
// "Gerund: the verb as a noun" and the four sets are that chapter's questions,
// its two word decks and its pensa.
//
// Two halves, the way tests/grammar.progress-sheet.test.mjs is split:
//
//   Real logic. The wording is three pure builders exported from ui.js
//   (`chapterTip`, `stateTip`, `partsTip`) and they are run for real, over a
//   chapter built by the real `chapterMaterial` / `chapterProgress` — because
//   the whole point of the panel is that it cannot disagree with the line
//   above it, and only running both can show that.
//
//   Wiring. Delegation, the pointer guard, the trigger selector and the class
//   names need a DOM, so they are read out of the source with every comment
//   line stripped first: a test in this repo has passed against its own
//   comment before.
//
// No Latin from the book appears here: the skill title below is the app's own
// (app/data/grammar/skills.json) and the sets are invented shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapterTip, stateTip, partsTip, memberLabel, memberWhat, dueText } from '../app/js/grammar/ui.js';
import { chapterMaterial, chapterProgress, chapterSummary } from '../app/js/grammar/chapter.js';
import { MASTERED_DAYS, MASTERED_SUCCESSES, LEARN_NEEDED, LEARN_WINDOW, LEARN_KINDS, DAY_MS } from '../app/js/grammar/scheduler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = readFileSync(join(ROOT, 'app/js/grammar/ui.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'app/css/grammar.css'), 'utf8');
const SW = readFileSync(join(ROOT, 'app/sw.js'), 'utf8');

/** Source with every comment line taken out, so no assertion below can pass against prose. */
const code = (src) => src
  .split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');
const UI_CODE = code(UI);
const CSS_CODE = code(CSS);

/* ------------------------------------------------- a chapter to talk about */
// Cap. XXVI as the learner has it: one grammar skill and four chapter sets.
const GERUND = { id: 'gerund', title: 'Gerund: the verb as a noun (-ndum, -ndī, -ndō)', chapter: 26, category: 'verb-form', parse_filter: {} };
const SETS = [
  { id: 'questions-26', set: 'questions', chapter: 26, count: 12, title: 'Questions · Cap. XXVI' },
  { id: 'vocab-26', set: 'vocab', chapter: 26, count: 40, rev: false, title: 'Vocabulary · Cap. XXVI' },
  { id: 'vocab-26-rev', set: 'vocab', chapter: 26, count: 40, rev: true, title: 'Vocabulary · Cap. XXVI · English → Latin' },
  { id: 'pensum-26', set: 'pensum', chapter: 26, count: 9, data: { A: [1, 2, 3], B: [1, 2, 3], C: [1, 2, 3] } },
];
const skills = new Map([[GERUND.id, GERUND]]);
const sets = new Map(SETS.map((s) => [s.id, s]));
const material = () => chapterMaterial(26, { skills, sets });

const state = (rows) => (id) => rows[id] ?? null;
const row = (name, extra = {}) => ({ state: name, stage: 2, stability_days: 3, successes: 0, failures: 0, ...extra });
/** Three of the five opened, which is the row the learner was reading: "1 skill · 4 sets · 3 of 5 started". */
const THREE_STARTED = {
  gerund: row('learning'),
  'questions-26': row('practising', { due_at: new Date(Date.now() + 3 * DAY_MS).toISOString() }),
  'vocab-26': row('learning'),
};

const tipFor = (rows, opts = {}) => {
  const m = material();
  const p = chapterProgress(m, { state: state(rows) });
  return { tip: chapterTip({ roman: 'XXVI', material: m, progress: p, state: state(rows), ...opts }), progress: p, material: m };
};
const text = (t) => [t.title, t.summary, ...(t.lines ?? []).map((l) => `${l.mark} ${l.label} ${l.flag ?? ''} ${l.text}`), t.foot ?? ''].join('\n');

/* ============================================ the chapter line's explainer */

test('the chapter popup names the five things instead of defining "skill" and "set"', () => {
  const { tip, progress } = tipFor(THREE_STARTED);
  assert.equal(chapterSummary(progress), '1 skill · 4 sets · 3 of 5 started', 'the line this explains is not the line the learner saw');
  assert.equal(tip.title, 'Cap. XXVI');
  assert.equal(tip.lines.length, 5, 'the popup lists something other than the five things the line counts');
  // The one skill, by its own name — the whole ask. "A grammar skill is a point of grammar" would not do.
  assert.equal(tip.lines[0].label, GERUND.title);
  assert.deepEqual(tip.lines.slice(1).map((l) => l.label), ['Questions', 'Vocabulary', 'Vocabulary · English → Latin', 'Pensa']);
  // And each says which of the two kinds it is, attached to a real name rather than standing alone.
  assert.match(tip.lines[0].text, /grammar skill/);
  for (const l of tip.lines.slice(1)) assert.match(l.text, /chapter set/);
  assert.match(tip.summary, /1 grammar skill/);
  assert.match(tip.summary, /4 chapter sets/);
});

test('the ticks in the popup add up to the number on the line', () => {
  const { tip, progress } = tipFor(THREE_STARTED);
  assert.equal(tip.lines.filter((l) => l.done).length, progress.started, 'the popup marks a different number started from the one the line prints');
  assert.deepEqual(tip.lines.filter((l) => l.done).map((l) => l.label), [GERUND.title, 'Questions', 'Vocabulary']);
  // Each row's own state, in the words the row itself uses, so the two can never drift.
  assert.match(tip.lines[0].text, /in Learn$/);
  assert.match(tip.lines[1].text, new RegExp(`${dueText(THREE_STARTED['questions-26'])}$`.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`).replace(/\\\$$/, '$')));
  assert.equal(tip.lines[3].flag, 'not started', 'a thing the line does not count says so in a word, not in colour alone');
});

test('"started" is explained as opened, and the switch to "mastered" is announced', () => {
  const { tip } = tipFor(THREE_STARTED);
  assert.match(tip.foot, /"3 of 5 started"/, 'the foot does not quote the line it explains');
  assert.match(tip.foot, /opened/, '"started" is never explained');
  assert.match(tip.foot, /says nothing about how well/, 'the popup lets "started" read as "going well"');
  assert.match(tip.foot, /"1 of 5 mastered"/, 'the line that replaces this one is never mentioned');
});

test('once something is mastered the popup counts and explains that instead', () => {
  const rows = { ...THREE_STARTED, gerund: row('mastered', { successes_spaced: 3, stability_days: 30 }) };
  const { tip, progress } = tipFor(rows);
  assert.equal(chapterSummary(progress), '1 skill · 4 sets · 1 of 5 mastered');
  assert.equal(tip.lines.filter((l) => l.done).length, progress.mastered, 'the marks still count "started" while the line counts "mastered"');
  assert.equal(tip.lines[1].flag, 'not mastered');
  assert.match(tip.foot, /"1 of 5 mastered"/);
  assert.match(tip.foot, new RegExp(`${MASTERED_SUCCESSES} successes`), "the app's own definition of mastered is not the one the popup gives");
  assert.match(tip.foot, new RegExp(`${MASTERED_DAYS} days`));
});

test('a chapter with nothing of its own says so, and lists nothing', () => {
  const empty = chapterMaterial(3, { skills, sets });
  const p = chapterProgress(empty, { state: () => null });
  assert.equal(chapterSummary(p), 'No grammar of its own');
  const tip = chapterTip({ roman: 'III', material: empty, progress: p, state: () => null });
  assert.equal(tip.lines.length, 0);
  assert.match(tip.summary, /introduces no/);
  assert.equal(tip.foot, null, 'a chapter with nothing in it still explains a count it does not print');
});

test('nothing in the chapter popup says the same word twice in one line', () => {
  // "not started — grammar skill · not started" was the first draft of an unopened row.
  const { tip } = tipFor({});
  for (const l of tip.lines) {
    assert.equal(l.flag, 'not started');
    assert.ok(!l.text.includes('not started'), `"${l.label}" says "not started" twice`);
    assert.ok(l.text.trim().length > 3, `"${l.label}" has no detail at all`);
  }
  assert.match(tip.foot, /"not started" means you have opened none/);
});

test('a row taken out of the mix is not counted as started, and the popup says why it looks otherwise', () => {
  // chapterProgress counts `state !== 'new'`, and removeFromPractice makes a row `new` again while it keeps
  // every answer. The popup must not claim such a row was never opened — it says what the count did.
  const rows = { gerund: row('new', { successes: 11, failures: 1, last_at: new Date().toISOString() }) };
  const { tip, progress } = tipFor(rows);
  assert.equal(progress.started, 0, 'chapterProgress changed its mind about what "started" counts');
  assert.equal(tip.lines[0].flag, 'not started');
  assert.match(tip.lines[0].text, /out of the mix · 12 answers kept/, 'the row\'s own words are not carried into the popup');
});

test('the popup and the rows call the sets the same things', () => {
  for (const s of SETS) {
    assert.ok(memberLabel(s).length > 2);
    assert.match(memberWhat(s), /^chapter set · /);
  }
  assert.equal(memberLabel(SETS[2]), 'Vocabulary · English → Latin');
  assert.equal(memberWhat(SETS[1]), 'chapter set · 40 words, Latin → English');
  assert.equal(memberWhat(SETS[2]), 'chapter set · 40 words, English → Latin');
  assert.equal(memberWhat(SETS[0]), 'chapter set · 12 questions');
  assert.equal(memberWhat(GERUND), 'grammar skill');
  // The rows print the same label, from the same helper, so the two lists cannot drift apart.
  assert.match(UI_CODE, /text: memberLabel\(s\)/, 'the set rows stopped sharing their label with the popup');
});

/* ================================================= the state chip's explainer */

const learner = { state: 'learning', stage: 1, stability_days: 0.5, successes: 0, failures: 0 };

test('the state popup explains the words on the screen first, then the rest briefly', () => {
  const tip = stateTip(GERUND.title, learner);
  assert.equal(tip.title, GERUND.title, 'the popup does not name the skill it is about');
  assert.match(tip.summary, /^This row says "in Learn"\./, 'the popup does not lead with the phrase the learner is looking at');
  assert.match(tip.summary, /Continue learning/, 'nothing tells the learner what to do about it');
  assert.deepEqual(tip.lines.map((l) => l.label), ['not started', 'in Learn', 'practising', 'mastered', 'lapsed']);
  const here = tip.lines.filter((l) => l.here);
  assert.equal(here.length, 1);
  assert.equal(here[0].label, 'in Learn');
  assert.equal(here[0].flag, 'this row', 'the line on screen is marked by colour alone');
  assert.notEqual(here[0].mark, tip.lines[0].mark, 'the mark of the current state has the same shape as the others');
  for (const l of tip.lines) assert.ok(l.text.trim().length > 10, `"${l.label}" is listed with no explanation`);
});

test('the popup uses the scheduler\'s own numbers, not remembered ones', () => {
  const all = text(stateTip('X', learner));
  for (const n of [MASTERED_SUCCESSES, MASTERED_DAYS, LEARN_NEEDED, LEARN_WINDOW, LEARN_KINDS]) {
    assert.ok(all.includes(String(n)), `the explainer never mentions ${n} — a rule was written out by hand`);
  }
  assert.match(text(stateTip('X', row('mastered', { due_at: new Date(Date.now() + 30 * DAY_MS).toISOString() }))), new RegExp(`${MASTERED_SUCCESSES} successes spaced out over time`));
  assert.match(text(stateTip('X', row('lapsed'))), /twice its own gap/);
});

test('each state on screen is quoted exactly as the row prints it', () => {
  const now = Date.now();
  for (const s of [row('new'), learner, row('practising', { due_at: new Date(now + 3 * DAY_MS).toISOString() }), row('mastered', { due_at: new Date(now + 40 * DAY_MS).toISOString() }), row('lapsed')]) {
    const shown = dueText(s, now);
    assert.match(stateTip('X', s, { now }).summary, new RegExp(`^This row says "${shown.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}"\\.`), `the popup does not quote "${shown}"`);
  }
  // A chip and a plan line say where they are, so the opening words follow the place the label sits in.
  assert.match(stateTip('X', learner, { where: 'chip' }).summary, /^This chip says/);
  assert.match(stateTip('X', learner, { where: 'plan' }).summary, /^This skill stands at/);
});

test('where a chip prints the bare state word, the popup joins it to the word the rows use', () => {
  // Found on the live pass: a "Review first" chip says "new", and the list under it has no such line —
  // it says "not started", which is what every row says. The panel now says they are one state.
  const chip = stateTip('X', row('new'), { shown: 'new', where: 'chip' });
  assert.match(chip.summary, /^This chip says "new"\. The rows call this state "not started"\./);
  assert.match(stateTip('X', learner, { shown: 'learning', where: 'chip' }).summary, /The rows call this state "in Learn"\./);
  // And it is said only where the two differ: a row already quoting its own words gets no extra clause.
  for (const s of [row('new'), learner, row('lapsed'), row('practising', { due_at: new Date(Date.now() + 3 * DAY_MS).toISOString() })]) {
    assert.ok(!stateTip('X', s).summary.includes('The rows call this state'), `"${dueText(s)}" is being explained twice`);
  }
});

test('a row with no drill says plainly why it has none', () => {
  const metre = stateTip('Metre: hexameter, pentameter and hendecasyllable', row('new'), { can: false, parse: false, shown: 'lesson only — no drill' });
  assert.match(metre.summary, /^This row says "lesson only — no drill"\./);
  assert.match(metre.summary, /no way of pointing at itself/, 'the reason a metre skill has no drill is not given');
  assert.match(metre.summary, /never scheduled/);
  const thin = stateTip('X', row('new'), { can: false, parse: true, shown: 'no sentences in the library yet' });
  assert.match(thin.summary, /no sentence in your library/);
  assert.match(thin.summary, /as soon as a reading does/, 'a skill waiting for a sentence reads as permanently broken');
  const set = stateTip('Vocabulary', row('new'), { can: false, isSet: true, shown: 'no items yet' });
  assert.match(set.summary, /has been read into your library/);
  // None of the five is the row's state, and the foot says so rather than leaving a list with nothing marked.
  for (const tip of [metre, thin, set]) {
    assert.equal(tip.lines.filter((l) => l.here).length, 0);
    assert.match(tip.foot, /never any of them/);
  }
});

test('a row out of the mix counts its kept answers, and the foot does not list it twice', () => {
  const s = row('new', { successes: 40, failures: 2, last_at: new Date().toISOString() });
  const tip = stateTip('X', s);
  assert.equal(dueText(s), 'out of the mix · 42 answers kept');
  assert.match(tip.summary, /^This row says "out of the mix · 42 answers kept"\./);
  assert.match(tip.summary, /42 answers/, 'the popup drops the count the line just printed');
  assert.ok(!/out of the mix/.test(tip.foot), 'the foot offers the reading the row is already showing');
  // Every other row gets all three of the readings the list cannot hold.
  const other = stateTip('X', learner).foot;
  for (const phrase of ['out of the mix', 'lesson only — no drill', 'no sentences in the library yet']) {
    assert.ok(other.includes(phrase), `the foot no longer mentions "${phrase}"`);
  }
});

/* ============================================== the meter, through the same panel */

test('the parts meter builds its panel through the shared shape, unchanged', () => {
  const p = {
    summary: '3 of 6 parts done',
    parts: [
      { key: 'lesson', label: 'Lesson', blurb: 'the teaching steps, read through', done: true, detail: 'all 6 steps read', given: null },
      { key: 'chart', label: 'Chart', blurb: 'its paradigm table filled in, cell by cell', done: true, detail: '3 charts answered right', given: 0 },
      { key: 'mastered', label: 'Mastered', blurb: 'three spaced successes', done: false, detail: '1 of 3 spaced successes', given: null },
    ],
  };
  const tip = partsTip('Gerund', p);
  assert.equal(tip.title, 'Gerund');
  assert.equal(tip.summary, '3 of 6 parts done');
  assert.deepEqual(tip.lines.map((l) => l.mark), ['✓', '✓', '–']);
  assert.equal(tip.lines[1].text, 'completed unaided · 3 charts answered right', 'the rung is no longer said before the count');
  assert.equal(tip.lines[2].flag, 'not yet', '"not yet" no longer survives a detail');
  assert.equal(tip.lines[2].text, ' — 1 of 3 spaced successes');
  assert.match(tip.foot, /^Not part of this skill: /, 'the parts a skill cannot have are no longer named');
});

/* ======================================================== the wiring in source */

test('one panel and one set of listeners serve every label on an 88-row page', () => {
  assert.match(UI_CODE, /if \(tipWired \|\| typeof document === 'undefined'\) return;/, 'the listeners are no longer installed once');
  assert.match(UI_CODE, /if \(tipPanel\?\.isConnected\) return tipPanel;/, 'the one shared panel node is being rebuilt');
  assert.match(UI_CODE, /document\.body\.append\(tipPanel\);/, 'the panel is no longer hung off the body, so a clipping ancestor can cut it');
  const block = /function wireTips\(\) \{([\s\S]*?)\n\}/.exec(UI_CODE);
  assert.ok(block, 'wireTips() is gone');
  assert.ok(!/root\.addEventListener|el\.addEventListener/.test(block[1]), 'the delegation moved off the document onto something per-row');
  // One selector for every trigger: the meter, the chapter line and the state chips all go through it.
  assert.match(UI_CODE, /const TIP_SEL = '\[data-tip\]';/, 'the triggers no longer share one selector');
  assert.match(block[1], /closest\?\.\(TIP_SEL\)/, 'the delegation stopped matching the shared selector');
  assert.match(UI_CODE, /placeTip\(tipFor\)/, 'the shared panel stopped being placed by the one placer');
  assert.match(UI_CODE, /panelPlace\(el\.getBoundingClientRect\(\)/, 'the panel is no longer placed by the measured, clamped placer');
});

test('hover is asked of the event, never of the device', () => {
  // §17.2: a Windows laptop with a touchscreen answers "coarse, cannot hover" with a mouse in it, and
  // that is the learner's machine. The bug has shipped twice.
  const block = /function wireTips\(\) \{([\s\S]*?)\n\}/.exec(UI_CODE)[1];
  assert.match(block, /!pointerHovers\(e\)/, 'the panel no longer asks the event whether it can hover');
  assert.ok(!/matchMedia/.test(block), 'back to asking the device instead of the event');
  assert.match(UI_CODE, /import \{ attachHoverGloss, cutLatinWords, pointerHovers \} from '\.\.\/hovergloss\.js';/, 'the shared guard is no longer imported');
});

test('replaceChildren is not handed a null, which it would print as the word', () => {
  // `h()` filters nulls out of its children; `replaceChildren` is the DOM's own and does not. A skill with
  // every part once showed a literal "null" at the foot of its panel, and the shared renderer now builds
  // three kinds of panel out of optional pieces — every one of them a chance to do it again.
  const body = /function tipBody\(el\) \{([\s\S]*?)\n\}/.exec(UI_CODE);
  assert.ok(body, 'tipBody() is gone');
  assert.match(body[1], /\]\.filter\(Boolean\)\)/, 'the optional pieces are no longer filtered before replaceChildren');
  assert.ok(!/replaceChildren\([^.]*: null\)/.test(body[1]), 'a null is being passed to replaceChildren again');
});

test('one tap opens it: the toggle is measured from before the press', () => {
  // §21: focusin opened the panel and the click that followed closed it again, so a tap did nothing.
  const block = /function wireTips\(\) \{([\s\S]*?)\n\}/.exec(UI_CODE)[1];
  for (const kind of ['pointerover', 'pointerout', 'focusin', 'focusout', 'click', 'pointerdown', 'keydown']) {
    assert.match(block, new RegExp(`addEventListener\\('${kind}'`), `${kind} is no longer handled — one of the three ways in is gone`);
  }
  assert.match(block, /wasHeld = b \? tipHeld : null;/, 'what was pinned before the press is no longer recorded at pointerdown');
  assert.match(block, /tipHeld = wasHeld === b \? null : b;/, 'the tap toggle reads the state after focus has already moved');
  assert.match(block, /\}, true\);/, 'the pointerdown that records it is no longer in the capture phase');
  assert.match(block, /e\.key === 'Escape'/, 'Escape no longer closes it');
});

test('every label the learner asked about is a trigger, and says what it is', () => {
  // The chapter line, in both places it is printed: the spine's rows and the chapter page's panel.
  assert.match(UI_CODE, /chapterTipButton\(c\.roman, c\.material, c\.progress, stateOf\)/, 'the spine chapter line stopped explaining itself');
  assert.match(UI_CODE, /chapterTipButton\(row\.roman, material, progress, stateOf\)/, 'the chapter page summary stopped explaining itself');
  // The state word, everywhere it is printed: a skill row, a set row, the Review-first chips, the Today
  // card and the lesson header. One shared builder, so they can never drift apart.
  const uses = [...UI_CODE.matchAll(/stateTipButton\(/g)].length;
  assert.ok(uses >= 5, `only ${uses} state labels explain themselves — one of the five places was missed`);
  assert.match(UI_CODE, /tipTrigger\('chapter'/, 'the chapter trigger lost its kind');
  assert.match(UI_CODE, /tipTrigger\('state'/, 'the state trigger lost its kind');
  assert.match(UI_CODE, /'data-tip': 'parts'/, 'the meter is no longer served by the shared panel');
  assert.match(UI_CODE, /'data-tip': kind/, 'the trigger factory stopped stamping the selector every listener matches');
  // A trigger inside a <summary> must not fold the chapter away when it is pressed.
  assert.match(UI_CODE, /onclick: \(e\) => e\.preventDefault\(\)/, 'pressing the chapter line toggles the fold again');
  // Announced: the button says what it is and what it will do, and the panel is its description.
  assert.match(UI_CODE, /aria-expanded': 'false'/);
  assert.match(UI_CODE, /setAttribute\('aria-describedby', TIP_ID\)/, 'the panel is no longer the trigger\'s description');
  assert.match(UI_CODE, /export function tipLabel\(/, 'the triggers no longer share one spoken label');
});

test('nothing moves when a popup opens, and it stays on the screen', () => {
  // §17.1, §17.3, §21: the panel is fixed and body-mounted, it never grows the page, and it is clamped.
  assert.match(CSS_CODE, /\.g-tip \{[^}]*position: fixed/, 'the shared panel is back in the flow');
  assert.match(CSS_CODE, /\.g-tip\[data-hover="1"\] \{ pointer-events: none; \}/, 'a hover-opened panel takes the pointer again, which makes it flicker');
  assert.match(CSS_CODE, /\.g-tip \{[^}]*max-height/, 'the panel can no longer be shorter than the screen');
  assert.ok(!/\.g-why:hover \{[^}]*(padding|font-size|border-width)/.test(CSS_CODE), 'the trigger changes size on hover, so it moves under the hand');
});

test('every class the shared panel and its triggers draw is styled', () => {
  const used = new Set([...UI_CODE.matchAll(/'(g-(?:tip|why)(?:__[a-z]+)?)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, `only ${used.size} panel classes found in ui.js — the markup moved`);
  for (const cls of used) assert.match(CSS_CODE, new RegExp(`\\.${cls}[\\s,:[{]`), `.${cls} is drawn but never styled`);
});

test('the touch target is real, and the coarse rule is last in the file', () => {
  // §21.1: eleven coarse rules were dead because they sat next to what they override. A media query adds
  // no specificity, so the only thing that makes one win is its position in the file.
  const banner = CSS.indexOf('touch last');
  assert.ok(banner > 0, 'the touch-last section is gone');
  const at = CSS.indexOf('.g-why { min-height: var(--tap); }');
  assert.ok(at > 0, 'the trigger has no coarse touch target at all');
  assert.ok(at > banner, 'the .g-why touch rule sits above "touch last", where it silently loses');
  // And it really is inside a coarse block: the nearest @media above it is the one that matches a finger.
  const before = CSS.slice(0, at);
  assert.match(before.slice(before.lastIndexOf('@media')), /^@media \(pointer: coarse\)/, 'the 44px target is not behind a coarse query at all');
  // A min-height does nothing to an inline box: the trigger has to be a flex box to have a height at all.
  assert.match(CSS_CODE, /\.g-why \{[^}]*display: inline-flex/, 'the trigger is inline, so its 44px target is not there');
});

test('the panel is out of the word dictionary\'s reach', () => {
  assert.match(UI_CODE, /const LA_NO = '[^']*\[data-tip\]/, 'a tip trigger can be cut into Latin words under the pointer');
  assert.match(UI_CODE, /const LA_NO = '[^']*\.g-tip/, 'the shared panel is no longer out of the dictionary’s reach');
});

test('the cache version moved with the changed files', () => {
  const v = /const CACHE_VERSION = 'v(\d+)';/.exec(SW);
  assert.ok(v && Number(v[1]) >= 61, `CACHE_VERSION is v${v?.[1]} — the shipped ui.js and grammar.css changed`);
});
