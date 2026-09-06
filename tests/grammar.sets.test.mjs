// node --test tests/ — the chapter sets (GRAMMAR-CONTRACT.md "Wave 2"): the
// loaders and their normalisation, the pseudo-skills, the question / vocab /
// pensum generators over the fixtures in tests/fixtures/grammar/, question
// answer matching (macron-stripped, full-sentence, case-insensitive) and the
// judge for every new input (order, match, inline, bank, self).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSetLoader, manifestChapters, normaliseQuestionSet, normaliseVocab, groupPensa, setSkills, setsOfChapter, setChapters,
  matchQuestion, phraseIndexes, answerIndexes, pensumSegments, createSetItems, fromRoman, chapterOfWeek,
} from '../app/js/grammar/sets.js';
import { createPool } from '../app/js/grammar/items.js';
import { judge } from '../app/js/grammar/session.js';
import { orderMatches, scramble, chunksOf } from '../app/js/grammar/stage3.js';

const fx = new URL('./fixtures/grammar/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, fx), 'utf8'));
const fetchJson = async (name) => { try { return read(name); } catch { throw new Error(`${name}: 404`); } };
// The fixture store's shelf sentences (store-fixture.js r07 / r01) and one course sentence, as the section sees them.
const units = [
  { id: 'r07:1.1', la: 'Iūlia in hortō est.', en: '', week_n: 107 }, { id: 'r07:2.1', la: 'Puella rosās videt et rīdet.', en: '', week_n: 107 },
  { id: 'r07:3.1', la: 'Iūlius fīliae suae rosam dat.', en: '', week_n: 107 }, { id: 'r07:4.1', la: 'Iūlia patrī grātiās agit.', en: '', week_n: 107 },
  { id: 'r07:5.1', la: 'Mārcus sorōrī nihil dat.', en: '', week_n: 107 }, { id: 'r07:6.1', la: 'Aemilia puerīs māla dat.', en: '', week_n: 107 },
  { id: 'r07:7.1', la: 'Quīntus mātrī mālum ostendit.', en: '', week_n: 107 }, { id: 'r07:8.1', la: 'Cui Iūlius ōsculum dat? Iūliae.', en: '', week_n: 107 },
  { id: 'r07:9.1', la: 'Syra puellae speculum tenet.', en: '', week_n: 107 }, { id: 'r07:11.1', la: 'Ecce rosa in nāsō puellae!', en: '', week_n: 107 },
  { id: 'r07:12.1', la: 'Iūlia laeta ē hortō exit.', en: '', week_n: 107 },
  { id: 'r01:1.1', la: 'Rōma in Italiā est.', en: '', week_n: 101 }, { id: 'r01:7.1', la: 'Tiberis fluvius parvus est.', en: '', week_n: 101 }, { id: 'r01:12.1', la: 'Quid est Brundisium? Oppidum est.', en: '', week_n: 101 },
];
const weeks = [{ n: 1, id: 'w01', chapter: 'XXV' }, { n: 3, id: 'w03', chapter: 'XXVII (FS 1, 5); FL 63–65' }, { n: 101, id: 'r01' }, { n: 107, id: 'r07' }];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
async function loadSets() {
  const loaded = await createSetLoader({ fetchJson }).loadAll();
  const pensa = groupPensa(read('pensa/01.json').rows.concat(read('pensa/07.json').rows));
  return setSkills({ ...loaded, pensa, weeks });
}
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('fromRoman / chapterOfWeek: a course week reads its chapter field, the shelf its n − 100', () => {
  assert.equal(fromRoman('XXVII (FS 1, 5); FL 63–65'), 27);
  assert.equal(fromRoman('XXXIV'), 34);
  assert.equal(fromRoman(7), 7);
  assert.equal(fromRoman(''), null);
  assert.equal(chapterOfWeek(weeks[1]), 27);
  assert.equal(chapterOfWeek(weeks[3]), 7);
});

test('manifests and normalisation: chapters listed once, items usable, macron-stripped answers added, bad rows dropped', () => {
  assert.deepEqual(manifestChapters({ version: 1, chapters: [7, '25', 7, 'x'] }), [7, 25]);
  assert.deepEqual(manifestChapters(['13.json']), [13]);
  assert.equal(manifestChapters({}), null);
  const q = normaliseQuestionSet(read('questions/07.json'));
  assert.equal(q.chapter, 7); assert.equal(q.week_id, 'r07'); assert.equal(q.items.length, 12);
  assert.ok(q.items[0].answers.includes('in horto'), 'macron-stripped variant added');
  assert.equal(normaliseQuestionSet({ chapter: 1, items: [{ q: 'x', answers: ['a'], input: 'choice', choices: ['a'] }, { q: 'no answers', answers: [] }] }).items[0].input, 'type', 'a choice item with one choice is typed');
  const v = normaliseVocab({ chapter: 2, words: [{ lemma: 'līber', pos: 'ADJ', meaning: 'free' }, { lemma: 'līber', pos: 'N', meaning: 'book' }, { lemma: 'bonus', pos: 'ADJ', meaning: 'good' }, { lemma: 'bonus', pos: 'ADJ', meaning: 'good (comp.)' }, { lemma: 'x' }] });
  assert.deepEqual(v.words.map((w) => `${w.lemma}|${w.pos}`), ['līber|ADJ', 'līber|N', 'bonus|ADJ'], 'lemma + pos dedupes; a word without a meaning is dropped');
  const p = groupPensa([{ chapter: 1, kind: 'A', items: [{ text: 'a_', blanks: [{ answers: ['x'] }] }, { text: 'b_', blanks: [{ answers: ['y'] }], unverified: true }] }, { chapter: 1, kind: 'c', items: [{ q: 'Q?', answers: ['a'] }] }, { chapter: 'x', kind: 'A', items: [] }]);
  assert.equal(p.get(1).A.length, 1, 'unverified items hidden'); assert.equal(p.get(1).C.length, 1); assert.equal(p.size, 1);
});

test('setSkills: questions-NN, vocab-NN, vocab-NN-rev, pensum-NN with counts, chapters, the week they belong to; setsOfChapter in Questions · Vocabulary · Pensa order', async () => {
  const sets = await loadSets();
  assert.deepEqual([...sets.keys()].sort(), ['pensum-01', 'pensum-07', 'questions-07', 'questions-25', 'vocab-01', 'vocab-01-rev', 'vocab-07', 'vocab-07-rev']);
  assert.equal(sets.get('questions-25').week_n, 1); assert.equal(sets.get('questions-07').week_n, 107); assert.equal(sets.get('vocab-01').week_n, 101);
  assert.equal(sets.get('pensum-01').count, 9, '3 A (one unverified hidden) + 3 B + 3 C');
  assert.equal(sets.get('vocab-07').count, 20); assert.equal(sets.get('vocab-07-rev').rev, true);
  assert.deepEqual(setsOfChapter(sets, 7).map((s) => s.id), ['questions-07', 'vocab-07', 'vocab-07-rev', 'pensum-07']);
  assert.deepEqual(setChapters(sets), [1, 7, 25]);
  for (const s of sets.values()) { assert.equal(s.kinds.length, 1); assert.equal(s.parse_filter, null); assert.ok(s.title.includes('Cap.')); }
});

test('matchQuestion: macron-stripped, case-insensitive, punctuation ignored; the answering sentence and a passage sentence containing the answer are accepted; a stray sentence is not', () => {
  const answers = ['in hortō', 'Iūlia in hortō est.'];
  const sentence = 'Iūlia in hortō est.';
  assert.equal(matchQuestion('in horto', answers, sentence), true);
  assert.equal(matchQuestion('IN HORTŌ', answers, sentence), true);
  assert.equal(matchQuestion('Iulia in horto est', answers, sentence), true);
  assert.equal(matchQuestion('in hortō est', answers, sentence), true, 'a fragment of the sentence containing the answer');
  assert.equal(matchQuestion('in villa', answers, sentence), false);
  assert.equal(matchQuestion('Iulia in villa est', answers, sentence), false, 'a word not in the sentence');
  assert.equal(matchQuestion('hortō', answers, sentence), false, 'one word that is not an accepted answer');
  assert.equal(matchQuestion('', answers, sentence), false);
  assert.equal(matchQuestion('Non', ['Nōn', 'Minimē'], ''), true);
});

test('phraseIndexes / answerIndexes / pensumSegments', () => {
  assert.deepEqual(phraseIndexes('Iūlius fīliae suae rosam dat.', 'fīliae suae'), [1, 2]);
  assert.deepEqual(phraseIndexes('Iūlius fīliae suae rosam dat.', 'filiae'), [1]);
  assert.deepEqual(phraseIndexes('Iūlius fīliae suae rosam dat.', 'servō'), []);
  assert.deepEqual(answerIndexes('Cui Iūlius ōsculum dat? Iūliae.', ['Iūliae', 'Iūlius Iūliae ōsculum dat.']), [4], 'only the answer that is in the sentence as a phrase');
  // A tap is one word: only a one-word answer's index is an accepted tap, or a tap on "in" would answer "in vīllā" (m5).
  assert.deepEqual(answerIndexes('Iūlius fīliae suae rosam dat.', ['fīliae suae', 'fīliae']), [1]);
  assert.deepEqual(answerIndexes('Iūlius fīliae suae rosam dat.', ['fīliae suae']), [], 'a phrase-only answer leaves nothing to tap: the item falls back to typing');
  assert.deepEqual(answerIndexes('Iūlius fīliae suae rosam dat.', ['fīliae suae'], { whole: false }), [1, 2], 'the feedback still lights the whole phrase');
  assert.deepEqual(pensumSegments('Iūlius fīli_ su_ rosam dat.'), [{ text: 'Iūlius fīli' }, { blank: 0 }, { text: ' su' }, { blank: 1 }, { text: ' rosam dat.' }]);
  assert.deepEqual(pensumSegments('Rōma in ___ est.'), [{ text: 'Rōma in ' }, { blank: 0 }, { text: ' est.' }]);
});

test('question items: the item\'s input, tap accepts the answer\'s words in the sentence (typed when absent), choices from the item, the answering sentence in the feedback; keys never repeat until the set is spent', async () => {
  const sets = await loadSets();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: seq([0.1, 0.6, 0.3, 0.9, 0.5]) });
  const seen = new Set();
  const kinds = new Set();
  for (let i = 0; i < 12; i++) {
    const it = gen.generate({ skill: 'questions-07', kind: 'question', stage: 1 });
    assert.ok(it && it.kind === 'question' && it.skill === 'questions-07');
    assert.ok(!seen.has(it.key), `repeat ${it.key}`); seen.add(it.key);
    assert.equal(it.repeat, false);
    kinds.add(it.input);
    assert.equal(typeof it.prompt.question, 'string');
    assert.ok(it.feedback.sentence, 'the answering sentence');
    if (it.input === 'tap') { assert.ok(it.prompt.la && it.accept.length && it.meanings.length); assert.ok(it.accept.every((i) => it.meanings[i])); }
    if (it.input === 'choice') { assert.ok(it.choices.length >= 2 && it.choices.some((c) => c.correct)); }
    if (it.input === 'type') assert.equal(it.prompt.la, null, 'the sentence is not shown before a typed answer');
  }
  assert.deepEqual([...kinds].sort(), ['choice', 'tap', 'type']);
  assert.equal(gen.generate({ skill: 'questions-07', kind: 'question' }).repeat, true, 'the pool wraps honestly');
  // A tap item whose answer is not in the sentence (a case the set author got wrong) falls back to typing.
  const odd = setSkills({ questions: new Map([[9, { chapter: 9, items: [{ id: 'q9-1', q: 'Quis?', answers: ['Nēmō'], input: 'tap', unit_id: 'r07:1.1', choices: [], hint: '', en: '' }] }]]) });
  const it = createSetItems({ sets: odd, units, pool: createPool(mem()) }).generate({ skill: 'questions-09', kind: 'question' });
  assert.equal(it.input, 'type');
  // Judging: typed answers by matchQuestion, choices, taps.
  const typed = { ...it, answer: ['in hortō', 'Iūlia in hortō est.'], feedback: { sentence: 'Iūlia in hortō est.' } };
  assert.equal(judge(typed, 'in horto').correct, true);
  assert.equal(judge(typed, 'Iulia in horto est').correct, true);
  assert.equal(judge(typed, 'in villa').correct, false);
});

