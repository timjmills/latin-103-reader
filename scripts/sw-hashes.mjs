#!/usr/bin/env node
// Writes the content fingerprint of every file the app serves into app/sw.js (between the `<hashes>` markers).
//
// Why (2026-10-22: "the site now is working quite slowly"): each publish rebuilds the whole site, so every file comes
// back with a new date and ETag whether or not it changed, and the service worker used to fetch all ~335 shell
// files again (and drop its cache of the data files) at every version. With a fingerprint per file it keeps every
// file whose content is the same and fetches only what changed.
//
//   node scripts/sw-hashes.mjs          rewrite the block
//   node scripts/sw-hashes.mjs --check  exit 1 when it is out of date (tests/sw.hashes.test.mjs runs the same check)

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const SW = join(APP, 'sw.js');

/** Every file the app serves, as './rel/path' → the first 12 hex digits of its SHA-256. */
export function appHashes(dir = APP) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = relative(dir, full).split('\\').join('/');
      if (statSync(full).isDirectory()) { if (rel !== 'js/stubs') walk(full); continue; }
      if (rel === 'sw.js' || name.startsWith('.') || name.startsWith('_') || /README|\.md$/i.test(name)) continue;
      if (!/\.(html|css|js|json|webmanifest|svg|png|jpe?g|webp|woff2?|mp3|m4a|ogg|txt)$/i.test(name)) continue;
      out[`./${rel}`] = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 12);
    }
  };
  walk(dir);
  return out;
}

export function hashBlock(hashes) {
  const lines = Object.entries(hashes).map(([k, v]) => `  ${JSON.stringify(k)}: '${v}',`);
  return `// <hashes> written by scripts/sw-hashes.mjs — do not edit by hand\nconst HASHES = {\n${lines.join('\n')}\n};\n// </hashes>`;
}

export const BLOCK_RE = /\/\/ <hashes>[\s\S]*?\/\/ <\/hashes>/;

if (import.meta.url === `file://${process.argv[1]}`) {
  const sw = readFileSync(SW, 'utf8');
  if (!BLOCK_RE.test(sw)) { console.error('app/sw.js has no // <hashes> … // </hashes> block'); process.exit(2); }
  const next = sw.replace(BLOCK_RE, hashBlock(appHashes()));
  if (process.argv.includes('--check')) {
    if (next !== sw) { console.error('app/sw.js fingerprints are out of date: run  node scripts/sw-hashes.mjs'); process.exit(1); }
    console.log('app/sw.js fingerprints are up to date');
  } else {
    writeFileSync(SW, next);
    console.log(`app/sw.js: ${Object.keys(appHashes()).length} fingerprints written`);
  }
}
