// node --test tests/ — the wave-2 fix pass (qa/grammar/CODE-REVIEW-G2.md,
// qa/grammar/QA-REPORT-G2.md, 2026-09-06). One test per rule that was wrong:
// the Pensum A stem (C1), macron-sensitive pensum blanks (M3), the Pensum B
// multiset bank (CR M3), vocabulary keys and distractors (M8 / M9), the loader
// that no longer memoises a failure (M10) and can fetch one chapter (CR M6),
// and the blanks/holes guard (m6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSetLoader, groupPensa, setSkills, pensumSegments, pensumFilled, createSetItems } from '../app/js/grammar/sets.js';
import { createPool, matchesForm, matchesFormExact } from '../app/js/grammar/items.js';
import { judge } from '../app/js/grammar/session.js';

const fx = new URL('./fixtures/grammar/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, fx), 'utf8'));
const fetchJson = async (name) => { try { return read(name); } catch { throw new Error(`${name}: 404`); } };
const units = [
  { id: 'r01:1.1', la: 'Rōma in Italiā est.', en: '', week_n: 101 },
  { id: 'r01:7.1', la: 'Tiberis fluvius parvus est.', en: '', week_n: 101 },
  { id: 'r01:12.1', la: 'Quid est Brundisium? Oppidum est.', en: '', week_n: 101 },
];
const weeks = [{ n: 101, id: 'r01' }, { n: 107, id: 'r07' }];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const pensa01 = () => setSkills({ pensa: groupPensa(read('pensa/01.json').rows), weeks });

test('C1 — Pensum A prints the stem once: the sentence owns it, blanks[].stem is metadata, and the model answer is a real Latin word', () => {
  const sets = pensa01();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: () => 0 });
  const it = gen.generate({ skill: 'pensum-01', kind: 'pensum', stage: 1 });
  assert.equal(it.pensum, 'A');
  // What the learner sees: the prose segments with an input at each hole. The stem is already at the end of the
  // segment before the hole, so nothing may be printed beside the input.
  const rendered = it.segments.map((s) => (s.blank == null ? s.text : '[__]')).join('');
  assert.equal(rendered, 'Rōma in Itali[__] est.');
  assert.equal(it.segments.filter((s) => s.blank != null).length, it.blanks.length);
  assert.equal(it.blanks[0].stem, 'Itali', 'still carried — the aria-label uses it, and "Italiā" typed whole is accepted');
  // The "Filled in" block, which the learner reads as the book's own sentence.
  assert.equal(it.feedback.short, 'Rōma in Italiā est.');
  assert.equal(it.feedback.sentence, 'Rōma in Italiā est.');
  // Two blanks in one sentence go the same way.
  assert.equal(
    pensumFilled(pensumSegments('Nīlus fluvi_ magn_ est.'), [{ stem: 'fluvi', answers: ['us'] }, { stem: 'magn', answers: ['us'] }]),
    'Nīlus fluvius magnus est.');
});

test('M3 — a pensum blank is macron-sensitive (Italia is not Italiā) and a macron-only miss is known for what it is; every other drill stays macron-optional', () => {
  const sets = pensa01();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: () => 0 });
  const a = gen.generate({ skill: 'pensum-01', kind: 'pensum', stage: 1 });   // Rōma in Itali_ est. → ā (abl. after in)
  assert.equal(a.exact, true);
  assert.equal(judge(a, { 0: 'ā' }).correct, true);
  assert.equal(judge(a, { 0: 'Italiā' }).correct, true, 'the whole word is accepted');
  const miss = judge(a, { 0: 'a' });
  assert.equal(miss.correct, false, 'the nominative ending is not the ablative — the contrast is the drill');
  assert.equal(miss.cells[0].macron, true);
  assert.equal(miss.macron, true);
  assert.equal(miss.cells[0].note, 'abl. after in', 'the note the feedback names the case with');
  // Ordinary drills keep "macrons optional" (GRAMMAR-PLAN §9a).
  assert.equal(matchesForm('Italia', ['Italiā']), true);
  assert.equal(matchesFormExact('Italia', ['Italiā']), false);
  assert.equal(matchesFormExact('ITALIĀ', ['Italiā']), true, 'case and punctuation still ignored');
});

