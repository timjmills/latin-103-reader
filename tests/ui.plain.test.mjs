// node --test tests/ — the pure helpers behind the plain-words layer
// ("In plain words" under notes, the English under margin glosses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainWords, marginNotes } from '../app/js/reader.js';
import { DEFAULT_SETTINGS } from '../app/js/sync.js';
import { DEFAULT_SETTINGS as FIXTURE_DEFAULTS, withPlainDemo, DEMO_PLAIN } from '../app/js/store-fixture.js';

test('plainWords: trimmed string, null for anything blank or not a string', () => {
  assert.equal(plainWords('  A simpler note. '), 'A simpler note.');
  assert.equal(plainWords(''), null);
  assert.equal(plainWords('   '), null);
  assert.equal(plainWords(null), null);
  assert.equal(plainWords(undefined), null);
  assert.equal(plainWords(42), null);
});

test('marginNotes carries en (trimmed) or null so the UI never sees undefined', () => {
  // Invented glosses, not the book's.
  const rows = marginNotes({ margin: [{ line: 1, la: 'exemplum -ī n', en: ' an example ' }, { line: 2, la: 'aliud', en: '' }, { line: 3, la: 'tertium' }] });
  assert.deepEqual(rows.map((m) => m.en), ['an example', null, null]);
});

test('settings default plainOpen and showGlossEnglish to false in both stores', () => {
  assert.equal(DEFAULT_SETTINGS.plainOpen, false);
  assert.equal(DEFAULT_SETTINGS.showGlossEnglish, false);
  assert.equal(FIXTURE_DEFAULTS.plainOpen, false);
  assert.equal(FIXTURE_DEFAULTS.showGlossEnglish, false);
});

test('withPlainDemo: samples on the first three notes / two highlights / three glosses, only when the build has none', () => {
  const units = [
    { id: 'u1', note: 'n', margin: [{ line: 1, la: 'a' }, { line: 1, la: 'b' }] },
    { id: 'u2', note: null, margin: [] },
    { id: 'u3', note: 'n', margin: [{ line: 2, la: 'c' }, { line: 2, la: 'd' }] },
    { id: 'u4', note: 'n', margin: [] },
    { id: 'u5', note: 'n', margin: [] },
  ];
  const hl = [{ unit_id: 'u1', text: 'a' }, { unit_id: 'u2', text: 'b' }, { unit_id: 'u3', text: 'c' }];
  const out = withPlainDemo(units, hl);
  assert.deepEqual(out.units.map((u) => u.note_simple), [DEMO_PLAIN.notes[0], null, DEMO_PLAIN.notes[1], DEMO_PLAIN.notes[2], null]);
  assert.deepEqual(out.units.flatMap((u) => u.margin.map((m) => m.en ?? null)), [DEMO_PLAIN.glosses[0], DEMO_PLAIN.glosses[1], DEMO_PLAIN.glosses[2], null]);
  assert.deepEqual(out.highlights.map((h) => h.simple), [DEMO_PLAIN.highlights[0], DEMO_PLAIN.highlights[1], null]);
  assert.equal(units[0].note_simple, undefined);   // inputs untouched
  // Real data wins: nothing is injected when any note_simple / simple / en is already there.
  const real = withPlainDemo([{ id: 'x', note: 'n', note_simple: 'real', margin: [{ line: 1, la: 'a', en: 'real' }] }, { id: 'y', note: 'n', margin: [{ line: 2, la: 'b' }] }], [{ unit_id: 'x', text: 'a', simple: 'real' }, { unit_id: 'y', text: 'b' }]);
  assert.deepEqual(real.units.map((u) => u.note_simple), ['real', null]);
  assert.equal(real.units[1].margin[0].en, null);   // missing en is normalised to null, as store.js does
  assert.deepEqual(real.highlights.map((h) => h.simple), ['real', null]);
});
