// node --test tests/ — playback speed: the rate clamp / normalisation behind
// settings.audioRate (Settings → Audio → Speed and the transport's "1.0×").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, RATE_MIN, RATE_MAX, RATE_STEPS, clampRate, normaliseSettings, patchSettings } from '../app/js/sync.js';
import { fmtRate } from '../app/js/settings.js';

test('RATE_STEPS: 0.5 … 1.2 in tenths, ascending, 1.0 included', () => {
  assert.deepEqual([...RATE_STEPS], [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2]);
  assert.equal(RATE_STEPS[0], RATE_MIN);
  assert.equal(RATE_STEPS[RATE_STEPS.length - 1], RATE_MAX);
  assert.equal(DEFAULT_SETTINGS.audioRate, 1);
});

test('clampRate: values inside the range pass through, rounded to one decimal', () => {
  for (const r of RATE_STEPS) assert.equal(clampRate(r), r);
  assert.equal(clampRate(0.75), 0.8);
  assert.equal(clampRate(0.84), 0.8);
  assert.equal(clampRate(1.05), 1.1);
  assert.equal(clampRate('0.9'), 0.9);
});

test('clampRate: out-of-range values are clamped to [0.5, 1.2]', () => {
  assert.equal(clampRate(0), 0.5);
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate(-3), 0.5);
  assert.equal(clampRate(2), 1.2);
  assert.equal(clampRate(1.21), 1.2);
});

test('clampRate: nothing usable → the fallback (1.0 by default)', () => {
  assert.equal(clampRate(undefined), 1);
  assert.equal(clampRate(null), 1);
  assert.equal(clampRate(''), 1);
  assert.equal(clampRate('fast'), 1);
  assert.equal(clampRate(NaN), 1);
  assert.equal(clampRate(Infinity), 1);
  assert.equal(clampRate(-Infinity), 1);
  assert.equal(clampRate(true), 1);
  assert.equal(clampRate(false), 1);
  assert.equal(clampRate({}), 1);
  assert.equal(clampRate(null, 0.8), 0.8);
});

test('clampRate: every result is one of RATE_STEPS', () => {
  for (let v = -1; v <= 3; v += 0.037) assert.ok(RATE_STEPS.includes(clampRate(v)), `clampRate(${v}) = ${clampRate(v)}`);
});

test('settings: audioRate defaults to 1 and is clamped by normalise / patch', () => {
  assert.equal(normaliseSettings(null).data.audioRate, 1);
  assert.equal(normaliseSettings({ data: { size: 2 } }).data.audioRate, 1);
  assert.equal(normaliseSettings({ data: { audioRate: 0.7 } }).data.audioRate, 0.7);
  assert.equal(normaliseSettings({ data: { audioRate: 3 } }).data.audioRate, 1.2);
  assert.equal(normaliseSettings({ data: { audioRate: 'x' } }).data.audioRate, 1);
  assert.equal(patchSettings({ data: { audioRate: 1 } }, { audioRate: 0.5 }).data.audioRate, 0.5);
  assert.equal(patchSettings({ data: { audioRate: 1 } }, { audioRate: 0.2 }).data.audioRate, 0.5);
  assert.equal(patchSettings({ data: { audioRate: 0.6 } }, { size: 4 }).data.audioRate, 0.6);
});

test('fmtRate: one decimal and the multiplication sign; bad input shows the default', () => {
  assert.equal(fmtRate(1), '1.0×');
  assert.equal(fmtRate(0.5), '0.5×');
  assert.equal(fmtRate(1.2), '1.2×');
  assert.equal(fmtRate(0.75), '0.8×');
  assert.equal(fmtRate(undefined), '1.0×');
});
