// node --test tests/ — practising a table from the Tables tab counts towards
// the progress sheet and towards nothing else (GRAMMAR-CONTRACT.md §20).
//
//   > "Practising a table from the Tables tab records nothing unless that skill
//   >  is already in mixed practice … Want table practice to count toward the
//   >  sheet without counting toward review scheduling?"  — "yes please"
//
// One flag used to gate two things: `counted` decided both whether an attempt
// was logged and whether the scheduler saw it, so the obvious place to practise
// a table never moved the Chart line. They are split here — always log, schedule
// only when counted — and every assertion below is about one half of that split
// not leaking into the other.
//
// Behaviour, not source: the attempts are produced by running real catalogue
// items through a real session against a real store, and read back through the
// same functions the app reads them with.
//
// The Latin here is invented. No word of the book appears in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueDrill } from '../app/js/grammar/session.js';
import { createGrammarStore } from '../app/js/grammar/store-grammar.js';
import { skillProgress } from '../app/js/grammar/progress.js';
import { progressTrail } from '../app/js/grammar/stats.js';
import { addToPractice, isUncounted, LEARN_NEEDED, LEARN_WINDOW } from '../app/js/grammar/scheduler.js';
import { givenNote } from '../app/js/grammar/ui.js';

const SKILL = 'made-up-table-skill';
/** The skill row the sheet reads: one that can have a chart part (it names a table) and can be drilled. */
const skillRow = { id: SKILL, title: 'A made-up table skill', paradigms: ['fict1'] };

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const store = async () => { const g = createGrammarStore({ mode: 'local', storage: mem() }); await g.ready(); return g; };

/**
 * A whole-table chart item on an invented paradigm: three cells, `given` the
 * ones printed before the learner started and `shown` how many the view put on
 * screen — which is what tells a blank table from a phone's single cell.
 */
const table = ({ given = [] } = {}) => {
  const forms = ['nūvela', 'nūvelae', 'nūvelam'];
  return {
    skill: SKILL, kind: 'chart', input: 'chart', key: null, lemma: 'nūvela, nūvelae f',
    prompt: { question: 'Fill in the table.' },
    chart: {
      byWord: false, given: [...given], shown: forms.length, section: 0, target: { row: 0, col: 0 },
      cells: forms.map((a, i) => ({ answer: [a], label: `cell ${i + 1}`, row: i, col: 0 })),
      table: { kind: 'noun', sections: [{ title: 'singular', headers: [], rows: [] }] },
    },
  };
};
const right = (item) => Object.fromEntries(item.chart.cells.map((c, i) => [i, c.answer[0]]));
const wrong = (item) => Object.fromEntries(item.chart.cells.map((c, i) => [i, `${c.answer[0]}xx`]));

/** Run one table through a catalogue drill against `gstore` and answer it. */
async function practise(gstore, item, value = null, { skillId = SKILL, hint = false } = {}) {
  const drill = createCatalogueDrill({ items: [item], gstore, skillId });
  const cur = drill.start();
  assert.ok(cur, 'the table is on screen');
  if (hint) drill.runner.hint();
  const res = await drill.runner.answer(value ?? right(item));
  return { drill, res };
}

/**
 * Several tables through **one** catalogue run, which is what the Tables tab
 * builds (the whole-table drill queues the chosen word and the stock words
 * behind it). It is also the only way to write several rows here: an attempt's
 * id is `at | skill | item_key`, a catalogue item has no key, and a fresh
 * runner starts its clock at `Date.now()` — so two runs inside the same
 * millisecond would be one row. A runner's own clock only ever moves forward.
 */
async function practiseAll(gstore, items, { skillId = SKILL, value = right } = {}) {
  const drill = createCatalogueDrill({ items, gstore, skillId });
  let cur = drill.start();
  while (cur) { await drill.runner.answer(value(cur.item)); cur = drill.runner.forward(); }
  return drill;
}

