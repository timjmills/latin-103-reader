// node --test tests/ — the chapter spine, grammar side (GRAMMAR-CONTRACT.md
// "Chapter spine — navigation by chapter"): one chapter's skills and sets,
// the by-chapter grouping over the whole book, "Practise this chapter"
// drawing only from that chapter's material, a chapter with nothing drillable,
// and the remembered choice of view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spine, spineRows, chapterMaterial, chapterProgress, chapterPool, chapterSummary, normaliseView, CHAPTER_MAX } from '../app/js/grammar/chapter.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { setSkills, setsOfChapter } from '../app/js/grammar/sets.js';
import { buildSession, newState, addToPractice, applyAnswer, DAY_MS, SET_MAX, SET_MIN, SET_WINDOW } from '../app/js/grammar/scheduler.js';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const RAW = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const INDEX = indexSkills(RAW);

// The chapter sets of two chapters, built the way the section builds them.
const SETS = setSkills({
  questions: new Map([[7, { chapter: 7, week_id: 'r07', title: 'Puella et rosa', items: Array.from({ length: 24 }, (_, i) => ({ id: `q07-${i}` })) }],
    [9, { chapter: 9, week_id: 'r09', title: '', items: Array.from({ length: 24 }, (_, i) => ({ id: `q09-${i}` })) }]]),
  vocab: new Map([[7, { chapter: 7, words: Array.from({ length: 20 }, (_, i) => ({ lemma: `w${i}` })) }],
    [21, { chapter: 21, words: Array.from({ length: 20 }, (_, i) => ({ lemma: `v${i}` })) }]]),
  pensa: new Map([[7, { chapter: 7, A: [{}, {}], B: [{}], C: [{}, {}, {}] }]]),
  weeks: [{ n: 107, id: 'r07', chapter: '7' }, { n: 109, id: 'r09', chapter: '9' }, { n: 121, id: 'r21', chapter: '21' }],
});
const ALL = new Map([...INDEX.skills, ...SETS]);
const material7 = () => chapterMaterial(7, { skills: ALL, order: INDEX.order, sets: SETS });

/** A state map from ids, all in rotation and due. */
const due = (id) => ({ ...addToPractice(newState(id, NOW), NOW), due_at: new Date(NOW - DAY_MS).toISOString(), stability_days: 2 });
const states = (ids) => new Map(ids.map((id) => [id, due(id)]));
const stateOf = (map) => (id) => map.get(id) ?? newState(id, NOW);

test('the spine is the book: I–XXXIV in order, whether or not chapters.js has landed', () => {
  const bare = spine(null);
  assert.equal(bare.length, CHAPTER_MAX);
  assert.equal(bare[0].n, 1);
  assert.equal(bare[6].roman, 'VII');
  assert.equal(bare[6].title, '', 'no title until the chapter list is there');
  assert.deepEqual(bare[6].readings, []);
  // With the list: titles and readings ride along, gaps are still filled.
  const withList = spine([{ n: 7, roman: 'VII', title: 'Puella et Rosa', readings: [{ kind: 'fr', week_n: 107 }] }]);
  assert.equal(withList.length, CHAPTER_MAX);
  assert.equal(withList[6].title, 'Puella et Rosa');
  assert.equal(withList[6].readings[0].week_n, 107);
  assert.equal(withList[0].title, '');
  // A list naming a chapter beyond XXXIV keeps it rather than dropping it.
  assert.equal(spine([{ n: 40 }]).length, 40);
});

