// node --test tests/ — the pure helpers behind margin notes and the panel divider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginNotes, marginMode, stackMargin, marginTop } from '../app/js/reader.js';
import { clampPanelWidth, SIZE_MAX, clampSize } from '../app/js/settings.js';
import { DEFAULT_SETTINGS, normaliseSettings, patchSettings } from '../app/js/sync.js';

test('marginNotes: missing → [], blanks dropped, line coerced or null, en trimmed or null', () => {
  assert.deepEqual(marginNotes({ margin: [{ line: 1, la: 'a', en: '  an invented gloss ' }] }), [{ line: 1, la: 'a', en: 'an invented gloss' }]);
  assert.deepEqual(marginNotes({}), []);
  assert.deepEqual(marginNotes({ margin: null }), []);
  // An invented gloss, not one from the book.
  assert.deepEqual(marginNotes({ margin: [{ line: '45', la: ' exemplum -ī n = rēs ficta ' }, { line: 3, la: '' }, null, { la: 'x', line: null }] }),
    [{ line: 45, la: 'exemplum -ī n = rēs ficta', en: null }, { line: null, la: 'x', en: null }]);
});

test('marginMode: phones are always inline; the gutter needs room for a readable prose column', () => {
  const base = { wide: true, colPx: 172, gutterPx: 52, em: 20 };
  assert.equal(marginMode({ ...base, wide: false, available: 2000 }), 'inline');
  assert.equal(marginMode({ ...base, available: 960 }), 'gutter');        // 1440 desktop
  assert.equal(marginMode({ ...base, available: 704 }), 'gutter');        // 768 tablet, panel closed: 480px prose = 24em
  assert.equal(marginMode({ ...base, available: 368 }), 'inline');        // 768 tablet with the panel open
  assert.equal(marginMode({ ...base, available: 704, em: 44 }), 'inline'); // largest type: 480 < 18 × 44
  assert.equal(marginMode({ ...base, available: 0 }), 'inline');
});

test('stackMargin: blocks keep their sentence top unless the one above overlaps', () => {
  const tops = stackMargin([{ top: 0, height: 40 }, { top: 10, height: 40 }, { top: 200, height: 20 }, { top: 205, height: 20 }], 8);
  assert.deepEqual(tops, [0, 48, 200, 228]);
  assert.deepEqual(stackMargin([]), []);
});

test('stackMargin: with maxUp a pushed run is pulled back up so its worst error is halved and shared', () => {
  // Three blocks each 40 high wanting tops 0/10/20: pass 1 stacks them at 0/48/96 (pushes 0/38/76).
  // Pass 2 shifts the run up by (0 + 76) / 2 = 38, bounded by maxUp and the room above (none here → 0).
  assert.deepEqual(stackMargin([{ top: 0, height: 40 }, { top: 10, height: 40 }, { top: 20, height: 40 }], 8, { maxUp: 31 }), [0, 48, 96]);
  // With room above the run (the blocks start at 100) the shift is min(38, maxUp 31, room 100) = 31.
  assert.deepEqual(stackMargin([{ top: 100, height: 40 }, { top: 110, height: 40 }, { top: 120, height: 40 }], 8, { maxUp: 31 }), [69, 117, 165]);
  // A block that was never pushed is left alone: run of one, push 0 → shift 0.
  assert.deepEqual(stackMargin([{ top: 100, height: 40 }, { top: 300, height: 40 }], 8, { maxUp: 31 }), [100, 300]);
});

test('marginTop: a smaller note lands on the sentence baseline', () => {
  // 20px text, 14.4px note in 31px line boxes: ascent gap 0.72×5.6 ≈ 4px, half-leading 8.3px.
  assert.equal(marginTop({ contentTop: 100, textSize: 20, noteSize: 14.4, noteLineHeight: 31 }), 96);
  // same size, no leading difference → unchanged
  assert.equal(marginTop({ contentTop: 100, textSize: 20, noteSize: 20, noteLineHeight: 20 }), 100);
});

test('clampPanelWidth: null keeps the CSS default; otherwise 18rem … 60vw', () => {
  assert.equal(clampPanelWidth(null, 288, 614), null);
  assert.equal(clampPanelWidth('abc', 288, 614), null);
  assert.equal(clampPanelWidth(0, 288, 614), null);
  assert.equal(clampPanelWidth(100, 288, 614), 288);
  assert.equal(clampPanelWidth(900, 288, 614), 614);
  assert.equal(clampPanelWidth(400.4, 288, 614), 400);
  assert.equal(clampPanelWidth(400, 288, 200), 288);   // max below min (tiny viewport): min wins
});

test('settings defaults carry showMargin and panelWidth; eight type sizes', () => {
  assert.equal(DEFAULT_SETTINGS.showMargin, true);
  assert.equal(DEFAULT_SETTINGS.panelWidth, null);
  assert.equal(SIZE_MAX, 8);
});

test('clampSize: integer 1–8 from any stored value; non-numeric → the default', () => {
  assert.equal(clampSize(3), 3);
  assert.equal(clampSize('3'), 3);
  assert.equal(clampSize('31'), 8);
  assert.equal(clampSize(0), 1);
  assert.equal(clampSize(9), 8);
  assert.equal(clampSize(4.6), 5);
  assert.equal(clampSize('abc'), 3);
  assert.equal(clampSize(NaN), 3);
  assert.equal(clampSize(null), 3);
  assert.equal(clampSize(undefined), 3);
  assert.equal(clampSize(true), 3);
  assert.equal(normaliseSettings({ data: { size: '3' } }).data.size, 3);
  assert.equal(normaliseSettings({ data: { size: 0 } }).data.size, 1);
  assert.equal(patchSettings(normaliseSettings(null), { size: '9' }).data.size, 8);
});
