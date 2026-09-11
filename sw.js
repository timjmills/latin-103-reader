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

const CACHE_VERSION = 'v53';
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
  './js/chapters.js',
  './js/progress.js',
  './css/grammar.css',
  './css/chapters.css',
  './css/progress.css',
  './css/print.css',
  './js/grammar/index.js',
  './js/grammar/lessons.js',
  './js/grammar/items.js',
  './js/grammar/scheduler.js',
  './js/grammar/session.js',
  './js/grammar/stats.js',
  './js/grammar/ui.js',
  './js/grammar/store-grammar.js',
  './data/grammar/skills.json',
  './data/grammar/paradigms.json',
  './data/glossary-headwords.json',
  './data/grammar/occurrences.json',
  './data/grammar/lessons/index.json',
  './data/grammar/lessons/ablative-absolute-perfect.json',
  './data/grammar/lessons/ablative-absolute.json',
  './data/grammar/lessons/ablative-accompaniment.json',
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
  // The generated banks (GRAMMAR-CONTRACT.md §11b): built by pipeline/build_generated.py, one per sentence skill with templates.
  './data/grammar/generated/index.json',
  // The written teaching sentences (GRAMMAR-CONTRACT.md §1), one file a skill: the whole of what Learn draws on.
  './data/grammar/sentences/ablative-absolute-perfect.json',
  './data/grammar/sentences/ablative-absolute.json',
  './data/grammar/sentences/ablative-accompaniment.json',
  './data/grammar/sentences/ablative-agent.json',
  './data/grammar/sentences/ablative-comparison.json',
  './data/grammar/sentences/ablative-degree.json',
  './data/grammar/sentences/ablative-means.json',
  './data/grammar/sentences/ablative-origin.json',
  './data/grammar/sentences/ablative-place.json',
  './data/grammar/sentences/ablative-time.json',
  './data/grammar/sentences/accusative-destination.json',
  './data/grammar/sentences/accusative-infinitive.json',
  './data/grammar/sentences/accusative-object.json',
  './data/grammar/sentences/active-personal-endings.json',
  './data/grammar/sentences/adjective-agreement.json',
  './data/grammar/sentences/adverbs.json',
  './data/grammar/sentences/comparative.json',
  './data/grammar/sentences/conditions-contrary-to-fact.json',
  './data/grammar/sentences/cum-causal.json',
  './data/grammar/sentences/cum-narrative.json',
  './data/grammar/sentences/dative-indirect-object.json',
  './data/grammar/sentences/dative-of-agent.json',
  './data/grammar/sentences/dative-possession.json',
  './data/grammar/sentences/dative-verbs.json',
  './data/grammar/sentences/deliberative-subjunctive.json',
  './data/grammar/sentences/demonstrative-pronouns.json',
  './data/grammar/sentences/demonstratives.json',
  './data/grammar/sentences/deponent-imperatives.json',
  './data/grammar/sentences/deponent-verbs.json',
  './data/grammar/sentences/dummodo.json',
  './data/grammar/sentences/elegiac-couplet.json',
  './data/grammar/sentences/enclitics.json',
  './data/grammar/sentences/fifth-declension.json',
  './data/grammar/sentences/fourth-declension.json',
  './data/grammar/sentences/future-active.json',
  './data/grammar/sentences/future-imperative.json',
  './data/grammar/sentences/future-infinitive.json',
  './data/grammar/sentences/future-irregular.json',
  './data/grammar/sentences/future-participle.json',
  './data/grammar/sentences/future-passive.json',
  './data/grammar/sentences/future-perfect.json',
  './data/grammar/sentences/genitive-of.json',
  './data/grammar/sentences/genitive-possession.json',
  './data/grammar/sentences/gerund.json',
  './data/grammar/sentences/gerundive.json',
  './data/grammar/sentences/imperative.json',
  './data/grammar/sentences/imperfect-active.json',
  './data/grammar/sentences/imperfect-irregular.json',
  './data/grammar/sentences/imperfect-passive.json',
  './data/grammar/sentences/imperfect-subjunctive.json',
  './data/grammar/sentences/indirect-command.json',
  './data/grammar/sentences/indirect-question.json',
  './data/grammar/sentences/infinitive.json',
  './data/grammar/sentences/irregular-comparison.json',
  './data/grammar/sentences/irregular-verbs-present.json',
  './data/grammar/sentences/noli-infinitive.json',
  './data/grammar/sentences/nominative-subject.json',
  './data/grammar/sentences/noun-gender.json',
  './data/grammar/sentences/passive-periphrastic.json',
  './data/grammar/sentences/passive-personal-endings.json',
  './data/grammar/sentences/passive-voice.json',
  './data/grammar/sentences/perfect-active.json',
  './data/grammar/sentences/perfect-deponent-participle.json',
  './data/grammar/sentences/perfect-deponent.json',
  './data/grammar/sentences/perfect-infinitive.json',
  './data/grammar/sentences/perfect-passive-participle.json',
  './data/grammar/sentences/perfect-passive.json',
  './data/grammar/sentences/perfect-subjunctive.json',
  './data/grammar/sentences/personal-pronouns.json',
  './data/grammar/sentences/pluperfect-subjunctive.json',
  './data/grammar/sentences/pluperfect.json',
  './data/grammar/sentences/potential-subjunctive.json',
  './data/grammar/sentences/present-indicative-3rd.json',
  './data/grammar/sentences/present-participle.json',
  './data/grammar/sentences/present-subjunctive.json',
  './data/grammar/sentences/principal-parts.json',
  './data/grammar/sentences/prosody-scansion.json',
  './data/grammar/sentences/purpose-clause.json',
  './data/grammar/sentences/relative-pronoun.json',
  './data/grammar/sentences/result-clause.json',
  './data/grammar/sentences/sequence-of-tenses.json',
  './data/grammar/sentences/subjunctive-wish-command.json',
  './data/grammar/sentences/superlative.json',
  './data/grammar/sentences/supine.json',
  './data/grammar/sentences/third-declension-neuter.json',
  './data/grammar/sentences/third-declension.json',
  './data/grammar/sentences/vocative.json',
  './data/grammar/sentences/wishes-utinam.json',
  // The sentence templates (GRAMMAR-CONTRACT.md §11), one file a skill as they are written.
  './data/grammar/templates/ablative-agent.json',
  './data/grammar/templates/ablative-means.json',
  './data/grammar/templates/accusative-infinitive.json',
  './data/grammar/templates/accusative-object.json',
  './data/grammar/templates/dative-indirect-object.json',
  './data/grammar/templates/ablative-absolute.json',
  './data/grammar/templates/perfect-active.json',
  './data/grammar/templates/purpose-clause.json',
  './data/grammar/templates/ablative-absolute-perfect.json',
  './data/grammar/templates/ablative-degree.json',
  './data/grammar/templates/adverbs.json',
  './data/grammar/templates/enclitics.json',
  './data/grammar/templates/noli-infinitive.json',
  './data/grammar/templates/passive-periphrastic.json',
  './data/grammar/templates/conditions-contrary-to-fact.json',
  './data/grammar/templates/cum-causal.json',
  './data/grammar/templates/cum-narrative.json',
  './data/grammar/templates/deliberative-subjunctive.json',
  './data/grammar/templates/dummodo.json',
  './data/grammar/templates/indirect-command.json',
  './data/grammar/templates/indirect-question.json',
  './data/grammar/templates/potential-subjunctive.json',
  './data/grammar/templates/result-clause.json',
  './data/grammar/templates/sequence-of-tenses.json',
  './data/grammar/templates/subjunctive-wish-command.json',
  './data/grammar/templates/wishes-utinam.json',
  './vendor/supabase.js',
  './data/glossary.json',
  './data/function-words.json',
  './data/glosses.json',
  './data/course.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './data/grammar/questions/01.json',
  './data/grammar/questions/02.json',
  './data/grammar/questions/03.json',
  './data/grammar/questions/04.json',
  './data/grammar/questions/05.json',
  './data/grammar/questions/06.json',
  './data/grammar/questions/07.json',
  './data/grammar/questions/08.json',
  './data/grammar/questions/09.json',
  './data/grammar/questions/10.json',
  './data/grammar/questions/11.json',
  './data/grammar/questions/12.json',
  './data/grammar/questions/13.json',
  './data/grammar/questions/14.json',
  './data/grammar/questions/15.json',
  './data/grammar/questions/16.json',
  './data/grammar/questions/17.json',
  './data/grammar/questions/18.json',
  './data/grammar/questions/19.json',
  './data/grammar/questions/20.json',
  './data/grammar/questions/21.json',
  './data/grammar/questions/22.json',
  './data/grammar/questions/23.json',
  './data/grammar/questions/24.json',
  './data/grammar/questions/25.json',
  './data/grammar/questions/26.json',
  './data/grammar/questions/27.json',
  './data/grammar/questions/28.json',
  './data/grammar/questions/29.json',
  './data/grammar/questions/30.json',
  './data/grammar/questions/31.json',
  './data/grammar/questions/32.json',
  './data/grammar/questions/33.json',
  './data/grammar/questions/34.json',
  './data/grammar/questions/index.json',
  './data/grammar/vocab/01.json',
  './data/grammar/vocab/02.json',
  './data/grammar/vocab/03.json',
  './data/grammar/vocab/04.json',
  './data/grammar/vocab/05.json',
  './data/grammar/vocab/06.json',
  './data/grammar/vocab/07.json',
  './data/grammar/vocab/08.json',
  './data/grammar/vocab/09.json',
  './data/grammar/vocab/10.json',
  './data/grammar/vocab/11.json',
  './data/grammar/vocab/12.json',
  './data/grammar/vocab/13.json',
  './data/grammar/vocab/14.json',
  './data/grammar/vocab/15.json',
  './data/grammar/vocab/16.json',
  './data/grammar/vocab/17.json',
  './data/grammar/vocab/18.json',
  './data/grammar/vocab/19.json',
  './data/grammar/vocab/20.json',
  './data/grammar/vocab/21.json',
  './data/grammar/vocab/22.json',
  './data/grammar/vocab/23.json',
  './data/grammar/vocab/24.json',
  './data/grammar/vocab/25.json',
  './data/grammar/vocab/26.json',
  './data/grammar/vocab/27.json',
  './data/grammar/vocab/28.json',
  './data/grammar/vocab/29.json',
  './data/grammar/vocab/30.json',
  './data/grammar/vocab/31.json',
  './data/grammar/vocab/32.json',
  './data/grammar/vocab/33.json',
  './data/grammar/vocab/34.json',
  './data/grammar/vocab/index.json',
  './js/grammar/generate.js',
  './js/grammar/inputs.js',
  './js/grammar/sets.js',
  './js/grammar/stage3.js',
  './js/grammar/today.js',
  // wave 3
  './js/grammar/print.js',
  // the chapter spine (GRAMMAR-CONTRACT.md "Chapter spine"): ./js/chapters.js and ./css/chapters.css are above
  './js/grammar/chapter.js',
];

const abs = (rel) => new URL(rel, self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // In chunks, not all ~180 at once: a phone that opened every connection in one Promise.all stalled the install (m9).
    const CHUNK = 12;
    const one = async (rel) => {
      try {
        const res = await fetch(new Request(abs(rel), { cache: 'reload' }));
        if (res.ok) await cache.put(abs(rel), res);
        else console.warn('[sw] precache skipped', rel, res.status);
      } catch (e) {
        console.warn('[sw] precache failed', rel, e && e.message);
      }
    };
    for (let i = 0; i < PRECACHE.length; i += CHUNK) await Promise.all(PRECACHE.slice(i, i + CHUNK).map(one));
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
