// node --test tests/ — the Colloquia Personarum shelf (GRAMMAR-CONTRACT.md
// "Wave 3 · Colloquia shelf": colloquia I–XXIV as library weeks n = 200 +
// colloquium, ids c01–c24). Everything the review shelf gets, the colloquia
// get too: a `c` unit id reads as its week, the label is "Colloquium VII" and
// never "Week 207", the weeks menu files them under their own heading, and
// they stay out of the 103 pace exactly as the review shelf does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOfUnit, isShelfWeek, isReviewWeek, isColloquiaWeek, shelfKind, shelfChapter, SHELF_BASE, COLLO_BASE, progressByWeek, makeProgressRows } from '../app/js/sync.js';
import { weekNumberLabel, weekPhrase, weekTitleLabel, groupWeeks, SHELF_GROUPS, studyLog, paceRate } from '../app/js/settings.js';
import { chapterOfWeek } from '../app/js/grammar/sets.js';

const MIN = 60 * 1000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 8, 5, 15);

test('weekOfUnit reads a colloquium id: c07 → 207, and a progress row carries it', () => {
  assert.equal(weekOfUnit('c07:3.1'), 207);
  assert.equal(weekOfUnit('c01:1.1'), 201);
  assert.equal(weekOfUnit('c24:12.1'), 224);
  assert.equal(weekOfUnit('q07:1.1'), null, 'only w / r / c are library prefixes');
  assert.equal(COLLO_BASE, 200);
  assert.deepEqual([...progressByWeek(new Map([['w01:1.1', 'T'], ['r07:1.1', 'T'], ['c07:1.1', 'T'], ['c07:2.1', 'T']]))], [[1, 1], [107, 1], [207, 2]]);
  assert.equal(makeProgressRows(['c07:1.1'], new Map(), 'T')[0].week_n, 207, 'a colloquium sentence is read under its own week, so a reset of it finds the row');
});

test('shelfKind / shelfChapter tell the two shelves apart; both are shelf weeks, neither is a course week', () => {
  assert.equal(shelfKind(3), null);
  assert.equal(shelfKind(107), 'review');
  assert.equal(shelfKind(207), 'colloquia');
  assert.equal(shelfKind(SHELF_BASE), null, '100 itself is not a shelf week');
  assert.equal(shelfKind(COLLO_BASE), null, 'nor is 200');
  assert.equal(shelfKind('207'), 'colloquia');
  assert.equal(shelfKind(null), null);
  assert.equal(shelfKind(300), null, 'weeks.n stops at 299 (migration 0018)');
  // A colloquium must read as a shelf week wherever the review shelf already does — the pace, the
  // translation toggle, the reader's `data-shelf` and the item generators all branch on this one predicate.
  assert.equal(isShelfWeek(207), true);
  assert.equal(isShelfWeek(14), false);
  assert.equal(isReviewWeek(107), true);
  assert.equal(isReviewWeek(207), false);
  assert.equal(isColloquiaWeek(207), true);
  assert.equal(isColloquiaWeek(107), false);
  assert.equal(shelfChapter(207), 7, 'colloquium VII, not chapter 107');
  assert.equal(shelfChapter(224), 24);
  assert.equal(shelfChapter(107), 7, 'the review shelf is unchanged');
  assert.equal(shelfChapter(3), null);
});

test('labels: "Colloquium VII" — never "Week 207", never "Cap. VII"', () => {
  assert.equal(weekNumberLabel(207), 'Colloquium VII');
  assert.equal(weekNumberLabel(201), 'Colloquium I');
  assert.equal(weekPhrase(207), 'colloquium VII');
  assert.equal(weekTitleLabel(207, 'Mārcus et Iūlia'), 'Colloquium VII · Mārcus et Iūlia');
  assert.equal(weekTitleLabel(207, ''), 'Colloquium VII');
  // The colloquia pipeline names its rows "Colloquium N · <speakers>", so the label must not be doubled.
  assert.equal(weekTitleLabel(207, 'Colloquium VII · Iūlius et Syra'), 'Colloquium VII · Iūlius et Syra');
  assert.equal(weekTitleLabel(207, 'Colloquium VII'), 'Colloquium VII');
  assert.equal(weekTitleLabel(107, 'Cap. VII · Puella et Rosa'), 'Cap. VII · Puella et Rosa');
  assert.equal(weekTitleLabel(2, 'Week 2 · Daedalus'), 'Week 2 · Daedalus');
  assert.equal(weekTitleLabel(207, 'Colloquia Personarum'), 'Colloquium VII · Colloquia Personarum', 'only its own label is absorbed');
  for (const n of [201, 207, 224]) {
    for (const s of [weekNumberLabel(n), weekPhrase(n), weekTitleLabel(n, 'T')]) assert.doesNotMatch(s, /[Ww]eek/, `${s} must not name a week number`);
  }
  // The review shelf keeps its own wording.
  assert.equal(weekNumberLabel(107), 'Cap. VII');
  assert.equal(weekPhrase(107), 'chapter VII');
});

