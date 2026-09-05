// node --test tests/ — the study log (CONTRACT.md "Study log" / "Study log
// merge"): the day key, the per-device rows behind `study_days` (max per row,
// summed per day), the ticker's active-time rule, the stats (sentences per
// day, per-week apportioning, pace, time left) and the sparkline geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDay, isDayKey, cleanMs, addStudyMs, mergeStudyDays, studyPending, studyDaysView, coalesceOutbox, studyKey, normaliseStudyRow, cleanDevice, STUDY_KEY_SEP, STUDY_MAIN_DEVICE,
  readsOf as readsOfSync,
} from '../app/js/sync.js';
import {
  sentencesPerDay, sentencesPerDayByWeek, reviewsPerDay, passesByWeek, readAtOf, readsOf, paceRate, paceOf, lastDays, studyLog, todayLineText, timeLeftMs, timeLeftText,
  fmtActive, fmtPace, fmtDay, sparklinePath, sparklineSummary, activeSlice, ROUGH_PACE, PACE_MIN_MS,
} from '../app/js/settings.js';

const MIN = 60 * 1000;
// Local-time instants (the helpers group by the *local* day, so the tests build dates the same way).
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 8, 5, 15);   // Sat 5 Sep 2026, 15:00 local

test('localDay: the local calendar day; bad input → null', () => {
  assert.equal(localDay(new Date(2026, 8, 5, 0, 30)), '2026-09-05');
  assert.equal(localDay(new Date(2026, 8, 5, 23, 59)), '2026-09-05');
  assert.equal(localDay(new Date(2026, 0, 1).getTime()), '2026-01-01');
  assert.equal(localDay('never'), null);
  assert.ok(isDayKey(localDay()));
  assert.equal(isDayKey('2026-9-5'), false);
});

test('studyKey / normaliseStudyRow / cleanDevice: one key per (day, device); a row without a device is the baseline\'s', () => {
  assert.equal(studyKey('2026-09-05', 'phone'), `2026-09-05${STUDY_KEY_SEP}phone`);
  assert.equal(studyKey('2026-09-05'), `2026-09-05${STUDY_KEY_SEP}${STUDY_MAIN_DEVICE}`);
  assert.equal(studyKey('today', 'phone'), null);
  assert.equal(cleanDevice('  '), 'main');
  assert.equal(cleanDevice(`a${STUDY_KEY_SEP}b`), 'main', 'the separator can never be part of a device id');
  assert.deepEqual(normaliseStudyRow({ day: '2026-09-05', device: 'phone', active_ms: '1500.4', updated_at: 'T' }), { key: studyKey('2026-09-05', 'phone'), day: '2026-09-05', device: 'phone', active_ms: 1500, updated_at: 'T' });
  assert.deepEqual(normaliseStudyRow({ day: '2026-09-05', active_ms: 5 }), { key: studyKey('2026-09-05', 'main'), day: '2026-09-05', device: 'main', active_ms: 5, updated_at: null }, 'a v4 cache row / a pre-0012 server row');
  assert.equal(normaliseStudyRow({ day: 'junk', active_ms: 5 }), null);
});

test('addStudyMs: adds to this device\'s row for the day, never negative or fractional', () => {
  const r = addStudyMs(null, '2026-09-05', 15000.4, 'T1', 'phone');
  assert.deepEqual(r, { key: studyKey('2026-09-05', 'phone'), day: '2026-09-05', device: 'phone', active_ms: 15000, updated_at: 'T1' });
  assert.deepEqual(addStudyMs(r, '2026-09-05', -5, 'T2', 'phone'), { ...r, updated_at: 'T2' });
  assert.equal(addStudyMs({ active_ms: 'x' }, '2026-09-05', 100).active_ms, 100);
  assert.equal(addStudyMs(null, '2026-09-05', 100).device, 'main', 'no device named: the baseline row');
  assert.equal(addStudyMs(null, 'today', 100), null);
  assert.equal(cleanMs(NaN), 0);
});

