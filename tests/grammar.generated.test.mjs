// node --test tests/ — unlimited and mixed sentence practice from the generated
// banks (GRAMMAR-CONTRACT.md §11, §11b, §12):
//
//   1  the bank loader: `generated/index.json` gates the requests, a bank is
//      fetched once and cached, every sentence comes back `generated: true`
//      with its template, and a missing bank is null, never a throw;
//   2  A1's order over written + generated: a drill draws the skill's written
//      sentences first, then its bank, and nothing from the bank repeats until
//      the whole bank has come round — then a fresh shuffle, said once;
//   3  unlimited practice is the same drill extended ten at a time, the bank's
//      memory carried across the extensions;
//   4  a mixed set interleaves the skill with its confusables and prerequisites,
//      capped to the learner's chapter, each from its own pool;
//   5  a generated item's attempt carries `meta: { generated, template, sentence }`
//      and a written one carries none; neither has a key, so neither enters
//      "redo what was wrong" (the same rule as a teaching step's item).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills, indexCatalogue, normaliseSentences, normaliseGenerated, createTeachDataLoader } from '../app/js/grammar/lessons.js';
import { createItems, createTeachItems } from '../app/js/grammar/items.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { createGrammarStore, normaliseAttempt, serverAttemptRow } from '../app/js/grammar/store-grammar.js';
import { createDrill, createMixed, mixedMembers, createGeneratedTier, createSkillDraw, sessionMisses, LEARN_BLOCKED } from '../app/js/grammar/session.js';

