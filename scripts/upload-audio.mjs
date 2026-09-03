#!/usr/bin/env node
// Upload chapter recordings to the private `audio` bucket as the signed-in user.
//
//   node scripts/upload-audio.mjs                       every audio/week-NN.mp3
//   node scripts/upload-audio.mjs audio/week-03.mp3     just that file
//   node scripts/upload-audio.mjs --dry-run             list what would be uploaded
//
// Destination: audio/{your user id}/week-NN.mp3 (replaces an existing file).
// Credentials as for seed.mjs (SEED_EMAIL / SEED_PASSWORD in .env, or a prompt).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { ROOT, loadConfig, credentials, signIn, client } from './lib/supa.mjs';

const AUDIO_DIR = join(ROOT, 'audio');
const MAX_BYTES = 50 * 1024 * 1024;   // bucket file_size_limit (free tier)
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter((a) => !a.startsWith('--')).map((f) => resolve(process.cwd(), f));

function discover() {
  if (files.length) return files;
  if (!existsSync(AUDIO_DIR)) return [];
  return readdirSync(AUDIO_DIR).filter((f) => /^week-\d\d\.(mp3|m4a|mp4|aac|ogg|wav)$/i.test(f)).sort().map((f) => join(AUDIO_DIR, f));
}

function describe(file) {
  const name = basename(file);
  const m = /^week-(\d\d)\.([a-z0-9]+)$/i.exec(name);
  if (!m) throw new Error(`${name}: expected a name like week-03.mp3`);
  const ext = m[2].toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`${name}: unsupported extension .${ext}`);
  const size = statSync(file).size;
  // Always stored as week-NN.mp3 so the app finds it; the content type is preserved.
  return { file, name, weekTag: `week-${m[1]}`, mime, size, object: `week-${m[1]}.mp3` };
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const list = discover();
  if (!list.length) {
    console.log(`No recordings found. Put them in ${AUDIO_DIR} as week-01.mp3 … week-14.mp3, or pass paths.`);
    process.exit(1);
  }
  const items = list.map(describe);
  for (const it of items) {
    console.log(`${it.name}  ${mb(it.size)}  → audio/<your-id>/${it.object}${it.size > MAX_BYTES ? '   (TOO LARGE — over 50 MB, re-encode at a lower bitrate)' : ''}`);
  }
  const tooBig = items.filter((it) => it.size > MAX_BYTES);
  if (tooBig.length) { console.error(`\n${tooBig.length} file(s) exceed the 50 MB bucket limit.`); process.exit(1); }
  if (dryRun) { console.log('\nDRY RUN — nothing uploaded.'); return; }

  const cfg = await loadConfig();
  const creds = await credentials();
  const session = await signIn(cfg, creds);
  creds.password = null;
  const api = client(cfg, session);
  console.log(`\nSigned in as ${session.user.email}\n`);

  let failed = 0;
  for (const it of items) {
    const path = `/storage/v1/object/audio/${api.uid}/${it.object}`;
    process.stdout.write(`Uploading ${it.name} (${mb(it.size)}) … `);
    try {
      await api.post(path, readFileSync(it.file), { raw: true, headers: { 'Content-Type': it.mime, 'x-upsert': 'true', 'cache-control': '3600' } });
      console.log('ok');
    } catch (e) {
      failed += 1;
      console.log('FAILED');
      console.error(`  ${e.message}`);
    }
  }
  if (failed) { console.error(`\n${failed} upload(s) failed.`); process.exit(1); }
  console.log('\nDone. In the app, open the week and choose "Align audio" to mark where each sentence starts.');
}

main().catch((e) => {
  console.error(`\nUpload failed: ${e.message}`);
  process.exit(1);
});
