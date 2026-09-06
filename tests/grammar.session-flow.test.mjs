// node --test tests/ — the session flow the learner asked for
// (GRAMMAR-CONTRACT.md "Session flow — move on, step back, colour the result"
// and "Hints, per answer box"):
//
//   1  a correct answer lets the session move on; a wrong one holds the item
//      and only the forward arrow gets past it;
//   2  the FIRST answer to an item is the one logged and the one the scheduler
//      sees — retries write nothing, anywhere;
//   3  back and forward walk the items already seen, and a step back is a
//      replay: never re-graded, never touching the scheduler;
//   4  every answer box carries its own two-level hint, and no level of any
//      hint on any skill spells an accepted answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems, normaliseAnswer } from '../app/js/grammar/items.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { createPractice, createLearn, boxHints, hintTexts, answerLeak, acceptedAnswers, normaliseHintMode, HINT_MODES } from '../app/js/grammar/session.js';
import { learnCriterion, newState, addToPractice } from '../app/js/grammar/scheduler.js';

/* --------------------------------------------------------------- fixtures */

/** A store in the shape createPractice / createLearn use, remembering every write. */
function memStore() {
  const states = new Map();
  const attempts = [];
  const confusions = [];
  return {
    states, attempts, confusions,
    getStates: () => states,
    getState: (id) => states.get(id) ?? null,
    setState: async (s) => { states.set(s.skill, s); return s; },
    getConfusions: () => [],
    getAttempts: () => attempts,
    addAttempt: async (a) => { attempts.push(a); },
    bumpConfusion: async (a, b) => { confusions.push(`${a}|${b}`); },
  };
}

const skillRow = (id) => ({ id, set: null, title: id, plain: `the ${id}`, summary: `${id}: the rule for it.`, kinds: ['blank'], parse_filter: { case: 'dat' }, confusable_with: [], prereqs: [], feature: 'case' });
const SKILLS = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, skillRow(id)]));

/** One typed item per slot, with a distinct key, answered by the word "right". */
const fakeItems = () => {
  let n = 0;
  return {
    drillable: () => true,
    generate: ({ skill, kind = 'blank', stage = 2 }) => {
      n += 1;
      return {
        skill, kind, stage, key: `${skill}:${n}`, input: 'type', answer: ['right'], choices: null,
        unit_id: null, target: { text: 'sorōrī', form: 'sorori', index: 1 }, entry: null, meanings: [],
        prompt: { la: 'Mārcus ___ nihil dat.', question: 'Fill the blank', gloss: 'soror — sister', hint: 'Dative — the "to/for" form' },
        confuse: { values: {}, indexes: {}, forms: { wrong: 'b' } },
        feedback: { short: 'x', term: 'the dative', label: { name: 'Dative', plain: "the 'to/for' form" }, table: null, lemma: 'soror sorōris f', sense: 'sister' },
      };
    },
  };
};

const plan = (n) => Array.from({ length: n }, (_, i) => ({ skill: ['a', 'b', 'c', 'd', 'e', 'f'][i % 6], kind: 'blank', stage: 2, currentWeek: false }));
const practice = (n = 4, extra = {}) => {
  const gstore = memStore();
  const p = createPractice({ plan: plan(n), gstore, items: fakeItems(), skillsIndex: { skills: SKILLS }, preset: 'review-heavy', size: n, rand: () => 0.4, ...extra });
  p.start();
  return { p, r: p.runner, gstore };
};

/* ------------------------------------------- 1 · move on, or do not */

test('a correct answer leaves the session free to move on; forward takes the next item', async () => {
  const { r } = practice(3);
  const first = r.current.item.key;
  const res = await r.answer('right');
  assert.equal(res.correct, true);
  assert.equal(res.retry, false);
  assert.equal(r.position, 0, 'the runner does not move by itself — the view times the beat');
  assert.equal(r.canForward, true, 'but forward is open at once');
  assert.equal(r.held, false);
  r.forward();
  assert.notEqual(r.current.item.key, first, 'and forward is the next item');
  assert.equal(r.position, 1);
});

