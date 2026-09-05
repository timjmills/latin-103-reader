// node --test tests/ — reading progress (CONTRACT.md "Reading progress" /
// "Reviews"): the rows markRead() writes (a first read, a review ≥ 30 min
// after the last pass, nothing within it), the field-by-field merge behind
// pulls, realtime and the upsert, the per-week counts, and the last-position
// normalisation that rides in settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProgressRows, progressByWeek, normaliseLastPosition, normaliseSettings, patchSettings, coalesceOutbox,
  progressPending, mergeProgress, patchLastPosition, newerLastPosition, mergeSettings, DEFAULT_SETTINGS,
  REVIEW_GAP_MS, normaliseProgressRow, lastReadOf, readSettled, mergeProgressRow, sameProgressRow, applyProgressRealtime,
} from '../app/js/sync.js';
import { DEFAULT_SETTINGS as FIXTURE_DEFAULTS } from '../app/js/store-fixture.js';

const T0 = '2026-09-05T10:00:00.000Z';
const T1 = '2026-09-05T10:00:01.000Z';
const T2 = '2026-09-05T10:00:02.000Z';
const row = (unit_id, updated_at = T0, extra = {}) => ({ unit_id, week_n: 1, read_at: updated_at, reads: 1, last_read_at: updated_at, updated_at, ...extra });
const MIN = 60 * 1000;
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

test('mergeProgress: with an empty outbox the server rows come in and rows it no longer has are pruned', () => {
  const local = new Map([['w01:1.1', row('w01:1.1')], ['w01:9.1', row('w01:9.1')]]);
  const r = mergeProgress(local, [row('w01:1.1'), row('w01:2.1', T1)], []);
  assert.equal(r.skipped, false);
  assert.deepEqual([...r.merged.keys()].sort(), ['w01:1.1', 'w01:2.1']);
  assert.deepEqual(r.changed, ['w01:2.1']);
  assert.equal(r.removed, 1);
  assert.ok(local.has('w01:9.1'), 'the local Map is not mutated');
});

test('mergeProgress: a reset (or markRead) still in the outbox blocks the merge — the deleted rows never come back locally', () => {
  const local = new Map();   // just reset: everything gone locally, the delete not yet sent
  const remote = Array.from({ length: 93 }, (_, i) => row(`w01:${i + 1}.1`));
  const pending = [{ seq: 7, table: 'reading_progress', key: 'reset:all:1', op: 'delete', week_n: null }];
  const r = mergeProgress(local, remote, pending);
  assert.equal(r.skipped, true);
  assert.equal(r.merged, local, 'the local Map comes back untouched');
  assert.equal(r.merged.size, 0);
  assert.deepEqual(r.changed, []);
  const mark = [{ seq: 8, table: 'reading_progress', key: 'mark:1:0', op: 'upsert_many', rows: [row('w01:1.1')] }];
  assert.equal(mergeProgress(local, remote, mark).skipped, true, 'a pending markRead batch blocks it too');
});

test('mergeProgress: other pending ops only stop the pruning (an unflushed local row survives), the merge itself goes on', () => {
  const local = new Map([['w01:5.1', row('w01:5.1', T2)]]);
  const ops = [{ seq: 1, table: 'lookups', key: 'amo', op: 'upsert', row: {} }];
  const r = mergeProgress(local, [row('w01:1.1')], ops);
  assert.equal(r.skipped, false);
  assert.deepEqual([...r.merged.keys()].sort(), ['w01:1.1', 'w01:5.1']);
  assert.equal(r.removed, 0);
  assert.equal(progressPending(ops), false);
  assert.equal(progressPending(null), false);
});