test('mergeStudyDays: per (day, device) row the larger total stands; with an empty outbox missing rows are pruned', () => {
  const k = (day, dev) => studyKey(day, dev);
  const local = new Map([
    [k('2026-09-04', 'laptop'), { key: k('2026-09-04', 'laptop'), day: '2026-09-04', device: 'laptop', active_ms: 90000, updated_at: 'a' }],
    [k('2026-09-01', 'laptop'), { key: k('2026-09-01', 'laptop'), day: '2026-09-01', device: 'laptop', active_ms: 5000 }],
  ]);
  const remote = [
    { day: '2026-09-04', device: 'laptop', active_ms: 60000, updated_at: 'b' },   // our own row, an older total
    { day: '2026-09-04', device: 'phone', active_ms: 30000, updated_at: 'c' },    // the phone's row for the same day
    { day: '2026-09-05', device: 'phone', active_ms: 30000, updated_at: 'c' },
    { day: 'junk', active_ms: 1 },
  ];
  const r = mergeStudyDays(local, remote, []);
  assert.equal(r.skipped, false);
  assert.equal(r.merged.get(k('2026-09-04', 'laptop')).active_ms, 90000, 'the local figure was larger');
  assert.equal(r.merged.get(k('2026-09-04', 'phone')).active_ms, 30000, 'another device\'s row sits beside ours');
  assert.equal(r.merged.get(k('2026-09-05', 'phone')).active_ms, 30000);
  assert.equal(r.merged.has(k('2026-09-01', 'laptop')), false, 'a row the server no longer has goes');
  assert.deepEqual(r.changed, [k('2026-09-04', 'phone'), k('2026-09-05', 'phone')]);
  assert.equal(r.removed, 1);
  assert.equal(local.size, 2, 'the local Map is not mutated');
  assert.deepEqual([...studyDaysView(r.merged)], [['2026-09-04', 120000], ['2026-09-05', 30000]], 'the day is the sum of its devices');
  // A larger remote total replaces the local one for that row only.
  const r2 = mergeStudyDays(local, [{ day: '2026-09-04', device: 'laptop', active_ms: 120000 }, { day: '2026-09-01', device: 'laptop', active_ms: 5000 }], []);
  assert.equal(r2.merged.get(k('2026-09-04', 'laptop')).active_ms, 120000);
  assert.deepEqual(r2.changed, [k('2026-09-04', 'laptop')]);
});

test('mergeStudyDays: a pending study_days op blocks the merge; other pending ops only stop the pruning', () => {
  const local = new Map();   // just cleared locally
  const pending = [{ seq: 1, table: 'study_days', key: 'clear:1', op: 'delete' }];
  const r = mergeStudyDays(local, [{ day: '2026-09-04', active_ms: 60000 }], pending);
  assert.equal(r.skipped, true);
  assert.equal(r.merged, local);
  assert.equal(studyPending(pending), true);
  const other = [{ seq: 2, table: 'lookups', key: 'amo', op: 'upsert' }];
  const k3 = studyKey('2026-09-03', 'laptop');
  const l2 = new Map([[k3, { key: k3, day: '2026-09-03', device: 'laptop', active_ms: 1000 }]]);
  const r2 = mergeStudyDays(l2, [{ day: '2026-09-04', device: 'phone', active_ms: 60000 }], other);
  assert.equal(r2.skipped, false);
  assert.deepEqual([...r2.merged.keys()].sort(), [k3, studyKey('2026-09-04', 'phone')].sort());
  assert.equal(r2.removed, 0);
});

test('studyDaysView: Map day → ms summed across the devices\' rows (a phone and a laptop add up; two tabs of one device share a row)', () => {
  const rows = new Map([
    [studyKey('2026-09-05', 'phone'), { day: '2026-09-05', device: 'phone', active_ms: 20 * MIN }],
    [studyKey('2026-09-05', 'laptop'), { day: '2026-09-05', device: 'laptop', active_ms: 30 * MIN }],
    [studyKey('2026-09-05', 'main'), { day: '2026-09-05', device: 'main', active_ms: 5 * MIN }],
    [studyKey('2026-09-04', 'phone'), { day: '2026-09-04', device: 'phone', active_ms: 1500 }],
    ['x', { active_ms: 5 }],
  ]);
  assert.deepEqual([...studyDaysView(rows)], [['2026-09-05', 55 * MIN], ['2026-09-04', 1500]]);
  assert.deepEqual([...studyDaysView(new Map([['2026-09-05', 1500], ['x', 5]]))], [['2026-09-05', 1500]], 'the fixture store\'s plain day → ms Map');
  assert.deepEqual([...studyDaysView(new Map([[studyKey('2026-09-05', 'phone'), { active_ms: 7 }]]))], [['2026-09-05', 7]], 'a row without a day: the key names it');
  assert.deepEqual([...studyDaysView(null)], []);
});

