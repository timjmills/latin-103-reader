// node --test tests/ — "Redo what was wrong" (GRAMMAR-CONTRACT.md, 2026-09-06):
//
//   1  the missed-items query: an item whose MOST RECENT attempt was wrong;
//      answering it right clears it, wrong again keeps it, a self-graded
//      "partly" is never a miss, and the index is dropped on every write;
//   2  the redo plan: most recently missed first, still interleaved across
//      skills and kinds, capped by the size asked for, and never a slot
//      outside the skill or the chapter handed in;
//   3  the logging difference — an immediate retry inside an item writes
//      nothing anywhere, a redo is an ordinary logged encounter;
//   4  the empty state, and an item that can no longer be built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrammarStore, isMissedAttempt, missKey } from '../app/js/grammar/store-grammar.js';
import { buildRedoSession, addToPractice, newState } from '../app/js/grammar/scheduler.js';
import { createRedo, createPractice, sessionMisses } from '../app/js/grammar/session.js';
import { createItems, createPool } from '../app/js/grammar/items.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m }; };
const at = (n) => new Date(Date.UTC(2026, 8, 6, 10, n, 0)).toISOString();
const attempt = (skill, item_key, correct, extra = {}) => ({ skill, kind: 'blank', item_key, mode: 'practice', correct, at: at(0), ...extra });

async function storeWith(rows) {
  const g = createGrammarStore({ mode: 'local', storage: mem() });
  await g.ready();
  for (const r of rows) await g.addAttempt(r);
  return g;
}

/* ------------------------------------------- 1 · what counts as missed */

test('isMissedAttempt: wrong is a miss; right is not; a self-graded "partly" never is', () => {
  assert.equal(isMissedAttempt({ correct: false }), true);
  assert.equal(isMissedAttempt({ correct: true }), false);
  assert.equal(isMissedAttempt({ correct: false, self: 'wrong' }), true);
  // migration 0017 gave drill_attempts.self for exactly this: "partly" is worth another look, not a miss.
  assert.equal(isMissedAttempt({ correct: false, self: 'partly' }), false);
  assert.equal(isMissedAttempt({ correct: true, self: 'partly' }), false);
  assert.equal(isMissedAttempt(null), false);
  // an item is named by its skill AND its key: two skills scanning one word of one sentence share a key
  assert.notEqual(missKey({ skill: 'a', item_key: 'k' }), missKey({ skill: 'b', item_key: 'k' }));
});

test('getMissed: an item whose most recent attempt was wrong, most recently missed first', async () => {
  const g = await storeWith([
    attempt('a', 'k1', false, { at: at(1) }),
    attempt('b', 'k2', false, { at: at(2) }),
    attempt('a', 'k3', true, { at: at(3) }),
    attempt('c', 'k4', false, { at: at(4) }),
  ]);
  assert.deepEqual(g.getMissed().map((m) => m.item_key), ['k4', 'k2', 'k1']);
  assert.equal(g.countMissed(), 3);
  assert.deepEqual(g.getMissed({ skill: 'a' }).map((m) => m.item_key), ['k1']);
  assert.deepEqual(g.getMissed({ skills: ['b', 'c'] }).map((m) => m.item_key), ['k4', 'k2']);
  assert.equal(g.countMissed({ skills: new Set(['b']) }), 1);
  assert.deepEqual(g.getMissed({ limit: 2 }).map((m) => m.item_key), ['k4', 'k2']);
});

test('answering a missed item right in a redo clears it; wrong again keeps it, with a fresher timestamp', async () => {
  const g = await storeWith([attempt('a', 'k1', false, { at: at(1) }), attempt('b', 'k2', false, { at: at(2) })]);
  assert.equal(g.countMissed(), 2);
  // the redo answers k1 right and k2 wrong
  await g.addAttempt(attempt('a', 'k1', true, { at: at(10) }));
  await g.addAttempt(attempt('b', 'k2', false, { at: at(11) }));
  const left = g.getMissed();
  assert.deepEqual(left.map((m) => m.item_key), ['k2'], 'the list shrinks by exactly the one got right');
  assert.equal(left[0].at, at(11), 'and the one still missed carries its newest miss');
});

test('an earlier wrong answer does not resurrect an item put right since', async () => {
  const g = await storeWith([attempt('a', 'k1', true, { at: at(9) }), attempt('a', 'k1', false, { at: at(2) })]);
  assert.equal(g.countMissed(), 0, 'the most recent attempt decides, whatever order the rows arrived in');
});

