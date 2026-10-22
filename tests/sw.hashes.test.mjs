// node --test tests/ — app/sw.js carries the content fingerprint of every file it serves, so an update downloads
// only what changed (scripts/sw-hashes.mjs). Out of date, an update would re-download a changed file's old copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appHashes, hashBlock, BLOCK_RE } from '../scripts/sw-hashes.mjs';

const sw = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');

test('app/sw.js fingerprints match the files (run: node scripts/sw-hashes.mjs)', () => {
  const block = BLOCK_RE.exec(sw)?.[0];
  assert.ok(block, 'app/sw.js has no // <hashes> block');
  assert.equal(block, hashBlock(appHashes()), 'out of date: run  node scripts/sw-hashes.mjs');
});

test('every precached file has a fingerprint', () => {
  const hashes = appHashes();
  const list = [...(/const PRECACHE = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const missing = list.filter((p) => p !== './' && !hashes[p]);
  assert.deepEqual(missing, []);
});