test("a chapter's grammar: the skills the book introduces there, in book order, and its sets", () => {
  const m = material7();
  assert.ok(m.skills.length, 'chapter VII introduces at least one skill');
  assert.ok(m.skills.every((s) => s.chapter === 7 && !s.set), 'only that chapter, and no sets among the skills');
  const pos = new Map(INDEX.order.map((id, i) => [id, i]));
  assert.deepEqual(m.skills.map((s) => s.id), [...m.skills].sort((a, b) => pos.get(a.id) - pos.get(b.id)).map((s) => s.id), 'book order');
  assert.deepEqual(m.sets.map((s) => s.id), ['questions-07', 'vocab-07', 'vocab-07-rev', 'pensum-07'], 'questions · vocabulary (the reverse deck after its own) · pensa');
  assert.deepEqual(m.sets.map((s) => s.id), setsOfChapter(SETS, 7).map((s) => s.id));
  assert.deepEqual(m.members.map((s) => s.id), [...m.skills, ...m.sets].map((s) => s.id));
  // Chapter IX has a question set but no vocabulary deck and no pensa: the row list says so, it does not invent them.
  assert.deepEqual(chapterMaterial(9, { skills: ALL, order: INDEX.order, sets: SETS }).sets.map((s) => s.id), ['questions-09']);
  // A chapter entry that names its own skills is believed (chapters.js is the source of truth).
  const named = chapterMaterial(7, { skills: ALL, order: INDEX.order, sets: SETS, entry: { grammar: { skills: ['nominative-subject'] } } });
  assert.deepEqual(named.skills.map((s) => s.id), ['nominative-subject']);
});

test('how much of a chapter is done, and the line that says so', () => {
  const m = material7();
  const ids = m.members.map((s) => s.id);
  const st = states([ids[0], ids[1]]);
  st.set(ids[0], { ...st.get(ids[0]), state: 'mastered' });
  const p = chapterProgress(m, { state: stateOf(st), drillable: () => true });
  assert.equal(p.total, m.members.length);
  assert.equal(p.skills, m.skills.length);
  assert.equal(p.sets, 4);
  assert.equal(p.mastered, 1);
  assert.equal(p.started, 2);
  assert.equal(p.rotation, 2);
  assert.match(chapterSummary(p), /mastered/);
  const fresh = chapterProgress(m, { state: () => null, drillable: () => true });
  assert.match(chapterSummary(fresh), /not started$/);
  assert.equal(chapterSummary({ total: 0 }), 'No grammar of its own');
  // Nothing drillable is counted honestly, never hidden.
  assert.equal(chapterProgress(m, { state: () => null, drillable: () => false }).drillable, 0);
});

test('the by-chapter grouping covers every chapter of the book, in order, each with its own material', () => {
  const rows = spineRows({ chapters: [{ n: 7, roman: 'VII', title: 'Puella et Rosa' }], skills: ALL, order: INDEX.order, sets: SETS, state: () => null, drillable: () => true });
  assert.equal(rows.length, CHAPTER_MAX);
  assert.deepEqual(rows.map((r) => r.n), Array.from({ length: CHAPTER_MAX }, (_, i) => i + 1));
  assert.equal(rows[6].title, 'Puella et Rosa');
  // Every skill of the map sits under exactly one chapter, and no chapter borrows another's.
  const seen = rows.flatMap((r) => r.material.skills.map((s) => s.id));
  assert.equal(seen.length, new Set(seen).size, 'no skill appears twice');
  assert.equal(seen.length, INDEX.skills.size, 'every skill is placed');
  for (const r of rows) assert.ok(r.material.skills.every((s) => s.chapter === r.n));
  assert.deepEqual(rows[6].material.sets.map((s) => s.id), ['questions-07', 'vocab-07', 'vocab-07-rev', 'pensum-07']);
  assert.equal(rows[0].material.sets.length, 0, 'a chapter with no set shows none');
});

test('"Practise this chapter" draws only from that chapter, and obeys the mix rules', () => {
  const m = material7();
  const pool = chapterPool(m, { state: () => null, drillable: () => true });
  assert.deepEqual([...pool.map.keys()].sort(), m.members.map((s) => s.id).sort());
  assert.deepEqual(pool.rotation, [], 'nothing is in rotation before the learner puts it there');
  assert.ok(pool.addable.includes('questions-07'));
  assert.ok(!pool.addable.includes('vocab-07-rev'), 'the optional reverse deck is never added by a bulk action');

  const ids = m.members.map((s) => s.id);
  const plan = buildSession({ states: states(ids), skills: pool.map, size: 15, seed: 7, now: NOW });
  assert.equal(plan.length, 15);
  const inChapter = new Set(ids);
  assert.ok(plan.every((p) => inChapter.has(p.skill)), "every slot is this chapter's");
  for (let i = 1; i < plan.length; i++) {
    assert.notEqual(plan[i].skill, plan[i - 1].skill, 'no two consecutive items on one skill');
    assert.notEqual(plan[i].kind, plan[i - 1].kind, 'no two consecutive items of one kind');
  }
});

