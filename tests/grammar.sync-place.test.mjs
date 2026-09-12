// node --test tests/ — the lesson place and an attempt's `meta` across two
// devices (GRAMMAR-CONTRACT.md §25).
//
// The learner finished a lesson's six steps on their computer, opened the same
// skill on their phone and saw step 1 with nothing done: `l103.grammar.learn`
// had never left the browser. What is modelled here is exactly that — **two
// grammar stores over one in-memory backend**, which is a faithful model of two
// devices and is where the merge lives. The real cross-device test needs the
// learner's own account and is theirs to run.
//
// What each test pins:
//   · two partial `done` sets converge to their **union**, whichever order they sync in
//   · a place this device has and the server has not survives a first sync, and is pushed up
//   · a fresh device with a populated server is given the place
//   · `learn_place` NULL is *unknown* and never "no steps done"
//   · `meta` NULL is **counted** (before §20 an uncounted attempt was not logged at all)
//   · `meta.given` NULL is *unknown* — never 0, never a failure (§18.3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrammarStore, serverAttemptRow, serverStateRow } from '../app/js/grammar/store-grammar.js';
import { mergeLearnPlace, normaliseLearnPlace, samePlace, isUncounted, addToPractice } from '../app/js/grammar/scheduler.js';
import { skillProgress } from '../app/js/grammar/progress.js';
import { normaliseLearn, learnCache } from '../app/js/grammar/ui.js';

/* ------------------------------------------------------------------ rigs */