const dataDir = new URL('../app/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const INDEX = indexSkills(read('grammar/skills.json'));
const SKILLS = INDEX.skills;
const CAT = indexCatalogue(read('grammar/paradigms.json'));
const HEADWORDS = read('glossary-headwords.json').headwords;
const DIO = 'dative-indirect-object';
const ACO = 'accusative-object';
const RAW_BANK = read(`grammar/generated/${DIO}.json`);
const RAW_BANK_ACO = read(`grammar/generated/${ACO}.json`);
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const store = () => createGrammarStore({ mode: 'local', storage: mem() });
const sentencesOf = (id) => normaliseSentences(read(`grammar/sentences/${id}.json`), id);
const teachFor = (id, rand = () => 0.3) => createTeachItems({ skill: SKILLS.get(id), sentences: sentencesOf(id).sentences, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand });
/** The skill's bank as a generator, over the first `n` of its sentences (the committed bank is regenerated; a slice keeps the test stable). */
const bankFor = (id, raw, n = 12, rand = () => 0.3) => {
  const bank = normaliseGenerated({ ...raw, sentences: raw.sentences.slice(0, n) }, id);
  return createTeachItems({ skill: SKILLS.get(id), sentences: bank.sentences, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand, poolKey: `test.generated.${id}` });
};
// A small library beside the written set, so a drill without a bank still has the book to reach.
const UNITS = [
  { id: 'r07:1.1', la: 'Iūlius puerō rosam dat.', en: '' }, { id: 'r07:1.2', la: 'Mēdus dominō pecūniam nōn dat.', en: '' },
  { id: 'r03:1.1', la: 'Mārcus puellae librum dat.', en: '' }, { id: 'r03:1.2', la: 'Puer puellam videt.', en: '' },
];
const gen = (rand = () => 0.3) => { const items = createItems({ units: UNITS, lookup, paradigm, skills: SKILLS, storage: mem(), rand }); return createGenerator({ items, stage3: createStage3({ items, paradigm, rand }), sets: null, skills: SKILLS }); };
const answerRight = (item) => (item.input === 'chart' ? Object.fromEntries(item.chart.cells.map((c, i) => [i, c.answer[0]]))
  : item.input === 'choice' ? item.choices.find((c) => c.correct).value : item.input === 'tap' ? item.accept[0] : item.answer[0]);
const answerWrong = (item) => (item.input === 'chart' ? Object.fromEntries(item.chart.cells.map((c, i) => [i, 'xx']))
  : item.input === 'choice' ? item.choices.find((c) => !c.correct).value : item.input === 'tap' ? [0, 1, 2, 3].find((i) => !item.accept.includes(i)) : 'xx');
// A cheap pseudo-random sequence, so shuffles differ from run to run of the same test but the test stays deterministic.
const lcg = (seed = 7) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/* ============================================ 1 · the bank loader */

test('the committed bank has the §11a shape and normaliseGenerated marks every sentence', () => {
  assert.equal(RAW_BANK.skill, DIO);
  assert.ok(Array.isArray(RAW_BANK.seeds) && RAW_BANK.seeds.length >= 1);
  assert.ok(RAW_BANK.count >= 100 && RAW_BANK.sentences.length === RAW_BANK.count, 'a full bank (the coverage check wants 100)');
  for (const s of RAW_BANK.sentences.slice(0, 50)) {
    // The focus is the printed form; the sentence may capitalise it at its head (Mātrī … / mātrī).
    assert.ok(s.id && s.la && s.en && s.focus && s.la.toLowerCase().includes(s.focus.toLowerCase()), s.id);
    assert.equal(s.generated, true);
    assert.ok(/^dio-t\d+$/.test(s.template), s.template);
    assert.ok(s.gloss.length >= 5 && s.gloss.length <= 8 && s.gloss.every((g) => g.w && g.m), 'every word glossed');
  }
  const bank = normaliseGenerated(RAW_BANK, DIO);
  assert.equal(bank.generated, true);
  assert.equal(bank.count, RAW_BANK.sentences.length);
  assert.deepEqual(bank.seeds, RAW_BANK.seeds);
  for (const s of bank.sentences) { assert.equal(s.generated, true); assert.ok(s.template); assert.ok(s.gloss.length); }
  // A written sentence carries neither flag.
  const written = sentencesOf(DIO).sentences[0];
  assert.equal(written.generated, undefined);
  assert.equal(written.template, undefined);
});

test('createTeachDataLoader.loadGenerated: the manifest gates the requests, a bank is fetched once, a miss is null', async () => {
  const calls = [];
  const loader = createTeachDataLoader({ fetchJson: async (name) => {
    calls.push(name);
    if (name === 'generated/index.json') return { generated: [DIO] };
    if (name === `generated/${DIO}.json`) return RAW_BANK;
    throw new Error(`${name}: 404`);
  } });
  const ids = await loader.generatedIds();
  assert.ok(ids.has(DIO) && !ids.has('purpose-clause'));
  const bank = await loader.loadGenerated(DIO);
  assert.equal(bank.count, RAW_BANK.sentences.length);
  assert.equal(await loader.loadGenerated(DIO), bank, 'cached: the same object');
  assert.equal(await loader.loadGenerated('purpose-clause'), null, 'not in the manifest: null without a request');
  assert.deepEqual(calls, ['generated/index.json', `generated/${DIO}.json`]);
  // No manifest: every bank is asked for, and a 404 is null.
  const c2 = [];
  const bare = createTeachDataLoader({ fetchJson: async (name) => { c2.push(name); throw new Error(`${name}: 404`); } });
  assert.equal(await bare.generatedIds(), null);
  assert.equal(await bare.loadGenerated(DIO), null);
  assert.equal(await bare.loadGenerated(DIO), null);
  assert.deepEqual(c2, ['generated/index.json', `generated/${DIO}.json`], 'a 404 is remembered');
  // A network failure is not remembered: the next ask tries again.
  let fail = true;
  const flaky = createTeachDataLoader({ fetchJson: async (name) => { if (name === 'generated/index.json') return { generated: [DIO] }; if (fail) throw new Error('network'); return RAW_BANK; } });
  assert.equal(await flaky.loadGenerated(DIO), null);
  fail = false;
  assert.ok((await flaky.loadGenerated(DIO))?.count);
});

/* ============================================ 2 · A1 over written + generated */

test('the generated tier: a fresh shuffle, nothing twice until the bank is spent, then a new round said once', () => {
  const skill = SKILLS.get(DIO);
  const generated = bankFor(DIO, RAW_BANK, 12, lcg(3));
  const tier = createGeneratedTier({ skill, generated, rand: lcg(11) });
  assert.equal(tier.size, 12);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const it = tier.item({ skill: DIO, kind: i % 2 ? 'recognise' : 'blank', stage: 1 });
    assert.ok(it, `item ${i}`);
    assert.equal(it.pool, 'generated');
    assert.equal(it.generated, true);
    assert.ok(it.template && it.taught, 'says which template and sentence');
    assert.equal(it.key, null, 'never a redo item');
    assert.equal(it.repeat, false);
    seen.push(it.taught);
  }
  assert.equal(new Set(seen).size, 12, 'every sentence once before any comes round');
  assert.equal(tier.round, 0);
  const again = tier.item({ skill: DIO, kind: 'recognise', stage: 1 });
  assert.ok(again && again.repeat === true, 'the first of the new round says so');
  assert.equal(tier.round, 1);
  assert.equal(tier.item({ skill: DIO, kind: 'parse', stage: 1 }).repeat, false);
  // A chart slot is asked as a sentence kind: a generated sentence carries no table.
  const chart = tier.item({ skill: DIO, kind: 'chart', stage: 1 });
  assert.ok(chart && chart.kind !== 'chart');
  // Without a bank the tier answers nothing.
  const none = createGeneratedTier({ skill, generated: null });
  assert.equal(none.item({ skill: DIO, kind: 'recognise', stage: 1 }), null);
  assert.equal(none.size, 0);
  // The shuffle is the tier's own: two tiers over the same bank with different seeds start differently.
  const t2 = createGeneratedTier({ skill, generated: bankFor(DIO, RAW_BANK, 12, lcg(3)), rand: lcg(99) });
  const firstA = createGeneratedTier({ skill, generated: bankFor(DIO, RAW_BANK, 12, lcg(3)), rand: lcg(11) }).item({ skill: DIO, kind: 'recognise', stage: 1 }).taught;
  const firstB = t2.item({ skill: DIO, kind: 'recognise', stage: 1 }).taught;
  assert.notEqual(firstA, firstB);
});