test('M3 — Pensum B judges the tapped word by its macron: the bank offers Italia beside Italiā because that is the exercise', () => {
  const sets = pensa01();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: () => 0.99 });
  let b = null;
  for (let i = 0; i < 9 && !b; i++) { const it = gen.generate({ skill: 'pensum-01', kind: 'pensum', stage: 1 }); if (it?.pensum === 'B' && it.bank.includes('Italia')) b = it; }
  assert.ok(b, 'the chapter I Pensum B item');
  assert.equal(b.exact, true);
  assert.ok(b.bank.includes('Italiā') && b.bank.includes('Italia'));
  assert.equal(judge(b, { 0: 'Italiā' }).correct, true);
  const wrong = judge(b, { 0: 'Italia' });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.cells[0].macron, true);
  assert.equal(wrong.cells[0].expected, 'Italiā');
});

test('CR M3 — a Pensum B bank that needs the same word twice offers two tiles, so Check is reachable', () => {
  const rows = [{ chapter: 9, kind: 'B', items: [{ text: 'Hīc ___ est et illīc ___ est.', blanks: [{ i: 0, answers: ['puer'], bank: ['puer', 'puella'] }, { i: 1, answers: ['puer'], bank: ['puer'] }] }] }];
  const gen = createSetItems({ sets: setSkills({ pensa: groupPensa(rows), weeks }), units, pool: createPool(mem()), rand: () => 0 });
  const it = gen.generate({ skill: 'pensum-09', kind: 'pensum', stage: 1 });
  assert.equal(it.input, 'bank');
  assert.equal(it.bank.filter((w) => w === 'puer').length, 2, 'one tile per required occurrence');
  assert.equal(it.bank.filter((w) => w === 'puella').length, 1, 'the distractor once');
  assert.equal(judge(it, { 0: 'puer', 1: 'puer' }).correct, true);
});

test('M8 / M9 — a vocabulary key carries the part of speech, so a homograph is reachable; a distractor never crosses part of speech', () => {
  const deck = { chapter: 2, words: [
    { lemma: 'līber', dict: 'līber, -era, -erum', pos: 'ADJ', meaning: 'free' },
    { lemma: 'liber', dict: 'liber, -brī m.', pos: 'N', meaning: 'book' },
    { lemma: 'fluvius', dict: 'fluvius, -ī m.', pos: 'N', meaning: 'river' },
    { lemma: 'oppidum', dict: 'oppidum, -ī n.', pos: 'N', meaning: 'town' },
    { lemma: 'īnsula', dict: 'īnsula, -ae f.', pos: 'N', meaning: 'island' },
    { lemma: 'multus', dict: 'multus, -a, -um', pos: 'ADJ', meaning: 'many' },
    { lemma: 'parvus', dict: 'parvus, -a, -um', pos: 'ADJ', meaning: 'small' },
    { lemma: 'magnus', dict: 'magnus, -a, -um', pos: 'ADJ', meaning: 'big' },
  ] };
  const sets = setSkills({ vocab: new Map([[2, deck]]), weeks });
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: seq([0.9, 0.1, 0.7, 0.3, 0.55, 0.2]) });
  const posOf = new Map(deck.words.map((w) => [w.meaning, w.pos]));
  const keys = new Set();
  for (let i = 0; i < deck.words.length; i++) {
    const it = gen.generate({ skill: 'vocab-02', kind: 'vocab', stage: 1, match: false });
    keys.add(it.key);
    assert.match(it.key, /^vocab:02:[^:]+:(N|ADJ)$/, it.key);
    for (const c of it.choices) assert.equal(posOf.get(c.value), it.word.pos, `${c.value} against a ${it.word.pos}`);
  }
  assert.equal(keys.size, deck.words.length, 'eight distinct keys for eight words: both homographs reachable');
  assert.ok(keys.has('vocab:02:līber:ADJ') && keys.has('vocab:02:liber:N'));
});