/** One learner's Supabase, in memory: the rows, and a count of what was read and written. */
function backend() {
  const tables = { skill_state: new Map(), drill_attempts: new Map(), confusions: new Map(), pensa: new Map() };
  const api = {
    tables,
    rows: (t) => [...tables[t].values()].map((r) => JSON.parse(JSON.stringify(r))),
    place: (skill) => tables.skill_state.get(skill)?.learn_place ?? null,
    from(table) {
      const t = tables[table];
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: () => q,
        then: (res) => res({ data: api.rows(table), error: null }),
        /** PostgREST writes only the columns in the body: an absent column keeps whatever the row has. */
        upsert(row) {
          const key = row.skill ?? `${row.at}|${row.skill}|${row.item_key}`;
          const id = table === 'drill_attempts' ? `${row.at}|${row.skill}|${row.item_key}` : key;
          const cur = t.get(id);
          t.set(id, cur ? { ...cur, ...row } : { ...row });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return api;
}

/** One device: its own IndexedDB, its own outbox, both backed by the shared server. */
function device(server, { storage = null } = {}) {
  const stores = { skill_state: new Map(), drill_attempts: new Map(), confusions: new Map(), pensa: new Map() };
  const keyOf = (name, v) => (name === 'skill_state' ? v.skill : name === 'drill_attempts' ? v.id : name === 'pensa' ? v.id : `${v.skill_a}|${v.skill_b}`);
  const dbModule = {
    getAll: async (s) => [...stores[s].values()],
    put: async (s, v) => { stores[s].set(keyOf(s, v), JSON.parse(JSON.stringify(v))); },
    del: async (s, k) => { stores[s].delete(k); },
    clear: async (s) => { stores[s].clear(); },
    deleteByIndex: async (s, _i, value) => { for (const [k, v] of [...stores[s]]) if (v.skill === value) stores[s].delete(k); },
  };
  const outbox = [];
  const hooks = {
    ready: async () => {},
    uid: () => 'learner',
    online: () => true,
    getClient: async () => server,
    pageAll: async (fn) => (await fn()).data ?? [],
    outboxEmpty: async () => outbox.length === 0,
    enqueue: async (op) => { outbox.push(op); },
    onRealtime: () => () => {},
    onSynced: () => () => {},
  };
  /** Send everything queued, the way store.js's sendOp does for these two ops. */
  const flush = async () => {
    while (outbox.length) {
      const op = outbox.shift();
      if (op.table === 'skill_state' && op.op === 'upsert') await server.from('skill_state').upsert(op.row);
      else if (op.table === 'skill_state' && op.op === 'learn_place') await server.from('skill_state').upsert({ skill: op.skill, learn_place: op.learn_place ?? null });
      else if (op.table === 'drill_attempts' && op.op === 'insert') await server.from('drill_attempts').upsert(op.row);
    }
  };
  const cache = storage ? learnCache(storage) : null;
  const g = createGrammarStore({ mode: 'idb', hooks, dbModule, learnCache: cache, storage });
  return { g, flush, outbox, storage, cache, stores };
}

/** A localStorage stand-in. */
const mem = (seed = null) => {
  const m = new Map(seed ? Object.entries(seed) : []);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
/** Everything a device knows and has queued, sent and pulled back. */
const sync = async (d) => { await d.flush(); await d.g.pull(); await d.flush(); };

/* ---------------------------------------------------- the merge, in itself */

test('mergeLearnPlace: done is a union, seen and at take the larger, and a null side stands aside', () => {
  assert.deepEqual(mergeLearnPlace({ done: [0, 1, 2] }, { done: [3, 4, 5] }), { done: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(mergeLearnPlace({ done: [3, 1] }, { done: [1, 0] }), { done: [0, 1, 3] }, 'sorted, no repeats');
  assert.deepEqual(mergeLearnPlace({ seen: 4, at: 10 }, { seen: 9, at: 2 }), { seen: 9, at: 10 }, 'seen is a high-water mark; at is the later touch');
  // null is unknown: it loses to anything the other side knows, in either position, and erases nothing.
  assert.deepEqual(mergeLearnPlace(null, { done: [0, 1] }), { done: [0, 1] });
  assert.deepEqual(mergeLearnPlace({ done: [0, 1] }, null), { done: [0, 1] });
  assert.equal(mergeLearnPlace(null, null), null);
  // …and neither does an empty object, a bad type, or a stored `{ done: [] }`.
  assert.deepEqual(mergeLearnPlace({ done: [2] }, {}), { done: [2] });
  assert.deepEqual(mergeLearnPlace({ done: [2] }, { done: [] }), { done: [2] });
  assert.deepEqual(mergeLearnPlace({ done: [2] }, 'nonsense'), { done: [2] });
  // The union is commutative, so two devices reach the same answer whichever pulls first.
  assert.deepEqual(mergeLearnPlace({ done: [0], seen: 3 }, { done: [4], at: 7 }), mergeLearnPlace({ done: [4], at: 7 }, { done: [0], seen: 3 }));
  assert.equal(normaliseLearnPlace({ done: [], seen: 0, at: 0 }), null, 'a place that says nothing is null, not an empty object');
  assert.equal(samePlace({ done: [1, 2] }, { done: [2, 1] }), true);
  assert.equal(samePlace({ done: [1] }, null), false);
});

/* ------------------------------------------------- two devices, one backend */

test('two devices each holding part of one lesson converge on the union, not on the last writer', async () => {
  const server = backend();
  const pc = device(server);
  const phone = device(server);
  await pc.g.ready();
  await phone.g.ready();

  await pc.g.setLearnPlace('gerund', { done: [0, 1, 2] });
  await phone.g.setLearnPlace('gerund', { done: [3, 4] });
  // The phone writes second, so plain last-write-wins would leave the server holding [3, 4] alone.
  await pc.flush();
  await phone.flush();
  assert.deepEqual(server.place('gerund'), { done: [3, 4] }, 'the raw server row really is the later writer\'s');

  await sync(pc);
  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4], 'the pull unions rather than replacing');
  assert.deepEqual(server.place('gerund').done, [0, 1, 2, 3, 4], 'and the union is pushed back');

  await sync(phone);
  assert.deepEqual(phone.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4], 'the other device catches up');

  // Converged: another round changes nothing, and neither device has lost a step it recorded.
  await sync(pc); await sync(phone);
  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4]);
  assert.deepEqual(phone.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4]);
});

