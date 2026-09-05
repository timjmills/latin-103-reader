// node --test tests/ — the study log (CONTRACT.md "Study log"): the day key,
// the additive-max merge behind `study_days`, the ticker's active-time rule,
// the stats (sentences per day, per-week apportioning, pace, time left) and
// the sparkline geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, isDayKey, cleanMs, addStudyMs, mergeStudyDays, studyPending, studyDaysView, coalesceOutbox } from '../app/js/sync.js';
import {
  sentencesPerDay, sentencesPerDayByWeek, paceRate, paceOf, lastDays, studyLog, timeLeftMs, timeLeftText,
  fmtActive, fmtPace, fmtDay, sparklinePath, activeSlice, ROUGH_PACE, PACE_MIN_MS,
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

test('addStudyMs: adds to the day, never negative or fractional', () => {
  const r = addStudyMs(null, '2026-09-05', 15000.4, 'T1');
  assert.deepEqual(r, { day: '2026-09-05', active_ms: 15000, updated_at: 'T1' });
  assert.deepEqual(addStudyMs(r, '2026-09-05', -5, 'T2'), { day: '2026-09-05', active_ms: 15000, updated_at: 'T2' });
  assert.equal(addStudyMs({ active_ms: 'x' }, '2026-09-05', 100).active_ms, 100);
  assert.equal(addStudyMs(null, 'today', 100), null);
  assert.equal(cleanMs(NaN), 0);
});

test('mergeStudyDays: per day the larger total stands; with an empty outbox missing days are pruned', () => {
  const local = new Map([['2026-09-04', { day: '2026-09-04', active_ms: 90000, updated_at: 'a' }], ['2026-09-01', { day: '2026-09-01', active_ms: 5000 }]]);
  const remote = [{ day: '2026-09-04', active_ms: 60000, updated_at: 'b' }, { day: '2026-09-05', active_ms: 30000, updated_at: 'c' }, { day: 'junk', active_ms: 1 }];
  const r = mergeStudyDays(local, remote, []);
  assert.equal(r.skipped, false);
  assert.equal(r.merged.get('2026-09-04').active_ms, 90000, 'the local figure was larger');
  assert.equal(r.merged.get('2026-09-05').active_ms, 30000);
  assert.equal(r.merged.has('2026-09-01'), false, 'a day the server no longer has goes');
  assert.deepEqual(r.changed, ['2026-09-05']);
  assert.equal(r.removed, 1);
  assert.equal(local.size, 2, 'the local Map is not mutated');
  // A larger remote total replaces the local one.
  const r2 = mergeStudyDays(local, [{ day: '2026-09-04', active_ms: 120000 }, { day: '2026-09-01', active_ms: 5000 }], []);
  assert.equal(r2.merged.get('2026-09-04').active_ms, 120000);
  assert.deepEqual(r2.changed, ['2026-09-04']);
});

test('mergeStudyDays: a pending study_days op blocks the merge; other pending ops only stop the pruning', () => {
  const local = new Map();   // just cleared locally
  const pending = [{ seq: 1, table: 'study_days', key: 'clear:1', op: 'delete' }];
  const r = mergeStudyDays(local, [{ day: '2026-09-04', active_ms: 60000 }], pending);
  assert.equal(r.skipped, true);
  assert.equal(r.merged, local);
  assert.equal(studyPending(pending), true);
  const other = [{ seq: 2, table: 'lookups', key: 'amo', op: 'upsert' }];
  const l2 = new Map([['2026-09-03', { day: '2026-09-03', active_ms: 1000 }]]);
  const r2 = mergeStudyDays(l2, [{ day: '2026-09-04', active_ms: 60000 }], other);
  assert.equal(r2.skipped, false);
  assert.deepEqual([...r2.merged.keys()].sort(), ['2026-09-03', '2026-09-04']);
  assert.equal(r2.removed, 0);
});

test('studyDaysView / outbox: Map day → ms; a day\'s flushes coalesce to the last total, a clear keeps its own entry', () => {
  assert.deepEqual([...studyDaysView(new Map([['2026-09-05', { active_ms: 1500 }], ['x', { active_ms: 5 }]]))], [['2026-09-05', 1500]]);
  const ops = [
    { seq: 1, table: 'study_days', key: 'day:2026-09-05', op: 'upsert', row: { day: '2026-09-05', active_ms: 60000 } },
    { seq: 2, table: 'study_days', key: 'clear:9', op: 'delete' },
    { seq: 3, table: 'study_days', key: 'day:2026-09-05', op: 'upsert', row: { day: '2026-09-05', active_ms: 15000 } },
  ];
  const { ops: out, dropSeqs } = coalesceOutbox(ops);
  assert.deepEqual(out.map((o) => o.seq), [2, 3], 'the clear is sent, then the day\'s latest total');
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
});

test('paceRate / paceOf: sentences per active hour over the last 7 active days, else overall, else rough', () => {
  assert.equal(paceRate(30, 30 * MIN), 60);
  assert.equal(paceRate(3, 20000), null, 'under PACE_MIN_MS is no pace');
  assert.equal(paceRate(0, 10 * MIN), null);
  assert.equal(PACE_MIN_MS, 2 * MIN);
  const days = [];
  for (let i = 1; i <= 9; i++) days.push({ day: `2026-08-${String(i).padStart(2, '0')}`, ms: 10 * MIN, sentences: i <= 2 ? 100 : 10 });   // two fast early days, seven slow recent ones
  days.push({ day: '2026-08-20', ms: 0, sentences: 5 });   // a day with sentences but no time is not an active day
  const recent = paceOf(days);
  assert.equal(recent.basis, 'recent');
  assert.equal(recent.days, 7);
  assert.equal(Math.round(recent.perHour), 60, '7 × 10 sentences in 70 min');
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
  assert.deepEqual(log.today, { day: '2026-09-05', ms: 20 * MIN, sentences: 4, pace: 12 });
  assert.equal(log.days.length, 14);
  assert.equal(log.days[13].day, '2026-09-05');
  assert.deepEqual(log.days[9], { day: '2026-09-01', ms: 10 * MIN, sentences: 2, pace: 12 });
  assert.deepEqual(log.days[0], { day: '2026-08-23', ms: 0, sentences: 0, pace: null });
  // Week 1: 3/4 of today's 20 min + all of the 1st's 10 min = 25 min, 5 sentences; week 2: 5 min, 1 sentence; week 3: 5 min, 1 sentence.
  assert.deepEqual(log.weeks.map((w) => [w.n, Math.round(w.ms / MIN), w.sentences, w.pace]), [[1, 25, 5, 12], [2, 5, 1, 12], [3, 5, 1, 12]]);
  assert.equal(log.pace.basis, 'recent');
  assert.equal(log.pace.days, 4, 'the 30 Aug time with no sentences is an active day too');
  assert.equal(Math.round(log.pace.perHour * 10) / 10, 11.1, '7 sentences in 38 active minutes');
  assert.deepEqual(log.overall, { ms: 38 * MIN, sentences: 7, pace: log.pace.perHour });
  const empty = studyLog({ progress: new Map(), studyDays: new Map(), now: NOW });
  assert.deepEqual(empty.today, { day: '2026-09-05', ms: 0, sentences: 0, pace: null });
  assert.deepEqual(empty.weeks, []);
  assert.equal(empty.pace.basis, 'rough');
  assert.equal(studyLog({ now: NOW }).days.length, 14, 'no inputs at all is fine');
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
