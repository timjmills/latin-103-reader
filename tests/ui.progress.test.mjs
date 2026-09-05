// node --test tests/ — the pure pieces of the reading-progress UI (CONTRACT.md
// "Reading progress"): read-batching, the first unread sentence, the
// "current sentence while scrolling" rule, the in-view rule and the texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstUnread, queueReads, progressValueOf, readTickText, nearestUnit, inViewEnough, unitEndMs, playbackRead, nextCounts, READ_DWELL_MS } from '../app/js/reader.js';
import { readSettled } from '../app/js/sync.js';
import { progressText, progressStateText } from '../app/js/settings.js';

const units = [{ id: 'w01:1.1', order: 0 }, { id: 'w01:2.1', order: 1 }, { id: 'w01:3.1', order: 2 }];

test('nextCounts: Next / j counts a first read at once, a review only after the dwell, a settled sentence never', () => {
  const row = { unit_id: 'w01:1.1', week_n: 1, read_at: '2026-09-05T10:00:00.000Z', reads: 1, last_read_at: '2026-09-05T10:00:00.000Z' };
  assert.equal(READ_DWELL_MS, 2000);
  assert.equal(nextCounts({ value: null, settled: false, heldMs: 0 }), true, 'a first read: moved past with Next counts, no dwell (CONTRACT.md)');
  assert.equal(nextCounts({ value: row, settled: false, heldMs: 300 }), false, 'hammering j through a read week is not a review');
  assert.equal(nextCounts({ value: row, settled: false, heldMs: 2000 }), true, 'current for the dwell: a review');
  assert.equal(nextCounts({ value: row, settled: true, heldMs: 60000 }), false, 'read within the last 30 min: nothing');
  assert.equal(nextCounts({ value: null, settled: false, heldMs: 0, dwellMs: 0 }), true);
  assert.equal(nextCounts({ value: row, settled: false, heldMs: 5, dwellMs: 0 }), true);
});

test('queueReads: adds what is neither read nor queued, once; says what it added', () => {
  const queue = new Set();
  const progress = new Map([['w01:1.1', '2026-09-05T10:00:00.000Z']]);
  assert.deepEqual(queueReads(queue, ['w01:1.1', 'w01:2.1'], progress), ['w01:2.1']);
  assert.deepEqual(queueReads(queue, ['w01:2.1', 'w01:3.1', '', null], progress), ['w01:3.1'], 'a queued id is not added twice');
  assert.deepEqual([...queue], ['w01:2.1', 'w01:3.1']);
  assert.deepEqual(queueReads(queue, null, progress), []);
});

test('queueReads with readSettled: a sentence read ≥ 30 min ago is queued again (a review), one read just now is not', () => {
  const MIN = 60 * 1000;
  const now = Date.parse('2026-09-05T11:00:00.000Z');
  const rows = new Map([
    ['w01:1.1', { unit_id: 'w01:1.1', week_n: 1, read_at: '2026-09-05T10:00:00.000Z', reads: 1, last_read_at: '2026-09-05T10:00:00.000Z' }],   // an hour ago
    ['w01:2.1', { unit_id: 'w01:2.1', week_n: 1, read_at: '2026-09-05T10:00:00.000Z', reads: 2, last_read_at: '2026-09-05T10:50:00.000Z' }],   // reviewed 10 min ago
  ]);
  const settled = (v) => readSettled(v, now);
  const queue = new Set();
  assert.deepEqual(queueReads(queue, ['w01:1.1', 'w01:2.1', 'w01:3.1'], rows, settled), ['w01:1.1', 'w01:3.1']);
  assert.deepEqual(queueReads(new Set(), ['w01:1.1'], rows, (v) => readSettled(v, now - 40 * MIN)), [], '20 min after the read: nothing yet');
  assert.deepEqual(queueReads(new Set(), ['w01:1.1'], rows), [], 'without the rule any entry is settled (the old behaviour)');
  assert.equal(progressValueOf(rows, 'w01:1.1'), rows.get('w01:1.1'));
  assert.equal(progressValueOf(new Set(['w01:1.1']), 'w01:1.1'), true);
  assert.equal(progressValueOf(new Set(), 'w01:1.1'), null);
  assert.equal(progressValueOf(null, 'w01:1.1'), null);
});

test('readTickText: "read", then "read · reviewed", "read · reviewed ×2" as the passes mount', () => {
  assert.equal(readTickText(null), 'read');
  assert.equal(readTickText('2026-09-05T10:00:00.000Z'), 'read');
  assert.equal(readTickText({ reads: 1 }), 'read');
  assert.equal(readTickText({ reads: 2 }), 'read · reviewed');
  assert.equal(readTickText({ reads: 3 }), 'read · reviewed ×2');
  assert.equal(readTickText({ reads: 'x' }), 'read');
});

test('firstUnread: the first sentence in order not in the progress map; null once all are read', () => {
  assert.equal(firstUnread(units, new Map()).id, 'w01:1.1');
  assert.equal(firstUnread(units, new Set(['w01:1.1', 'w01:2.1'])).id, 'w01:3.1');
  assert.equal(firstUnread(units, new Set(['w01:2.1'])).id, 'w01:1.1', 'a gap counts: Continue goes back to it');
  assert.equal(firstUnread(units, new Set(units.map((u) => u.id))), null);
  assert.equal(firstUnread([], new Map()), null);
});