test('the union holds when the other device\'s row is newer: the scheduler\'s fields are last-write-wins, the place is not', async () => {
  const server = backend();
  const pc = device(server);
  const phone = device(server);
  await pc.g.ready(); await phone.g.ready();

  // The pc answered steps and left the skill alone; the phone put it into mixed practice a moment later.
  await pc.g.setLearnPlace('gerund', { done: [0, 1, 2] });
  await pc.flush();
  await phone.g.setState(addToPractice('gerund'));
  await phone.g.setLearnPlace('gerund', { done: [5] });
  await phone.flush();

  await sync(pc);
  const row = pc.g.getState('gerund');
  assert.equal(row.state, 'practising', 'the newer row wins for everything the scheduler owns');
  assert.deepEqual(row.learn_place.done, [0, 1, 2, 5], 'and the place is still the union of both');
});

test('a place this device has and the server has not survives the first sync and is pushed up (the learner\'s computer)', async () => {
  const server = backend();
  // Exactly what is on their disk today: `l103.grammar.learn`, never synced, a lesson finished.
  const storage = mem({ 'l103.grammar.learn': JSON.stringify({ gerund: { done: [0, 1, 2, 3, 4, 5], at: 1757000000000 } }) });
  const pc = device(server, { storage });
  await pc.g.ready();

  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4, 5], 'the cache is read in at startup');
  await sync(pc);
  assert.deepEqual(server.place('gerund').done, [0, 1, 2, 3, 4, 5], 'and pushed to an empty server rather than wiped by it');
  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4, 5], 'the empty server never read as "no steps done"');
  // A second pull against a server that now agrees is still a no-op.
  await sync(pc);
  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4, 5]);
});

test('a fresh device against a populated server is given the place, and mirrors it to its own cache', async () => {
  const server = backend();
  const pc = device(server, { storage: mem({ 'l103.grammar.learn': JSON.stringify({ gerund: { done: [0, 1, 2] } }) }) });
  await pc.g.ready();
  await sync(pc);

  const storage = mem();
  const phone = device(server, { storage });
  await phone.g.ready();
  assert.equal(phone.g.getLearnPlace('gerund'), null, 'nothing is known before the first pull');
  await sync(phone);
  assert.deepEqual(phone.g.getLearnPlace('gerund').done, [0, 1, 2]);
  assert.deepEqual(normaliseLearn(JSON.parse(storage.getItem('l103.grammar.learn'))), { gerund: { done: [0, 1, 2] } }, 'the offline cache is written so the pips draw with no network');
});

test('a server row whose learn_place is NULL never takes a place off a device', async () => {
  const server = backend();
  // An old row, written before the column existed: everything but the place.
  server.tables.skill_state.set('gerund', { ...serverStateRow(addToPractice('gerund')), learn_place: null });

  const phone = device(server, { storage: mem({ 'l103.grammar.learn': JSON.stringify({ gerund: { done: [0, 1, 2, 3, 4, 5] } }) }) });
  await phone.g.ready();
  await sync(phone);
  assert.deepEqual(phone.g.getLearnPlace('gerund').done, [0, 1, 2, 3, 4, 5], 'NULL is unknown, not empty');
  assert.equal(phone.g.getState('gerund').state, 'practising', 'the rest of the old row still applies');
  assert.deepEqual(server.place('gerund').done, [0, 1, 2, 3, 4, 5], 'and the device fills the column in');
});

test('a place is never taken off by a state write: adding a skill to practice keeps the steps already answered', async () => {
  const server = backend();
  const pc = device(server);
  await pc.g.ready();
  await pc.g.setLearnPlace('gerund', { done: [0, 1] });
  // `addToPractice(id)` builds a row from a bare id, so its `learn_place` is null — unknown, not empty.
  await pc.g.setState(addToPractice('gerund'));
  assert.deepEqual(pc.g.getLearnPlace('gerund').done, [0, 1]);
  await pc.g.setLearnPlace('gerund', null);
  assert.equal(pc.g.getLearnPlace('gerund'), null, 'only the deliberate erase clears it');
  assert.equal(pc.g.getState('gerund').state, 'practising', 'and the erase leaves the scheduler\'s row alone');
});