test('M9 — when a chapter has fewer than four of a part of speech, the distractors come from the same part of speech in nearby chapters, never from another', () => {
  const thin = { chapter: 1, words: [{ lemma: 'est', dict: 'esse', pos: 'V', meaning: 'is' }, { lemma: 'fluvius', dict: 'fluvius, -ī m.', pos: 'N', meaning: 'river' }, { lemma: 'īnsula', dict: 'īnsula, -ae f.', pos: 'N', meaning: 'island' }, { lemma: 'oppidum', dict: 'oppidum, -ī n.', pos: 'N', meaning: 'town' }] };
  const near = { chapter: 2, words: [{ lemma: 'habitat', dict: 'habitāre', pos: 'V', meaning: 'lives' }, { lemma: 'cantat', dict: 'cantāre', pos: 'V', meaning: 'sings' }, { lemma: 'videt', dict: 'vidēre', pos: 'V', meaning: 'sees' }] };
  const sets = setSkills({ vocab: new Map([[1, thin], [2, near]]), weeks });
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: () => 0 });
  let verb = null;
  for (let i = 0; i < 4 && !verb; i++) { const it = gen.generate({ skill: 'vocab-01', kind: 'vocab', stage: 1, match: false }); if (it.word.pos === 'V') verb = it; }
  assert.ok(verb, 'the chapter has one verb');
  assert.equal(verb.choices.length, 4);
  const allV = new Set([...thin.words, ...near.words].filter((w) => w.pos === 'V').map((w) => w.meaning));
  for (const c of verb.choices) assert.ok(allV.has(c.value), `${c.value} is not a verb`);
});

test('M10 — a failed chapter-set fetch is reported and retried, never memoised as empty for the life of the page', async () => {
  let fail = true;
  const calls = [];
  const flaky = async (name) => { calls.push(name); if (fail && name === 'questions/index.json') throw new Error('offline'); return fetchJson(name); };
  const loader = createSetLoader({ fetchJson: flaky });
  const first = await loader.loadAll();
  assert.equal(first.questions.size, 0);
  assert.ok(first.failed.includes('questions/index.json'), 'the failure is reported, not swallowed');
  assert.ok(first.vocab.size > 0, 'what did load is still there');
  fail = false;
  const second = await loader.loadAll();
  assert.ok(second.questions.size > 0, 'a later load retries the manifest');
  assert.equal(calls.filter((n) => n === 'vocab/index.json').length, 1, 'what succeeded is still fetched once');
});

test('CR M6 — the loader can fetch a single chapter, so the weeks-menu Today card costs two files rather than sixty-eight', async () => {
  const calls = [];
  const loader = createSetLoader({ fetchJson: async (name) => { calls.push(name); return fetchJson(name); } });
  const one = await loader.loadChapter(7);
  assert.deepEqual([...one.questions.keys()], [7]);
  assert.deepEqual([...one.vocab.keys()], [7]);
  assert.deepEqual(calls.filter((n) => /\d\d\.json$/.test(n)).sort(), ['questions/07.json', 'vocab/07.json']);
});

test('m6 — a pensum item whose blanks do not match the holes in its text is hidden rather than paired wrongly', () => {
  const p = groupPensa([{ chapter: 3, kind: 'A', items: [
    { text: 'Puer_ ambulat.', blanks: [{ i: 0, stem: 'Puer', answers: ['ī'] }] },
    { text: 'Puer_ puell_ videt.', blanks: [{ i: 0, stem: 'Puer', answers: ['ī'] }] },
  ] }]);
  assert.equal(p.get(3).A.length, 1);
  assert.equal(p.get(3).A[0].text, 'Puer_ ambulat.');
});