test('vocab items: Latin → English is a choice with same-pos distractors from the chapter, every other one a 4-pair match; the reverse deck is typed from stage 2 (choice at 1); the dictionary line rides in the feedback', async () => {
  const sets = await loadSets();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: seq([0.2, 0.7, 0.4, 0.9, 0.1, 0.6]) });
  const choice = gen.generate({ skill: 'vocab-07', kind: 'vocab', stage: 1, match: false });
  assert.equal(choice.input, 'choice');
  assert.equal(choice.choices.length, 4);
  assert.equal(choice.choices.filter((c) => c.correct).length, 1);
  assert.equal(choice.prompt.gloss, null, 'the meaning is withheld');
  assert.ok(choice.feedback.dict && choice.feedback.short.includes(choice.word.meaning));
  const samePos = sets.get('vocab-07').data.words.filter((w) => w.pos === choice.word.pos).length;
  if (samePos >= 4) for (const c of choice.choices) if (!c.correct) assert.ok(sets.get('vocab-07').data.words.some((w) => w.meaning === c.value && w.pos === choice.word.pos), 'distractor of the same part of speech');
  const match = gen.generate({ skill: 'vocab-07', kind: 'vocab', stage: 1, match: true });
  assert.equal(match.input, 'match');
  assert.equal(match.pairs.length, 4); assert.equal(match.right.length, 4);
  // The contract fixes the key as `vocab:NN:<lemma>:<pos>[:rev]`; the way the word was shown rides in `variant`, so a
  // word's history is one row whether it came up as a choice or inside a match (M5 / m5).
  assert.ok(match.key.startsWith('vocab:07:'), match.key);
  assert.equal(match.variant, 'match');
  const rev1 = gen.generate({ skill: 'vocab-07-rev', kind: 'vocab', stage: 1 });
  assert.equal(rev1.input, 'choice'); assert.ok(rev1.choices.every((c) => /^[A-Za-zāēīōū]/.test(c.label)));
  const rev2 = gen.generate({ skill: 'vocab-07-rev', kind: 'vocab', stage: 2 });
  assert.equal(rev2.input, 'type');
  assert.equal(judge(rev2, rev2.word.lemma.replace(/ō/g, 'o').replace(/ī/g, 'i').replace(/ē/g, 'e').replace(/ā/g, 'a').replace(/ū/g, 'u')).correct, true, 'macrons optional');
  assert.ok(rev2.key.endsWith(':rev'));
  // Match judging: every left paired with the right whose `pair` is its index.
  const right = match.right;
  const good = {}; match.pairs.forEach((_, i) => { good[i] = right.findIndex((r) => r.pair === i); });
  assert.equal(judge(match, good).correct, true);
  const bad = { ...good, 0: good[1], 1: good[0] };
  const r = judge(match, bad);
  assert.equal(r.correct, false); assert.equal(r.cells.filter((c) => !c.ok).length, 2);
});

