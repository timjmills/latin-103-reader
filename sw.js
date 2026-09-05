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

const CACHE_VERSION = 'v33';
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
  './css/grammar.css',
  './js/grammar/index.js',
  './js/grammar/lessons.js',
  './js/grammar/items.js',
  './js/grammar/scheduler.js',
  './js/grammar/session.js',
  './js/grammar/stats.js',
  './js/grammar/ui.js',
  './js/grammar/store-grammar.js',
  './data/grammar/skills.json',
  './data/grammar/lessons/index.json',
  './data/grammar/lessons/ablative-absolute-perfect.json',
  './data/grammar/lessons/ablative-absolute.json',
  './data/grammar/lessons/ablative-agent.json',
  './data/grammar/lessons/ablative-comparison.json',
  './data/grammar/lessons/ablative-degree.json',
  './data/grammar/lessons/ablative-means.json',
  './data/grammar/lessons/ablative-origin.json',
  './data/grammar/lessons/ablative-place.json',
  './data/grammar/lessons/ablative-time.json',
  './data/grammar/lessons/accusative-destination.json',
  './data/grammar/lessons/accusative-infinitive.json',
  './data/grammar/lessons/accusative-object.json',
  './data/grammar/lessons/active-personal-endings.json',
  './data/grammar/lessons/adjective-agreement.json',
  './data/grammar/lessons/adverbs.json',
  './data/grammar/lessons/comparative.json',
  './data/grammar/lessons/conditions-contrary-to-fact.json',
  './data/grammar/lessons/cum-causal.json',
  './data/grammar/lessons/cum-narrative.json',
  './data/grammar/lessons/dative-indirect-object.json',
  './data/grammar/lessons/dative-of-agent.json',
  './data/grammar/lessons/dative-possession.json',
  './data/grammar/lessons/dative-verbs.json',
  './data/grammar/lessons/deliberative-subjunctive.json',
  './data/grammar/lessons/demonstrative-pronouns.json',
  './data/grammar/lessons/demonstratives.json',
  './data/grammar/lessons/deponent-imperatives.json',
  './data/grammar/lessons/deponent-verbs.json',
  './data/grammar/lessons/dummodo.json',
  './data/grammar/lessons/elegiac-couplet.json',
  './data/grammar/lessons/enclitics.json',
  './data/grammar/lessons/fifth-declension.json',
  './data/grammar/lessons/fourth-declension.json',
  './data/grammar/lessons/future-active.json',
  './data/grammar/lessons/future-imperative.json',
  './data/grammar/lessons/future-infinitive.json',
  './data/grammar/lessons/future-irregular.json',
  './data/grammar/lessons/future-participle.json',
  './data/grammar/lessons/future-passive.json',
  './data/grammar/lessons/future-perfect.json',
  './data/grammar/lessons/genitive-of.json',
  './data/grammar/lessons/genitive-possession.json',
  './data/grammar/lessons/gerund.json',
  './data/grammar/lessons/gerundive.json',
  './data/grammar/lessons/imperative.json',
  './data/grammar/lessons/imperfect-active.json',
  './data/grammar/lessons/imperfect-irregular.json',
  './data/grammar/lessons/imperfect-passive.json',
  './data/grammar/lessons/imperfect-subjunctive.json',
  './data/grammar/lessons/indirect-command.json',
  './data/grammar/lessons/indirect-question.json',
  './data/grammar/lessons/infinitive.json',
  './data/grammar/lessons/irregular-comparison.json',
  './data/grammar/lessons/irregular-verbs-present.json',
  './data/grammar/lessons/noli-infinitive.json',
  './data/grammar/lessons/nominative-subject.json',
  './data/grammar/lessons/noun-gender.json',
  './data/grammar/lessons/passive-periphrastic.json',
  './data/grammar/lessons/passive-personal-endings.json',
  './data/grammar/lessons/passive-voice.json',
  './data/grammar/lessons/perfect-active.json',
  './data/grammar/lessons/perfect-deponent-participle.json',
  './data/grammar/lessons/perfect-deponent.json',
  './data/grammar/lessons/perfect-infinitive.json',
  './data/grammar/lessons/perfect-passive-participle.json',
  './data/grammar/lessons/perfect-passive.json',
  './data/grammar/lessons/perfect-subjunctive.json',
  './data/grammar/lessons/personal-pronouns.json',
  './data/grammar/lessons/pluperfect-subjunctive.json',
  './data/grammar/lessons/pluperfect.json',
  './data/grammar/lessons/potential-subjunctive.json',
  './data/grammar/lessons/present-indicative-3rd.json',
  './data/grammar/lessons/present-participle.json',
  './data/grammar/lessons/present-subjunctive.json',
  './data/grammar/lessons/principal-parts.json',
  './data/grammar/lessons/prosody-scansion.json',
  './data/grammar/lessons/purpose-clause.json',
  './data/grammar/lessons/relative-pronoun.json',
  './data/grammar/lessons/result-clause.json',
  './data/grammar/lessons/sequence-of-tenses.json',
  './data/grammar/lessons/subjunctive-wish-command.json',
  './data/grammar/lessons/superlative.json',
  './data/grammar/lessons/supine.json',
  './data/grammar/lessons/third-declension-neuter.json',
  './data/grammar/lessons/third-declension.json',
  './data/grammar/lessons/vocative.json',
  './data/grammar/lessons/wishes-utinam.json',
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
