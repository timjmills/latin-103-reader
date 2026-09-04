// node --test tests/ — the pure helpers behind the audio word cursor and the
// Audio toggle: alignment-word → token mapping, the cursor lookup, row normalisation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseWord, mapWordsToTokens, wordAt, WORD_HOLD_MS } from '../app/js/audio.js';
import { DEFAULT_SETTINGS, normaliseSettings, patchSettings, cleanWords, normaliseAlignmentRows } from '../app/js/sync.js';

test('normaliseWord: lowercase, macrons stripped, v→u, j→i, punctuation dropped', () => {
  assert.equal(normaliseWord('Nārrāvit,'), 'narrauit');
  assert.equal(normaliseWord('Iūlius'), 'iulius');
  assert.equal(normaliseWord('juvenis'), 'iuuenis');
  assert.equal(normaliseWord('"Nōlī"'), 'noli');
  assert.equal(normaliseWord('—'), '');
  assert.equal(normaliseWord(null), '');
});

test('mapWordsToTokens: exact sequence maps one-to-one', () => {
  // Invented sentence, not the book's.
  const tokens = ['Nauta', 'postquam', 'nāvem', 'Titī', 'vīdit'];
  assert.deepEqual(mapWordsToTokens(['nauta', 'postquam', 'navem', 'titi', 'vidit,'], tokens), [0, 1, 2, 3, 4]);
});

test('mapWordsToTokens: mis-heard, merged and split words are skipped, never guessed', () => {
  // An invented sentence (not the book's) with the kind of noise Whisper makes: the first words missed,
  // "inquit" heard as "in quit", "mē dērīdēre" as "mede ridere".
  const tokens = ['Nauta', 'postquam', 'nāvem', 'Titī', 'vīdit', 'rīdēre', 'coepit', 'sed', 'Lūcius', 'Nōlī', 'inquit', 'mē', 'dērīdēre'];
  const words = ['titi', 'vidit,', 'ridere', 'coepit,', 'sed', 'lucius,', 'noli', 'in', 'quit', 'mede', 'ridere'];
  assert.deepEqual(mapWordsToTokens(words, tokens), [3, 4, 5, 6, 7, 8, 9, -1, -1, -1, -1]);
});

test('mapWordsToTokens: order is respected — a repeated word maps to its own occurrence', () => {
  const tokens = ['et', 'pater', 'et', 'māter', 'et', 'līberī'];
  assert.deepEqual(mapWordsToTokens(['et', 'mater', 'et', 'liberi'], tokens), [0, 3, 4, 5]);
  // Extra words in the recording (a false start) do not shift the rest.
  assert.deepEqual(mapWordsToTokens(['pater', 'pater', 'et', 'mater'], tokens), [1, -1, 2, 3]);
});

test('mapWordsToTokens: empty inputs and words that normalise to nothing', () => {
  assert.deepEqual(mapWordsToTokens([], ['a']), []);
  assert.deepEqual(mapWordsToTokens(['a', '—'], []), [-1, -1]);
  assert.deepEqual(mapWordsToTokens(['—', 'a'], ['a']), [-1, 0]);
});

test('wordAt: binary search by start; a word holds until the next starts or a pause longer than the hold', () => {
  const words = [{ s: 1000, e: 1400 }, { s: 1400, e: 1900 }, { s: 3000, e: 3300 }];
  assert.equal(wordAt(words, 999), null);
  assert.equal(wordAt(words, 1000), words[0]);
  assert.equal(wordAt(words, 1399), words[0]);
  assert.equal(wordAt(words, 1400), words[1]);
  assert.equal(wordAt(words, 1900 + WORD_HOLD_MS), words[1]);       // still held
  assert.equal(wordAt(words, 1900 + WORD_HOLD_MS + 1), null);       // a pause: no cursor
  assert.equal(wordAt(words, 3100), words[2]);
  assert.equal(wordAt(words, 3300 + WORD_HOLD_MS + 1), null);       // after the last word
  assert.equal(wordAt([], 5), null);
});

test('cleanWords: [] for anything but an array; bad entries dropped; text order kept; e ≥ s', () => {
  assert.deepEqual(cleanWords(undefined), []);
  assert.deepEqual(cleanWords(null), []);
  assert.deepEqual(cleanWords('x'), []);
  assert.deepEqual(cleanWords([{ t: 'b', s: 500, e: 400 }, { t: 'a', s: 100, e: 200 }, { t: '', s: 1, e: 2 }, { t: 'c', s: 'x', e: 2 }, null]),
    [{ t: 'b', s: 500, e: 500 }, { t: 'a', s: 100, e: 200 }]);
});

test('normaliseAlignmentRows: start_ms order, words normalised to [] (manual rows) or kept', () => {
  const rows = normaliseAlignmentRows([
    { unit_id: 'w01:2.1', start_ms: 5000.4 },
    { unit_id: 'w01:1.1', start_ms: '1000', words: [{ t: 'Syra', s: 1000, e: 1300 }] },
    { unit_id: '', start_ms: 3 },
    { unit_id: 'w01:3.1', start_ms: NaN },
  ]);
  assert.deepEqual(rows, [
    { unit_id: 'w01:1.1', start_ms: 1000, end_ms: null, synth: false, words: [{ t: 'Syra', s: 1000, e: 1300 }] },
    { unit_id: 'w01:2.1', start_ms: 5000, end_ms: null, synth: false, words: [] },
  ]);
});

test('settings: every boolean setting is coerced — "false" / "0" / 0 read as off, "true" / "1" / 1 as on, junk as the default', () => {
  const keys = ['showAudio', 'showSummaries', 'plainOpen', 'showGlossEnglish', 'showMargin', 'showHighlights', 'showUnderlines', 'compact'];
  for (const k of keys) {
    for (const off of ['false', '0', 0, false, 'FALSE', ' false ']) assert.equal(normaliseSettings({ data: { [k]: off } }).data[k], false, `${k}: ${JSON.stringify(off)}`);
    for (const on of ['true', '1', 1, true, 'TRUE']) assert.equal(normaliseSettings({ data: { [k]: on } }).data[k], true, `${k}: ${JSON.stringify(on)}`);
    for (const junk of ['maybe', {}, [], NaN, 2, null, undefined]) assert.equal(normaliseSettings({ data: { [k]: junk } }).data[k], DEFAULT_SETTINGS[k], `${k}: junk`);
    assert.equal(patchSettings({ data: {} }, { [k]: 'false' }).data[k], false);
    assert.equal(patchSettings({ data: {} }, { [k]: '1' }).data[k], true);
  }
});

test('settings: showAudio defaults to true and survives normalise / patch', () => {
  assert.equal(DEFAULT_SETTINGS.showAudio, true);
  assert.equal(normaliseSettings({ data: { size: 2 } }).data.showAudio, true);
  assert.equal(normaliseSettings({ data: { showAudio: false } }).data.showAudio, false);
  assert.equal(patchSettings({ data: { showAudio: false } }, { showAudio: true }).data.showAudio, true);
});
