// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ts, isNewer, mergeRows, applyRealtime, coalesceOutbox,
  makeLookup, patchLookup, patchSettings, normaliseSettings, lookupsView,
  weekOfUnit, weekTag, staleWeeks, DEFAULT_SETTINGS,
} from '../app/js/sync.js';

const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-09-01T10:00:01.000Z';
const T2 = '2026-09-01T10:00:02.000Z';
const keyOf = (r) => r.form;

test('ts parses ISO and Postgres timestamptz strings, 0 for missing', () => {
  assert.equal(ts(null), 0);
  assert.equal(ts('nonsense'), 0);
  assert.equal(ts(T0), Date.parse(T0));
  // Postgres microsecond precision with +00:00 offset equals the same ms instant
  assert.equal(ts('2026-09-01T10:00:00.000000+00:00'), ts(T0));
  assert.equal(ts('2026-09-01T10:00:00.000123+00:00'), ts(T0));
});

test('isNewer is strict: equal timestamps are not newer (own echo is ignored)', () => {
  assert.equal(isNewer({ updated_at: T1 }, { updated_at: T0 }), true);
  assert.equal(isNewer({ updated_at: T0 }, { updated_at: T1 }), false);
  assert.equal(isNewer({ updated_at: T1 }, { updated_at: T1 }), false);
  assert.equal(isNewer({ updated_at: T1 }, undefined), true);
});

test('mergeRows: newest wins, local-only rows survive, changed keys reported', () => {
  const local = new Map([
    ['amo', { form: 'amo', learned_at: null, updated_at: T1 }],      // local newer
    ['vult', { form: 'vult', learned_at: null, updated_at: T0 }],    // remote newer
    ['offline', { form: 'offline', learned_at: null, updated_at: T2 }], // unflushed local write
  ]);
  const remote = [
    { form: 'amo', learned_at: T0, updated_at: T0 },
    { form: 'vult', learned_at: T1, updated_at: T1 },
    { form: 'novus', learned_at: null, updated_at: T0 },
  ];
  const { merged, changed } = mergeRows(local, remote, keyOf);
  assert.equal(merged.get('amo').learned_at, null, 'local newer row kept');
  assert.equal(merged.get('vult').learned_at, T1, 'remote newer row applied');
  assert.ok(merged.has('offline'), 'local-only row kept');
  assert.ok(merged.has('novus'), 'new remote row added');
  assert.deepEqual(changed.sort(), ['novus', 'vult']);
});

test('applyRealtime: insert/update apply when newer, delete removes, echo is a no-op', () => {
  let map = new Map([['amo', { form: 'amo', updated_at: T1 }]]);

  let r = applyRealtime(map, { eventType: 'UPDATE', new: { form: 'amo', updated_at: T1 }, old: {} }, keyOf);
  assert.equal(r.changed, false, 'same updated_at → own write echo, ignored');

  r = applyRealtime(map, { eventType: 'UPDATE', new: { form: 'amo', learned_at: T2, updated_at: T2 }, old: {} }, keyOf);
  assert.equal(r.changed, true);
  assert.equal(r.map.get('amo').learned_at, T2);
  map = r.map;

  r = applyRealtime(map, { eventType: 'INSERT', new: { form: 'novus', updated_at: T0 }, old: {} }, keyOf);
  assert.equal(r.changed, true);
  assert.equal(r.map.size, 2);
  map = r.map;

  r = applyRealtime(map, { eventType: 'DELETE', new: {}, old: { form: 'novus' } }, keyOf);
  assert.equal(r.changed, true);
  assert.equal(r.map.has('novus'), false);

  r = applyRealtime(map, { eventType: 'DELETE', new: {}, old: { form: 'ghost' } }, keyOf);
  assert.equal(r.changed, false, 'deleting an unknown key changes nothing');

  r = applyRealtime(map, { eventType: 'DELETE', new: {}, old: {} }, keyOf);
  assert.equal(r.changed, false, 'delete without replica identity payload is ignored');
});

