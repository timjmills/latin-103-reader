// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHighlights, segmentUnit, activeUnderlines, unitLookups, unitRef, noteLabel } from '../app/js/reader.js';
import { audioStateText } from '../app/js/settings.js';
import { tokenize } from '../app/js/tokenize.js';

// Invented sentences (not from the course texts).
const LA = 'Iūlia: "Gallus ē hortō currēns \'lupus captus est\' clāmat, \'Laetāminī, amīcī meī!';

test('resolveHighlights: exact substring → offsets', () => {
  const { ranges, missing } = resolveHighlights(LA, [{ unit_id: 'w01:91.1', text: 'Laetāminī', label: 'x', note: 'y' }]);
  assert.equal(missing.length, 0);
  assert.equal(ranges.length, 1);
  assert.equal(LA.slice(ranges[0].start, ranges[0].end), 'Laetāminī');
  assert.equal(ranges[0].label, 'x');
});

test('resolveHighlights: occurrence picks the nth match; miss is reported not guessed', () => {
  const la = 'sequere mē, sequere!';
  const { ranges } = resolveHighlights(la, [{ text: 'sequere', occurrence: 2 }]);
  assert.equal(ranges[0].start, 12);
  const r = resolveHighlights(la, [{ text: 'Proficīscere' }, { text: 'sequere', occurrence: 3 }]);
  assert.equal(r.ranges.length, 0);
  assert.equal(r.missing.length, 2);
});

test('resolveHighlights: overlaps drop the later range, output sorted', () => {
  const la = 'abc def ghi';
  const { ranges, missing } = resolveHighlights(la, [{ text: 'def ghi' }, { text: 'abc def' }, { text: 'ghi' }]);
  assert.deepEqual(ranges.map((r) => r.text), ['abc def', 'ghi']);   // 'def ghi' overlaps and is dropped
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reason, 'overlap');
});

test('segmentUnit: words overlapping a range join it; edge whitespace stays outside', () => {
  const la = 'Cane dormiente, Iūlia canit';
  const tokens = tokenize(la);
  const { ranges } = resolveHighlights(la, [{ text: 'Cane dormiente', label: 'abl abs' }]);
  const groups = segmentUnit(tokens, ranges);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].range.label, 'abl abs');
  assert.equal(groups[0].tokens.map((t) => t.text).join(''), 'Cane dormiente');
  assert.equal(groups[1].range, null);
  assert.equal(groups[1].tokens.map((t) => t.text).join(''), ', Iūlia canit');
});

test('segmentUnit: partial-word range still lights the whole word', () => {
  const la = 'Laetāminī amīcī';
  const tokens = tokenize(la);
  const groups = segmentUnit(tokens, [{ start: 4, end: 9, label: 'ending' }]);
  assert.equal(groups[0].tokens[0].text, 'Laetāminī');
  assert.equal(groups[0].range.label, 'ending');
});

test('tokenize: forms are lowercase, macron-stripped, offsets round-trip', () => {
  const t = tokenize(LA).filter((x) => x.isWord);
  assert.equal(t[0].form, 'iulia');
  assert.equal(t[1].form, 'gallus');
  assert.equal(t.find((x) => x.text === 'Laetāminī').form, 'laetamini');
  for (const x of t) assert.equal(LA.slice(x.start, x.end), x.text);
  assert.equal(tokenize(LA).map((x) => x.text).join(''), LA);
});

test('activeUnderlines: looked-up and not learned', () => {
  const lookups = new Map([
    ['labyrintho', { first_seen_unit_id: 'w01:25.2', learned_at: null }],
    ['est', { first_seen_unit_id: 'w01:28.1', learned_at: '2026-09-01T00:00:00Z' }],
  ]);
  const seen = activeUnderlines(lookups);
  assert.ok(seen.has('labyrintho'));
  assert.ok(!seen.has('est'));
});

test('unitLookups: forms in this sentence first (text order), then first-seen-here extras', () => {
  const la = 'Lupus in parvō hortō dormiēbat.';
  const tokens = tokenize(la);
  const lookups = new Map([
    ['horto', { first_seen_unit_id: 'w01:25.2', learned_at: null }],
    ['lupus', { first_seen_unit_id: 'w01:25.1', learned_at: null }],
    ['iulia', { first_seen_unit_id: 'w01:25.2', learned_at: null }],   // looked up "here" but tokeniser differs
    ['est', { first_seen_unit_id: 'w01:28.1', learned_at: null }],
  ]);
  assert.deepEqual(unitLookups('w01:25.2', tokens, lookups).map((x) => x.form), ['lupus', 'horto', 'iulia']);
});

test('unitRef parses line and sentence numbers', () => {
  assert.deepEqual(unitRef('w01:25.2'), { line: 25, n: 2 });
  assert.equal(unitRef('w05:b3'), null);
});

test('noteLabel: line/sentence ids read naturally; block ids degrade to "this sentence"', () => {
  assert.equal(noteLabel({ id: 'w01:25.2', line_no: 25, note: 'x' }), 'Grammar note for sentence 2 on line 25');
  assert.equal(noteLabel({ id: 'w07:b3.2', line_no: null, note: 'x' }), 'Grammar note for this sentence');
  assert.equal(noteLabel({ id: 'w01:25.2', line_no: null, note: 'x' }), 'Grammar note for this sentence');
});

test('audioStateText: none / uploaded / partially aligned / fully aligned', () => {
  assert.equal(audioStateText({ hasAudio: false }), 'No recording for this week yet.');
  assert.equal(audioStateText({ hasAudio: true, alignedCount: 0, total: 40 }), 'Recording uploaded — not aligned yet.');
  assert.equal(audioStateText({ hasAudio: true, alignedCount: 3, total: 40 }), 'Aligned 3 of 40 sentences.');
  assert.equal(audioStateText({ hasAudio: true, alignedCount: 40, total: 40 }), 'Aligned — all 40 sentences.');
});