test('an attempt with no item_key is left out: it names no item, so it could never be redone', async () => {
  const g = await storeWith([attempt('a', '', false, { at: at(1) }), attempt('a', 'k1', false, { at: at(2) })]);
  assert.deepEqual(g.getMissed().map((m) => m.item_key), ['k1']);
});

test('the missed index is dropped on every write, as the per-skill one is', async () => {
  const g = await storeWith([attempt('a', 'k1', false, { at: at(1) })]);
  assert.equal(g.countMissed(), 1);
  await g.addAttempt(attempt('b', 'k2', false, { at: at(2) }));
  assert.equal(g.countMissed(), 2, 'a new attempt is seen at once');
  await g.resetSkill('a');
  assert.equal(g.countMissed(), 1, 'and so is a reset');
  await g.resetAll();
  assert.equal(g.countMissed(), 0);
});

test('sessionMisses: one row per item, the last answer to it deciding, newest first', () => {
  const log = [
    { skill: 'a', kind: 'blank', item_key: 'k1', correct: false, at: at(1) },
    { skill: 'b', kind: 'chart', item_key: 'k2', correct: false, at: at(2) },
    { skill: 'a', kind: 'blank', item_key: 'k1', correct: true, at: at(3) },   // re-queued and got right
    { skill: 'c', kind: 'parse', item_key: 'k4', correct: true, partial: true, at: at(4) },
  ];
  assert.deepEqual(sessionMisses(log).map((m) => m.item_key), ['k2']);
  assert.deepEqual(sessionMisses([]), []);
});

/* -------------------------------------------------- 2 · the redo plan */

const skillRow = (id) => ({ id, set: null, title: id, plain: `the ${id}`, summary: `${id}.`, kinds: ['blank', 'chart', 'parse'], parse_filter: { case: 'dat' }, confusable_with: [], prereqs: [], feature: 'case' });
const SKILLS = new Map(['a', 'b', 'c', 'd'].map((id) => [id, skillRow(id)]));
const miss = (skill, key, kind, n) => ({ skill, kind, item_key: key, at: at(n) });

test('buildRedoSession: the most recent miss leads, and the plan is a slot per named item', () => {
  const plan = buildRedoSession({ misses: [miss('a', 'k1', 'blank', 1), miss('b', 'k2', 'chart', 5)], skills: SKILLS, seed: 1 });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], { skill: 'b', kind: 'chart', stage: 1, currentWeek: false, itemKey: 'k2', redo: true });
  assert.equal(plan[1].itemKey, 'k1');
});

test('buildRedoSession: still interleaved — no two neighbours on one skill or of one kind while anything else is left', () => {
  const misses = [
    miss('a', 'a1', 'blank', 9), miss('a', 'a2', 'blank', 8), miss('a', 'a3', 'blank', 7),
    miss('b', 'b1', 'chart', 6), miss('b', 'b2', 'chart', 5), miss('b', 'b3', 'chart', 4),
  ];
  const plan = buildRedoSession({ misses, skills: SKILLS, size: 6, seed: 7 });
  assert.equal(plan.length, 6);
  for (let i = 1; i < plan.length; i++) {
    assert.notEqual(plan[i].skill, plan[i - 1].skill, `slot ${i} repeats the skill`);
    assert.notEqual(plan[i].kind, plan[i - 1].kind, `slot ${i} repeats the kind`);
  }
  assert.equal(plan[0].itemKey, 'a1', 'and the newest miss is still first');
});

test('buildRedoSession: the size caps it, and the cap is spread across the skills that missed', () => {
  const misses = [
    miss('a', 'a1', 'blank', 9), miss('a', 'a2', 'blank', 8), miss('a', 'a3', 'blank', 7), miss('a', 'a4', 'blank', 6),
    miss('b', 'b1', 'chart', 5), miss('b', 'b2', 'chart', 4),
    miss('c', 'c1', 'parse', 3),
  ];
  const plan = buildRedoSession({ misses, skills: SKILLS, size: 3, seed: 3 });
  assert.equal(plan.length, 3);
  assert.deepEqual([...new Set(plan.map((p) => p.skill))].sort(), ['a', 'b', 'c'], 'a redo of three is not three of one skill');
  const keys = plan.map((p) => p.itemKey);
  assert.ok(keys.includes('a1') && keys.includes('b1') && keys.includes('c1'), 'each skill contributes its own newest miss');
});