/** The sheet as the selection page builds it (ui.js `progressOf`), for one skill. */
const sheet = (gstore, o = {}) => skillProgress(skillRow, { state: gstore.getState(SKILL), attempts: gstore.getAttempts({ skill: SKILL }), drillable: true, ...o });
const part = (res, key) => res.parts.find((p) => p.key === key);

/* ------------------------------------------------- 1 · always logged, always marked */

test('a table practised out of the rotation is written down, and marked so a scheduler can skip it', async () => {
  const gstore = await store();
  const { drill } = await practise(gstore, table());
  assert.equal(drill.counted, false, 'the skill is not in mixed practice');
  const rows = gstore.getAttempts({ skill: SKILL });
  assert.equal(rows.length, 1, 'the run used to log nothing at all');
  assert.equal(isUncounted(rows[0]), true, 'the marker the readers read');
  assert.equal(rows[0].meta.uncounted, true, 'and it lives in meta, where it needs no column');
  assert.equal(rows[0].kind, 'chart');
  assert.equal(rows[0].correct, true);
});

test('the marker rides beside the rung, never over it: §18.3 still knows which level the table was at', async () => {
  const gstore = await store();
  await practise(gstore, table({ given: [0, 1] }));
  const [row] = gstore.getAttempts({ skill: SKILL });
  assert.equal(row.meta.given, 67, 'two of three cells were printed');
  assert.equal(row.meta.uncounted, true, 'and the marker was added, not substituted');
});

test('a counted run carries no marker, so nothing changes for a skill already in practice', async () => {
  const gstore = await store();
  await gstore.setState(addToPractice(SKILL));
  const { drill } = await practise(gstore, table());
  assert.equal(drill.counted, true);
  const [row] = gstore.getAttempts({ skill: SKILL });
  assert.equal(isUncounted(row), false);
  assert.equal(row.meta?.uncounted, undefined);
});

/* ------------------------------------------------- 2 · the scheduler never sees it */

test('an uncounted answer moves nothing the scheduler owns — no state, no due date, no stability', async () => {
  const gstore = await store();
  await practise(gstore, table());
  assert.equal(gstore.getState(SKILL), null, 'a skill never touched stays never touched');
  await practise(gstore, table(), wrong(table()));
  assert.equal(gstore.getState(SKILL), null, 'nor does getting one wrong put the skill anywhere');
});

test('a skill sitting in Learn is not nudged by a table: its row comes back byte for byte', async () => {
  const gstore = await store();
  // A skill mid-Learn is the case that matters: `setState` here would move its stage or its due date
  // under the learner, and the scheduler would be reading a session that never happened.
  await gstore.setState({ skill: SKILL, state: 'learning', stage: 2, stability_days: 3, due_at: '2026-09-20T09:00:00.000Z', successes: 4 });
  const before = gstore.getState(SKILL);
  await practise(gstore, table());
  await practise(gstore, table(), wrong(table()));
  const after = gstore.getState(SKILL);
  assert.deepEqual(after, before, 'the skill_state row was touched');
  assert.equal(after.due_at, before.due_at, 'the due date moved');
  assert.equal(after.stability_days, before.stability_days, 'the stability moved');
  assert.equal(after.state, 'learning', 'the state moved');
});

test('setState is never reached at all on an uncounted answer', async () => {
  // Not "the row came back the same" but "the call was not made": a scheduler write is also an
  // outbox row and a sync, and neither may happen for a table practised out of the rotation.
  const gstore = await store();
  let writes = 0;
  const spy = { ...gstore, setState: async (...a) => { writes += 1; return gstore.setState(...a); } };
  await practise(spy, table());
  assert.equal(writes, 0);
  await gstore.setState(addToPractice(SKILL));
  await practise(spy, table());
  assert.equal(writes, 1, 'a counted run still schedules — the split cut the wrong way');
});

/* ------------------------------------------------- 3 · the progress sheet sees it */

