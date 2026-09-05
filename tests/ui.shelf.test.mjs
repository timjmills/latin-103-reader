// node --test tests/ — the review shelf (GRAMMAR-CONTRACT.md "Review shelf":
// Familia Romana I–XXIV as library weeks n = 100 + chapter): the week helpers
// (unit ids, labels), the weeks-menu grouping, the shelf-aware study log
// (shelf sentences count in the day's minutes and reads, never in the pace
// or the per-week table) and the fixture store's shelf weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOfUnit, isShelfWeek, shelfChapter, roman, SHELF_BASE, progressByWeek, makeProgressRows } from '../app/js/sync.js';
import { weekNumberLabel, weekPhrase, weekTitleLabel, groupWeeks, studyLog, timeLeftText, translationDesc, paceRate } from '../app/js/settings.js';

const MIN = 60 * 1000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 8, 5, 15);

test('weekOfUnit: course ids and shelf ids (r07 → 107); progress rows carry the shelf week', () => {
  assert.equal(weekOfUnit('w07:12.3'), 7);
  assert.equal(weekOfUnit('r07:46.1'), 107);
  assert.equal(weekOfUnit('r24:1.1'), 124);
  assert.equal(weekOfUnit('x07:1.1'), null);
  assert.equal(SHELF_BASE, 100);
  assert.deepEqual([...progressByWeek(new Map([['w01:1.1', 'T'], ['r07:1.1', 'T'], ['r07:2.1', 'T']]))], [[1, 1], [107, 2]]);
  const rows = makeProgressRows(['r07:1.1'], new Map(), 'T');
  assert.equal(rows[0].week_n, 107, 'a shelf sentence is read under its chapter\'s week, so a reset of that chapter finds it');
});

test('isShelfWeek / shelfChapter / roman', () => {
  assert.equal(isShelfWeek(107), true);
  assert.equal(isShelfWeek(14), false);
  assert.equal(isShelfWeek(100), false);
  assert.equal(isShelfWeek('107'), true);
  assert.equal(isShelfWeek(null), false);
  assert.equal(shelfChapter(107), 7);
  assert.equal(shelfChapter(124), 24);
  assert.equal(shelfChapter(3), null);
  assert.equal(roman(7), 'VII');
  assert.equal(roman(24), 'XXIV');
  assert.equal(roman(0), '—');
});

test('week labels: "Week 3" for the course, "Cap. VII" for the shelf — never "Week 107"', () => {
  assert.equal(weekNumberLabel(3), 'Week 3');
  assert.equal(weekNumberLabel(107), 'Cap. VII');
  assert.equal(weekPhrase(3), 'week 3');
  assert.equal(weekPhrase(107), 'chapter VII');
  assert.equal(weekTitleLabel(2, 'Daedalus et Īcarus'), 'Week 2 · Daedalus et Īcarus');
  assert.equal(weekTitleLabel(107, 'Puella et Rosa'), 'Cap. VII · Puella et Rosa');
  assert.equal(weekTitleLabel(107, ''), 'Cap. VII');
  assert.equal(translationDesc(true), 'English under each sentence');
  assert.match(translationDesc(false), /Latin only/);
});

test('groupWeeks: the outline\'s course weeks (with their library rows), then the shelf in chapter order', () => {
  const outline = [{ n: 1, title: 'One', reading: 'FR XXV' }, { n: 2, title: 'Two' }, { n: 3, title: 'Three' }];
  const weeks = [{ n: 107, title: 'Puella et Rosa', focus: { label: 'Dative' } }, { n: 1, title: 'One (lib)' }, { n: 101, title: 'Imperium Rōmānum' }, { n: 3, title: 'Three' }];
  const g = groupWeeks(outline, weeks);
  assert.deepEqual(g.course.map((e) => [e.n, e.lib?.title ?? null, e.outline.title]), [[1, 'One (lib)', 'One'], [2, null, 'Two'], [3, 'Three', 'Three']]);
  assert.deepEqual(g.shelf.map((e) => [e.n, e.chapter, e.numeral, e.lib.title]), [[101, 1, 'I', 'Imperium Rōmānum'], [107, 7, 'VII', 'Puella et Rosa']]);
  assert.equal(g.shelf[1].outline, null);
  // No outline (course.json missing): the library's own course weeks stand in; shelf rows in the outline are ignored.
  const g2 = groupWeeks([], weeks);
  assert.deepEqual(g2.course.map((e) => e.n), [1, 3]);
  assert.deepEqual(groupWeeks([{ n: 107 }], weeks).course.map((e) => e.n), [1, 3]);
  assert.deepEqual(groupWeeks(null, null), { course: [], shelf: [] });
});