test('nearestUnit: the box straddling the line, else the nearest edge; empty boxes ignored', () => {
  const boxes = [{ id: 'a', top: 0, bottom: 100 }, { id: 'b', top: 100, bottom: 100 }, { id: 'c', top: 120, bottom: 200 }, { id: 'd', top: 260, bottom: 300 }];
  assert.equal(nearestUnit(boxes, 50), 'a');
  assert.equal(nearestUnit(boxes, 110), 'a', 'ties go to the earlier unit');
  assert.equal(nearestUnit(boxes, 115), 'c');
  assert.equal(nearestUnit(boxes, 225), 'c');
  assert.equal(nearestUnit(boxes, 245), 'd');
  assert.equal(nearestUnit([], 10), null);
  assert.equal(nearestUnit(null, 10), null);
});

test('inViewEnough: 80% of the unit, or of the viewport for a unit taller than it', () => {
  assert.equal(inViewEnough(80, 100, 800), true);
  assert.equal(inViewEnough(79, 100, 800), false);
  assert.equal(inViewEnough(640, 2000, 800), true, 'a tall block fills 80% of the viewport');
  assert.equal(inViewEnough(600, 2000, 800), false);
  assert.equal(inViewEnough(0, 0, 800), false);
  assert.equal(inViewEnough(NaN, 100, 800), false);
});

// Alignment: 1.1 (0–4 s, its own end), 2.1 (4–? s: until 3.1 starts at 10 s), 3.1 (10 s–?: the last row, no end_ms); 4.1 is not aligned.
const rows = [
  { unit_id: 'w01:1.1', start_ms: 0, end_ms: 4000 },
  { unit_id: 'w01:2.1', start_ms: 4000, end_ms: null },
  { unit_id: 'w01:3.1', start_ms: 10000, end_ms: null },
];

test('unitEndMs: own end_ms, else the next row, else the fallback; null for an unaligned unit', () => {
  assert.equal(unitEndMs(rows, 'w01:1.1'), 4000);
  assert.equal(unitEndMs(rows, 'w01:2.1'), 10000);
  assert.equal(unitEndMs(rows, 'w01:3.1'), null);
  assert.equal(unitEndMs(rows, 'w01:3.1', 15000), 15000);
  assert.equal(unitEndMs(rows, 'w01:4.1', 15000), null);
  assert.equal(unitEndMs(null, 'w01:1.1'), null);
});

test('playbackRead: chapter playback moving on to the next aligned sentence marks the one it left', () => {
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:2.1', playedMs: 4000, rows }), true);
  assert.equal(playbackRead({ prevId: 'w01:2.1', nextId: 'w01:3.1', playedMs: 6000, rows }), true);
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:3.1', playedMs: 4000, rows }), false, 'a jump over a sentence is not "passed"');
  assert.equal(playbackRead({ prevId: 'w01:2.1', nextId: 'w01:1.1', playedMs: 6000, rows }), false, 'nor is going back');
  assert.equal(playbackRead({ prevId: 'w01:4.1', nextId: 'w01:1.1', playedMs: 9000, rows }), false, 'an unaligned sentence never counts');
});

test('playbackRead: playback that stops where the sentence ends counts; a Stop partway, a jump or an error does not', () => {
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: null, playedMs: 3900, atMs: 3960, rows }), true, 'the loop stops 40 ms short of end_ms');
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: null, playedMs: 1500, atMs: 1500, rows }), false, 'Stop after 1.5 s of a 4 s sentence');
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: null, playedMs: 3900, atMs: 3960, rows, error: 'The recording could not be played.' }), false);
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: null, playedMs: 3900, atMs: null, rows }), false, 'no time known → not ended');
  assert.equal(playbackRead({ prevId: 'w01:3.1', nextId: null, playedMs: 5000, atMs: 14990, rows, durationMs: 15000 }), true, 'the last row ends with the recording');
  assert.equal(playbackRead({ prevId: 'w01:3.1', nextId: null, playedMs: 5000, atMs: 12000, rows, durationMs: 15000 }), false);
  assert.equal(playbackRead({ prevId: 'w01:3.1', nextId: null, playedMs: 5000, atMs: 12000, rows }), false, 'the last row without an end and no duration: never "ended"');
});

test('playbackRead: only time actually played counts — 1.5 s, or 80% of a shorter sentence', () => {
  const short = [{ unit_id: 'w01:1.1', start_ms: 0, end_ms: 1000 }, { unit_id: 'w01:2.1', start_ms: 1000, end_ms: null }];
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:2.1', playedMs: 1000, rows }), false, 'passed, but not played long enough (a long pause in between counts for nothing)');
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:2.1', playedMs: 1500, rows }), true);
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:2.1', playedMs: 850, rows: short }), true, 'a 1 s sentence needs 0.8 s');
  assert.equal(playbackRead({ prevId: 'w01:1.1', nextId: 'w01:2.1', playedMs: 700, rows: short }), false);
  assert.equal(playbackRead({ prevId: null, nextId: 'w01:2.1', playedMs: 9000, rows }), false);
});

test('progressText: not started / N of M / finished', () => {
  assert.equal(progressText(0, 93), 'not started');
  assert.equal(progressText(42, 93), '42 of 93 sentences');
  assert.equal(progressText(42, 93, { noun: 'read' }), '42 of 93 read');
  assert.equal(progressText(93, 93), 'finished ✓');
  assert.equal(progressText(120, 93), 'finished ✓', 'a stale row beyond the total never shows more than the total');
  assert.equal(progressText(5, 0), 'not started');
  assert.equal(progressText(-3, 10), 'not started');
});

test('progressStateText: the Settings line', () => {
  assert.equal(progressStateText(0, 93), 'Nothing read yet.');
  assert.equal(progressStateText(1, 93), '1 of 93 sentences read.');
  assert.equal(progressStateText(93, 93), 'All 93 sentences read.');
});