test('A1 in a drill: written first, then the bank, and the book only after the bank (the pool says which)', async () => {
  const skill = SKILLS.get(DIO);
  const written = new Set(sentencesOf(DIO).sentences.map((s) => s.id));
  const libraryItem = (slot, opts = {}) => gen().generate({ skill: DIO, kind: slot.kind, stage: slot.stage, chapter: 7, chapterMode: 'ceiling', ...opts });
  const tier = createGeneratedTier({ skill, generated: bankFor(DIO, RAW_BANK, 6), rand: lcg(5) });
  const draw = createSkillDraw({ skill, steps: [], teachItems: teachFor(DIO), libraryItem, generatedItem: tier.item, rand: lcg(2) });
  const pools = [];
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const it = draw.blockedItem({ skill: DIO, kind: 'recognise', stage: 1 });
    if (!it) break;
    pools.push(it.pool);
    ids.push(it.pool === 'written' ? it.taught : it.pool === 'generated' ? it.taught : it.key);
    if (it.pool === 'written') assert.ok(written.has(it.taught));
  }
  const firstGen = pools.indexOf('generated');
  const firstLib = pools.findIndex((p) => p === 'library-short' || p === 'library');
  assert.ok(firstGen > 5, `the written sentences come first (${firstGen})`);
  assert.ok(pools.slice(0, firstGen).every((p) => p === 'written'));
  assert.equal(firstLib, -1, 'the bank is endless: the book is never reached while it exists');
  const genIds = ids.filter((_, i) => pools[i] === 'generated');
  assert.equal(new Set(genIds.slice(0, 6)).size, 6, 'six generated sentences, none twice');
  assert.ok(genIds.length > 6, 'then the bank comes round again');
  // Without a bank the draw reaches the book after the written set, as before.
  const plain = createSkillDraw({ skill, steps: [], teachItems: teachFor(DIO), libraryItem, rand: lcg(2) });
  const p2 = [];
  for (let i = 0; i < 30; i++) { const it = plain.blockedItem({ skill: DIO, kind: 'recognise', stage: 1 }); if (!it) break; p2.push(it.pool); }
  assert.ok(p2.includes('library-short'));
  assert.ok(!p2.includes('generated'));
});

/* ============================================ 3 · unlimited practice */