test('pensum items: A endings inline (stem given, ending or whole word accepted), B word blanks with a bank holding every answer, C a question typed or tapped; unverified items never appear', async () => {
  const sets = await loadSets();
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: seq([0.05, 0.5, 0.95, 0.3]) });
  const seen = { A: 0, B: 0, C: 0 };
  const keys = new Set();
  for (let i = 0; i < 9; i++) {
    const it = gen.generate({ skill: 'pensum-01', kind: 'pensum', stage: 1 });
    assert.ok(it && !keys.has(it.key)); keys.add(it.key);
    seen[it.pensum] += 1;
    assert.ok(!/Mult_/.test(it.segments?.map((s) => s.text ?? '_').join('') ?? ''), 'the unverified item is hidden');
    if (it.pensum === 'A') {
      assert.equal(it.input, 'inline');
      assert.ok(it.blanks.every((b) => b.stem && b.answers.length));
      const v = {}; it.blanks.forEach((b, i) => { v[i] = b.answers[0]; });
      assert.equal(judge(it, v).correct, true);
      const whole = {}; it.blanks.forEach((b, i) => { whole[i] = b.stem + b.answers[0]; });
      assert.equal(judge(it, whole).correct, true, 'stem + ending accepted');
      const wrong = { ...v, 0: 'xx' };
      assert.equal(judge(it, wrong).correct, false);
    } else if (it.pensum === 'B') {
      assert.equal(it.input, 'bank');
      for (const b of it.blanks) assert.ok(it.bank.includes(b.answers[0]), 'the bank holds the answer');
      const v = {}; it.blanks.forEach((b, i) => { v[i] = b.answers[0]; });
      assert.equal(judge(it, v).correct, true);
    } else {
      assert.ok(it.input === 'type' || it.input === 'tap');
      assert.ok(it.feedback.sentence);
      if (it.input === 'type') assert.equal(judge(it, it.answer[0]).correct, true);
    }
  }
  assert.deepEqual(seen, { A: 3, B: 3, C: 3 });
  assert.equal(gen.generate({ skill: 'pensum-01', kind: 'pensum' }).repeat, true);
  assert.equal(gen.drillable('pensum-01'), true);
  assert.equal(gen.drillable('pensum-99'), false);
});