test('groupWeeks: course, review shelf and colloquia are three lists, each in chapter order', () => {
  const outline = [{ n: 1, title: 'One' }, { n: 2, title: 'Two' }];
  const weeks = [
    { n: 207, title: 'Iūlius et Syra' }, { n: 1, title: 'One (lib)' },
    { n: 101, title: 'Imperium Rōmānum' }, { n: 201, title: 'Mārcus et Iūlia' }, { n: 107, title: 'Puella et Rosa' },
  ];
  const g = groupWeeks(outline, weeks);
  assert.deepEqual(g.course.map((e) => e.n), [1, 2]);
  assert.deepEqual(g.shelf.map((e) => [e.n, e.chapter, e.numeral, e.kind]), [[101, 1, 'I', 'review'], [107, 7, 'VII', 'review']]);
  assert.deepEqual(g.collo.map((e) => [e.n, e.chapter, e.numeral, e.kind]), [[201, 1, 'I', 'colloquia'], [207, 7, 'VII', 'colloquia']]);
  assert.equal(g.collo[0].outline, null);
  // A colloquium in course.json is still not a course week.
  assert.deepEqual(groupWeeks([{ n: 207 }], weeks).course.map((e) => e.n), [1]);
  assert.deepEqual(groupWeeks(null, null), { course: [], shelf: [], collo: [] });
});

test('SHELF_GROUPS: the menu headings, their settings flags and their list ids', () => {
  assert.deepEqual(SHELF_GROUPS.map((g) => [g.key, g.kind, g.setting, g.name, g.unit, g.plural]), [
    ['shelf', 'review', 'shelfOpen', 'Review shelf · Familia Romana I–XXIV', 'chapter', 'chapters'],
    ['collo', 'colloquia', 'colloOpen', 'Colloquia Personarum I–XXIV', 'colloquium', 'colloquia'],
  ]);
  assert.equal(SHELF_GROUPS[1].plural, 'colloquia', "the menu counts 'colloquia', never 'colloquiums'");
  assert.equal(new Set(SHELF_GROUPS.map((g) => g.id)).size, SHELF_GROUPS.length, 'each disclosure controls its own list');
  assert.equal(new Set(SHELF_GROUPS.map((g) => g.setting)).size, SHELF_GROUPS.length, 'each remembers its own open state');
});

test('a colloquium sits outside the 103 pace, exactly as a review chapter does', () => {
  const progress = new Map([
    ['w01:1.1', at(2026, 9, 5, 10)], ['w01:2.1', at(2026, 9, 5, 10)],       // 2 course sentences today
    ['c07:1.1', at(2026, 9, 5, 11)], ['c07:2.1', at(2026, 9, 5, 11)],       // 2 colloquium turns today
    ['r07:1.1', at(2026, 9, 5, 11)],                                        // 1 review chapter sentence
  ]);
  const studyDays = new Map([['2026-09-05', 30 * MIN]]);
  const log = studyLog({ progress, studyDays, now: NOW });
  assert.equal(log.today.sentences, 5, 'every sentence read counts in the day');
  assert.equal(log.today.pace, 4, "the day's pace is the course reading's: 2 in 30 min");
  assert.deepEqual(log.weeks.map((w) => w.n), [1], 'the per-week table is the course weeks only');
  assert.equal(log.pace.sentences, 2);
  assert.equal(log.overall.pace, paceRate(2, 30 * MIN));
  // A colloquium-only day has no course pace at all.
  const alone = studyLog({ progress: new Map([['c07:1.1', at(2026, 9, 4, 11)]]), studyDays: new Map([['2026-09-04', 10 * MIN]]), now: NOW });
  assert.equal(alone.days[12].sentences, 1);
  assert.equal(alone.days[12].pace, null);
});

test('chapterOfWeek: colloquium N accompanies Familia Romana chapter N', () => {
  assert.equal(chapterOfWeek({ n: 207 }), 7, 'so the colloquium reads with chapter VII\'s questions and vocabulary');
  assert.equal(chapterOfWeek({ n: 107 }), 7);
  assert.equal(chapterOfWeek({ n: 3, chapter: 'XXVII' }), 27, 'a course week still names its chapter in roman');
  assert.equal(chapterOfWeek(null), null);
});

test('fixture store: two colloquia (201, 207) of speaker turns, Latin only, no line numbers', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async (url) => (String(url).endsWith('/weeks.json') ? { ok: true, json: async () => [] } : { ok: false, status: 404, json: async () => { throw new Error('404'); } });
  globalThis.location ??= { search: '' };
  const { store } = await import('../app/js/store-fixture.js');
  await store.ready().catch(() => {});
  const weeks = await store.getWeeks();
  const collo = weeks.filter((w) => isColloquiaWeek(w.n));
  assert.deepEqual(collo.map((w) => [w.n, w.id, w.source, w.has_line_numbers, w.unit_count]), [[201, 'c01', 'CP', false, 12], [207, 'c07', 'CP', false, 12]]);
  const units = await store.getUnits(207);
  assert.equal(units.length, 12);
  assert.ok(units.every((u) => /^c07:\d+\.1$/.test(u.id) && u.la && u.en === '' && u.week_n === 207), 'Latin only, filed under week 207');
  assert.ok(units.every((u) => u.unit_type === 'speech' && u.speaker && u.line_no == null && u.lines.length === 0 && u.margin.length === 0), 'speaker turns, no line numbers, no marginal glosses');
  assert.deepEqual(await store.getHighlights(207), []);
  assert.deepEqual(await store.getPictures(207), []);
  assert.deepEqual(await store.getAlignment(207), []);
  assert.equal(await store.getAudioUrl(207), null);
  assert.deepEqual(await store.getUnits(212), [], 'a colloquium the fixture does not carry is empty, not an error');
});