test('the chart part ticks from a table practised out of the rotation, and says the rung', async () => {
  const gstore = await store();
  const before = sheet(gstore);
  assert.equal(part(before, 'chart').done, false, 'nothing done yet');
  await practise(gstore, table({ given: [] }));
  const after = sheet(gstore);
  assert.equal(part(after, 'chart').done, true, 'the Chart line never moved from the Tables tab');
  assert.equal(part(after, 'chart').given, 0, 'the rung reaches the sheet too');
  assert.equal(givenNote(part(after, 'chart')), 'completed unaided');
  assert.match(part(after, 'chart').detail, /1 chart answered right/);
  assert.ok(after.done > before.done, 'the row\'s count moved');
});

test('the hardest rung stands, whenever it was done', async () => {
  const gstore = await store();
  await practise(gstore, table({ given: [0, 1] }));
  assert.equal(givenNote(part(sheet(gstore), 'chart')), 'completed with 80% given', '67% of a three-cell table is the 80 rung');
  await practiseAll(gstore, [table({ given: [] }), table({ given: [0, 1] })]);
  assert.equal(part(sheet(gstore), 'chart').given, 0, 'dropping back a level took the achievement away');
  assert.equal(givenNote(part(sheet(gstore), 'chart')), 'completed unaided');
});

test('a table read off its hints is a chart answered right at no rung', async () => {
  const gstore = await store();
  await practise(gstore, table(), null, { hint: true });
  const p = part(sheet(gstore), 'chart');
  assert.equal(p.done, true);
  assert.equal(p.given, null, '"completed unaided" may not be said of a table whose cells were shown');
  assert.equal(givenNote(p), null);
});

/* ---------------------------------- 4 · and the parts that are not the chart do not */

test('table practice does not tick "Practised": that part is the blocked ten on the whole skill', async () => {
  // The learner was asked and chose Chart only. "Practised" claims §10's blocked set of ten on the
  // skill as a whole; letting tables tick it would redefine it as "ten of anything", and a learner
  // who had drilled one paradigm would read the same row as one who had worked the skill through.
  const gstore = await store();
  await practiseAll(gstore, Array.from({ length: 12 }, () => table()));
  const res = sheet(gstore);
  assert.equal(gstore.getAttempts({ skill: SKILL }).length, 12, 'twelve tables were answered');
  assert.equal(part(res, 'chart').done, true);
  assert.equal(part(res, 'practice').done, false, 'twelve tables ticked a part the learner never did');
  assert.equal(part(res, 'practice').detail, null, 'and nothing is claimed about a part with no evidence');
  assert.equal(part(res, 'learn').done, false);
  assert.equal(part(res, 'rotation').done, false);
  assert.equal(part(res, 'mastered').done, false);
});

test('a counted table still counts as practice — the split is about the marker, not about the catalogue', async () => {
  const gstore = await store();
  await gstore.setState(addToPractice(SKILL));
  await practiseAll(gstore, Array.from({ length: 10 }, () => table()));
  assert.equal(part(sheet(gstore), 'practice').done, true, 'what the scheduler took as practice is still practice');
});

/* ------------------------------------------------- 5 · review mechanisms do not see it */

test('a table got wrong never enters "redo what was wrong"', async () => {
  const gstore = await store();
  const t = table();
  await practise(gstore, t, wrong(t));
  const [row] = gstore.getAttempts({ skill: SKILL });
  assert.equal(row.correct, false);
  assert.equal(isUncounted(row), true);
  assert.deepEqual(gstore.getMissed({ skill: SKILL }), [], 'an uncounted miss asks for no review');
  assert.equal(gstore.countMissed({ skill: SKILL }), 0);
  assert.equal(gstore.countMissed(), 0);
  // It is not hidden either: the empty state may not claim a clean sheet over a wrong answer that
  // was really given, and the line that prints this count already names "a catalogue table".
  assert.equal(gstore.countUnnamedMissed({ skill: SKILL }), 1);
});

