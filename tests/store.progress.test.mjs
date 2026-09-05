// node --test tests/ — reading progress (CONTRACT.md "Reading progress"):
// the rows markRead() writes (idempotent), the per-week counts, and the
// last-position normalisation that rides in settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProgressRows, progressByWeek, normaliseLastPosition, normaliseSettings, patchSettings, coalesceOutbox,
  progressPending, mergeProgress, patchLastPosition, newerLastPosition, mergeSettings, DEFAULT_SETTINGS,
} from '../app/js/sync.js';
import { DEFAULT_SETTINGS as FIXTURE_DEFAULTS } from '../app/js/store-fixture.js';

const T0 = '2026-09-05T10:00:00.000Z';
const T1 = '2026-09-05T10:00:01.000Z';
const T2 = '2026-09-05T10:00:02.000Z';
const row = (unit_id, updated_at = T0) => ({ unit_id, week_n: 1, read_at: updated_at, updated_at });

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
    { unit_id: 'w01:2.1', week_n: 1, read_at: '2026-09-05T10:00:00.000Z', updated_at: '2026-09-05T10:00:00.000Z' },
    { unit_id: 'w07:b3.2', week_n: 7, read_at: '2026-09-05T10:00:00.000Z', updated_at: '2026-09-05T10:00:00.000Z' },
  ]);
  assert.deepEqual(makeProgressRows(['w01:1.1'], new Set(['w01:1.1'])), [], 'a Set of ids works as well');
  assert.deepEqual(makeProgressRows(null, null), []);
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