test('resetting a skill clears its place here and in the cache, and clearing a place the device has not got makes no row', async () => {
  const server = backend();
  const storage = mem();
  const pc = device(server, { storage });
  await pc.g.ready();
  await pc.g.setLearnPlace('gerund', { done: [0, 1] });
  assert.ok(storage.getItem('l103.grammar.learn'), 'mirrored on write');
  await pc.g.resetSkill('gerund');
  assert.equal(pc.g.getLearnPlace('gerund'), null);
  assert.equal(storage.getItem('l103.grammar.learn'), null, 'the cache does not resurrect it at the next start');
  // What ui.js does one line after a reset. It must not put the row back.
  await pc.g.setLearnPlace('gerund', null);
  assert.equal(pc.g.getStates().size, 0);
});

/* ----------------------------------------------------- an attempt's `meta` */

test('meta crosses to the second device, so an uncounted table stays uncounted there (§20.4 closed)', async () => {
  const server = backend();
  const pc = device(server);
  const phone = device(server);
  await pc.g.ready(); await phone.g.ready();

  await pc.g.addAttempt({ skill: 'decl2', kind: 'chart', item_key: '', mode: 'practice', correct: true, at: '2026-09-12T10:00:00.000Z', meta: { uncounted: true, given: 20 } });
  await pc.g.addAttempt({ skill: 'decl2', kind: 'chart', item_key: 'c1', mode: 'practice', correct: true, at: '2026-09-12T10:05:00.000Z', meta: { given: 0 } });
  await sync(pc);
  await sync(phone);

  const rows = phone.g.getAttempts({ skill: 'decl2' });
  assert.equal(rows.length, 2);
  assert.equal(isUncounted(rows[0]), true, 'the Tables-tab run is still uncounted on the phone');
  assert.equal(rows[0].meta.given, 20);
  assert.equal(isUncounted(rows[1]), false);
  assert.equal(rows[1].meta.given, 0, '0 is "from memory" and must survive as 0, not fall to null');
  assert.equal('meta' in serverAttemptRow({ skill: 'a', kind: 'chart', item_key: '', mode: 'practice', correct: true, at: 'x', meta: { given: 50 } }), true);
});

test('an attempt with no meta reads as COUNTED, not as unknown — every such row predates the marker', async () => {
  const server = backend();
  // A row written before migration 0020: the column is NULL because the client never sent it.
  server.tables.drill_attempts.set('2026-09-01T10:00:00.000Z|gerund|k1', { skill: 'gerund', kind: 'chart', item_key: 'k1', mode: 'practice', correct: true, hinted: false, self: null, answer: null, expected: null, confused_with: null, ms: null, at: '2026-09-01T10:00:00.000Z', meta: null });
  const phone = device(server);
  await phone.g.ready();
  await sync(phone);

  const [a] = phone.g.getAttempts({ skill: 'gerund' });
  assert.equal('meta' in a, false, 'a null column leaves no meta on the row at all');
  assert.equal(isUncounted(a), false, 'before §20 an uncounted attempt was never written down, so an old row is genuinely counted');

  // What that means where it is read: the chart part is ticked, and the rung is *unknown*.
  const p = skillProgress({ id: 'gerund', paradigms: ['decl2'] }, { attempts: [a], drillable: true });
  const chart = p.parts.find((x) => x.key === 'chart');
  assert.equal(chart.done, true, 'the table was filled in and the sheet says so');
  assert.equal(chart.given, null, 'the rung is unknown — never 0, and never a failure (§18.3)');
});

test('the same is true of an attempt whose meta says nothing about the rung', () => {
  const p = skillProgress({ id: 'gerund', paradigms: ['decl2'] }, {
    attempts: [{ skill: 'gerund', kind: 'chart', item_key: 'k', mode: 'practice', correct: true, at: '2026-09-01T10:00:00.000Z', meta: { uncounted: true } }],
    drillable: true,
  });
  const chart = p.parts.find((x) => x.key === 'chart');
  assert.equal(chart.done, true, 'an uncounted table still proves the table was filled in (§20.1)');
  assert.equal(chart.given, null, 'given absent → unknown');
  assert.equal(p.parts.find((x) => x.key === 'practice').done, false, 'and it never reaches the practice part');
});