test('outbox: a device\'s flushes for a day coalesce to its last total, another device\'s key stays apart, a clear keeps its own entry', () => {
  const ops = [
    { seq: 1, table: 'study_days', key: 'day:2026-09-05:laptop', op: 'upsert', row: { day: '2026-09-05', device: 'laptop', active_ms: 60000 } },
    { seq: 2, table: 'study_days', key: 'clear:9', op: 'delete' },
    { seq: 3, table: 'study_days', key: 'day:2026-09-05:laptop', op: 'upsert', row: { day: '2026-09-05', device: 'laptop', active_ms: 15000 } },
  ];
  const { ops: out, dropSeqs } = coalesceOutbox(ops);
  assert.deepEqual(out.map((o) => o.seq), [2, 3], 'the clear is sent, then the device\'s latest total');
  assert.deepEqual(dropSeqs, [1]);
});

test('activeSlice: the tick counts while visible and recently active or playing; never a long absence', () => {
  const base = { now: 100000, lastActivity: 70000, dt: 15000 };
  assert.equal(activeSlice({ ...base }), 15000);
  assert.equal(activeSlice({ ...base, lastActivity: 39000 }), 0, 'idle for 61 s');
  assert.equal(activeSlice({ ...base, lastActivity: 39000, playing: true }), 15000, 'audio playing counts as active');
  assert.equal(activeSlice({ ...base, visible: false, playing: true }), 0, 'nothing while hidden');
  assert.equal(activeSlice({ ...base, dt: 600000 }), 30000, 'a throttled timer banks at most two ticks');
  assert.equal(activeSlice({ ...base, dt: -5 }), 0);
});

test('sentencesPerDay / sentencesPerDayByWeek: grouped by the local day of read_at', () => {
  const p = new Map([
    ['w01:1.1', at(2026, 9, 4, 23)], ['w01:2.1', at(2026, 9, 5, 0)], ['w02:1.1', at(2026, 9, 5, 9)], ['w02:2.1', at(2026, 9, 5, 9)], ['w03:1.1', 'bad'],
  ]);
  assert.deepEqual([...sentencesPerDay(p)], [['2026-09-04', 1], ['2026-09-05', 3]]);
  const bw = sentencesPerDayByWeek(p);
  assert.deepEqual([...bw.get('2026-09-05')], [[1, 1], [2, 2]]);
  assert.deepEqual([...sentencesPerDay(null)], []);
  // Whole rows (store.getProgressRows()) count by their first pass exactly like bare read_at values.
  const rows = new Map([['w01:1.1', { read_at: at(2026, 9, 4, 23), reads: 3, last_read_at: at(2026, 9, 5, 9) }], ['w01:2.1', at(2026, 9, 5, 0)]]);
  assert.deepEqual([...sentencesPerDay(rows)], [['2026-09-04', 1], ['2026-09-05', 1]]);
  assert.equal(readAtOf(rows.get('w01:1.1')), at(2026, 9, 4, 23));
  assert.equal(readAtOf('x'), 'x');
  assert.equal(readAtOf(null), null);
  assert.equal(readsOf(rows.get('w01:1.1')), 3);
  assert.equal(readsOf('x'), 1);
  assert.equal(readsOf({ reads: 'nope' }), 1);
  assert.equal(readsOf({ reads: 2.9 }), 2);
  assert.equal(readsOf, readsOfSync, 'one helper: settings.js re-exports sync.js\'s');
});

test('reviewsPerDay / passesByWeek: a reviewed sentence counts once on the day of its last pass; a week\'s passes is its largest reads', () => {
  const p = new Map([
    ['w01:1.1', { read_at: at(2026, 9, 1), reads: 3, last_read_at: at(2026, 9, 5, 9) }],   // reviewed twice, last today
    ['w01:2.1', { read_at: at(2026, 9, 1), reads: 2, last_read_at: at(2026, 9, 5, 10) }],  // reviewed today
    ['w01:3.1', { read_at: at(2026, 9, 1), reads: 2, last_read_at: at(2026, 9, 4, 10) }],  // reviewed yesterday
    ['w01:4.1', { read_at: at(2026, 9, 5, 8), reads: 1, last_read_at: at(2026, 9, 5, 8) }], // read today, never reviewed
    ['w02:1.1', at(2026, 9, 5, 8)],                                                       // a bare read_at: one pass
    ['w03:1.1', { read_at: at(2026, 9, 5, 8), reads: 2 }],                                 // no last_read_at: the first pass stands in
  ]);
  assert.deepEqual([...reviewsPerDay(p)].sort(), [['2026-09-04', 1], ['2026-09-05', 3]]);
  assert.deepEqual([...passesByWeek(p)], [[1, 3], [2, 1], [3, 2]]);
  assert.deepEqual([...reviewsPerDay(null)], []);
  assert.deepEqual([...passesByWeek(new Map())], []);
});