test('patchLastPosition: only lastPosition moves; the row keeps its updated_at', () => {
  const cur = normaliseSettings({ data: { size: 5 }, updated_at: T0 });
  const lp = { week_n: 2, unit_id: 'w02:3.1', view: 'sentence', at: T1 };
  const next = patchLastPosition(cur, lp);
  assert.deepEqual(next.data.lastPosition, lp);
  assert.equal(next.data.size, 5);
  assert.equal(next.updated_at, T0, 'a scroll does not bump the settings clock');
  assert.equal(patchLastPosition(null, { week_n: 'x' }).data.lastPosition, null);
  assert.equal(patchLastPosition(null, lp).updated_at, null);
});

test('newerLastPosition: the newer `at` wins; a position without one loses to any with one', () => {
  const a = { week_n: 1, unit_id: 'w01:1.1', view: 'passage', at: T0 };
  const b = { week_n: 1, unit_id: 'w01:2.1', view: 'passage', at: T1 };
  assert.equal(newerLastPosition(a, b).unit_id, 'w01:2.1');
  assert.equal(newerLastPosition(b, a).unit_id, 'w01:2.1');
  assert.equal(newerLastPosition(a, { ...b, at: null }).unit_id, 'w01:1.1');
  assert.equal(newerLastPosition(null, b).unit_id, 'w01:2.1');
  assert.equal(newerLastPosition(null, null), null);
});

test('mergeSettings: the newer row wins as a whole, but lastPosition is merged on its own clock', () => {
  const posA = { week_n: 1, unit_id: 'w01:1.1', view: 'passage', at: T2 };   // this device scrolled last…
  const posB = { week_n: 1, unit_id: 'w01:7.1', view: 'passage', at: T0 };
  const local = { data: { ...DEFAULT_SETTINGS, size: 2, lastPosition: posA }, updated_at: T0 };
  const remote = { data: { ...DEFAULT_SETTINGS, size: 6, lastPosition: posB }, updated_at: T1 };   // …the other changed a setting later
  const r = mergeSettings(local, remote);
  assert.equal(r.changed, true);
  assert.equal(r.settings.data.size, 6, 'the remote setting is taken');
  assert.equal(r.settings.updated_at, T1);
  assert.deepEqual(r.settings.data.lastPosition, posA, 'the newer position is kept even though the row was older');
  // The other way round: an older row carrying a newer position moves only the position.
  const r2 = mergeSettings({ data: { ...DEFAULT_SETTINGS, size: 6, lastPosition: posB }, updated_at: T1 }, { data: { ...DEFAULT_SETTINGS, size: 2, lastPosition: posA }, updated_at: T0 });
  assert.equal(r2.changed, true);
  assert.equal(r2.settings.data.size, 6);
  assert.equal(r2.settings.updated_at, T1);
  assert.deepEqual(r2.settings.data.lastPosition, posA);
  // An own echo (same row) changes nothing.
  assert.equal(mergeSettings(local, local).changed, false);
  assert.equal(mergeSettings(local, null).changed, false);
});

test('fixture store: the same DEFAULT_SETTINGS as sync.js (noteSize and audioRate included)', () => {
  assert.deepEqual(FIXTURE_DEFAULTS, DEFAULT_SETTINGS);
  assert.equal(FIXTURE_DEFAULTS.noteSize, 4);
});

test('makeProgressRows: one row per new id with week_n from the id; known ids, repeats and idless ids are skipped', () => {
  const existing = new Map([['w01:1.1', { unit_id: 'w01:1.1' }]]);
  const rows = makeProgressRows(['w01:1.1', 'w01:2.1', 'w01:2.1', 'w07:b3.2', '', null, 'nope'], existing, '2026-09-05T10:00:00.000Z');
  assert.deepEqual(rows, [
    { unit_id: 'w01:2.1', week_n: 1, read_at: T0, reads: 1, last_read_at: T0, updated_at: T0 },
    { unit_id: 'w07:b3.2', week_n: 7, read_at: T0, reads: 1, last_read_at: T0, updated_at: T0 },
  ]);
  assert.deepEqual(makeProgressRows(['w01:1.1'], new Set(['w01:1.1'])), [], 'a Set of ids works as well (read for good: no time to review against)');
  assert.deepEqual(makeProgressRows(null, null), []);
});

