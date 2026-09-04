// node --test tests/ — alignment rows' `end_ms` / `synth` (CONTRACT.md "Audio
// alignment rows", later note): normalisation through the store, where a
// sentence and the chapter stop, the week's length, the listen bar's hint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEndMs, normaliseAlignmentRows } from '../app/js/sync.js';
import { alignmentEndMs, unitStopMs, chapterStopMs } from '../app/js/audio.js';
import { synthHintText } from '../app/js/settings.js';

test('cleanEndMs: a finite end no earlier than the start; anything else → null', () => {
  assert.equal(cleanEndMs(5400, 5000), 5400);
  assert.equal(cleanEndMs('5400.4', 5000), 5400);
  assert.equal(cleanEndMs(4000, 5000), 5000, 'an end before the start is pulled up to it');
  assert.equal(cleanEndMs(undefined, 5000), null);
  assert.equal(cleanEndMs(null, 5000), null);
  assert.equal(cleanEndMs('', 5000), null);
  assert.equal(cleanEndMs(NaN, 5000), null);
  assert.equal(cleanEndMs('soon', 5000), null);
  assert.equal(cleanEndMs(true, 5000), null);
});

test('normaliseAlignmentRows: end_ms and synth pass through; rows without them (IndexedDB before 0007, manual alignments) get null / false', () => {
  const rows = normaliseAlignmentRows([
    { unit_id: 'w13:b30.2', start_ms: 747770, end_ms: 748900, synth: false, words: [] },
    { unit_id: 'w13:b1.1', start_ms: 30500 },                         // an older cached row: no field at all
    { unit_id: 'w13:b2.1', start_ms: 40000, end_ms: null, synth: 'yes' },
    { unit_id: 'w13:b3.1', start_ms: 50000, end_ms: 'x', synth: true },
  ]);
  assert.deepEqual(rows, [
    { unit_id: 'w13:b1.1', start_ms: 30500, end_ms: null, synth: false, words: [] },
    { unit_id: 'w13:b2.1', start_ms: 40000, end_ms: null, synth: false, words: [] },
    { unit_id: 'w13:b3.1', start_ms: 50000, end_ms: null, synth: true, words: [] },
    { unit_id: 'w13:b30.2', start_ms: 747770, end_ms: 748900, synth: false, words: [] },
  ]);
  // A manual alignment from the overlay saves {unit_id, start_ms} only → null / false.
  assert.deepEqual(normaliseAlignmentRows([{ unit_id: 'w01:1.1', start_ms: 1200 }]), [{ unit_id: 'w01:1.1', start_ms: 1200, end_ms: null, synth: false, words: [] }]);
});

test("unitStopMs: the row's end_ms when it has one, else the next row's start, else null", () => {
  const rows = normaliseAlignmentRows([
    { unit_id: 'a', start_ms: 1000 },
    { unit_id: 'b', start_ms: 5000, end_ms: 7000 },
    { unit_id: 'c', start_ms: 9000 },
  ]);
  assert.equal(unitStopMs(rows, 0), 5000, 'no end_ms: until the next row starts');
  assert.equal(unitStopMs(rows, 1), 7000, 'end_ms wins over the next row');
  assert.equal(unitStopMs(rows, 2), null, 'the last row without end_ms plays to the end of the file');
  assert.equal(unitStopMs(rows, -1), null);
  assert.equal(unitStopMs([], 0), null);
});

test("chapterStopMs: the last row's end_ms (a shared recording), else null", () => {
  assert.equal(chapterStopMs(normaliseAlignmentRows([{ unit_id: 'a', start_ms: 1000 }, { unit_id: 'b', start_ms: 747770, end_ms: 748900 }])), 748900);
  assert.equal(chapterStopMs(normaliseAlignmentRows([{ unit_id: 'a', start_ms: 1000, end_ms: 2000 }, { unit_id: 'b', start_ms: 5000 }])), null, 'only the last row bounds the chapter');
  assert.equal(chapterStopMs([]), null);
  assert.equal(chapterStopMs(null), null);
});

test("alignmentEndMs: end_ms counts towards the week's length (week 13 of a 13 / 14 recording)", () => {
  assert.equal(alignmentEndMs([{ unit_id: 'a', start_ms: 1000, end_ms: 4000 }]), 4000);
  assert.equal(alignmentEndMs([{ unit_id: 'a', start_ms: 1000, end_ms: 4000, words: [{ t: 'x', s: 1000, e: 6000 }] }]), 6000);
  assert.equal(alignmentEndMs([{ unit_id: 'a', start_ms: 1000, end_ms: null }]), 1000);
});

test('synthHintText: the sentence in sentence view, the week in passage view; nothing for a real voice', () => {
  assert.equal(synthHintText({ sentence: true, unitSynth: true, anySynth: true }), 'This sentence is read by a synthesised voice');
  assert.equal(synthHintText({ sentence: true, unitSynth: false, anySynth: true }), '');
  assert.equal(synthHintText({ sentence: false, unitSynth: false, anySynth: true }), 'Some or all of this week is read by a synthesised voice');
  assert.equal(synthHintText({ sentence: false, anySynth: false }), '');
  assert.equal(synthHintText(), '');
});