/* ------------------------------------------------- 6 · the Learn replay is undisturbed */

/** A run of Learn attempts good enough to pass the criterion, oldest first. */
const learnRun = (from, n = LEARN_WINDOW) => Array.from({ length: n }, (_, i) => ({
  skill: SKILL, kind: i % 2 ? 'parse' : 'recognise', mode: 'learn', correct: true, hinted: false,
  item_key: `k-${from}-${i}`, at: new Date(from + i * 60000).toISOString(),
}));

test('a table between two Learn runs merges, splits and closes nothing', async () => {
  const t0 = Date.parse('2026-09-01T09:00:00.000Z');
  const gstore = await store();
  const rows = [...learnRun(t0), ...learnRun(t0 + 3600000)];
  for (const r of rows) await gstore.addAttempt(r);
  const without = sheet(gstore);
  assert.ok(LEARN_NEEDED <= LEARN_WINDOW, 'the criterion is over the window');
  assert.equal(part(without, 'learn').done, true);
  // …now the same log with a table practised in the gap between the two runs.
  const gap = await store();
  for (const r of learnRun(t0)) await gap.addAttempt(r);
  await practise(gap, table());                     // a table, in the middle of the Learn story
  for (const r of learnRun(t0 + 3600000)) await gap.addAttempt(r);
  const with_ = sheet(gap);
  assert.equal(part(with_, 'learn').done, part(without, 'learn').done, 'the table changed whether Learn passed');
  assert.equal(part(with_, 'learn').detail, part(without, 'learn').detail, 'the table changed how the pass is described');
  assert.equal(part(with_, 'lesson').detail, part(without, 'lesson').detail, 'the table was counted as an item answered in Learn');
  assert.equal(part(with_, 'practice').detail, part(without, 'practice').detail, 'the table resumed practice and closed a run');
});

test('an ordinary practice answer in the gap DOES close the run — the test above is not vacuous', async () => {
  const t0 = Date.parse('2026-09-01T09:00:00.000Z');
  const gap = await store();
  for (const r of learnRun(t0)) await gap.addAttempt(r);
  await gap.addAttempt({ skill: SKILL, kind: 'parse', mode: 'practice', correct: true, hinted: false, item_key: 'p-1', at: new Date(t0 + 1800000).toISOString() });
  for (const r of learnRun(t0 + 3600000)) await gap.addAttempt(r);
  assert.match(part(sheet(gap), 'learn').detail ?? '', /passed 2 times/, 'two runs, judged separately');
});

test('the scheduler replay behind the history curve steps over an uncounted table', async () => {
  const t0 = Date.parse('2026-09-01T09:00:00.000Z');
  const ordinary = { skill: SKILL, kind: 'parse', mode: 'practice', correct: true, hinted: false, item_key: 'p-1', at: new Date(t0).toISOString(), ms: 4000 };
  const later = { ...ordinary, item_key: 'p-2', at: new Date(t0 + 7 * 86400000).toISOString() };
  const tableRow = { skill: SKILL, kind: 'chart', mode: 'practice', correct: true, hinted: false, item_key: '', at: new Date(t0 + 86400000).toISOString(), ms: 30000, meta: { given: 0, uncounted: true } };
  const plain = progressTrail([ordinary, later]);
  const withTable = progressTrail([ordinary, tableRow, later]);
  assert.equal(withTable.trail.length, plain.trail.length, 'the uncounted table drew a point on a curve it never moved');
  assert.deepEqual(withTable.trail.map((p) => p.stability), plain.trail.map((p) => p.stability), 'the replayed stability diverged from what the skill really had');
  // …and the same row without the marker would move it, which is what makes the assertion above mean something.
  const counted = progressTrail([ordinary, { ...tableRow, meta: { given: 0 } }, later]);
  assert.notEqual(counted.trail.length, plain.trail.length);
});