test('buildRedoSession: nothing outside the skills handed in, and duplicates of an item collapse to its newest', () => {
  const only = new Map([['a', skillRow('a')]]);
  const plan = buildRedoSession({ misses: [miss('a', 'k1', 'blank', 1), miss('b', 'k2', 'chart', 9), miss('z', 'k3', 'blank', 8)], skills: only, seed: 1 });
  assert.deepEqual(plan.map((p) => p.skill), ['a'], 'a chapter or a skill hands in its own world and the plan stays inside it');
  const dup = buildRedoSession({ misses: [miss('a', 'k1', 'blank', 1), miss('a', 'k1', 'chart', 6)], skills: only, seed: 1 });
  assert.equal(dup.length, 1);
  assert.equal(dup[0].kind, 'chart', 'the newest attempt on the item says which kind it was');
  assert.deepEqual(buildRedoSession({ misses: [], skills: SKILLS }), [], 'nothing missed, nothing planned');
  assert.deepEqual(buildRedoSession({ misses: [{ skill: 'a', kind: 'blank', item_key: '' }], skills: only }), [], 'an item with no key is not a slot');
});

test('buildRedoSession: each slot takes its skill\'s current stage', () => {
  const states = new Map([['a', { ...newState('a'), stage: 3 }], ['b', { ...newState('b'), stage: 2 }]]);
  const plan = buildRedoSession({ misses: [miss('a', 'k1', 'blank', 2), miss('b', 'k2', 'chart', 1)], skills: SKILLS, states, seed: 1 });
  assert.equal(plan.find((p) => p.skill === 'a').stage, 3);
  assert.equal(plan.find((p) => p.skill === 'b').stage, 2);
});

/* ---------------------------------- 3 · a retry writes nothing, a redo is logged */

/** A store in the shape the session modules use, remembering every write. */
function memStore() {
  const states = new Map();
  const attempts = [];
  return {
    states, attempts,
    getStates: () => states,
    getState: (id) => states.get(id) ?? null,
    setState: async (s) => { states.set(s.skill, s); return s; },
    getConfusions: () => [],
    getAttempts: () => attempts,
    addAttempt: async (a) => { attempts.push(a); },
    bumpConfusion: async () => {},
  };
}
/**
 * A generator that honours `itemKey`: the key names the item, and a key it has
 * never heard of builds nothing (the sentence left the library) — the two
 * behaviours a redo depends on.
 */
const keyedItems = (gone = new Set()) => ({
  drillable: () => true,
  generate: ({ skill, kind = 'blank', stage = 2, itemKey = null }) => {
    if (itemKey != null && gone.has(itemKey)) return null;
    const key = itemKey ?? `${skill}:fresh:${Math.random()}`;
    return {
      skill, kind, stage, key, input: 'type', answer: ['right'], choices: null,
      unit_id: null, target: null, entry: null, meanings: [],
      prompt: { la: 'Mārcus ___ nihil dat.', question: 'Fill the blank', gloss: null, hint: 'x' },
      confuse: { values: {}, indexes: {}, forms: {} },
      feedback: { short: 'x', term: 't', label: { name: 'Dative', plain: "the 'to/for' form" }, table: null, lemma: 'soror', sense: 'sister' },
    };
  },
});

const rotation = () => { const g = memStore(); for (const id of SKILLS.keys()) g.states.set(id, addToPractice(newState(id))); return g; };

test('the immediate retry inside an item is judged and written down nowhere', async () => {
  const gstore = rotation();
  const p = createPractice({ plan: [{ skill: 'a', kind: 'blank', stage: 2, currentWeek: false }], gstore, items: keyedItems(), skillsIndex: { skills: SKILLS }, size: 1, rand: () => 0.4 });
  p.start();
  const before = gstore.attempts.length;
  const first = await p.runner.answer('nope');
  assert.equal(first.correct, false);
  assert.equal(first.retry, false);
  assert.equal(gstore.attempts.length, before + 1, 'the first answer is logged');
  const stateAfterFirst = { ...gstore.states.get('a') };
  const again = await p.runner.answer('right');
  assert.equal(again.retry, true, 'the retry says so');
  assert.equal(again.correct, true);
  assert.equal(gstore.attempts.length, before + 1, 'no second drill_attempts row');
  assert.deepEqual(gstore.states.get('a'), stateAfterFirst, 'and the scheduler never sees it');
  assert.equal(p.runner.log.length, 1, 'nor does the log, so the criterion cannot be inflated');
});

