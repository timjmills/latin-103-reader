// node --test tests/ — a chapter's practice draws that chapter's own Latin
// (GRAMMAR-CONTRACT.md "Chapter spine"; qa/grammar/QA-NAV-SESSION.md M3). The
// skills were already kept inside the chapter; the *sentences* were not, so a
// chapter-VII session could quote Catullus 70 from cap. XXXIV. The rule, and
// what is measured here:
//
//   1. the chapter's own sentences;
//   2. failing those, sentences at or before it;
//   3. only with neither, the wider library — and the item says so.
//
// The pure rule lives in app/js/grammar/chapter.js (scopeByChapter, scopeNote,
// chapterSentenceReport); the generators (items.js, stage3.js) draw through it
// and every slot of a chapter session carries the chapter (scheduler.js,
// session.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems } from '../app/js/grammar/items.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { createStage3 } from '../app/js/grammar/stage3.js';
import { buildSession, newState, addToPractice, DAY_MS } from '../app/js/grammar/scheduler.js';
import { chapterTier, chapterOfSentence, scopeByChapter, scopeNote, chapterSentenceReport } from '../app/js/grammar/chapter.js';
import { scopeSentence } from '../app/js/grammar/ui.js';

const RAW = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const INDEX = indexSkills(RAW);
const SKILL = 'dative-indirect-object';   // the book introduces it in chapter VII
const NOW = Date.parse('2026-09-06T12:00:00Z');