test('a wrong answer holds the item: it stays, with its result, until the forward arrow is pressed', async () => {
  const { r } = practice(3);
  const key = r.current.item.key;
  const res = await r.answer('nope');
  assert.equal(res.correct, false);
  assert.equal(r.position, 0);
  assert.equal(r.held, true, 'the item is holding the session');
  assert.equal(r.current.item.key, key, 'and it is the same item');
  // `next()` is not offered to the learner while an item is held: the view calls `forward()`, deliberately.
  r.forward();
  assert.equal(r.position, 1, 'the forward arrow is the way past');
  assert.notEqual(r.current.item.key, key);
});

test('forward is closed while the item on screen has not been answered at all — it is not a way to skip', () => {
  const { r } = practice(3);
  assert.equal(r.canForward, false);
  assert.equal(r.canBack, false);
  const before = r.position;
  r.forward();
  assert.equal(r.position, before, 'nothing moves');
});

test('a wrong answer tried again until it is right: the item is right on screen, and only then does forward feel earned', async () => {
  const { r } = practice(3);
  await r.answer('nope');
  const second = await r.answer('still nope');
  assert.equal(second.correct, false);
  assert.equal(second.retry, true);
  const third = await r.answer('right');
  assert.equal(third.correct, true, 'the retry is judged, so the learner sees they have it');
  assert.equal(third.retry, true, 'but it is a retry, and nothing about it is written down');
  assert.equal(r.position, 0);
  r.forward();
  assert.equal(r.position, 1);
});

/* --------------------------------- 2 · the first answer is the only one */

test('wrong, wrong, then right: one attempt logged, one state change, one confusion — the first answer only', async () => {
  const { r, gstore } = practice(3);
  const skill = r.current.item.skill;
  await r.answer('wrong');           // the confuse map turns "wrong" into skill b
  await r.answer('wrong');
  await r.answer('wrong');
  await r.answer('right');
  assert.equal(gstore.attempts.length, 1, 'one drill_attempts row');
  assert.equal(gstore.attempts[0].correct, false, 'and it is the first answer, the wrong one');
  assert.equal(r.log.length, 1, 'one row in the session log');
  assert.equal(gstore.confusions.length, 1, 'the confusion pair is counted once');
  const st = gstore.states.get(skill);
  assert.equal(st.failures, 1, 'one failure');
  assert.equal(st.successes, 0, 'and no success: the three retries are not evidence');
  assert.equal(st.successes_spaced, 0, 'nothing towards mastery either');
  assert.equal(st.streak, 0);
  const sum = r.summary();
  assert.equal(sum.total, 1);
  assert.equal(sum.right, 0);
  assert.deepEqual(sum.wrong, [skill]);
});

test('a right answer retried wrong cannot undo itself either — the first answer stands', async () => {
  const { r, gstore } = practice(3);
  await r.answer('right');
  await r.answer('nonsense');
  assert.equal(gstore.attempts.length, 1);
  assert.equal(gstore.attempts[0].correct, true);
  assert.equal(gstore.states.get(r.current.item.skill).successes, 1);
  assert.equal(r.summary().right, 1);
});

test('a miss re-queues once, however many times it is retried — the session does not grow with the retries', async () => {
  const { r } = practice(4);
  // Whether a miss finds room to come back is `requeue`'s business (it needs a gap from its own skill and
  // may have none in a short plan). What matters here is that the retries change the queue not at all.
  await r.answer('nope');
  const queued = JSON.stringify(r.queue);
  const added = r.added;
  await r.answer('nope again');
  await r.answer('nope again either');
  await r.answer('right');
  assert.equal(JSON.stringify(r.queue), queued, 'the retries queue nothing more');
  assert.equal(r.added, added, 'and the session is not longer for having been retried');
});

test('the Learn criterion cannot be reached by retrying: it reads the log, and the log holds first answers', async () => {
  const { r } = practice(6);
  for (let i = 0; i < 6; i++) {
    if (!r.current) break;
    await r.answer('wrong');
    await r.answer('right');     // got there in the end, but not the first time
    r.forward();
  }
  const c = learnCriterion(r.log, { kinds: 1 });
  assert.equal(c.correct, 0, 'nothing correct is logged');
  assert.equal(c.passed, false, 'so the criterion is not met by persistence alone');
});

test('a hint pressed on a retry cannot change what was logged', async () => {
  const { r, gstore } = practice(2);
  await r.answer('nope');
  r.hint();
  await r.answer('right');
  assert.equal(gstore.attempts[0].hinted, false, 'the attempt was made before any hint was open');
});