test('order input judging (stage3.js): the book\'s order, chunks of the same text interchangeable; scramble never returns the original', () => {
  const chunks = chunksOf('Iūlius fīliae suae rosam dat.');
  assert.deepEqual(chunks, ['Iūlius', 'fīliae', 'suae', 'rosam', 'dat.']);
  assert.equal(orderMatches(chunks, [0, 1, 2, 3, 4]), true);
  assert.equal(orderMatches(chunks, [1, 0, 2, 3, 4]), false);
  assert.equal(orderMatches(chunks, [0, 1, 2, 3]), false);
  assert.equal(orderMatches(['et', 'a', 'et'], [2, 1, 0]), true, 'two "et" chunks swap freely');
  for (let seed = 0; seed < 50; seed++) { let a = seed * 7919; const rand = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; const s = scramble(chunks, rand); assert.ok(s && !orderMatches(chunks, s)); }
  assert.equal(scramble(['a', 'a'], Math.random), null);
  const item = { input: 'order', chunks };
  assert.equal(judge(item, [0, 1, 2, 3, 4]).correct, true);
  assert.equal(judge(item, ['0', '1', '2', '3', '4']).correct, true);
  assert.equal(judge(item, [4, 3, 2, 1, 0]).correct, false);
  assert.equal(judge(item, [4, 3, 2, 1, 0]).given, 'dat. rosam suae fīliae Iūlius');
});

test('self-graded (translate) judging: right / partly count as correct (partly partial), wrong not; every result carries self: true', () => {
  const item = { input: 'self', answer: ['Julius gives his daughter a rose.'] };
  assert.deepEqual(judge(item, 'right'), { correct: true, partial: false, self: true, expected: 'Julius gives his daughter a rose.', given: 'right' });
  assert.equal(judge(item, 'partly').partial, true);
  assert.equal(judge(item, 'wrong').correct, false);
});