test('coalesceOutbox keeps the last op per (table,key) in last-seen order', () => {
  const ops = [
    { seq: 1, table: 'lookups', key: 'amo', op: 'upsert', row: { form: 'amo', learned_at: null } },
    { seq: 2, table: 'settings', key: 'settings', op: 'upsert', row: { data: { size: 2 } } },
    { seq: 3, table: 'lookups', key: 'amo', op: 'upsert', row: { form: 'amo', learned_at: T1 } },
    { seq: 4, table: 'lookups', key: 'vult', op: 'delete' },
    { seq: 5, table: 'settings', key: 'settings', op: 'upsert', row: { data: { size: 4 } } },
    { seq: 6, table: 'audio_alignments', key: 'week:1', op: 'replace_week', rows: [] },
    { seq: 7, table: 'lookups', key: 'amo', op: 'delete' },
  ];
  const { ops: out, dropSeqs } = coalesceOutbox(ops);
  assert.deepEqual(out.map((o) => o.seq), [4, 5, 6, 7]);
  assert.deepEqual(dropSeqs, [1, 2, 3]);
  assert.equal(out.find((o) => o.key === 'amo').op, 'delete', 'final state for amo is delete');
  assert.equal(out.find((o) => o.key === 'settings').row.data.size, 4);
});

test('makeLookup is idempotent; patchLookup bumps updated_at', () => {
  const row = makeLookup(undefined, 'amo', 'w01:1.1', T0);
  assert.deepEqual(row, { form: 'amo', first_seen_unit_id: 'w01:1.1', created_at: T0, learned_at: null, updated_at: T0 });
  assert.equal(makeLookup(row, 'amo', 'w01:9.9', T1), null, 'second add returns null (no-op)');
  const learned = patchLookup(row, { learned_at: T1 }, T1);
  assert.equal(learned.learned_at, T1);
  assert.equal(learned.updated_at, T1);
  assert.equal(learned.first_seen_unit_id, 'w01:1.1', 'first-seen unit is preserved');
  assert.equal(patchLookup(undefined, { learned_at: T1 }, T1), null);
});

test('settings: defaults filled, patch merged, timestamp set', () => {
  const s0 = normaliseSettings(null);
  assert.deepEqual(s0.data, DEFAULT_SETTINGS);
  assert.equal(s0.updated_at, null);
  const s1 = patchSettings(s0, { size: 5, theme: 'dark' }, T1);
  assert.equal(s1.data.size, 5);
  assert.equal(s1.data.theme, 'dark');
  assert.equal(s1.data.face, 'serif', 'untouched keys keep defaults');
  assert.equal(s1.updated_at, T1);
  const s2 = normaliseSettings({ data: { size: 1 }, updated_at: T2 });
  assert.equal(s2.data.size, 1);
  assert.equal(s2.data.showHighlights, true);
});

test('lookupsView exposes exactly the CONTRACT fields', () => {
  const view = lookupsView(new Map([['amo', { form: 'amo', first_seen_unit_id: 'w01:1.1', created_at: T0, learned_at: null, updated_at: T1, user_id: 'x' }]]));
  assert.deepEqual(view.get('amo'), { first_seen_unit_id: 'w01:1.1', learned_at: null, created_at: T0 });
});

test('week helpers', () => {
  assert.equal(weekOfUnit('w01:1.1'), 1);
  assert.equal(weekOfUnit('w14:139.2'), 14);
  assert.equal(weekOfUnit('bogus'), null);
  assert.equal(weekTag(3), 'week-03');
  assert.equal(weekTag(14), 'week-14');
});

test('staleWeeks: missing locally, missing units, or remote newer', () => {
  const remote = [
    { n: 1, updated_at: T0 },
    { n: 2, updated_at: T2 },
    { n: 3, updated_at: T0 },
    { n: 4, updated_at: T0 },
  ];
  const local = [
    { n: 1, updated_at: T0 },
    { n: 2, updated_at: T0 },
    { n: 3, updated_at: T0 },
  ];
  const hasUnits = (n) => n !== 3;
  assert.deepEqual(staleWeeks(remote, local, hasUnits), [2, 3, 4]);
});