test('makeProgressRows: a sentence met again ≥ 30 min after its last pass is a review (reads + 1, read_at kept); within 30 min nothing', () => {
  const existing = new Map([
    ['w01:1.1', row('w01:1.1')],                                                      // read at T0
    ['w01:2.1', row('w01:2.1', T0, { reads: 2, last_read_at: plus(T0, 20 * MIN) })],   // reviewed once, 20 min ago
    ['w01:3.1', { unit_id: 'w01:3.1', week_n: 1, read_at: T0 }],                       // a row from before the migration (no reads / last_read_at)
  ]);
  const now = plus(T0, 40 * MIN);
  const rows = makeProgressRows(['w01:1.1', 'w01:2.1', 'w01:3.1', 'w01:4.1', 'w01:1.1'], existing, now);
  assert.deepEqual(rows, [
    { unit_id: 'w01:1.1', week_n: 1, read_at: T0, reads: 2, last_read_at: now, updated_at: now },
    { unit_id: 'w01:3.1', week_n: 1, read_at: T0, reads: 2, last_read_at: now, updated_at: now },
    { unit_id: 'w01:4.1', week_n: 1, read_at: now, reads: 1, last_read_at: now, updated_at: now },
  ], 'w01:2.1 was covered 20 min ago: still the same session');
  assert.deepEqual(makeProgressRows(['w01:1.1'], existing, plus(T0, REVIEW_GAP_MS - 1000)), [], 'just under the gap: nothing');
  assert.equal(makeProgressRows(['w01:1.1'], existing, plus(T0, REVIEW_GAP_MS))[0]?.reads, 2, 'exactly the gap: a review');
  assert.equal(makeProgressRows(['w01:2.1'], existing, plus(T0, 60 * MIN))[0]?.reads, 3, 'a third pass');
  assert.ok(existing.get('w01:1.1').reads === 1 && existing.get('w01:1.1').last_read_at === T0, 'the existing rows are not mutated');
});

test('normaliseProgressRow / lastReadOf / readSettled: missing review fields default to one pass at read_at', () => {
  assert.deepEqual(normaliseProgressRow({ unit_id: 'w01:1.1', week_n: 1, read_at: T0 }), { unit_id: 'w01:1.1', week_n: 1, read_at: T0, reads: 1, last_read_at: T0, updated_at: T0 });
  assert.equal(normaliseProgressRow({ read_at: T0, reads: '3', last_read_at: T1, updated_at: T2 }).reads, 3);
  assert.equal(normaliseProgressRow({ read_at: T1, reads: 0, last_read_at: T0 }).last_read_at, T0, 'a last pass is taken as given (a hand-edited or skewed clock included)');
  assert.equal(normaliseProgressRow({ read_at: T1, last_read_at: 'bad' }).last_read_at, T1, 'an unparsable last pass falls back to the first');
  assert.equal(normaliseProgressRow(null), null);
  assert.equal(lastReadOf(row('x', T0, { last_read_at: T2 })), T2);
  assert.equal(lastReadOf(T1), T1, 'the getProgress() view: a bare read_at');
  assert.equal(lastReadOf(true), null);
  assert.equal(lastReadOf(null), null);
  const now = Date.parse(T0) + 40 * MIN;
  assert.equal(readSettled(null, now), false, 'unread');
  assert.equal(readSettled(row('x', T0), now), false, '40 min on: the next pass is a review');
  assert.equal(readSettled(row('x', T0, { last_read_at: plus(T0, 20 * MIN) }), now), true, 'covered 20 min ago');
  assert.equal(readSettled(T0, Date.parse(T0) + 5 * MIN), true);
  assert.equal(readSettled(true, now), true, 'a Set entry: read, no time to review against');
  assert.equal(readSettled(row('x', plus(T0, 60 * MIN)), now), true, 'a pass in the future (clock skew) is not reviewed');
});