test('unlimited practice: createDrill open-ended, ten more at a time, the bank\'s memory carried across', async () => {
  const gstore = store();
  await gstore.ready();
  const skill = SKILLS.get(DIO);
  const drill = createDrill({ skill, gstore, items: gen(), teachItems: teachFor(DIO), generated: bankFor(DIO, RAW_BANK, 40, lcg(4)), currentWeekN: 107, pin: 'The receiver takes the dative.', rand: lcg(9), open: true });
  assert.equal(drill.open, true);
  assert.equal(drill.bank, 40);
  await drill.begin();
  let cur = drill.start();
  const genSeen = [];
  let n = 0;
  const run = async () => { while (cur) { n += 1; assert.equal(cur.item.skill, DIO); assert.ok(cur.item.pin); if (cur.item.pool === 'generated') genSeen.push(cur.item.taught); await drill.runner.answer(answerRight(cur.item)); cur = drill.runner.forward(); } };
  await run();
  assert.ok(n >= 8 && n <= LEARN_BLOCKED, `${n} items in the first ten`);
  assert.equal(drill.runner.length, LEARN_BLOCKED);
  cur = drill.more();
  assert.ok(cur, 'ten more start at once');
  assert.equal(drill.runner.length, 2 * LEARN_BLOCKED);
  await run();
  cur = drill.more();
  await run();
  assert.equal(drill.runner.length, 3 * LEARN_BLOCKED);
  assert.ok(n >= 24, `${n} items over three tens`);
  // The skill has 16 written sentences (and chart slots draw on stock words), so the bank is reached in the third ten;
  // keep asking for more until a dozen generated items have come up, and none may repeat while the bank of 40 lasts.
  let tens = 3;
  while (genSeen.length < 12 && tens < 8) { cur = drill.more(); await run(); tens += 1; }
  assert.ok(genSeen.length >= 12, `${genSeen.length} generated items once the written set was spent`);
  assert.equal(new Set(genSeen).size, genSeen.length, 'no generated sentence twice while the bank of 40 lasts');
  assert.equal(drill.round, 0);
  assert.equal(gstore.getAttempts({ skill: DIO }).length, n, 'every item logged under the skill');
  assert.equal(gstore.getState(DIO).state, 'practising');
});

/* ============================================ 4 · a mixed set */

test('mixedMembers: the skill, then its confusables and prerequisites, each once, drillable, under the chapter cap, at most four', () => {
  const skill = SKILLS.get(DIO);
  const all = mixedMembers(skill, SKILLS);
  assert.equal(all[0], skill);
  assert.ok(all.length >= 2 && all.length <= 5);
  const ids = all.slice(1).map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'each once');
  const declared = [...skill.confusable_with, ...skill.prereqs];
  for (const id of ids) assert.ok(declared.includes(id), `${id} is declared`);
  assert.equal(ids[0], skill.confusable_with[0], 'the confusables lead');
  // The learner's chapter caps the related skills: at chapter 3 only accusative-object (ch. 3) and nominative-subject (ch. 1) remain.
  const capped = mixedMembers(skill, SKILLS, { chapter: 3 });
  assert.ok(capped.slice(1).every((s) => s.chapter <= 3), capped.map((s) => `${s.id}:${s.chapter}`).join(' '));
  assert.ok(capped.some((s) => s.id === ACO));
  assert.equal(capped[0], skill, 'the skill itself is never capped away');
  // Not drillable: left out. A cap of zero: the skill alone.
  assert.deepEqual(mixedMembers(skill, SKILLS, { drillable: (id) => id === skill.id }).map((s) => s.id), [DIO]);
  assert.deepEqual(mixedMembers(skill, SKILLS, { chapter: 0 }).map((s) => s.id), [DIO]);
  assert.equal(mixedMembers(skill, SKILLS, { max: 1 }).length, 2);
  assert.equal(mixedMembers({ id: 'x', kinds: [] }, SKILLS).length, 1, 'no declarations: the skill alone');
});

