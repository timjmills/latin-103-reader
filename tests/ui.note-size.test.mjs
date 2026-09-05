// node --test tests/ — the notes size (Settings → Type "Notes"): the clamp
// behind settings.noteSize and its place in normalise / patch. The reading
// size (settings.size) is untouched by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, NOTE_SIZE_MIN, NOTE_SIZE_MAX, clampNoteSize, clampSize, normaliseSettings, patchSettings } from '../app/js/sync.js';

test('noteSize: seven steps, default 4 (today\'s look)', () => {
  assert.equal(NOTE_SIZE_MIN, 1);
  assert.equal(NOTE_SIZE_MAX, 7);
  assert.equal(DEFAULT_SETTINGS.noteSize, 4);
});

test('clampNoteSize: integers inside the range pass through; others round', () => {
  for (let n = NOTE_SIZE_MIN; n <= NOTE_SIZE_MAX; n++) assert.equal(clampNoteSize(n), n);
  assert.equal(clampNoteSize(2.4), 2);
  assert.equal(clampNoteSize(2.6), 3);
  assert.equal(clampNoteSize('5'), 5);
});

test('clampNoteSize: out-of-range values are clamped to [1, 7]', () => {
  assert.equal(clampNoteSize(0), 1);
  assert.equal(clampNoteSize(-4), 1);
  assert.equal(clampNoteSize(8), 7);
  assert.equal(clampNoteSize(100), 7);
});

test('clampNoteSize: nothing usable → the fallback (4 by default)', () => {
  for (const v of [undefined, null, '', 'big', NaN, Infinity, -Infinity, true, false, {}]) assert.equal(clampNoteSize(v), 4, `clampNoteSize(${String(v)})`);
  assert.equal(clampNoteSize(null, 2), 2);
});

test('settings: noteSize defaults to 4 and is clamped by normalise / patch, independently of size', () => {
  assert.equal(normaliseSettings(null).data.noteSize, 4);
  assert.equal(normaliseSettings({ data: { size: 7 } }).data.noteSize, 4);      // an older row without the key
  assert.equal(normaliseSettings({ data: { noteSize: 6 } }).data.noteSize, 6);
  assert.equal(normaliseSettings({ data: { noteSize: 9 } }).data.noteSize, 7);
  assert.equal(normaliseSettings({ data: { noteSize: 'x' } }).data.noteSize, 4);
  const patched = patchSettings({ data: { size: 3, noteSize: 4 } }, { noteSize: 1 });
  assert.equal(patched.data.noteSize, 1);
  assert.equal(patched.data.size, 3);
  assert.equal(patchSettings({ data: { noteSize: 5 } }, { noteSize: 0 }).data.noteSize, 1);
  assert.equal(patchSettings({ data: { noteSize: 5 } }, { size: 8 }).data.noteSize, 5);
  assert.equal(clampSize(8), 8);   // the reading clamp keeps its own range
});
