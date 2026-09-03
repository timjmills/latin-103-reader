// node --test tests/ — keeps app/sw.js honest about the shell it precaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');

function precacheList() {
  const m = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(m, 'PRECACHE array not found in app/sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function shellFiles(dir = APP) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(APP, full).split('\\').join('/');
    if (statSync(full).isDirectory()) {
      if (rel === 'js/stubs') continue;                 // dev-only stand-ins
      out.push(...shellFiles(full));
      continue;
    }
    if (rel === 'sw.js' || /README|\.md$/i.test(name)) continue;
    if (rel === 'js/store-fixture.js') continue;        // dev only
    if (/\.(html|css|js|json|webmanifest|svg|png|woff2?)$/i.test(name)) out.push(rel);
  }
  return out;
}

test('every precache entry is a relative "./" path (GitHub Pages sub-path safe)', () => {
  const list = precacheList();
  assert.ok(list.length > 10);
  for (const p of list) {
    assert.ok(p.startsWith('./'), `${p} must start with ./`);
    assert.ok(!p.includes('supabase.co'), `${p} must not reference Supabase`);
    assert.ok(!p.startsWith('/'), `${p} must not be root-absolute`);
  }
  assert.ok(list.includes('./') && list.includes('./index.html'), 'shell entry points precached');
});

test('sw.js never uses leading-slash absolute URLs', () => {
  for (const line of sw.split('\n')) {
    if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
    assert.ok(!/['"]\/(?!\/)/.test(line), `absolute path in sw.js: ${line.trim()}`);
  }
});

test('every shell file that exists under app/ is in PRECACHE', () => {
  const list = new Set(precacheList().map((p) => p.replace(/^\.\//, '')));
  const missing = shellFiles().filter((f) => !list.has(f));
  assert.deepEqual(missing, [], `add these to PRECACHE in app/sw.js: ${missing.join(', ')}`);
});

test('manifest icons exist and are relative', () => {
  const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative`);
    assert.ok(existsSync(join(APP, icon.src)), `${icon.src} missing — run node scripts/make-icons.mjs`);
  }
});