test("Learn's own runner obeys the same rule: a retried blocked item is logged once", async () => {
  const gstore = memStore();
  const skill = { ...skillRow('a'), kinds: ['blank'] };
  const learn = createLearn({ skill, gstore, items: fakeItems(), rand: () => 0.4 });
  learn.startBlocked();
  await learn.runner.answer('nope');
  await learn.runner.answer('nope');
  await learn.runner.answer('right');
  assert.equal(gstore.attempts.length, 1);
  assert.equal(learn.runner.log.length, 1);
  assert.equal(learn.runner.log[0].correct, false);
});

/* --------------------------------------- 3 · back, forward, and replay */

test('back and forward walk the items already seen, and going back is a replay', async () => {
  const { r, gstore } = practice(4);
  const one = r.current.item.key;
  await r.answer('right');
  r.forward();
  const two = r.current.item.key;
  await r.answer('nope');
  assert.equal(gstore.attempts.length, 2);

  r.back();
  assert.equal(r.position, 0);
  assert.equal(r.current.item.key, one, 'the item that was answered, not a fresh one');
  assert.equal(r.replay, true);
  assert.equal(r.answered.result.correct, true, 'shown with the result it was answered with');

  // Read-only: an answer given here is judged for the eye and written down nowhere.
  const again = await r.answer('nope');
  assert.equal(again.retry, true);
  assert.equal(gstore.attempts.length, 2, 'no new attempt');
  assert.equal(r.log.length, 2, 'no new log row');
  assert.equal(r.resultAt(0).result.correct, true, 'and the stored result is untouched');

  r.forward();
  assert.equal(r.position, 1, 'forward returns to where the learner was');
  assert.equal(r.current.item.key, two);
  assert.equal(r.replay, false);
  assert.equal(r.held, true, 'still holding, exactly as it was left');
});

test('back stops at the first item and forward never runs past the frontier', async () => {
  const { r } = practice(4);
  await r.answer('right');
  r.forward();
  await r.answer('right');
  r.forward();                       // frontier is item 3 now, unanswered
  assert.equal(r.position, 2);
  r.back(); r.back(); r.back(); r.back();
  assert.equal(r.position, 0, 'back stops at the first item');
  assert.equal(r.canBack, false);
  r.forward(); r.forward(); r.forward(); r.forward();
  assert.equal(r.position, 2, 'forward stops at the unanswered frontier');
});

test('stepping back and answering forward again does not double-count the item at the frontier', async () => {
  const { r, gstore } = practice(3);
  await r.answer('right');
  r.forward();
  r.back();
  r.forward();
  assert.equal(r.position, 1);
  await r.answer('right');
  assert.equal(gstore.attempts.length, 2, 'two items, two attempts');
});

/* ---------------------------------------------- 4 · hints, per answer box */

