// node --test tests/ — the chapter sets (GRAMMAR-CONTRACT.md "Wave 2"): the
// loaders and their normalisation, the pseudo-skills, the question / vocab /
// pensum generators over the fixtures in tests/fixtures/grammar/, question
// answer matching (macron-stripped, full-sentence, case-insensitive) and the
// judge for every new input (order, match, inline, bank, self).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSetLoader, manifestChapters, manifestWeeks, normaliseQuestionSet, normaliseVocab, groupPensa, setSkills, setsOfChapter, setChapters,
  pensumCInput, PENSUM_TYPE_MAX,
  matchQuestion, phraseIndexes, answerIndexes, pensumSegments, createSetItems, fromRoman, chapterOfWeek,
  resolveRef, resolveList, withStripped,
} from '../app/js/grammar/sets.js';
import { createPool } from '../app/js/grammar/items.js';
import { judge } from '../app/js/grammar/session.js';
import { orderMatches, scramble, chunksOf } from '../app/js/grammar/stage3.js';

const fx = new URL('./fixtures/grammar/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, fx), 'utf8'));
const fetchJson = async (name) => { try { return read(name); } catch { throw new Error(`${name}: 404`); } };
// The fixture's own invented sentences (tests/fixtures/grammar/units.json) — the sentences the fixture question
// set refers to, and the ones its span references index. `?fixture=1` merges the same file over the store's units.
const units = read('units.json').units;
const weeks = [{ n: 1, id: 'w01', chapter: 'XXV', title: 'Thēseus et Mīnōtaurus' }, { n: 3, id: 'w03', chapter: 'XXVII (FS 1, 5); FL 63–65', title: 'Mīnōs · Corōnis · Fabellae LXIII–LXV' }, { n: 101, id: 'r01' }, { n: 107, id: 'r07' }];
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

test('manifests and normalisation: chapters listed once, items usable, sentence references kept, bad rows dropped', () => {
  assert.deepEqual(manifestChapters({ version: 1, chapters: [7, '25', 7, 'x'] }), [7, 25]);
  assert.deepEqual(manifestChapters(['13.json']), [13]);
  assert.equal(manifestChapters({}), null);
  const q = normaliseQuestionSet(read('questions/07.json'));
  assert.equal(q.chapter, 7); assert.equal(q.week_id, 'r07'); assert.equal(q.items.length, 12);
  // The answers stay references: the book's words are not in the public file, so they cannot be expanded until
  // the sentence is in hand (the macron-stripped variants are added at resolve time — see the span test below).
  assert.deepEqual(q.items[0].answers, [{ span: [1, 2] }, { span: [0, 3] }]);
  assert.deepEqual(normaliseQuestionSet({ chapter: 1, items: [{ q: 'x?', answers: ['Ita', { span: [0, 1] }, { parts: ['quia', { span: [2, 3] }] }, { span: [2, 1] }, { span: 'x' }, 42, { parts: [] }] }] }).items[0].answers,
    ['Ita', { span: [0, 1] }, { parts: ['quia', { span: [2, 3] }] }], 'a malformed reference is dropped, a good one kept');
  assert.equal(normaliseQuestionSet({ chapter: 1, items: [{ q: 'x?', answers: [42] }] }).items.length, 0, 'an item left with no answer at all is dropped');
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

test('sentence references: a span is the words of the sentence, parts weave our wording around them; an index past the end resolves to nothing', () => {
  const la = 'Iūlius fīliae suae rosam dat.';
  assert.equal(resolveRef(la, { span: [1, 2] }), 'fīliae suae');
  assert.equal(resolveRef(la, { span: [0, 4] }), 'Iūlius fīliae suae rosam dat', 'the slice runs word to word');
  assert.equal(resolveRef(la, 'Minimē'), 'Minimē', 'our own wording passes through');
  assert.equal(resolveRef(la, { parts: ['Nōn:', { span: [1, 2] }] }), 'Nōn: fīliae suae');
  assert.equal(resolveRef('Hortus nōn est magnus, hortus parvus est.', { parts: [{ span: [1, 2] }, 'parvus'] }), 'nōn est parvus');
  assert.equal(resolveRef(la, { span: [3, 9] }), null, 'past the end of the sentence');
  assert.equal(resolveRef('', { span: [0, 1] }), null, 'no sentence at all');
  assert.equal(resolveRef(la, { parts: ['Ita', { span: [9, 9] }] }), null, 'one bad part spoils the whole');
  assert.deepEqual(resolveList(la, ['Ita', { span: [1, 2] }]), ['Ita', 'fīliae suae']);
  assert.equal(resolveList(la, ['Ita', { span: [1, 9] }]), null, 'a list is all or nothing');
  assert.deepEqual(withStripped(['fīliae suae', 'Ita']), ['fīliae suae', 'filiae suae', 'Ita'], 'macron-stripped variants added once, at resolve time');
});

test('a question whose sentence the device does not have is hidden, never guessed at: the set degrades to its resolvable items and to nothing at all when none resolve', () => {
  const items = [
    { id: 'q9-1', q: 'Ubi?', answers: [{ span: [1, 2] }], input: 'type', unit_id: 'r07:1.1', choices: [], hint: '', en: '' },
    { id: 'q9-2', q: 'Quid?', answers: [{ span: [1, 2] }], input: 'type', unit_id: 'r07:404.1', choices: [], hint: '', en: '' },
    { id: 'q9-3', q: 'Quis?', answers: [{ span: [0, 0] }, 'Nēmō'], input: 'choice', unit_id: 'r07:1.1', choices: [{ span: [0, 0] }, { span: [99, 99] }], hint: '', en: '' },
  ];
  const sets = setSkills({ questions: new Map([[9, normaliseQuestionSet({ chapter: 9, items })]]) });
  const gen = createSetItems({ sets, units, pool: createPool(mem()), rand: () => 0 });
  const seen = new Set();
  for (let i = 0; i < 4; i++) { const it = gen.generate({ skill: 'questions-09', kind: 'question' }); assert.ok(it, 'an item still comes'); seen.add(it.question.id); }
  assert.deepEqual([...seen], ['q9-1'], 'the item with a missing sentence and the one with a broken choice are both out');
  assert.equal(gen.drillable('questions-09'), true);
  // Every item unresolvable: no crash, no item, and the set reports itself undrillable rather than stalling a session.
  const none = setSkills({ questions: new Map([[8, normaliseQuestionSet({ chapter: 8, items: [{ ...items[1], id: 'q8-1' }] })]]) });
  const dead = createSetItems({ sets: none, units, pool: createPool(mem()), rand: () => 0 });
  assert.equal(dead.generate({ skill: 'questions-08', kind: 'question' }), null);
  assert.equal(dead.drillable('questions-08'), false);
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

/* ============================ a week with no chapter of its own (§28) ====== */

test('§28: a week that reads no chapter of its own carries its questions in a file named for the week', async () => {
  assert.deepEqual(manifestWeeks({ version: 1, weeks: ['w03', 'w03.json', 'nope', 'w3'] }), ['w03']);
  assert.deepEqual(manifestWeeks({ version: 1, chapters: [7] }), [], 'a manifest with no weeks lists none');
  const item = { id: 'qw03-01', qword: 'quis', q: 'Quis taurum cēpit?', en: 'Who caught the bull?', unit_id: 'w03:minos:b6.2', answers: ['Herculēs'], input: 'tap', hint: 'the subject' };
  const docs = {
    'questions/index.json': { version: 1, chapters: [7], weeks: ['w03'] },
    'questions/07.json': read('questions/07.json'),
    'questions/w03.json': { chapter: 27, week_id: 'w03', title: 'Mīnōs · Corōnis · Fabellae LXIII–LXV', items: [item] },
    'vocab/index.json': { version: 1, chapters: [] },
  };
  const loaded = await createSetLoader({ fetchJson: async (n) => { if (!(n in docs)) throw new Error(`${n}: 404`); return docs[n]; } }).loadAll();
  assert.deepEqual([...loaded.questions.keys()], [7], 'the week file was filed under a chapter number');
  assert.deepEqual([...loaded.weekQuestions.keys()], ['w03']);
  const built = setSkills({ ...loaded, weeks });
  const own = built.get('questions-w03');
  assert.ok(own, 'the week has no question set of its own');
  assert.equal(own.week_id, 'w03');
  assert.equal(own.week_n, 3);
  assert.equal(own.chapter, 27, 'the row still sits under the chapter the week belongs to');
  assert.equal(own.count, 1);
  // The row is named for the stories, never "Cap. XXVII": that chapter number is week 4's reading, and
  // two rows with one name is the very confusion this set exists to end.
  assert.match(own.title, /Mīnōs/);
  assert.ok(!own.title.includes('Cap.'), own.title);
  assert.ok(built.get('questions-07'), 'the chapter set and the week set are two rows, not one');
});

test('§28: every shipped week set asks about its own week, and covers all of that week\'s readings', () => {
  const dir = new URL('../app/data/grammar/questions/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  // Weeks 3, 5 and 10 read Fabulae Syrae and Fabellae Latinae beside a chapter their neighbour reads.
  assert.deepEqual(manifestWeeks(index), ['w03', 'w05', 'w10'], 'the manifest no longer lists a week set, so nothing fetches it');
  // Every reading of the week is asked about: the complaint was whole stories having nothing at all,
  // which a set drawn only from the first story of the week would repeat.
  const readings = {
    w03: ['coronis', 'fl-63', 'fl-64', 'fl-65', 'minos'],
    w05: ['coriolanus', 'fl-66', 'fl-67', 'fl-68', 'nausicaa'],
    w10: ['arachne', 'fl-69', 'fl-70', 'fl-71', 'fl-72', 'fl-73', 'fl-74'],
  };
  for (const [wid, stories] of Object.entries(readings)) {
    const set = JSON.parse(readFileSync(new URL(`${wid}.json`, dir), 'utf8'));
    assert.equal(set.week_id, wid);
    assert.ok(set.items.length >= 24, `${wid} needs 24 items, it has ${set.items.length}`);
    for (const it of set.items) assert.ok(it.unit_id.startsWith(`${wid}:`), `${it.id} asks about ${it.unit_id}`);
    assert.deepEqual([...new Set(set.items.map((it) => it.unit_id.split(':')[1]))].sort(), stories, `${wid} leaves a reading unasked`);
  }
  // And each neighbour's chapter file is left to its own week alone.
  for (const [file, wid] of [['27.json', 'w04'], ['28.json', 'w06'], ['32.json', 'w11']]) {
    const set = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    assert.equal(set.week_id, wid);
    for (const it of set.items) assert.ok(it.unit_id.startsWith(`${wid}:`), `${file} ${it.id} asks about ${it.unit_id}`);
    assert.ok(set.items.length >= 24, `${file} fell to ${set.items.length} items`);
  }
});


/* ===================== Pensum C: nothing long is typed (§29) ============== */

test('§29: a Pensum C answer is typed only while it is short; longer ones are ordered, longest are self-marked', () => {
  assert.equal(PENSUM_TYPE_MAX, 3);
  // One to three words: typed, or tapped when the sentence holds the answer as one word.
  assert.equal(pensumCInput(1, false, () => 0.9), 'type');
  assert.equal(pensumCInput(3, false, () => 0.1), 'type');
  assert.equal(pensumCInput(1, true, () => 0.1), 'tap');
  assert.equal(pensumCInput(1, true, () => 0.9), 'type');
  // Four to eight: the answer's own words, out of order.
  for (const n of [4, 5, 8]) assert.equal(pensumCInput(n, true, () => 0.1), 'order', `${n} words`);
  // Longer than the reorder cap: answered from the chapter and self-marked.
  for (const n of [9, 12, 37]) assert.equal(pensumCInput(n, true, () => 0.1), 'self', `${n} words`);
  // Never typed once it is long, however the coin falls.
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) for (const n of [4, 9, 20]) assert.notEqual(pensumCInput(n, true, () => r), 'type');
});

test('§29: a whole-sentence Pensum C answer is put in order, not typed out', () => {
  // The shape the learner met: a question whose model answer is a whole sentence. The Latin here is
  // our own — the book's own pensum lines never enter a public file, this one included (PROMPT.md §5).
  const long = 'Puella parvam rosam in hortō suō cotīdiē carpēbat.';
  const rows = [{ chapter: 9, kind: 'C', items: [{ q: 'Quid puella in hortō carpēbat?', answers: [long], unit_id: null }] }];
  const sets = setSkills({ pensa: groupPensa(rows), weeks });
  const gen = createSetItems({ sets, units: [], pool: createPool(mem()), rand: seq([0.05, 0.5, 0.95, 0.3]) });
  const it = gen.generate({ skill: 'pensum-09', kind: 'pensum', stage: 1 });
  assert.ok(it, 'the item is built');
  assert.equal(it.pensum, 'C');
  assert.equal(it.input, 'order', 'seven words: put them in order');
  assert.deepEqual(it.chunks, ['Puella', 'parvam', 'rosam', 'in', 'hortō', 'suō', 'cotīdiē', 'carpēbat.']);
  assert.equal(it.display[it.display.length - 1], 'carpēbat', 'the last chip drops the full stop, which would say "put me last"');
  assert.ok(Array.isArray(it.scrambled) && it.scrambled.length === it.chunks.length);
  assert.ok(!orderMatches(it.chunks, it.scrambled), 'it is actually scrambled');
  // The book's order is right; any other is not.
  assert.equal(judge(it, it.chunks.map((_, i) => i)).correct, true);
  assert.equal(judge(it, [1, 0, 2, 3, 4, 5, 6, 7]).correct, false);
});

test('§29: a Pensum C answer past the reorder cap is answered from the chapter and marked by the learner', () => {
  const veryLong = 'Nauta fessus post longum iter ad parvum portum tandem pervēnit atque amīcōs suōs ibi laetus salūtāvit.';
  const rows = [{ chapter: 11, kind: 'C', items: [{ q: 'Quid nauta fēcit?', answers: [veryLong], unit_id: null }] }];
  const sets = setSkills({ pensa: groupPensa(rows), weeks });
  const gen = createSetItems({ sets, units: [], pool: createPool(mem()), rand: seq([0.05, 0.5]) });
  const it = gen.generate({ skill: 'pensum-11', kind: 'pensum', stage: 1 });
  assert.equal(it.input, 'self');
  assert.equal(it.answer[0], veryLong, 'the chapter\'s own answer is what the learner compares against');
  assert.equal(judge(it, 'right').correct, true);
  assert.equal(judge(it, 'partly').correct, true);
  assert.equal(judge(it, 'wrong').correct, false);
});


/* ================== a week's own vocabulary (§29) ========================= */

test('§29: a chapter two weeks read becomes two vocabulary rows, one per week', () => {
  // Weeks as course.json has them: week 3 reads Fabulae Syrae and the Fabellae, week 4 the chapter.
  const both = [{ n: 3, id: 'w03', chapter: 'XXVII (FS 1, 5); FL 63–65', source: 'FS+FL', title: 'Mīnōs · Corōnis · Fabellae LXIII–LXV' },
    { n: 4, id: 'w04', chapter: 'XXVII', source: 'FR', title: 'Rēs Rūsticae' }];
  const w = (lemma, unit_id) => ({ lemma, dict: `${lemma}, -ī m.`, pos: 'N', meaning: 'a word', unit_id, count: 1 });
  const deck = { chapter: 27, words: [w('taurus', 'w03:minos:b2.2'), w('corvus', 'w03:coronis:b10.1'), w('arātrum', 'w04:12.2')] };
  const built = setSkills({ vocab: new Map([[27, deck]]), weeks: both });

  const chapterRow = built.get('vocab-27');
  const weekRow = built.get('vocab-w03');
  assert.ok(weekRow, 'the week that reads its own stories has no vocabulary row');
  assert.equal(chapterRow.count, 1, "the chapter keeps only the chapter's own words");
  assert.equal(weekRow.count, 2, "the week takes the words its own stories bring in");
  assert.equal(chapterRow.week_n, 4, 'the chapter row belongs to the week that reads the chapter');
  assert.equal(weekRow.week_n, 3);
  assert.equal(weekRow.chapter, 27, 'the week row still sits under the chapter in the map');
  assert.match(weekRow.title, /Mīnōs/);
  assert.ok(!weekRow.title.includes('Cap.'), weekRow.title);
  // No word is taught twice, and each row has an English → Latin twin.
  const ids = new Set([...chapterRow.data.words, ...weekRow.data.words].map((x) => x.lemma));
  assert.equal(ids.size, 3);
  assert.equal(built.get('vocab-w03-rev')?.rev, true);
  assert.equal(built.get('vocab-27-rev')?.count, 1);
  // A chapter only one week reads is untouched: one row, every word.
  const solo = setSkills({ vocab: new Map([[7, { chapter: 7, words: [w('mālum', 'r07:45.1')] }]]), weeks: both });
  assert.equal(solo.get('vocab-07').count, 1);
  assert.equal([...solo.keys()].filter((k) => k.startsWith('vocab-w')).length, 0);
});

test('§29: the shipped chapter XXVII deck really does split into week 3\'s words and week 4\'s', () => {
  const deck = JSON.parse(readFileSync(new URL('../app/data/grammar/vocab/27.json', import.meta.url), 'utf8'));
  const course = JSON.parse(readFileSync(new URL('../app/data/course.json', import.meta.url), 'utf8'));
  const built = setSkills({ vocab: new Map([[27, normaliseVocab(deck)]]), weeks: course });
  const chapterRow = built.get('vocab-27');
  const weekRow = built.get('vocab-w03');
  assert.ok(weekRow && weekRow.count > 10, `week 3 gets ${weekRow?.count ?? 0} words of its own`);
  assert.ok(chapterRow.count > 10, `chapter XXVII keeps ${chapterRow.count}`);
  assert.equal(chapterRow.count + weekRow.count, deck.words.length, 'every word is in exactly one row');
  for (const x of weekRow.data.words) assert.ok(x.unit_id.startsWith('w03:'), `${x.lemma} is from ${x.unit_id}`);
  for (const x of chapterRow.data.words) assert.ok(!x.unit_id.startsWith('w03:'), `${x.lemma} is still in the chapter row`);
  assert.match(weekRow.title, /Mīnōs/);
});