test('a redo is an ordinary encounter: logged, fed to the scheduler, and the item it clears is the one got right', async () => {
  const gstore = rotation();
  const misses = [miss('a', 'a1', 'blank', 2), miss('b', 'b1', 'chart', 1)];
  const redo = createRedo({ misses, gstore, items: keyedItems(), skillsIndex: { skills: SKILLS }, size: 10, rand: () => 0.4 });
  assert.equal(redo.plan.length, 2);
  assert.deepEqual(redo.plan.map((p) => p.itemKey), ['a1', 'b1']);
  assert.equal(redo.requested, 2);
  const first = redo.start();
  assert.equal(first.item.key, 'a1', 'the runner plays the very item that was missed');
  const r1 = await redo.runner.answer('right');
  assert.equal(r1.retry, false);
  redo.runner.forward();
  await redo.runner.answer('nope');
  assert.equal(gstore.attempts.length, 2, 'both answers are logged — a redo is spaced retrieval, not a second try');
  assert.deepEqual(gstore.attempts.map((a) => [a.item_key, a.correct]), [['a1', true], ['b1', false]]);
  assert.equal(gstore.attempts.every((a) => a.mode === 'practice'), true);
  assert.ok(gstore.states.get('a').successes >= 1, 'the scheduler saw the right answer');
  assert.ok(gstore.states.get('b').failures >= 1, 'and the wrong one');
  // What the store would say afterwards: the list has shrunk by exactly the one got right.
  const g = await storeWith([attempt('a', 'a1', false, { at: at(2) }), attempt('b', 'b1', false, { at: at(1) })]);
  for (const a of gstore.attempts) await g.addAttempt({ ...a, at: at(20 + gstore.attempts.indexOf(a)) });
  assert.deepEqual(g.getMissed().map((m) => m.item_key), ['b1']);
});

test('a redo of one skill is blocked: a miss there is not re-queued beside itself', async () => {
  const gstore = rotation();
  const redo = createRedo({ misses: [miss('a', 'a1', 'blank', 2), miss('a', 'a2', 'chart', 1)], gstore, items: keyedItems(), skillsIndex: { skills: new Map([['a', skillRow('a')]]) }, oneSkill: 'a', rand: () => 0.4 });
  redo.start();
  const before = redo.runner.length;
  await redo.runner.answer('nope');
  assert.equal(redo.runner.length, before, 'no re-queue in a one-skill redo, as in "Practise this skill"');
  assert.equal(redo.runner.queue.every((s) => s.skill === 'a'), true, 'and nothing outside the skill asked for');
});

test('a redo narrowed to a chapter cannot reach outside it, re-queue and filler included', async () => {
  const gstore = rotation();
  const world = new Map([['a', skillRow('a')], ['b', skillRow('b')]]);   // the chapter's material
  const redo = createRedo({ misses: [miss('a', 'a1', 'blank', 3), miss('b', 'b1', 'chart', 2), miss('c', 'c1', 'parse', 1)], gstore, items: keyedItems(), skillsIndex: { skills: world }, rand: () => 0.4 });
  assert.deepEqual([...new Set(redo.plan.map((p) => p.skill))].sort(), ['a', 'b'], 'the miss on c is not this chapter\'s');
  redo.start();
  await redo.runner.answer('nope');           // a miss re-queues, and the filler may only draw from the chapter
  assert.equal(redo.runner.queue.every((s) => world.has(s.skill)), true);
});

/* ------------------------------- 4 · the empty state and an item that has gone */

test('nothing to redo builds no session at all', () => {
  const gstore = rotation();
  const redo = createRedo({ misses: [], gstore, items: keyedItems(), skillsIndex: { skills: SKILLS } });
  assert.deepEqual(redo.plan, []);
  assert.equal(redo.start(), null, 'an empty redo is never started — the view says so quietly instead');
});

test('an item that can no longer be built is dropped quietly and the count is smaller', async () => {
  const gstore = rotation();
  const items = keyedItems(new Set(['b1']));   // b1's sentence has left the library
  const redo = createRedo({ misses: [miss('a', 'a1', 'blank', 3), miss('b', 'b1', 'chart', 2), miss('c', 'c1', 'parse', 1)], gstore, items, skillsIndex: { skills: SKILLS }, rand: () => 0.4 });
  assert.equal(redo.plan.length, 3, 'the plan cannot know: only the generator can answer');
  assert.equal(redo.start().item.key, 'a1');
  await redo.runner.answer('right');
  redo.runner.forward();
  assert.equal(redo.runner.current.item.key, 'c1', 'the item that could not be rebuilt is stepped over');
  assert.equal(redo.runner.dropped, 1, 'and counted, so the view can say the count is smaller');
  await redo.runner.answer('right');
  redo.runner.forward();
  assert.equal(redo.runner.current, null);
  const s = redo.runner.summary();
  assert.equal(s.total, 2);
  assert.equal(s.dropped, 1);
  assert.deepEqual(s.missed, [], 'both were answered right, so nothing is left to redo');
});