/* ------------------------------------------------------------- fixture */
// The same shape the build's glossary has: forms → entries with their parses.
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind: null });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const DO = ['dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat']];
const G = {
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],
  regi: [N('rēx, rēgis m', 'rex', [3, 1], 'm', ['rēx', 'rēg'], [nk('dat', 'sg', 'm')], ['king'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  rosam: [N('rosa -ae f', 'rosa', [1, 1], 'f', ['ros', 'ros'], [nk('acc', 'sg', 'f')], ['rose'])],
  dat: [V(...DO, [{ tense: 'pres', voice: 'act', mood: 'ind', person: 3, number: 'sg' }], ['give'])],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

// Four sentences of one skill, spread across the book. The unit id is the only
// thing that says where a sentence lives: r03 → chapter III, r07 → chapter VII,
// w13 → the 103's week 13, which reads chapter XXXIV (app/js/chapters.js).
const UNITS = [
  { id: 'r03:1.1', la: 'Puerō librum dat.' },
  { id: 'r07:1.1', la: 'Puerō rosam dat.' },
  { id: 'r07:1.2', la: 'Rēgī librum dat.' },
  { id: 'w13:1.1', la: 'Rēgī rosam dat.', en: 'He gives the king a rose.' },
];
const CHAPTER_OF = { 'r03:1.1': 3, 'r07:1.1': 7, 'r07:1.2': 7, 'w13:1.1': 34 };

const build = (units = UNITS) => {
  const items = createItems({ units, lookup, paradigm, skills: INDEX.skills, storage: mem(), rand: () => 0.5 });
  const stage3 = createStage3({ items, paradigm, rand: () => 0.5 });
  return createGenerator({ items, stage3, sets: null, skills: INDEX.skills });
};
/** Every item a chapter-scoped session would build for `n` slots of the skill. */
const draw = (gen, chapter, n = 6, kind = 'recognise') => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const item = gen.generate({ skill: SKILL, kind, stage: 1, chapter });
    if (item) out.push(item);
  }
  return out;
};

test('the fixture really does spread one skill across the book', () => {
  const gen = build();
  const seen = new Set(gen.candidates(SKILL).map((c) => c.unit.id));
  assert.deepEqual([...seen].sort(), Object.keys(CHAPTER_OF).sort(), 'every sentence yields a candidate');
});

/* ------------------------------------------------- the preference order */

test('a chapter with sentences of its own is drilled on its own sentences, and on nothing else', () => {
  const gen = build();
  const items = draw(gen, 7, 8);
  assert.ok(items.length >= 2, 'the chapter can build items at all');
  for (const it of items) {
    assert.equal(CHAPTER_OF[it.unit_id], 7, `${it.unit_id} is chapter VII's own`);
    assert.deepEqual(it.scope, { chapter: 7, from: 7, scope: 'own', beyond: false });
    assert.equal(scopeSentence(it.scope), null, 'nothing to explain: the sentence is the chapter\'s');
  }
  // The pool is still honest when it wraps: chapter VII has two sentences, so the third draw repeats one.
  assert.ok(items.slice(2).some((it) => it.repeat), 'pool exhaustion is still declared');
});

test('a chapter with none of its own falls back to the chapters before it — never forward while one exists', () => {
  const gen = build();
  const items = draw(gen, 5, 6);
  assert.ok(items.length, 'the skill still produces items for chapter V');
  for (const it of items) {
    assert.equal(it.unit_id, 'r03:1.1', 'the only sentence at or before chapter V');
    assert.equal(it.scope.chapter, 5);
    assert.equal(it.scope.from, 3);
    assert.equal(it.scope.beyond, false, 'chapter III is behind the learner, not ahead');
    assert.match(scopeSentence(it.scope), /no sentence in chapter V itself.*chapter III.*already read/);
  }
});

test('a chapter with nothing at or before it reaches forward — and the item says so in its own words', () => {
  const gen = build();
  const items = draw(gen, 1, 4);
  assert.ok(items.length, 'a reach forward is better than no item at all');
  for (const it of items) {
    assert.ok(CHAPTER_OF[it.unit_id] > 1);
    assert.equal(it.scope.chapter, 1);
    assert.equal(it.scope.beyond, true);
    assert.equal(it.scope.from, CHAPTER_OF[it.unit_id]);
    assert.match(scopeSentence(it.scope), /no sentence in chapter I or earlier.*further on than you have read/);
  }
});

test('the whole library is still the whole library when no chapter scopes the session', () => {
  const gen = build();
  const seen = new Set(draw(gen, null, 8).map((it) => it.unit_id));
  assert.ok(seen.size > 2, 'an unscoped session draws from everywhere, as it always did');
  for (const it of draw(build(), null, 4)) assert.equal(it.scope, null);
});

test('every kind obeys the same rule: chart, blank and parse draw the chapter it is scoped to', () => {
  for (const kind of ['chart', 'blank', 'parse']) {
    const gen = build();
    const items = draw(gen, 7, 4, kind);
    assert.ok(items.length, `the fixture builds ${kind} items`);
    for (const it of items) {
      // A chart has no sentence of its own; its word came from one, and that is what is scoped.
      if (it.unit_id) assert.equal(CHAPTER_OF[it.unit_id], 7, `${kind}: ${it.unit_id}`);
      assert.equal(it.scope.scope, 'own', `${kind}: drawn from the chapter's own Latin`);
      assert.equal(scopeSentence(it.scope), null, `${kind}: the chapter's own word needs no explanation`);
    }
  }
});

test('a stage-3 kind is scoped too: translate has only a chapter XXXIV sentence, and says so', () => {
  const gen = build();
  // `translate` needs an English, which only the course week carries — so for chapter VII it is a reach forward.
  const it = gen.generate({ skill: SKILL, kind: 'translate', stage: 3, chapter: 7 });
  assert.equal(it.kind, 'translate');
  assert.equal(it.unit_id, 'w13:1.1');
  assert.equal(it.scope.beyond, true);
  assert.equal(it.scope.from, 34);
  assert.match(scopeSentence(it.scope), /chapter XXXIV/);
  // `reorder` and `transform` have the chapter's own sentences, so they never leave chapter VII.
  for (const kind of ['reorder', 'transform']) {
    const x = gen.generate({ skill: SKILL, kind, stage: 3, chapter: 7 });
    assert.equal(x.kind, kind);
    assert.equal(CHAPTER_OF[x.unit_id], 7);
    assert.equal(x.scope.scope, 'own');
    assert.equal(scopeSentence(x.scope), null);
  }
});

/* --------------------------------------------------- a chapter session */

test('a chapter VII session holds no sentence from a later chapter', () => {
  const gen = build();
  const states = new Map([[SKILL, { ...addToPractice(newState(SKILL, NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString(), stability_days: 2 }]]);
  const skills = new Map([[SKILL, INDEX.skills.get(SKILL)]]);
  const plan = buildSession({ states, skills, size: 10, seed: 7, now: NOW, chapter: 7 });
  assert.equal(plan.length, 10);
  assert.ok(plan.every((p) => p.chapter === 7), 'the chapter is part of every slot, not an afterthought');
  let built = 0;
  for (const slot of plan) {
    const item = gen.generate({ skill: slot.skill, kind: slot.kind, stage: slot.stage, currentWeek: slot.currentWeek, chapter: slot.chapter });
    if (!item) continue;
    built += 1;
    if (item.unit_id) assert.ok(CHAPTER_OF[item.unit_id] <= 7, `${item.unit_id} is chapter ${CHAPTER_OF[item.unit_id]}, ahead of VII`);
  }
  assert.ok(built >= 5, 'the session really was built');
});

test('the current-week slots of a mixed session carry the week\'s chapter; the rest stay the whole library', () => {
  const states = new Map([[SKILL, { ...addToPractice(newState(SKILL, NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString(), stability_days: 2 }]]);
  const skills = new Map([[SKILL, INDEX.skills.get(SKILL)]]);
  const plan = buildSession({ states, skills, size: 10, seed: 3, now: NOW, currentWeekChapter: 27 });
  const week = plan.filter((p) => p.currentWeek);
  assert.ok(week.length, 'the ≈ 20 % current-week slots are there');
  assert.ok(week.every((p) => p.chapter === 27), 'a "this week" sentence is the week\'s chapter, not the library\'s');
  assert.ok(plan.filter((p) => !p.currentWeek).every((p) => p.chapter === null), 'the other slots are unchanged');
  // A session's own chapter outranks the week's on every slot.
  const scoped = buildSession({ states, skills, size: 10, seed: 3, now: NOW, chapter: 7, currentWeekChapter: 27 });
  assert.ok(scoped.every((p) => p.chapter === 7));
});

/* ------------------------------------------------------- the rule, pure */

test('chapterTier reads a library week as the book does (107 → VII, 207 → VII, week 4 → XXVII)', () => {
  assert.equal(chapterTier(107, 7), 'own');
  assert.equal(chapterTier(207, 7), 'own', 'the colloquium of a chapter is that chapter');
  assert.equal(chapterTier(103, 7), 'earlier');
  assert.equal(chapterTier(13, 7), 'later', 'week 13 reads chapter XXXIV');
  assert.equal(chapterTier(4, 27), 'own');
  assert.equal(chapterTier(999, 7), 'unknown', 'a week the spine does not name');
  assert.equal(chapterTier(107, null), 'unknown');
  assert.equal(chapterOfSentence({ unit: { week_n: 207 } }), 7);
  assert.equal(chapterOfSentence({ week_n: 13 }), 34);
  assert.equal(chapterOfSentence({}), null);
});

test('scopeByChapter returns the narrowest non-empty tier, and counts what it saw', () => {
  const list = [{ week_n: 107 }, { week_n: 103 }, { week_n: 13 }, { week_n: 999 }];
  const own = scopeByChapter(list, 7);
  assert.equal(own.scope, 'own');
  assert.deepEqual(own.list, [{ week_n: 107 }]);
  assert.deepEqual(own.counts, { own: 1, earlier: 1, later: 1, unknown: 1, atOrBefore: 2, total: 4 });
  const earlier = scopeByChapter(list, 5);
  assert.equal(earlier.scope, 'earlier');
  assert.deepEqual(earlier.list, [{ week_n: 103 }]);
  const beyond = scopeByChapter(list, 1);
  assert.equal(beyond.scope, 'beyond');
  assert.deepEqual(beyond.list.map((x) => x.week_n), [999, 107, 103, 13], 'an unnamed week before the chapters that are demonstrably ahead');
  // No chapter, or nothing to draw from: the whole library, exactly as before.
  assert.deepEqual(scopeByChapter(list, null), { list, scope: null, counts: null });
  assert.deepEqual(scopeByChapter([], 7).list, []);
});

test('scopeNote says nothing when there is nothing to say', () => {
  assert.equal(scopeNote(null, 'own', { week_n: 107 }), null, 'no chapter scoped the draw');
  assert.equal(scopeNote(7, null, { week_n: 107 }), null);
  // The chapter's own sentence still names the chapter: the pool it exhausts is that chapter's, not the library's.
  assert.deepEqual(scopeNote(7, 'own', { week_n: 107 }), { chapter: 7, from: 7, scope: 'own', beyond: false });
  assert.deepEqual(scopeNote(5, 'earlier', { week_n: 103 }), { chapter: 5, from: 3, scope: 'earlier', beyond: false });
  assert.deepEqual(scopeNote(1, 'beyond', { week_n: 13 }), { chapter: 1, from: 34, scope: 'beyond', beyond: true });
  assert.equal(scopeSentence(null), null);
  assert.equal(scopeSentence({ chapter: 7, from: 7, scope: 'own' }), null);
});

/* ---------------------------------------------------- the measurement */

test('chapterSentenceReport counts, per skill, the sentences at or before a chapter', () => {
  const gen = build();
  const skills = [INDEX.skills.get(SKILL)];
  const seven = chapterSentenceReport(7, { skills, candidates: gen.candidates });
  assert.deepEqual(seven.skills[0], { skill: SKILL, set: false, own: 2, earlier: 1, atOrBefore: 3, later: 1, unknown: 0, total: 4 });
  assert.deepEqual(seven.totals, { own: 2, earlier: 1, atOrBefore: 3, later: 1, unknown: 0, total: 4 });
  assert.deepEqual(seven.none, [], 'chapter VII can drill this skill on Latin the learner has met');

  const five = chapterSentenceReport(5, { skills, candidates: gen.candidates });
  assert.equal(five.skills[0].own, 0);
  assert.equal(five.skills[0].atOrBefore, 1, 'one sentence from chapter III');
  assert.deepEqual(five.none, []);

  // Chapter I is the honest case: the skill has nothing at or before it, so its items must say so.
  const one = chapterSentenceReport(1, { skills, candidates: gen.candidates });
  assert.equal(one.skills[0].atOrBefore, 0);
  assert.deepEqual(one.none, [SKILL]);
  assert.equal(one.totals.later, 4);

  // A chapter set is counted but never named as a gap: its items are the chapter's own by construction.
  const withSet = chapterSentenceReport(1, { skills: [...skills, { id: 'vocab-01', set: 'vocab' }], candidates: gen.candidates });
  assert.deepEqual(withSet.none, [SKILL]);
  assert.equal(withSet.skills[1].total, 0);
  // Nothing to report on is not an error.
  assert.deepEqual(chapterSentenceReport(7, {}).skills, []);
});

test('the report is a number a regression would move: every chapter of the fixture, at a glance', () => {
  const gen = build();
  const skills = [INDEX.skills.get(SKILL)];
  const perChapter = Object.fromEntries([1, 3, 5, 7, 34].map((n) => [n, chapterSentenceReport(n, { skills, candidates: gen.candidates }).totals.atOrBefore]));
  assert.deepEqual(perChapter, { 1: 0, 3: 1, 5: 1, 7: 3, 34: 4 }, 'the pool a chapter may draw on only ever grows through the book');
});