test('mergeProgressRow: reads = max, last_read_at = max, read_at = min, updated_at = max; a missing side yields the other', () => {
  const a = row('w01:1.1', T0, { reads: 2, last_read_at: T2, updated_at: T2 });
  const b = row('w01:1.1', T1, { reads: 3, last_read_at: T1, updated_at: T1, read_at: T1 });
  const m = mergeProgressRow(a, b);
  assert.deepEqual(m, { unit_id: 'w01:1.1', week_n: 1, read_at: T0, reads: 3, last_read_at: T2, updated_at: T2 });
  assert.deepEqual(mergeProgressRow(b, a), m, 'symmetric');
  assert.deepEqual(mergeProgressRow(null, { unit_id: 'w01:1.1', week_n: 1, read_at: T0 }), row('w01:1.1'), 'one side missing: the other, normalised');
  assert.deepEqual(mergeProgressRow(a, null), a);
  assert.equal(mergeProgressRow(null, null), null);
  assert.equal(sameProgressRow(a, { ...a, updated_at: T0 }), true, 'updated_at alone does not make a different row');
  assert.equal(sameProgressRow(a, b), false);
  assert.equal(sameProgressRow(null, null), true);
  assert.equal(sameProgressRow(a, null), false);
});

test('mergeProgress: rows meet field by field — a review on either side stands, an own echo changes nothing', () => {
  const local = new Map([['w01:1.1', row('w01:1.1', T0, { reads: 2, last_read_at: T2, updated_at: T2 })], ['w01:2.1', row('w01:2.1')]]);
  const remote = [row('w01:1.1', T1, { reads: 1, last_read_at: T1, updated_at: T1 }), row('w01:2.1', T0, { reads: 3, last_read_at: T2, updated_at: T2 }), row('w01:3.1', T2)];
  const r = mergeProgress(local, remote, []);
  assert.deepEqual(r.changed, ['w01:2.1', 'w01:3.1'], 'w01:1.1: the stale server copy adds nothing');
  assert.deepEqual(r.merged.get('w01:1.1'), local.get('w01:1.1'));
  assert.equal(r.merged.get('w01:2.1').reads, 3);
  assert.equal(r.merged.get('w01:2.1').last_read_at, T2);
  assert.equal(r.merged.get('w01:2.1').read_at, T0);
  assert.equal(r.merged.get('w01:3.1').reads, 1);
  const echo = mergeProgress(r.merged, [...r.merged.values()], []);
  assert.deepEqual(echo.changed, []);
  assert.equal(echo.removed, 0);
});

test('applyProgressRealtime: an INSERT / UPDATE merges (max reads, latest pass, earliest read), a DELETE drops, an echo is no change', () => {
  const map = new Map([['w01:1.1', row('w01:1.1', T0, { reads: 2, last_read_at: T2, updated_at: T2 })]]);
  const stale = applyProgressRealtime(map, { eventType: 'UPDATE', new: row('w01:1.1', T1, { reads: 1, last_read_at: T1, updated_at: T1 }), old: {} });
  assert.equal(stale.changed, false);
  assert.equal(stale.map, map);
  const echo = applyProgressRealtime(map, { eventType: 'UPDATE', new: { ...map.get('w01:1.1'), user_id: 'u' }, old: {} });
  assert.equal(echo.changed, false, 'the own write coming back');
  const review = applyProgressRealtime(map, { eventType: 'UPDATE', new: row('w01:1.1', T0, { reads: 3, last_read_at: plus(T2, MIN), updated_at: plus(T2, MIN) }), old: {} });
  assert.equal(review.changed, true);
  assert.equal(review.map.get('w01:1.1').reads, 3);
  assert.equal(review.map.get('w01:1.1').last_read_at, plus(T2, MIN));
  assert.equal(map.get('w01:1.1').reads, 2, 'the input Map is not mutated');
  const ins = applyProgressRealtime(map, { eventType: 'INSERT', new: { unit_id: 'w01:2.1', week_n: 1, read_at: T1 }, old: {} });
  assert.equal(ins.changed, true);
  assert.deepEqual(ins.map.get('w01:2.1'), row('w01:2.1', T1), 'normalised on the way in');
  const del = applyProgressRealtime(map, { eventType: 'DELETE', new: {}, old: { unit_id: 'w01:1.1' } });
  assert.equal(del.changed, true);
  assert.equal(del.map.size, 0);
  assert.equal(applyProgressRealtime(map, { eventType: 'DELETE', new: {}, old: { unit_id: 'nope' } }).changed, false);
  assert.equal(applyProgressRealtime(map, { eventType: 'INSERT', new: {}, old: {} }).changed, false, 'no id: ignored');
});

