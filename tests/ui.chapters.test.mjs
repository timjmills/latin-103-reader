// node --test tests/ — the chapter spine (GRAMMAR-CONTRACT.md "Chapter spine —
// navigation by chapter"): app/js/chapters.js is the single source of truth for
// the chapter → week mapping, and nothing else in the app may hard-code it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chapters, chapter, readingsOf, chapterOfWeek, weekChapters, readingPrefix, inReading,
  readingsMeta, parseChapterRoute, chapterHash, CHAPTER_MAX, SHELF_CHAPTER_MAX, SOURCE_NAMES,
} from '../app/js/chapters.js';
import { SHELF_BASE, COLLO_BASE, roman } from '../app/js/sync.js';

test('thirty-four chapters, in order, each with a numeral, a Latin title and readings', () => {
  const list = chapters();
  assert.equal(list.length, 34);
  assert.equal(CHAPTER_MAX, 34);
  assert.deepEqual(list.map((c) => c.n), Array.from({ length: 34 }, (_, i) => i + 1));
  for (const c of list) {
    assert.equal(c.roman, roman(c.n));
    assert.ok(c.title && typeof c.title === 'string', `chapter ${c.n} has a title`);
    assert.ok(c.readings.length > 0, `chapter ${c.n} has at least one reading`);
    for (const r of c.readings) {
      assert.ok(['fr', 'collo', 'fs', 'fl'].includes(r.kind), `${r.id}: kind is fr|collo|fs|fl`);
      assert.ok(Number.isInteger(r.week_n) && r.week_n > 0, `${r.id}: a week number`);
      assert.ok(r.label, `${r.id}: a label`);
      assert.ok(r.part === null || typeof r.part === 'string');
    }
    assert.deepEqual(c.weeks, [...new Set(c.readings.map((r) => r.week_n))]);
  }
  assert.equal(chapter(7).title, 'Puella et Rosa');
  assert.equal(chapter(1).title, 'Imperium Rōmānum');
  assert.equal(chapter(34).roman, 'XXXIV');
  assert.equal(chapter(0), null);
  assert.equal(chapter(35), null);
  assert.equal(chapter('7'), chapter(7));
  assert.deepEqual(readingsOf(99), []);
});

test('chapters I–XXIV take the review shelf and the colloquium; the labels are the book\'s', () => {
  assert.equal(SHELF_CHAPTER_MAX, 24);
  for (let n = 1; n <= 24; n++) {
    assert.deepEqual(readingsOf(n).map((r) => [r.kind, r.week_n, r.part]), [
      ['fr', SHELF_BASE + n, null],
      ['collo', COLLO_BASE + n, null],
    ], `chapter ${n}`);
  }
  const seven = readingsOf(7);
  assert.deepEqual(seven.map((r) => [r.id, r.label]), [['r07', SOURCE_NAMES.fr], ['c07', 'Colloquium VII']]);
  assert.ok(!seven.some((r) => /Week /.test(r.label)), 'a shelf reading is never labelled by its week number');
});

test('the fixed chapter → week mapping for XXV–XXXIV', () => {
  const primary = (n) => readingsOf(n).filter((r) => !r.supplement).map((r) => r.week_n);
  assert.deepEqual(primary(25), [1]);
  assert.deepEqual(primary(26), [2]);
  assert.deepEqual(primary(27), [4]);
  assert.deepEqual(primary(28), [6]);
  assert.deepEqual(primary(29), [7]);
  assert.deepEqual(primary(30), [8]);
  assert.deepEqual(primary(31), [9]);
  assert.deepEqual(primary(32), [11]);
  assert.deepEqual(primary(33), [12]);
  assert.deepEqual(primary(34), [13, 14], 'chapter XXXIV spans two weeks');
  assert.deepEqual(chapter(34).weeks, [13, 14]);
});

test('the supplement weeks attach to 27, 28 and 32, each part its own reading', () => {
  const supp = (n) => readingsOf(n).filter((r) => r.supplement);
  assert.deepEqual([...new Set(supp(27).map((r) => r.week_n))], [3]);
  assert.deepEqual([...new Set(supp(28).map((r) => r.week_n))], [5]);
  assert.deepEqual([...new Set(supp(32).map((r) => r.week_n))], [10]);
  assert.deepEqual(supp(27).map((r) => [r.kind, r.part, r.label]), [
    ['fs', 'minos', 'Mīnōs'], ['fs', 'coronis', 'Corōnis'],
    ['fl', 'fl-63', 'Fabella LXIII'], ['fl', 'fl-64', 'Fabella LXIV'], ['fl', 'fl-65', 'Fabella LXV'],
  ]);
  assert.deepEqual(supp(28).map((r) => r.part), ['coriolanus', 'nausicaa', 'fl-66', 'fl-67', 'fl-68']);
  assert.deepEqual(supp(32).map((r) => r.part), ['arachne', 'fl-69', 'fl-70', 'fl-71', 'fl-72', 'fl-73', 'fl-74']);
  // Nowhere else: the ten other chapters with a course week have no supplement.
  for (const n of [25, 26, 29, 30, 31, 33, 34]) assert.deepEqual(supp(n), [], `chapter ${n} has no supplement`);
  // The chapter's own week comes first, so "open the chapter" opens Familia Romana.
  assert.equal(readingsOf(27)[0].kind, 'fr');
  assert.equal(readingsOf(32)[0].week_n, 11);
});