test('studyLog with the shelf: minutes and reads per day include a chapter; the pace and the per-week table do not', () => {
  const progress = new Map([
    ['w01:1.1', at(2026, 9, 5, 10)], ['w01:2.1', at(2026, 9, 5, 10)],                      // 2 course sentences today
    ['r07:1.1', at(2026, 9, 5, 11)], ['r07:2.1', at(2026, 9, 5, 11)], ['r07:3.1', at(2026, 9, 5, 11)], ['r07:4.1', at(2026, 9, 5, 11)],   // 4 shelf sentences today
    ['r07:5.1', at(2026, 9, 4, 11)],                                                         // a shelf-only day yesterday
  ]);
  const studyDays = new Map([['2026-09-05', 30 * MIN], ['2026-09-04', 10 * MIN]]);
  const log = studyLog({ progress, studyDays, now: NOW });
  assert.equal(log.today.sentences, 6, 'every sentence read counts in the day');
  assert.equal(log.today.ms, 30 * MIN);
  assert.equal(log.today.pace, 4, 'the day\'s pace is the course reading\'s: 2 in 30 min');
  assert.equal(log.days[12].sentences, 1, 'yesterday\'s shelf sentence is in the table…');
  assert.equal(log.days[12].pace, null, '…but there is no course pace for a shelf-only day');
  assert.deepEqual(log.weeks.map((w) => w.n), [1], 'the per-week table is the 14 course weeks only');
  assert.equal(Math.round(log.weeks[0].ms / MIN), 10, 'week 1 gets its share of today\'s minutes (2 of 6 sentences)');
  assert.equal(log.pace.basis, 'recent');
  assert.equal(log.pace.perHour, 4, 'pace = course sentences ÷ the reading days\' minutes: 2 in 30 min (the shelf-only day has no first course reads)');
  assert.equal(log.pace.sentences, 2);
  assert.equal(log.overall.sentences, 7, 'overall keeps every sentence…');
  assert.equal(log.overall.ms, 40 * MIN);
  assert.equal(log.overall.pace, paceRate(2, 40 * MIN), '…and its pace is the course\'s over every minute');
  // Without the shelf nothing changes against the plain study log.
  const plain = new Map([...progress].filter(([id]) => id.startsWith('w')));
  const base = studyLog({ progress: plain, studyDays, now: NOW });
  assert.deepEqual(base.pace, log.pace);
  assert.deepEqual(base.weeks.map((w) => [w.n, w.sentences]), log.weeks.map((w) => [w.n, w.sentences]));
  assert.equal(Math.round(base.weeks[0].ms / MIN), 30, "alone, week 1 would take all of today's minutes; beside the shelf it takes its share");
  // Time left for a course week uses that pace; the caller shows none for a shelf chapter.
  assert.equal(timeLeftText(2, log.pace), 'about 30 min left');
});

test('fixture store: two shelf weeks (101, 107), a dozen Latin-only units each, nothing else to load', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  // The dev server's data/build is not here: weeks.json is an empty course, every other file a 404 — the shelf must need none of them.
  globalThis.fetch = async (url) => (String(url).endsWith('/weeks.json') ? { ok: true, json: async () => [] } : { ok: false, status: 404, json: async () => { throw new Error('404'); } });
  globalThis.location ??= { search: '' };
  const { store } = await import('../app/js/store-fixture.js');
  await store.ready().catch(() => {});
  const weeks = await store.getWeeks();
  const shelf = weeks.filter((w) => isShelfWeek(w.n));
  assert.deepEqual(shelf.map((w) => [w.n, w.id, w.chapter, w.has_line_numbers, w.unit_count]), [[101, 'r01', 'I', true, 12], [107, 'r07', 'VII', true, 12]]);
  assert.ok(shelf.every((w) => w.title && w.focus?.label && w.parts?.length === 1));
  assert.deepEqual(weeks.map((w) => w.n).slice(-2), [101, 107], 'the shelf comes after the course weeks');
  const units = await store.getUnits(107);
  assert.equal(units.length, 12);
  assert.ok(units.every((u) => /^r07:\d+\.1$/.test(u.id) && u.la && u.en === '' && u.week_n === 107 && Array.isArray(u.lines) && u.lines.length === 1 && u.margin.length === 0 && u.note == null));
  assert.equal(units.filter((u) => u.block_start).length, 4);
  assert.deepEqual(await store.getHighlights(107), []);
  assert.deepEqual(await store.getPictures(107), []);
  assert.deepEqual(await store.getAlignment(107), []);
  assert.equal(await store.getAudioUrl(107), null);
  assert.deepEqual(await store.getUnits(112), [], 'a shelf chapter the fixture does not carry is empty, not an error');
});
