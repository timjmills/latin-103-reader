// node --test tests/ — the pure helpers behind the section-summary disclosures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partSummary, summaryStorageKey } from '../app/js/reader.js';
import { DEFAULT_SETTINGS } from '../app/js/sync.js';
import { DEFAULT_SETTINGS as FIXTURE_DEFAULTS } from '../app/js/store-fixture.js';

test('partSummary: trimmed en/la, null when a part carries neither', () => {
  assert.equal(partSummary({ part: 'Pars I' }), null);
  assert.equal(partSummary(null), null);
  assert.deepEqual(partSummary({ summary_en: '  Only English. ' }), { en: 'Only English.', la: '' });
  // Invented text, not the book's.
  assert.deepEqual(partSummary({ summary_en: 'Syra tells a story.', summary_la: ' Syra fābulam nārrat. ' }), { en: 'Syra tells a story.', la: 'Syra fābulam nārrat.' });
  assert.equal(partSummary({ summary_en: '   ', summary_la: 42 }), null);
});

test('summaryStorageKey: one key per week and part, slugged; stable for the same input', () => {
  assert.equal(summaryStorageKey('w01', 'Pars I'), 'l103.summary.w01.pars-i');
  assert.equal(summaryStorageKey('w01', 'Pars II'), 'l103.summary.w01.pars-ii');
  assert.equal(summaryStorageKey('w07', '  Capitulum XXV · 1 '), 'l103.summary.w07.capitulum-xxv-1');
  assert.equal(summaryStorageKey('w01', 'Pars I'), summaryStorageKey('w01', 'Pars I'));
  assert.notEqual(summaryStorageKey('w01', 'Pars I'), summaryStorageKey('w02', 'Pars I'));
  assert.equal(summaryStorageKey(undefined, ''), 'l103.summary.week.part');
});

test('settings default showSummaries to true in both stores', () => {
  assert.equal(DEFAULT_SETTINGS.showSummaries, true);
  assert.equal(FIXTURE_DEFAULTS.showSummaries, true);
});
