# Backend modules (workstream E) — how the UI plugs in

Everything the UI needs from E is exported by three modules. Nothing in
`index.html` is required beyond D's `<script type="module" src="js/main.js">`;
the Supabase client is injected by `auth.js` when first needed.

```js
import { auth } from './auth.js';
import { store, registerServiceWorker, SETTINGS_LS_KEY } from './store.js';
import { audio } from './audio.js';
```

## Boot sequence expected in `main.js`

```js
const user = await auth.ensureSignedIn();   // shows the sign-in overlay if there is no session
await store.ready();                        // warms IndexedDB, pulls texts + progress when online
registerServiceWorker();                    // PWA; safe to call every load
audio.attach({ setPlayingUnit });           // reader hook, see below

// Sign-out (user-initiated or session revoked) clears IndexedDB + the SW
// runtime cache and then reloads the page, which boots into the sign-in form —
// no auth.onChange handling is needed in main.js.

store.onChange((kind) => {                  // 'lookups' | 'settings' | 'alignments' | 'weeks'
  // only fires for changes that arrived from sync / another device
});
```

`store.ready()` calls `auth.ensureSignedIn()` itself, so calling it first is
optional but keeps the order explicit. Offline with a remembered login it
resolves with the cached texts (`auth.user().offline === true`).

## Store — exactly the CONTRACT interface, plus

| Extra | Purpose |
| --- | --- |
| `store.sync()` | force a flush + pull now (a "Sync" button) |
| `store.getSettings()` | synchronous-safe before `ready()`: reads the `localStorage` mirror |
| `SETTINGS_LS_KEY` | `'latin103.settings'` — the mirror key the inline `<head>` script should read to set `data-size` / `data-face` / `data-theme` before first paint |
| `registerServiceWorker()` | registers `../sw.js` relative to `js/` with scope `./` |

Rows returned by `getUnits`/`getHighlights`/`getWeeks` carry an extra
`updated_at`; highlights also have a server `id` (uuid). Everything else is
the CONTRACT shape.

`onChange(kind)` fires only for remote-origin changes (another device,
realtime, or a pull). Local writes return after the IndexedDB write; the caller
already knows what changed.

## Audio — hooks

`audio.attach(reader)` needs one method on the reader:

```js
reader.setPlayingUnit(unitId | null)   // highlight the unit now playing (null = clear)
```

Then, from user gestures (tap/click — iOS blocks programmatic play otherwise):

```js
await audio.playUnit('w01:4.2');   // rejects with a plain-English Error if no audio / not aligned
await audio.playAll('w01:1.1');    // follow-along from a unit; omit to start at 0
audio.pause(); audio.resume(); audio.stop();
audio.onState(({ mode, playing, currentUnit, currentTimeMs, durationMs }) => …);
await audio.hasAudio(weekN); await audio.isAligned(weekN);
const rows = await audio.startAlignment(weekN);   // opens the full-screen alignment overlay; null if cancelled
```

Alignment mode is self-contained (its own overlay, class prefix `audio-`),
keyboard: Space = "starts now", Z/Backspace = undo, P = pause, Esc = cancel.

Upload: `store.uploadAudio(weekN, file)` from an `<input type="file" accept="audio/*">`
(or `node scripts/upload-audio.mjs` from the terminal).

## Sign-in overlay

Rendered by `auth.ensureSignedIn()` when there is no session: `role="dialog"`,
labelled inputs, `role="alert"` error line, class prefix `auth-`, styled with
`tokens.css` variables (with fallbacks). `auth.signOut()` clears IndexedDB and
the service-worker runtime cache, then shows the overlay again.

## Service worker

`app/sw.js` precaches the shell listed in its `PRECACHE` array (relative `./`
paths). `tests/sw.precache.test.mjs` fails if a shell file under `app/` is not
listed — add new CSS/JS/data files there. Bump `CACHE_VERSION` when shipping
changes. Cross-origin (Supabase) requests are never intercepted.