test('the chapter-set window holds inside a chapter session — while the chapter has other skills to offer', () => {
  // Chapter XXI carries five skills beside its two sets, so the sliding window is a rule the session can keep.
  const m = chapterMaterial(21, { skills: ALL, order: INDEX.order, sets: SETS });
  assert.ok(m.skills.length >= 3 && m.sets.length >= 2, 'the fixture chapter really is mixed');
  const pool = chapterPool(m, { state: () => null, drillable: () => true });
  const plan = buildSession({ states: states(m.members.map((s) => s.id)), skills: pool.map, size: 20, seed: 11, now: NOW });
  const isSet = (id) => !!pool.map.get(id)?.set;
  for (let start = 0; start + SET_WINDOW <= plan.length; start++) {
    const n = plan.slice(start, start + SET_WINDOW).filter((p) => isSet(p.skill)).length;
    assert.ok(n <= SET_MAX, `at most ${SET_MAX} set items in any ${SET_WINDOW} (window at ${start} had ${n})`);
    assert.ok(n >= SET_MIN, `and at least ${SET_MIN}, the chapter's own deck being due (window at ${start} had ${n})`);
  }
  // Chapter VII has one skill and four sets: the window cannot hold there, and the session is the chapter's
  // material rather than a rule kept by leaving items out — buildSession's own fallback, named here so it is not a surprise.
  const seven = chapterPool(material7(), { state: () => null, drillable: () => true });
  const thin = buildSession({ states: states(material7().members.map((s) => s.id)), skills: seven.map, size: 10, seed: 5, now: NOW });
  assert.ok(thin.filter((p) => !!seven.map.get(p.skill)?.set).length > SET_MAX);
});

test('a chapter with nothing drillable: no pool, no session, and the row says so quietly', () => {
  const m = material7();
  const pool = chapterPool(m, { state: () => null, drillable: () => false });
  assert.equal(pool.map.size, 0);
  assert.deepEqual(pool.rotation, []);
  assert.deepEqual(pool.addable, [], 'nothing to add: the panel offers reading, not a session');
  assert.deepEqual(buildSession({ states: states(m.members.map((s) => s.id)), skills: pool.map, size: 10, seed: 3, now: NOW }), [], 'no plan at all');
  const p = chapterProgress(m, { state: () => null, drillable: () => false });
  assert.equal(p.drillable, 0);
  assert.equal(p.total, m.members.length, 'the skills are still counted and still readable');
});

test('a lapsed member may be practised; a mastered one still counts as in rotation', () => {
  const m = material7();
  const ids = m.members.map((s) => s.id);
  const st = states(ids.slice(0, 3));
  // Long overdue → lapsed after decay; the pool keeps it (the one-skill rule: it is asked for on purpose).
  st.set(ids[0], { ...st.get(ids[0]), state: 'lapsed' });
  st.set(ids[1], { ...applyAnswer(st.get(ids[1]), { correct: true, now: NOW }), state: 'mastered' });
  const pool = chapterPool(m, { state: stateOf(st), drillable: () => true });
  assert.ok(pool.rotation.includes(ids[0]) && pool.lapsed.includes(ids[0]));
  assert.ok(pool.rotation.includes(ids[1]));
  assert.ok(!pool.addable.includes(ids[0]), 'a lapsed row is not "new"');
});

test('the remembered view is one of the two, and anything else reads as the map we had', () => {
  assert.equal(normaliseView('chapter'), 'chapter');
  assert.equal(normaliseView('topic'), 'topic');
  assert.equal(normaliseView(undefined), 'topic');
  assert.equal(normaliseView(null), 'topic');
  assert.equal(normaliseView('nonsense'), 'topic');
});