test('a mixed set interleaves the skill with its related skills, each from its own pool, logged under its own skill', async () => {
  const gstore = store();
  await gstore.ready();
  const dio = SKILLS.get(DIO);
  const aco = SKILLS.get(ACO);
  const members = [
    { skill: dio, teachItems: teachFor(DIO), generated: bankFor(DIO, RAW_BANK, 8, lcg(1)), pin: 'The receiver takes the dative.' },
    { skill: aco, teachItems: teachFor(ACO), generated: bankFor(ACO, RAW_BANK_ACO, 8, lcg(2)), pin: null },
  ];
  const mixed = createMixed({ members, gstore, items: gen(), currentWeekN: 107, size: 10, rand: lcg(8) });
  assert.deepEqual(mixed.members.map((s) => s.id), [DIO, ACO]);
  assert.equal(mixed.open, true);
  await mixed.begin();
  assert.equal(gstore.getState(DIO).state, 'practising');
  assert.equal(gstore.getState(ACO).state, 'practising');
  let cur = mixed.start();
  const order = [];
  const pools = { [DIO]: [], [ACO]: [] };
  while (cur) {
    order.push(cur.item.skill);
    pools[cur.item.skill].push(cur.item.pool);
    assert.ok(cur.item.pin, `${cur.item.skill} has its rule pinned`);
    await mixed.runner.answer(answerRight(cur.item));
    cur = mixed.runner.forward();
  }
  assert.equal(order.length, 10);
  assert.deepEqual(order.filter((_, i) => i % 2 === 0), Array(5).fill(DIO), 'the skill on every other item');
  assert.deepEqual(order.filter((_, i) => i % 2 === 1), Array(5).fill(ACO), 'the related skill between');
  assert.ok(pools[DIO].every((p) => p === 'written'), 'five items do not exhaust the written set');
  assert.ok(pools[ACO].every((p) => p === 'written'));
  assert.equal(gstore.getAttempts({ skill: DIO }).length, 5);
  assert.equal(gstore.getAttempts({ skill: ACO }).length, 5);
  // Ten more keep the rhythm; with three related skills they take turns.
  cur = mixed.more();
  assert.ok(cur && mixed.runner.length === 20);
  const three = createMixed({ members: [members[0], members[1], { skill: SKILLS.get('nominative-subject'), teachItems: teachFor('nominative-subject'), generated: null, pin: null }], gstore: store(), items: gen(), size: 8, rand: lcg(8) });
  assert.deepEqual(three.runner.queue.map((s) => s.skill), [DIO, ACO, DIO, 'nominative-subject', DIO, ACO, DIO, 'nominative-subject']);
  assert.throws(() => createMixed({ members: [], gstore, items: gen() }));
});

/* ============================================ 5 · the attempt's meta */

test('a generated item\'s attempt carries meta { generated, template, sentence }; a written one none; neither enters the redo list', async () => {
  const gstore = store();
  await gstore.ready();
  const skill = SKILLS.get(DIO);
  // Only three written sentences, so the bank is reached inside the ten.
  const few = createTeachItems({ skill, sentences: sentencesOf(DIO).sentences.slice(0, 3), lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HEADWORDS, storage: mem(), rand: () => 0.3 });
  const drill = createDrill({ skill, gstore, items: gen(), teachItems: few, generated: bankFor(DIO, RAW_BANK, 12, lcg(6)), currentWeekN: 107, rand: lcg(12) });
  await drill.begin();
  let cur = drill.start();
  let i = 0;
  let wrongGenerated = null;
  while (cur) {
    const { item } = cur;
    // The first generated item is answered wrong, every other item right.
    const wrong = item.pool === 'generated' && !wrongGenerated;
    const res = await drill.runner.answer(wrong ? answerWrong(item) : answerRight(item));
    if (wrong) { wrongGenerated = { item, attempt: res.attempt }; assert.equal(res.correct, false); }
    if (item.pool === 'generated') {
      assert.deepEqual(res.attempt.meta, { generated: true, template: item.template, sentence: item.taught }, 'meta on a generated attempt');
      assert.ok(/^dio-t\d+$/.test(res.attempt.meta.template));
    } else {
      assert.equal(res.attempt.meta, undefined, 'no meta on a written attempt');
    }
    assert.equal(res.attempt.item_key, null);
    i += 1;
    cur = drill.runner.forward();
  }
  assert.ok(wrongGenerated, 'a generated item came up inside the ten');
  const rows = gstore.getAttempts({ skill: DIO });
  assert.equal(rows.length, i);
  const withMeta = rows.filter((a) => a.meta);
  assert.ok(withMeta.length >= 1 && withMeta.every((a) => a.meta.generated === true && a.meta.template && a.meta.sentence));
  assert.ok(rows.some((a) => !a.meta), 'the written attempts carry none');
  // The store keeps meta on the device and drops it from the server row.
  const kept = normaliseAttempt({ ...wrongGenerated.attempt });
  assert.deepEqual(kept.meta, wrongGenerated.attempt.meta);
  assert.equal('meta' in serverAttemptRow(kept), false);
  assert.equal(normaliseAttempt({ ...wrongGenerated.attempt, meta: {} }).meta, undefined, 'an empty meta is no meta');
  // Wrong or right, an item with no key is not offered back: the same rule as a teaching step's item.
  assert.deepEqual(sessionMisses(drill.runner.log), []);
  assert.equal(drill.runner.summary().missed.length, 0);
  assert.equal(drill.runner.summary().right, i - 1);
});