test('no week is orphaned: all fourteen course weeks and both shelves are reachable exactly once', () => {
  const seen = new Map();
  for (const c of chapters()) for (const r of c.readings) {
    const key = r.id;
    assert.ok(!seen.has(key), `${key} appears twice (chapters ${seen.get(key)} and ${c.n})`);
    seen.set(key, c.n);
  }
  const weeks = new Set(chapters().flatMap((c) => c.weeks));
  for (let w = 1; w <= 14; w++) assert.ok(weeks.has(w), `course week ${w} is on the spine`);
  for (let n = 1; n <= 24; n++) {
    assert.ok(weeks.has(SHELF_BASE + n), `review chapter ${n} is on the spine`);
    assert.ok(weeks.has(COLLO_BASE + n), `colloquium ${n} is on the spine`);
  }
  assert.equal(weeks.size, 14 + 24 + 24);
  // Each week belongs to exactly one chapter (weekChapters is that reverse map).
  const map = weekChapters();
  assert.equal(map.size, weeks.size);
  assert.equal(map.get(3), 27, 'the supplement week is filed under the chapter it reads');
  assert.equal(map.get(4), 27);
  assert.equal(map.get(14), 34);
  assert.equal(chapterOfWeek(107), 7);
  assert.equal(chapterOfWeek(207), 7);
  assert.equal(chapterOfWeek(1), 25);
  assert.equal(chapterOfWeek(10), 32);
  assert.equal(chapterOfWeek(999), null);
  assert.equal(chapterOfWeek(null), null);
});

test('a reading names the sentences it owns: a whole week, or one part of a multi-text week', () => {
  assert.equal(readingPrefix(readingsOf(7)[0]), 'r07:');
  assert.equal(readingPrefix(readingsOf(7)[1]), 'c07:');
  assert.equal(readingPrefix(readingsOf(25)[0]), 'w01:');
  const minos = readingsOf(27).find((r) => r.part === 'minos');
  assert.equal(readingPrefix(minos), 'w03:minos:');
  assert.ok(inReading('w03:minos:1.1', minos));
  assert.ok(!inReading('w03:coronis:1.1', minos), 'a sibling part is a different reading');
  assert.ok(!inReading('w03:1.1', minos));
  assert.ok(inReading('r07:12.1', readingsOf(7)[0]));
  assert.ok(!inReading('r17:12.1', readingsOf(7)[0]), 'r07: never matches r17:');
  assert.equal(readingPrefix(null), '');
  assert.equal(inReading(null, readingsOf(7)[0]), false);
});

test('the grammar ids a chapter needs are the wave-2 set skill ids', () => {
  assert.deepEqual(chapter(7).grammar, {
    chapter: 7, questions: 'questions-07', vocab: 'vocab-07', vocabRev: 'vocab-07-rev', pensum: 'pensum-07',
    sets: ['questions-07', 'vocab-07', 'vocab-07-rev', 'pensum-07'],
  });
  assert.equal(chapter(34).grammar.questions, 'questions-34');
  assert.equal(chapter(1).grammar.pensum, 'pensum-01');
});

test('readingsMeta: the first names, then "+N more"', () => {
  assert.equal(readingsMeta(readingsOf(7)), 'Familia Rōmāna · Colloquium VII');
  assert.equal(readingsMeta(readingsOf(25)), 'Familia Rōmāna');
  assert.equal(readingsMeta(readingsOf(27)), 'Familia Rōmāna · Mīnōs · +4 more');
  assert.equal(readingsMeta(readingsOf(27), { max: 6 }), 'Familia Rōmāna · Mīnōs · Corōnis · Fabella LXIII · Fabella LXIV · Fabella LXV');
  assert.equal(readingsMeta([]), '');
  assert.equal(readingsMeta(null), '');
});

test('deep links: #/chapter/7 and #/chapter/7/grammar, and nothing else', () => {
  assert.deepEqual(parseChapterRoute('#/chapter/7'), { n: 7, tab: 'reading' });
  assert.deepEqual(parseChapterRoute('#/chapter/7/grammar'), { n: 7, tab: 'grammar' });
  assert.deepEqual(parseChapterRoute('#/chapter/7/reading'), { n: 7, tab: 'reading' });
  assert.deepEqual(parseChapterRoute('/chapter/34'), { n: 34, tab: 'reading' }, 'a hash-less route reads the same');
  assert.deepEqual(parseChapterRoute('#/chapter/7/'), { n: 7, tab: 'reading' });
  assert.equal(parseChapterRoute('#/chapter/35'), null, 'there is no chapter XXXV');
  assert.equal(parseChapterRoute('#/chapter/0'), null);
  assert.equal(parseChapterRoute('#/chapter/7/lesson'), null);
  assert.equal(parseChapterRoute('#/chapters'), null);
  assert.equal(parseChapterRoute(''), null);
  assert.equal(parseChapterRoute(null), null);
  assert.equal(chapterHash(7), '#/chapter/7');
  assert.equal(chapterHash(7, 'grammar'), '#/chapter/7/grammar');
  assert.equal(chapterHash(99), '');
  // Round trip: every chapter's own link parses back to it, in both tabs.
  for (const c of chapters()) for (const tab of ['reading', 'grammar']) {
    assert.deepEqual(parseChapterRoute(chapterHash(c.n, tab)), { n: c.n, tab });
  }
});