test('a redo whose every item has gone ends with no items and no crash', async () => {
  const gstore = rotation();
  const redo = createRedo({ misses: [miss('a', 'a1', 'blank', 2), miss('b', 'b1', 'chart', 1)], gstore, items: keyedItems(new Set(['a1', 'b1'])), skillsIndex: { skills: SKILLS }, rand: () => 0.4 });
  assert.equal(redo.start(), null);
  assert.equal(redo.runner.dropped, 2);
  assert.equal(redo.runner.summary().total, 0);
});

/* ------------------------- 5 · the real generator rebuilds an item by its key */

// An item's key is stable per (kind, unit, token) — that is what lets a missed item be rebuilt. These use
// the real `createItems` over a two-sentence fixture: the key that came out of a draw goes back in and
// brings the same item; a key from a sentence the library no longer holds brings nothing.
const memPool = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const noun = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const GLOSS = {
  puero: [noun('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [{ case: 'dat', number: 'sg', gender: 'm' }], ['boy'])],
  servo: [noun('servus -ī m', 'servus', [2, 1], 'm', ['serv', 'serv'], [{ case: 'dat', number: 'sg', gender: 'm' }], ['slave'])],
  librum: [noun('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [{ case: 'acc', number: 'sg', gender: 'm' }], ['book'])],
};
const gloss = (form) => ({ form, entries: GLOSS[form] ?? [], via: GLOSS[form] ? 'exact' : 'miss', enclitic: null });
const DAT = new Map([['dat-x', { id: 'dat-x', title: 'Dative', plain: 'the to/for form', summary: 'The dative is the to/for form.', kinds: ['blank', 'recognise'], parse_filter: { case: 'dat' }, feature: 'case', patterns: [], confusable_with: [], prereqs: [], chapter: 1, course: '101', week: 1, paradigms: [] }]]);
const REAL_UNITS = [{ id: 'w01:1.1', la: 'Puerō librum dat.' }, { id: 'w01:1.2', la: 'Servō librum dat.' }];
const realItems = () => createItems({ units: REAL_UNITS, lookup: gloss, paradigm: null, skills: DAT, storage: memPool(), rand: () => 0.4 });

test('a key drawn once brings the same item back, and the key names (kind, unit, token)', () => {
  const first = realItems().generate({ skill: 'dat-x', kind: 'blank', stage: 2 });
  assert.ok(first, 'the fixture produces a blank item');
  assert.match(first.key, /^blank:w01:1\.[12]:(puero|servo):\d+$/);
  const again = realItems().generate({ skill: 'dat-x', kind: 'blank', stage: 2, itemKey: first.key });
  assert.equal(again.key, first.key);
  assert.equal(again.unit_id, first.unit_id);
  assert.equal(again.target.text, first.target.text);
  assert.deepEqual(again.answer, first.answer);
});

test('a key whose sentence has left the library builds nothing — no substitute under the same name', () => {
  const gone = createItems({ units: [REAL_UNITS[0]], lookup: gloss, paradigm: null, skills: DAT, storage: memPool(), rand: () => 0.4 });
  assert.equal(gone.generate({ skill: 'dat-x', kind: 'blank', stage: 2, itemKey: 'blank:w01:1.2:servo:0' }), null);
  // …and neither does it fall through to another kind, which would be another item wearing the same name.
  assert.equal(gone.generate({ skill: 'dat-x', kind: 'chart', stage: 2, itemKey: 'chart:puer:0.0.0' }), null);
});

test('createPool: `want` hands back one exact key and marks it used; an unknown key is null', () => {
  const pool = createPool(memPool());
  assert.equal(pool.chooseInfo('s', 'blank', ['a', 'b', 'c'], () => 0, [], 'b').key, 'b');
  assert.ok(pool.used('s', 'blank').has('b'));
  assert.equal(pool.chooseInfo('s', 'blank', ['a', 'b', 'c'], () => 0, [], 'zz'), null);
});
