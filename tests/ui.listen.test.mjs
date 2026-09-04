// node --test tests/ — the pure helpers behind the listen bar at the top of
// the text: the status line, the duration format, and the alignment's end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, listenStatusText } from '../app/js/settings.js';
import { alignmentEndMs } from '../app/js/audio.js';

test('fmtDuration: minutes, hours, under a minute; nothing for bad input', () => {
  assert.equal(fmtDuration(14 * 60000), '14 min');
  assert.equal(fmtDuration(839800), '14 min');
  assert.equal(fmtDuration(30000), 'under a minute');
  assert.equal(fmtDuration(65 * 60000), '1 h 05 min');
  assert.equal(fmtDuration(0), '');
  assert.equal(fmtDuration(-5), '');
  assert.equal(fmtDuration(NaN), '');
  assert.equal(fmtDuration(undefined), '');
});

test('alignmentEndMs: the latest word end, or row start, across the rows', () => {
  assert.equal(alignmentEndMs([]), 0);
  assert.equal(alignmentEndMs(null), 0);
  assert.equal(alignmentEndMs([{ unit_id: 'a', start_ms: 1000 }, { unit_id: 'b', start_ms: 5000 }]), 5000);
  assert.equal(alignmentEndMs([
    { unit_id: 'a', start_ms: 1000, words: [{ t: 'x', s: 1000, e: 1500 }] },
    { unit_id: 'b', start_ms: 5000, words: [{ t: 'y', s: 5000, e: 5400 }, { t: 'z', s: 5400, e: 6200 }] },
  ]), 6200);
  assert.equal(alignmentEndMs([{ unit_id: 'a', start_ms: 'bad', words: [{ e: null }] }]), 0);
});

test('listenStatusText: idle → aligned count + duration', () => {
  const info = { hasAudio: true, alignedCount: 14, total: 14, durationMs: 14 * 60000 };
  assert.equal(listenStatusText(info), 'Aligned · 14 min');
  assert.equal(listenStatusText({ ...info, alignedCount: 12 }), 'Aligned 12 of 14 · 14 min');
  assert.equal(listenStatusText({ ...info, durationMs: 0 }), 'Aligned');
  assert.equal(listenStatusText({ hasAudio: false }), '');
  assert.equal(listenStatusText({ hasAudio: true, alignedCount: 0, total: 14 }), '');
  assert.equal(listenStatusText(), '');
});

test('listenStatusText: while the chapter plays it says where; a sentence says so', () => {
  const info = { hasAudio: true, alignedCount: 14, total: 14, durationMs: 60000 };
  assert.equal(listenStatusText(info, { mode: 'all', playing: true }, { index: 2 }), 'Playing · sentence 3 of 14');
  assert.equal(listenStatusText(info, { mode: 'all', playing: false }, { index: 2 }), 'Paused · sentence 3 of 14');
  assert.equal(listenStatusText(info, { mode: 'all', playing: true }, { index: -1 }), 'Playing');
  assert.equal(listenStatusText(info, { mode: 'unit', playing: true }), 'Playing this sentence');
  assert.equal(listenStatusText(info, { mode: 'unit', playing: false }), 'Paused');
});