test('CR M8 — a set’s Learn pass is a capped batch, resumable: a deck of 119 words is not one sitting', async () => {
  const { createLearn, SET_LEARN_BATCH } = await import('../app/js/grammar/session.js');
  const { createGrammarStore } = await import('../app/js/grammar/store-grammar.js');
  const words = Array.from({ length: 40 }, (_, i) => ({ lemma: `verbum${i}`, dict: `verbum${i}, -ī n.`, pos: 'N', meaning: `meaning ${i}` }));
  const sets = setSkills({ vocab: new Map([[3, { chapter: 3, words }]]), weeks });
  const pool = createPool(mem());
  const items = createSetItems({ sets, units, pool, rand: () => 0.3 });
  const gen = { generate: (slot) => items.generate(slot), drillable: () => true, pool };
  const g = createGrammarStore({ mode: 'local', storage: mem() });
  await g.ready();
  const seenAt = [];
  const learn = createLearn({ skill: sets.get('vocab-03'), gstore: g, items: gen, rand: () => 0.3, onProgress: (p) => seenAt.push(p.seen) });
  await learn.begin();
  assert.equal(learn.total, 40);
  assert.equal(learn.deckSize, SET_LEARN_BATCH, 'the pass is capped, not the whole deck');
  const run = async (l) => { let cur = l.runner.current; while (cur) { await l.runner.answer('x'); cur = l.runner.next(); } };
  learn.startGuided();
  assert.equal(learn.runner.length, SET_LEARN_BATCH);
  await run(learn);
  assert.equal(learn.seen, SET_LEARN_BATCH);
  assert.equal(learn.left, 40 - SET_LEARN_BATCH);
  // Another batch: the pool keeps its place, so no word comes round twice inside the pass.
  const firstKeys = new Set(learn.runner.log.map((a) => a.item_key));
  learn.moreGuided();
  await run(learn);
  assert.equal(learn.seen, SET_LEARN_BATCH * 2);
  for (const a of learn.runner.log) assert.equal(firstKeys.has(a.item_key), false, `${a.item_key} came round twice`);
  // The last batch is the remainder, not a full fifteen.
  learn.moreGuided();
  assert.equal(learn.runner.length, 40 - SET_LEARN_BATCH * 2);
  await run(learn);
  assert.equal(learn.left, 0);
  // Stopping and coming back: a fresh runner resumes where the pass stopped instead of restarting the deck.
  const again = createLearn({ skill: sets.get('vocab-03'), gstore: g, items: gen, rand: () => 0.3, resume: { seen: 20 } });
  assert.equal(again.seen, 20);
  assert.equal(again.left, 20);
  assert.ok(seenAt.length > 0 && seenAt[seenAt.length - 1] === 40, 'progress is reported as it goes, for the caller to persist');
});

test('migration 0017 — a self-graded translate attempt reaches the server as a `self` column, not only inside the answer string', async () => {
  const { serverAttemptRow } = await import('../app/js/grammar/store-grammar.js');
  const row = serverAttemptRow({ skill: 'x', kind: 'translate', item_key: 'translate:w01:1.1', mode: 'practice', correct: true, hinted: true, self: true, answer: 'self: partly', expected: 'the English', at: '2026-09-06T10:00:00.000Z' });
  assert.equal(row.self, 'partly');
  assert.equal(row.answer, 'self: partly', 'the string stays, for a client that does not know the column');
  assert.equal(serverAttemptRow({ skill: 'x', kind: 'blank', correct: false, at: 'now' }).self, null, 'null on every other kind');
  assert.equal(serverAttemptRow({ skill: 'x', kind: 'translate', self: 'right', at: 'now' }).self, 'right', 'a row from the server passes through');
  assert.equal(serverAttemptRow({ skill: 'x', kind: 'translate', self: 'nonsense', at: 'now' }).self, null, 'anything outside the check constraint is dropped');
});
