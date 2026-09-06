// node --test tests/ — the row models behind the Chapters tab and the chapter
// page (GRAMMAR-CONTRACT.md "Chapter spine"): grouping, progress per reading,
// the audio mark and the remembered tab. Pure; settings.js holds them beside
// groupWeeks so the menu paints one shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterRows, chapterMeta, readingRows, readingWhere, menuTab, MENU_TABS, groupWeeks } from '../app/js/settings.js';
import { readingsOf } from '../app/js/chapters.js';

const units = (prefix, n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${from + i}.1`, order: i }));

test('the menu remembers its tab and opens on Chapters', () => {
  assert.deepEqual(MENU_TABS, ['chapters', 'weeks']);
  assert.equal(menuTab(undefined), 'chapters', 'the book\'s spine is the way in');
  assert.equal(menuTab({}), 'chapters');
  assert.equal(menuTab({ menuTab: 'weeks' }), 'weeks');
  assert.equal(menuTab({ menuTab: 'nonsense' }), 'chapters');
});

test('chapterRows: I–XXXIV in order, each with its readings, its progress and its audio mark', () => {
  const library = new Set([107, 207, 1, 3, 4]);
  const totals = new Map([[107, 12], [207, 12], [1, 100], [3, 82], [4, 90]]);
  const read = new Map([[107, 6], [207, 12], [1, 100], [3, 10]]);
  const audio = new Set([1, 107]);
  const rows = chapterRows({ library, totals, read, audio });
  assert.equal(rows.length, 34);
  assert.deepEqual(rows.map((r) => r.n).slice(0, 3), [1, 2, 3]);

  const seven = rows[6];
  assert.equal(seven.roman, 'VII');
  assert.equal(seven.title, 'Puella et Rosa');
  assert.equal(seven.meta, 'Familia Rōmāna · Colloquium VII');
  assert.equal(seven.total, 24, 'the chapter and its colloquium together');
  assert.equal(seven.read, 18);
  assert.equal(seven.audio, true);
  assert.equal(seven.inLibrary, true);

  // A chapter with nothing in the library still has its numeral and title, and says so.
  const two = rows[1];
  assert.equal(two.inLibrary, false);
  assert.equal(two.total, 0);
  assert.equal(two.meta, '');
  assert.equal(two.audio, false);

  // Chapter XXVII: week 4 plus week 3's five stories — the supplement week is counted once, not five times.
  const c27 = rows[26];
  assert.deepEqual(c27.weeks, [4, 3]);
  assert.equal(c27.total, 90 + 82);
  assert.equal(c27.read, 10);
  assert.equal(c27.meta, 'Week 4 · Mīnōs · +4 more', 'a course chapter names its week first: that is where the pace knows it');
  assert.equal(c27.audio, false);

  // Chapter XXV: one course week, fully read.
  assert.equal(rows[24].read, 100);
  assert.equal(rows[24].total, 100);
  assert.equal(rows[24].audio, true);

  // Half the library missing: a chapter shows only what is there.
  const partial = chapterRows({ library: new Set([107]), totals, read });
  assert.equal(partial[6].meta, 'Familia Rōmāna');
  assert.equal(rows[24].meta, 'Week 1');
  assert.equal(chapterMeta(readingsOf(34)), 'Weeks 13 and 14', 'chapter XXXIV spans two weeks and says so');
  assert.equal(chapterMeta(readingsOf(7)), 'Familia Rōmāna · Colloquium VII', 'a shelf chapter is named by its readings');
  assert.equal(chapterMeta([]), '');
  assert.equal(partial[6].total, 12);
  // No library given at all: every reading counts (the menu before the weeks are known).
  assert.equal(chapterRows({}).length, 34);
  assert.equal(chapterRows({})[6].inLibrary, true);
  // A read count beyond the total is clamped, never over 100%.
  assert.equal(chapterRows({ library: new Set([107]), totals, read: new Map([[107, 99]]) })[6].read, 12);
});

test('readingWhere says which part of the library a reading lives in', () => {
  const [fr, collo] = readingsOf(7);
  assert.equal(readingWhere(fr), 'Review shelf');
  assert.equal(readingWhere(collo), 'Colloquia Persōnārum');
  assert.equal(readingWhere(readingsOf(27)[0], 'Rēs Rūsticae'), 'Week 4 · Rēs Rūsticae');
  assert.equal(readingWhere(readingsOf(27)[0]), 'Week 4');
  assert.equal(readingWhere(readingsOf(27).find((r) => r.part === 'minos')), 'Week 3 · Fabulae Syrae');
  assert.equal(readingWhere(readingsOf(27).find((r) => r.part === 'fl-63')), 'Week 3 · Fabellae Latīnae');
  assert.equal(readingWhere(null), '');
  // Never "Week 107" (GRAMMAR-CONTRACT.md).
  for (const r of readingsOf(7)) assert.ok(!/Week 1\d\d|Week 2\d\d/.test(readingWhere(r)));
});

test('readingRows: progress per reading, the part split, Continue and the audio mark', () => {
  const w03 = [...units('w03:minos:', 4), ...units('w03:coronis:', 3), ...units('w03:fl-63:', 2), ...units('w03:fl-64:', 2), ...units('w03:fl-65:', 2)];
  const rows = readingRows(27, {
    library: new Set([4, 3]),
    units: new Map([[3, w03]]),
    totals: new Map([[4, 90]]),
    titles: new Map([[4, 'Rēs Rūsticae'], [3, 'Mīnōs · Corōnis']]),
    progress: new Map([['w03:minos:1.1', 'T'], ['w03:minos:2.1', 'T'], ['w03:coronis:1.1', 'T'], ['w03:coronis:2.1', 'T'], ['w03:coronis:3.1', 'T']]),
    audio: new Map([[3, new Set(['w03:minos:1.1'])]]),
  });
  assert.equal(rows.length, 6, 'the chapter\'s own week and week 3\'s five stories');
  const [fr, minos, coronis, fl63] = rows;

  assert.equal(fr.label, 'Familia Rōmāna');
  assert.equal(fr.where, 'Week 4 · Rēs Rūsticae');
  assert.equal(fr.total, 90, 'a week whose units are not loaded falls back to its sentence count');
  assert.equal(fr.read, 0);
  assert.equal(fr.firstId, null);
  assert.equal(fr.firstUnread, null);
  assert.equal(fr.audio, false);

  assert.equal(minos.label, 'Mīnōs');
  assert.equal(minos.total, 4, 'only its own part\'s sentences');
  assert.equal(minos.read, 2);
  assert.equal(minos.firstId, 'w03:minos:1.1');
  assert.equal(minos.firstUnread, 'w03:minos:3.1', 'Continue goes to the first sentence not yet read');
  assert.equal(minos.audio, true, 'one aligned sentence is enough to mark the story');

  assert.equal(coronis.read, 3);
  assert.equal(coronis.total, 3);
  assert.equal(coronis.firstUnread, null, 'a finished reading offers no Continue');
  assert.equal(coronis.audio, false, 'the alignment covers Mīnōs only');

  assert.equal(fl63.read, 0);
  assert.equal(fl63.firstUnread, null, 'an untouched reading is opened, not continued');
  assert.equal(fl63.firstId, 'w03:fl-63:1.1');

  // Chapter VII: the shelf chapter and its colloquium, each with its own figures.
  const seven = readingRows(7, {
    library: new Set([107, 207]),
    units: new Map([[107, units('r07:', 12)], [207, units('c07:', 12)]]),
    progress: new Map(units('r07:', 5).map((u) => [u.id, 'T'])),
    audio: new Set([107]),
  });
  assert.deepEqual(seven.map((r) => [r.label, r.read, r.total, r.audio]), [
    ['Familia Rōmāna', 5, 12, true],
    ['Colloquium VII', 0, 12, false],
  ]);
  assert.equal(seven[0].firstUnread, 'r07:6.1');

  // A reading the library has not got: named, but marked absent and empty.
  const absent = readingRows(7, { library: new Set([107]), units: new Map([[107, units('r07:', 12)]]) });
  assert.equal(absent[1].inLibrary, false);
  assert.equal(absent[1].total, 0);
  assert.deepEqual(readingRows(99, {}), []);
});

test('My weeks is unchanged: groupWeeks still returns the three lists the menu paints', () => {
  const g = groupWeeks([{ n: 1, title: 'One' }], [{ n: 1, title: 'One' }, { n: 107, title: 'Puella et Rosa' }, { n: 207, title: 'Iūlius et Syra' }]);
  assert.deepEqual(g.course.map((e) => e.n), [1]);
  assert.deepEqual(g.shelf.map((e) => e.n), [107]);
  assert.deepEqual(g.collo.map((e) => e.n), [207]);
});

test('the fixture has all three chapter shapes offline: two readings, a supplement, and neither', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  // No data/build at all: weeks.json and every week file are 404s.
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new Error('404'); } });
  globalThis.location ??= { search: '' };
  const { store } = await import('../app/js/store-fixture.js');
  await store.ready();
  const weeks = await store.getWeeks();
  const library = new Set(weeks.map((w) => w.n));
  assert.ok(library.has(4) && library.has(3), 'two course weeks stand in for chapter XXVII');

  const totals = new Map(weeks.map((w) => [w.n, w.unit_count ?? 0]));
  const rows = chapterRows({ library, totals, read: new Map(), audio: new Set() });
  assert.equal(rows[6].meta, 'Familia Rōmāna · Colloquium VII', 'chapter VII: two readings');
  assert.ok(rows[26].meta.startsWith('Week 4 · Mīnōs'), 'chapter XXVII: a course week and a supplement story');
  assert.equal(rows[1].inLibrary, false, 'chapter II: neither');

  // The supplement week's units carry their part slug, so each story is its own reading.
  const units = new Map([[3, await store.getUnits(3)], [4, await store.getUnits(4)]]);
  const reads = readingRows(27, { library, units, totals, titles: new Map(weeks.map((w) => [w.n, w.title])), progress: new Map() });
  assert.deepEqual(reads.map((r) => r.label), ['Familia Rōmāna', 'Mīnōs', 'Corōnis', 'Fabella LXIII', 'Fabella LXIV', 'Fabella LXV']);
  assert.equal(reads[0].total, 6);
  assert.equal(reads[1].total, 4, 'Mīnōs has its own sentences');
  assert.equal(reads[3].total, 3, 'and so does the Fabella');
  assert.equal(reads[4].inLibrary, true);
  assert.equal(reads[4].total, 0, 'a story the fixture does not carry is empty, not an error');
  assert.ok((await store.getUnits(3)).every((u) => /^w03:(minos|coronis|fl-63):/.test(u.id)));
  assert.ok((await store.getUnits(4)).every((u) => u.en), 'a course week keeps its English');
});