test('paceRate / paceOf: sentences per active hour over the last 7 reading days, else overall, else rough', () => {
  assert.equal(paceRate(30, 30 * MIN), 60);
  assert.equal(paceRate(3, 20000), null, 'under PACE_MIN_MS is no pace');
  assert.equal(paceRate(0, 10 * MIN), null);
  assert.equal(PACE_MIN_MS, 2 * MIN);
  const days = [];
  for (let i = 1; i <= 9; i++) days.push({ day: `2026-08-${String(i).padStart(2, '0')}`, ms: 10 * MIN, sentences: i <= 2 ? 100 : 10 });   // two fast early days, seven slow recent ones
  days.push({ day: '2026-08-20', ms: 0, sentences: 5 });   // a day with sentences but no time is not a reading day
  days.push({ day: '2026-08-21', ms: 60 * MIN, sentences: 0, reviews: 93 });   // a revision day: time, no first reads — not a reading day either (M3)
  const recent = paceOf(days);
  assert.equal(recent.basis, 'recent');
  assert.equal(recent.days, 7);
  assert.equal(Math.round(recent.perHour), 60, '7 × 10 sentences in 70 min; the review-only hour does not dilute it');
  assert.equal(recent.ms, 70 * MIN);
  const thin = [{ day: '2026-08-01', ms: 5 * MIN, sentences: 10 }];
  for (let i = 2; i <= 8; i++) thin.push({ day: `2026-08-${String(i).padStart(2, '0')}`, ms: 10000, sentences: 1 });   // seven recent days of 10 s each
  const overall = paceOf(thin);
  assert.equal(overall.basis, 'overall', 'the last 7 active days hold too little time; every active day together does');
  assert.equal(overall.days, 8);
  assert.equal(Math.round(overall.perHour), 165, '17 sentences in 6 min 10 s');
  const rough = paceOf([{ day: '2026-08-01', ms: 30000, sentences: 3 }]);
  assert.deepEqual([rough.basis, rough.perHour], ['rough', ROUGH_PACE]);
  assert.equal(paceOf([]).basis, 'rough');
});

test('lastDays: the span ending today, oldest first', () => {
  const d = lastDays(NOW, 3);
  assert.deepEqual(d, ['2026-09-03', '2026-09-04', '2026-09-05']);
  assert.equal(lastDays(NOW, 14).length, 14);
});

test('studyLog: today, the last 14 days, weeks apportioned by the day\'s sentences, pace and overall', () => {
  const progress = new Map([
    ['w01:1.1', at(2026, 9, 5, 10)], ['w01:2.1', at(2026, 9, 5, 10)], ['w01:3.1', at(2026, 9, 5, 10)],   // 3 of week 1 today
    ['w02:1.1', at(2026, 9, 5, 11)],                                                                      // 1 of week 2 today
    ['w01:4.1', at(2026, 9, 1, 11)], ['w01:5.1', at(2026, 9, 1, 11)],                                     // 2 of week 1 four days ago
    ['w03:1.1', at(2026, 8, 1, 11)],                                                                      // a month ago: outside the 14 days, inside the weeks
  ]);
  const studyDays = new Map([['2026-09-05', 20 * MIN], ['2026-09-01', 10 * MIN], ['2026-08-01', 5 * MIN], ['2026-08-30', 3 * MIN]]);
  const log = studyLog({ progress, studyDays, now: NOW });
  assert.deepEqual(log.today, { day: '2026-09-05', ms: 20 * MIN, sentences: 4, reviews: 0, pace: 12 });
  assert.equal(log.days.length, 14);
  assert.equal(log.days[13].day, '2026-09-05');
  assert.deepEqual(log.days[9], { day: '2026-09-01', ms: 10 * MIN, sentences: 2, reviews: 0, pace: 12 });
  assert.deepEqual(log.days[0], { day: '2026-08-23', ms: 0, sentences: 0, reviews: 0, pace: null });
  // Week 1: 3/4 of today's 20 min + all of the 1st's 10 min = 25 min, 5 sentences; week 2: 5 min, 1 sentence; week 3: 5 min, 1 sentence.
  assert.deepEqual(log.weeks.map((w) => [w.n, Math.round(w.ms / MIN), w.sentences, w.passes, w.pace]), [[1, 25, 5, 1, 12], [2, 5, 1, 1, 12], [3, 5, 1, 1, 12]]);
  assert.equal(log.pace.basis, 'recent');
  assert.equal(log.pace.days, 3, 'the 30 Aug time with no first reads is counted in the totals, not in the pace');
  assert.equal(log.pace.perHour, 12, '7 sentences in 35 reading minutes');
  assert.deepEqual(log.overall, { ms: 38 * MIN, sentences: 7, reviews: 0, pace: paceRate(7, 38 * MIN) }, 'overall keeps every minute');
  const empty = studyLog({ progress: new Map(), studyDays: new Map(), now: NOW });
  assert.deepEqual(empty.today, { day: '2026-09-05', ms: 0, sentences: 0, reviews: 0, pace: null });
  assert.deepEqual(empty.weeks, []);
  assert.equal(empty.pace.basis, 'rough');
  assert.equal(studyLog({ now: NOW }).days.length, 14, 'no inputs at all is fine');
});