const index = indexSkills(JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8')));
const S = index.skills;
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const ADJ = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'ADJ', cat, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind: null });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const fin = (tense, mood, person, number, voice = 'act') => ({ tense, voice, mood, person, number });
const SOROR = ['soror sorōris f', 'soror', [3, 1], 'f', ['soror', 'sorōr']];
const G = {
  sorori: [N(...SOROR, [nk('dat', 'sg', 'f')], ['sister'])],
  soror: [N(...SOROR, [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f')], ['sister'])],
  marcus: [N('Mārcus -ī m', 'marcus', [2, 1], 'm', ['Mārc', 'Mārc'], [nk('nom', 'sg', 'm')], ['Marcus'])],
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  rosam: [N('rosa -ae f', 'rosa', [1, 1], 'f', ['ros', 'ros'], [nk('acc', 'sg', 'f')], ['rose'])],
  nihil: [N('nihil n', 'nihil', [9, 9], 'n', ['nihil', 'nihil'], [nk('acc', 'sg', 'n'), nk('nom', 'sg', 'n')], ['nothing'])],
  vir: [N('vir virī m', 'vir', [2, 3], 'm', ['vir', 'vir'], [nk('nom', 'sg', 'm')], ['man'])],
  amicus: [ADJ('amīcus -a -um', 'amicus', [1, 1], ['amīc', 'amīc', 'amici', 'amicissi'], [nk('nom', 'sg', 'm')], ['friendly, dear'])],
  vallēs: [N('vallis -is f', 'vallis', [3, 3], 'f', ['vall', 'vall'], [nk('nom', 'pl', 'f')], ['valley'])],
  valles: [N('vallis -is f', 'vallis', [3, 3], 'f', ['vall', 'vall'], [nk('nom', 'pl', 'f')], ['valley'])],
  montes: [N('mōns montis m', 'mons', [3, 3], 'm', ['mōns', 'mont'], [nk('nom', 'pl', 'm')], ['mountain'])],
  inter: [{ lemma: 'inter', h: 'inter', pos: 'PREP', roots: [], parses: [{ governs: 'acc' }], senses: ['between'], enc: null, kind: 'acc' }],
  sunt: [V('sum, esse, fuī, futūrum', 'sum', [5, 1], ['s', 'es', 'fu', 'fut'], [fin('pres', 'ind', 3, 'pl')], ['be'])],
  est: [V('sum, esse, fuī, futūrum', 'sum', [5, 1], ['s', 'es', 'fu', 'fut'], [fin('pres', 'ind', 3, 'sg')], ['be'])],
  dat: [V('dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat'], [fin('pres', 'ind', 3, 'sg')], ['give'])],
  iulius: [N('Iūlius -ī m', 'iulius', [2, 1], 'm', ['Iūli', 'Iūli'], [nk('nom', 'sg', 'm')], ['Julius'])],
  et: [{ lemma: 'et', h: 'et', pos: 'CONJ', roots: [], parses: [{}], senses: ['and'], enc: null }],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const units = [
  { id: 'w07:1.1', la: 'Mārcus sorōrī nihil dat.', en: 'Marcus gives his sister nothing.', week_n: 7 },
  { id: 'w07:1.2', la: 'Soror puerō librum dat.', en: 'The sister gives the boy a book.', week_n: 7 },
  { id: 'w07:2.1', la: 'Inter montēs vallēs sunt.', en: 'Between the mountains are valleys.', week_n: 7 },
  { id: 'w07:2.2', la: 'Vir amīcus est.', en: 'The man is friendly.', week_n: 7 },
  { id: 'w07:2.3', la: 'Iūlius rosam dat.', en: 'Julius gives a rose.', week_n: 7 },
];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const realItems = () => createItems({ units, lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4 });

test('every input kind gets a hint for every one of its answer boxes, each about its own box', () => {
  const chart = { input: 'chart', kind: 'chart', skill: 'x', lemma: 'soror sorōris f', answer: ['sorōrī'],
    chart: { head: 'soror', cells: [{ row: 0, col: 0, label: 'dative singular', answer: ['sorōrī'] }, { row: 1, col: 0, label: 'dative plural', answer: ['sorōribus'] }] },
    prompt: { question: 'q', hint: 'Dative — the "to/for" form' }, feedback: { term: 'the dative', label: { name: 'Dative', plain: "the 'to/for' form" } } };
  const pensumA = { input: 'inline', kind: 'pensum', pensum: 'A', skill: 'x', answer: ['ā', 'us', 'ōrum'],
    blanks: [{ i: 0, stem: 'Itali', answers: ['ā'], note: 'after in, where it means "in"' }, { i: 1, stem: 'domin', answers: ['us'], note: 'the subject' }, { i: 2, stem: 'serv', answers: ['ōrum'], note: 'whose' }],
    prompt: { question: 'Pensum A', hint: 'endings' }, feedback: { term: 'the pensum', label: null } };
  const pensumB = { ...pensumA, input: 'bank', prompt: { question: 'Pensum B', hint: 'bank' } };
  const match = { input: 'match', kind: 'vocab', skill: 'x', answer: ['puella — girl', 'rosa — rose'],
    pairs: [{ la: 'puella', en: 'girl', dict: 'puella -ae f' }, { la: 'rosa', en: 'rose', dict: 'rosa -ae f' }],
    prompt: { question: 'Match', hint: 'Two nouns from chapter I.' }, feedback: { term: 'vocabulary', label: null } };
  const order = { input: 'order', kind: 'reorder', skill: 'x', answer: ['Soror puerō librum dat.'],
    chunks: ['Soror', 'puerō', 'librum', 'dat.'], display: ['Soror', 'puerō', 'librum', 'dat'], scrambled: [2, 0, 3, 1],
    prompt: { question: 'Put them back', hint: 'puerō is dative.' }, feedback: { term: 'the dative', label: { name: 'Dative', plain: "the 'to/for' form" } } };

  const counts = [[chart, 2], [pensumA, 3], [pensumB, 3], [match, 2], [order, 4]];
  for (const [item, n] of counts) {
    const boxes = boxHints(item, { skill: { plain: 'the dative', summary: 'The dative is the to/for form.' } });
    assert.equal(boxes.length, n, `${item.input}: one hint per box`);
    assert.equal(new Set(boxes.map((b) => b.id)).size, n, `${item.input}: the ids are the boxes' own`);
    assert.equal(new Set(boxes.map((b) => b.levels[0])).size, n, `${item.input}: the first level differs box by box`);
    for (const b of boxes) {
      assert.ok(b.levels.length >= 1 && b.levels.length <= 2, `${item.input}: at most two levels`);
      assert.ok(b.label, `${item.input}: the box is named for a screen reader`);
      for (const t of b.levels) assert.equal(typeof t, 'string');
    }
  }
  // Four blanks means four hints, each about its own box — the contract's own example.
  const four = boxHints({ ...pensumA, answer: ['ā', 'us', 'ōrum', 'am'], blanks: [...pensumA.blanks, { i: 3, stem: 'ros', answers: ['am'], note: 'the object' }] }, {});
  assert.equal(four.length, 4);
  assert.ok(four.every((b, i) => b.levels[0].includes(`Blank ${i + 1}`)));
});

test('a single answer box gets one hint, two levels deep: plain words first, then the rule', () => {
  const items = realItems();
  const it = items.generate({ skill: 'dative-indirect-object', kind: 'blank', stage: 2 });
  assert.ok(it, 'the fixture library does produce a blank for this skill');
  const boxes = boxHints(it, { skill: S.get('dative-indirect-object') });
  assert.equal(boxes.length, 1, 'one box, one hint');
  assert.equal(boxes[0].id, '0');
  assert.equal(boxes[0].levels.length, 2, 'level one, then the rule behind it');
  assert.notEqual(boxes[0].levels[0], boxes[0].levels[1]);
});

test('an item that shows no hint at all is possible, and boxHints simply returns nothing for it', () => {
  assert.deepEqual(boxHints(null), []);
  assert.deepEqual(boxHints({ input: 'chart', kind: 'chart', chart: { cells: [] }, prompt: {}, feedback: {} }), []);
});

test('the three hint modes are the remembered setting, and anything else falls back to "press"', () => {
  assert.deepEqual([...HINT_MODES], ['press', 'always', 'off']);
  assert.equal(normaliseHintMode(undefined), 'press');
  assert.equal(normaliseHintMode('nonsense'), 'press');
  for (const m of HINT_MODES) assert.equal(normaliseHintMode(m), m);
});

/* ---- the sweep: a hint may narrow, it may never spell an accepted answer ---- */

test('answerLeak finds an answer a text spells, whole-word, macrons and case ignored', () => {
  assert.deepEqual(answerLeak('the blank wants sorōrī here', ['sorori']), ['sorori']);
  assert.deepEqual(answerLeak('the dative of soror', ['sorōrī']), [], 'the dictionary head is not the answer');
  assert.deepEqual(answerLeak('a form ending in -orum', ['sorōrī']), []);
  // A one- or two-letter ending that is also an English word is out of the check by design: no English
  // sentence about the ablative can avoid "a", and the generator never puts a Latin form in hint text.
  assert.deepEqual(answerLeak('this blank wants a long vowel', ['a']), []);
  assert.deepEqual(answerLeak('the ending is ōrum', ['ōrum']), ['ōrum']);
});

test('acceptedAnswers gathers every answer an item takes, so no box may spell another box\'s answer', () => {
  const chart = { answer: ['sorōrī'], chart: { cells: [{ answer: ['sorōrī'] }, { answer: ['sorōribus'] }] } };
  assert.ok(acceptedAnswers(chart).includes('sorōribus'));
  const pensum = { answer: ['ā'], blanks: [{ stem: 'Itali', answers: ['ā'] }] };
  assert.ok(acceptedAnswers(pensum).includes('Italiā'), 'the whole word counts too — a pensum blank accepts it');
});

test('B1 extended: no hint of any generated item ever spells an accepted answer', () => {
  const items = realItems();
  const s3 = createStage3({ items, paradigm, rand: () => 0.3 });
  let seen = 0;
  const sweep = (it, id) => {
    if (!it || !Array.isArray(it.answer)) return;
    seen += 1;
    const skill = S.get(id);
    // `recognise` and `parse` are answered with a label, not a form, and a hint that may not name the case is
    // no hint: they carry the same exemption the item sweep gives them (tests/grammar.fix4.test.mjs B1).
    if (it.kind === 'parse' || it.kind === 'recognise') return;
    const answers = acceptedAnswers(it);
    for (const text of hintTexts(it, { skill, describe: () => null })) {
      const bad = answerLeak(text, answers);
      assert.deepEqual(bad, [], `${id} · ${it.kind}: the hint "${text}" gives away ${bad.join(', ')}`);
    }
  };
  for (const id of index.order) {
    if (!items.drillable(id)) continue;
    for (const stage of [1, 2, 3]) {
      for (const kind of ['recognise', 'parse', 'blank', 'chart']) sweep(items.generate({ skill: id, kind, stage }), id);
      for (const kind of ['transform', 'reorder']) sweep(s3.generate({ skill: id, kind, stage }), id);
    }
  }
  assert.ok(seen > 4, 'the sweep actually generated items');
});

test('a level that would have spelled the answer is dropped rather than shown', () => {
  // A pensum whose authored note happens to print the very ending it wants.
  const leaky = { input: 'inline', kind: 'pensum', pensum: 'A', skill: 'x', answer: ['ōrum'],
    blanks: [{ i: 0, stem: 'serv', answers: ['ōrum'], note: 'the genitive plural is servōrum' }],
    prompt: { question: 'Pensum A', hint: 'endings' }, feedback: { term: 'the pensum', label: null } };
  const boxes = boxHints(leaky, {});
  for (const b of boxes) for (const t of b.levels) assert.deepEqual(answerLeak(t, acceptedAnswers(leaky)), [], `"${t}" leaked`);
});

test("a reorder item's chips each carry their own dictionary line, and none of them gives the order away", () => {
  const order = { input: 'order', kind: 'reorder', skill: 'x', answer: ['Soror puerō librum dat.'],
    chunks: ['Soror', 'puerō', 'librum', 'dat.'], display: ['Soror', 'puerō', 'librum', 'dat'], scrambled: [2, 0, 3, 1],
    prompt: { question: 'Put them back', hint: 'puerō is dative.' }, feedback: { term: 'the dative', label: null } };
  const describe = (form, text) => ({ lemma: `${text}-lemma`, meaning: `${text}-meaning`, parse: `${text}-parse` });
  const boxes = boxHints(order, { describe });
  assert.equal(boxes.length, 4);
  assert.deepEqual(boxes.map((b) => b.label), ['Soror', 'puerō', 'librum', 'dat'], 'each chip is its own box, named as it is printed');
  assert.ok(boxes[1].levels[0].includes('puerō-meaning'), 'and carries its dictionary line, which the chip itself cannot show');
  for (const b of boxes) for (const t of b.levels) assert.deepEqual(answerLeak(t, acceptedAnswers(order)), [], `"${t}" printed the sentence`);
  // The last chip does not carry the sentence's full stop, and neither does anything the hint says about it —
  // a hint that printed "dat." would say which word ends the sentence (stage3.js `display`, m1).
  const noDict = boxHints(order, { describe: () => null });
  assert.ok(noDict[3].levels[0].includes('dat'));
  assert.ok(!noDict[3].levels[0].includes('dat.'));
});

test('a match item\'s hints give the dictionary line, never the meaning that is the answer', () => {
  const match = { input: 'match', kind: 'vocab', skill: 'x', answer: ['puella — girl', 'rosa — rose'],
    pairs: [{ la: 'puella', en: 'girl', dict: 'puella -ae f' }, { la: 'rosa', en: 'rose', dict: 'rosa -ae f' }],
    prompt: { question: 'Match', hint: 'Two nouns from chapter I.' }, feedback: { term: 'vocabulary', label: null } };
  const boxes = boxHints(match, {});
  for (const [i, b] of boxes.entries()) {
    const all = b.levels.join(' ');
    assert.ok(all.includes(match.pairs[i].dict), 'the dictionary line is given');
    assert.equal(normaliseAnswer(all).split(' ').includes(normaliseAnswer(match.pairs[i].en)), false, 'the meaning is not');
  }
});
