/* Latin 103 Reader — service worker.
 *
 * Shell (HTML/CSS/JS/vendor/dictionary): precached at install, cache-first.
 * Supabase (any cross-origin request): never touched — auth tokens, texts and
 * signed audio URLs go straight to the network; the texts live in IndexedDB.
 * Everything is relative to this file so the app works at
 * https://<user>.github.io/latin-103-reader/ as well as http://localhost:8000/app/.
 *
 * Bump CACHE_VERSION whenever a precached file changes.
 */

const CACHE_VERSION = 'v5';
const SHELL = `latin103-shell-${CACHE_VERSION}`;
const RUNTIME = `latin103-runtime-${CACHE_VERSION}`;

// Missing entries are tolerated (logged) so the shell still installs while
// modules are being added; keep this list in step with app/ (tests/sw.precache.test.mjs).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './css/tokens.css',
  './css/reader.css',
  './css/panels.css',
  './js/main.js',
  './js/auth.js',
  './js/store.js',
  './js/db.js',
  './js/sync.js',
  './js/audio.js',
  './js/reader.js',
  './js/wordpanel.js',
  './js/dictionary.js',
  './js/paradigms.js',
  './js/tokenize.js',
  './js/settings.js',
  './vendor/supabase.js',
  './data/glossary.json',
  './data/function-words.json',
  './data/glosses.json',
  './data/course.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

const abs = (rel) => new URL(rel, self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(PRECACHE.map(async (rel) => {
      try {
        const res = await fetch(new Request(abs(rel), { cache: 'reload' }));
        if (res.ok) await cache.put(abs(rel), res);
        else console.warn('[sw] precache skipped', rel, res.status);
      } catch (e) {
        console.warn('[sw] precache failed', rel, e && e.message);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('latin103-') && n !== SHELL && n !== RUNTIME)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'skip-waiting') self.skipWaiting();
  if (type === 'clear-runtime') event.waitUntil(caches.delete(RUNTIME).then(() => caches.open(RUNTIME)));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase etc.: network only, never cached
  if (!url.pathname.startsWith(scopePath())) return;        // outside the app folder (dev fixtures)
  event.respondWith(cacheFirst(req));
});

function scopePath() {
  const p = new URL('./', self.location.href).pathname;
  return p;
}

async function cacheFirst(req) {
  const shell = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? abs('./index.html') : req;
  let hit = await shell.match(key, { ignoreSearch: true });
  if (hit) return hit;
  const runtime = await caches.open(RUNTIME);
  hit = await runtime.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') runtime.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    if (req.mode === 'navigate') {
      const index = await shell.match(abs('./index.html'));
      if (index) return index;
    }
    throw e;
  }
}