test('studyLog with reviews: counts, pace and time left stay first-reads-only; reviews per day and passes per week ride along', () => {
  const rows = new Map([
    ['w01:1.1', { read_at: at(2026, 9, 1, 10), reads: 3, last_read_at: at(2026, 9, 5, 10) }],   // read four days ago, reviewed twice, last today
    ['w01:2.1', { read_at: at(2026, 9, 1, 10), reads: 2, last_read_at: at(2026, 9, 5, 10) }],   // read four days ago, reviewed today
    ['w01:3.1', { read_at: at(2026, 9, 1, 10), reads: 1, last_read_at: at(2026, 9, 1, 10) }],   // read four days ago
    ['w01:4.1', { read_at: at(2026, 9, 5, 11), reads: 1, last_read_at: at(2026, 9, 5, 11) }],   // read today
    ['w02:1.1', { read_at: at(2026, 9, 4, 11), reads: 2, last_read_at: at(2026, 9, 4, 12) }],   // read and reviewed yesterday
  ]);
  const plain = new Map([...rows].map(([id, r]) => [id, r.read_at]));   // the same sentences without their review fields
  const studyDays = new Map([['2026-09-05', 20 * MIN], ['2026-09-01', 10 * MIN], ['2026-09-04', 5 * MIN]]);
  const log = studyLog({ progress: rows, studyDays, now: NOW });
  const base = studyLog({ progress: plain, studyDays, now: NOW });
  assert.deepEqual(log.today, { day: '2026-09-05', ms: 20 * MIN, sentences: 1, reviews: 2, pace: 3 });
  assert.equal(log.days[13].reviews, 2);
  assert.equal(log.days[12].reviews, 1, 'yesterday');
  assert.equal(log.days[9].reviews, 0, 'the 1st: three first reads, nothing reviewed');
  assert.deepEqual(log.days.map((d) => [d.sentences, d.pace]), base.days.map((d) => [d.sentences, d.pace]), 'first reads and pace are the same with or without the review fields');
  assert.deepEqual(log.pace, base.pace);
  assert.deepEqual(log.weeks.map((w) => [w.n, w.sentences, w.passes]), [[1, 4, 3], [2, 1, 2]]);
  assert.deepEqual(base.weeks.map((w) => [w.n, w.sentences, w.passes]), [[1, 4, 1], [2, 1, 1]]);
  assert.equal(log.overall.reviews, 3);
  assert.equal(log.overall.sentences, base.overall.sentences);
  // A review on a day with no first read still puts the day in the table.
  const onlyReview = studyLog({ progress: new Map([['w01:1.1', { read_at: at(2026, 8, 1), reads: 2, last_read_at: at(2026, 9, 5, 9) }]]), studyDays: new Map(), now: NOW });
  assert.deepEqual(onlyReview.today, { day: '2026-09-05', ms: 0, sentences: 0, reviews: 1, pace: null });
  assert.equal(onlyReview.overall.sentences, 1);
  // A revision day — an hour of reviews, no first reads — leaves the pace where the reading days put it (CONTRACT.md "Study log merge").
  const revision = studyLog({ progress: rows, studyDays: new Map([...studyDays, ['2026-09-03', 60 * MIN]]), now: NOW });
  assert.deepEqual(revision.pace, log.pace, 'an hour with no first reads changes nothing about the pace');
  assert.equal(revision.overall.ms, log.overall.ms + 60 * MIN, 'but every minute is in the totals');
  assert.equal(revision.days[11].ms, 60 * MIN, 'and in the day table');
});