test('progressByWeek: counts by the week in the unit id', () => {
  const p = new Map([['w01:1.1', 'x'], ['w01:2.1', 'x'], ['w03:b1.1', 'x'], ['odd', 'x']]);
  assert.deepEqual([...progressByWeek(p)], [[1, 2], [3, 1]]);
  assert.deepEqual([...progressByWeek(new Map())], []);
  assert.deepEqual([...progressByWeek(null)], []);
});

test('normaliseLastPosition: { week_n, unit_id, view, at } or null', () => {
  assert.deepEqual(normaliseLastPosition({ week_n: 3, unit_id: 'w03:4.1', view: 'sentence', at: '2026-09-05T10:00:00.000Z' }),
    { week_n: 3, unit_id: 'w03:4.1', view: 'sentence', at: '2026-09-05T10:00:00.000Z' });
  assert.deepEqual(normaliseLastPosition({ week_n: '3', unit_id: ' w03:4.1 ', view: 'grid', at: 'never' }),
    { week_n: 3, unit_id: 'w03:4.1', view: 'passage', at: null }, 'numeric strings, trimmed id, unknown view → passage, bad time → null');
  assert.equal(normaliseLastPosition({ week_n: 0, unit_id: 'w03:4.1' }), null);
  assert.equal(normaliseLastPosition({ week_n: 3, unit_id: '' }), null);
  assert.equal(normaliseLastPosition({ week_n: 3 }), null);
  assert.equal(normaliseLastPosition(null), null);
  assert.equal(normaliseLastPosition('w03:4.1'), null);
});

test('settings carry lastPosition: default null, normalised on read and on patch', () => {
  assert.equal(normaliseSettings(null).data.lastPosition, null);
  assert.equal(normaliseSettings({ data: { lastPosition: { week_n: 'x' } } }).data.lastPosition, null);
  const s = patchSettings(normaliseSettings(null), { lastPosition: { week_n: 2, unit_id: 'w02:1.1', view: 'sentence', at: '2026-09-05T10:00:00.000Z' } }, '2026-09-05T10:00:01.000Z');
  assert.deepEqual(s.data.lastPosition, { week_n: 2, unit_id: 'w02:1.1', view: 'sentence', at: '2026-09-05T10:00:00.000Z' });
  assert.equal(s.data.size, 3, 'the rest of the settings are untouched');
});

test('outbox: every markRead batch keeps its own entry; a reset after them is sent after them', () => {
  const ops = [
    { seq: 1, table: 'reading_progress', key: 'mark:1:0', op: 'upsert_many', rows: [{ unit_id: 'w01:1.1' }] },
    { seq: 2, table: 'reading_progress', key: 'mark:2:1', op: 'upsert_many', rows: [{ unit_id: 'w01:2.1' }] },
    { seq: 3, table: 'reading_progress', key: 'reset:1:3', op: 'delete', week_n: 1 },
  ];
  const { ops: out, dropSeqs } = coalesceOutbox(ops);
  assert.deepEqual(out.map((o) => o.seq), [1, 2, 3]);
  assert.deepEqual(dropSeqs, []);
});