test('sparklineSummary: what the picture says, for a screen reader', () => {
  const days = [{ day: '2026-09-03', ms: 0 }, { day: '2026-09-04', ms: 42 * MIN }, { day: '2026-09-05', ms: 10 * MIN }];
  assert.equal(sparklineSummary(days, '2026-09-05'), '2 active days of the last 3; peak 42 min on Yesterday.');
  assert.equal(sparklineSummary([{ day: '2026-09-05', ms: 5 * MIN }], '2026-09-05'), '1 active day of the last 1; peak 5 min on Today.');
  assert.equal(sparklineSummary(days.map((d) => ({ ...d, ms: 0 })), '2026-09-05'), 'No reading time in the last 3 days.');
  assert.equal(sparklineSummary([], '2026-09-05'), 'No reading time in the last 0 days.');
});

test('todayLineText: minutes · N read · M reviewed · pace, the zero parts left out', () => {
  assert.equal(todayLineText({ ms: 0, sentences: 0, reviews: 0, pace: null }), 'Nothing yet today.');
  assert.equal(todayLineText(null), 'Nothing yet today.');
  assert.equal(todayLineText({ ms: 12 * MIN, sentences: 14, reviews: 58, pace: 70 }), 'Today · 12 min · 14 read · 58 reviewed · 70 / h');
  assert.equal(todayLineText({ ms: 12 * MIN, sentences: 14, reviews: 0, pace: 70 }), 'Today · 12 min · 14 read · 70 / h');
  assert.equal(todayLineText({ ms: 0, sentences: 0, reviews: 3, pace: null }), 'Today · 0 min · 0 read · 3 reviewed');
});

test('timeLeftMs / timeLeftText: unread ÷ pace, rounded the way the heading says it', () => {
  const pace = { perHour: 60, basis: 'recent' };
  assert.equal(timeLeftMs(30, pace), 30 * MIN);
  assert.equal(timeLeftMs(30, 120), 15 * MIN);
  assert.equal(timeLeftText(0, pace), 'finished');
  assert.equal(timeLeftText(45, pace), 'about 45 min left');
  assert.equal(timeLeftText(47, pace), 'about 45 min left', 'quarter-hours and up round to 5 minutes');
  assert.equal(timeLeftText(7, pace), 'about 7 min left');
  assert.equal(timeLeftText(120, pace), 'about 2 h left');
  assert.equal(timeLeftText(93, pace), 'about 1½ h left');
  assert.equal(timeLeftText(1, { perHour: 600, basis: 'recent' }), 'under a minute left');
  assert.equal(timeLeftText(51, { perHour: ROUGH_PACE, basis: 'rough' }), 'about 50 min left (rough estimate)');
  assert.equal(timeLeftText(60, null), 'about 1 h left (rough estimate)');
});

test('fmtActive / fmtPace / fmtDay', () => {
  assert.equal(fmtActive(0), '0 min');
  assert.equal(fmtActive(20000), '<1 min');
  assert.equal(fmtActive(12 * MIN), '12 min');
  assert.equal(fmtActive(65 * MIN), '1 h 05 min');
  assert.equal(fmtPace(72.4), '72 / h');
  assert.equal(fmtPace(null), '—');
  assert.equal(fmtDay('2026-09-05', '2026-09-05'), 'Today');
  assert.equal(fmtDay('2026-09-04', '2026-09-05'), 'Yesterday');
  assert.match(fmtDay('2026-08-31', '2026-09-05'), /Mon/);
});

test('sparklinePath: points spread across the box, scaled to the peak; all zeros is a flat baseline', () => {
  const s = sparklinePath([0, 10, 5, 20], { w: 100, h: 20, pad: 0 });
  assert.equal(s.max, 20);
  assert.deepEqual(s.points, [[0, 20], [33.3, 10], [66.7, 15], [100, 0]]);
  assert.equal(s.d, 'M0 20 L33.3 10 L66.7 15 L100 0');
  assert.deepEqual(s.last, { x: 100, y: 0 });
  const flat = sparklinePath([0, 0, 0], { w: 30, h: 10, pad: 2 });
  assert.deepEqual(flat.points, [[2, 8], [15, 8], [28, 8]]);
  assert.equal(sparklinePath([], {}).last, null);
  assert.equal(sparklinePath([5], { w: 10, h: 10, pad: 0 }).points[0][0], 5, 'a single point sits in the middle');
});
