# Reader UI — hooks for the other workstreams

Owner: workstream D. Files: `index.html`, `css/*`, `js/main.js`, `reader.js`,
`wordpanel.js`, `settings.js`, `store-fixture.js`.

## Boot and module switches (`main.js`)

- Dictionary modules (`tokenize.js`, `dictionary.js`, `paradigms.js`) are
  imported straight from `app/js/`.
- Store: `?fixture=1` in the URL, or a missing `config.js` / empty
  `SUPABASE_URL`, selects `store-fixture.js`; otherwise `./store.js` +
  `./auth.js` are imported. `<html data-fixture="1|0">` says which.
- Settings are read once before `store.ready()` (the localStorage mirror) and
  re-read after it, so a fresh device picks up the synced row; `store.onChange`
  is subscribed before `ready()` so nothing emitted during boot is lost.
- Sign-in: with the real store, `auth.ensureSignedIn()` runs before anything
  loads (E's own form). "Sign out" in settings calls `auth.signOut()`.
- `registerServiceWorker()` (exported by E's `store.js`) is called once the
  reader is ready, real store only.
- `./audio.js` is loaded with either store (`audio.attach(reader, store)` hands
  it the store in use; the fixture store keeps uploads as in-memory object
  URLs). Used from its `audio` export:
  - `attach({ setPlayingUnit }, store)` at boot — follow-along highlighting.
  - `playUnit(unitId)` when a per-unit play button is tapped; a rejection is
    shown in `#notice` and announced through `#live`.
  - `playAll(fromUnitId)` — "Play chapter" in the settings menu; while a
    chapter plays, `#transport` (Pause / Stop, "sentence N of M") is shown from
    `audio.onState`.
  - `startAlignment(weekN)` — "Align audio…" in the settings menu.
  - `invalidate(weekN)` after an upload or a new alignment.
- Settings → Audio section (`initSettings(dialog, { audio })`): state line
  ("No recording" / "uploaded — not aligned" / "Aligned N of M"), Upload
  chapter MP3 (`store.uploadAudio(weekN, file)`), Align, Play chapter / Pause /
  Stop. The section is hidden when `audio` is null.
- Per-unit play buttons are shown only when the week has a recording **and**
  an alignment (`reader.setWeek(week, units, highlights, { audio, lookups })`
  renders once with both).

## Reader hooks (E)

- `window.latinReader.reader.setPlayingUnit(unitId | null)` — adds
  `.is-playing` to the unit (passage or sentence view) and scrolls it into
  view; `null` clears. (`audio.attach` receives the same function.)
- `window.latinReader.reader.setAudioAvailable(bool)` — shows/hides the per-unit
  play buttons. `main.js` sets it from `store.getAudioUrl(weekN)` +
  `store.getAlignment(weekN)` on every week load, after an upload, after an
  alignment, and on `store.onChange('alignments')`.
- Play button tap → `document` event `latin-reader:play-unit`
  `{ detail: { weekN, unitId } }` **and** `audio.playUnit(unitId)`.
- `window.latinReader.reader.unitElement(unitId)` → the unit's element.
- `window.latinReader.store` / `.panel` are exposed for debugging.

## Sync hooks (E)

`store.onChange(cb)` is subscribed: `cb('lookups')` refreshes underlines and the
open entry; `cb('settings')` re-applies theme/size/face/toggles;
`cb('alignments')` re-checks the play buttons for the current week.

## Settings shape

`{ size:1-5, face:'serif'|'sans'|'dyslexic', theme:'system'|'light'|'dark',
compact:false, showEnglish:'hidden'|'interleaved', showHighlights:true,
showUnderlines:true }` — mirrored to `localStorage['latin103.settings']`
(same key as E's `store.js`), read by the inline script in `index.html` before
first paint. `l103.week` and `l103.view` also live in localStorage (UI-only).

## Dictionary API consumed (B)

`tokenize(la)`, `lookup(form)`, `describe(entry, {compact, form})` (uses
`.paradigm` when filled), `paradigm(entry, entry.parses)` as a fallback,
`loadGlossary('./data/glossary.json')` at boot.

## Highlights (C)

`{unit_id, text, occurrence?, label, note}` rows are resolved to offsets with
`resolveHighlights()` in `reader.js`; unresolved rows are logged with
`console.warn('[reader] unresolved highlights …')` — nothing is guessed.
Tapping a word inside a glow opens the focus note above the word's entry.

## Dev

```
python -m http.server 8000            # from the repo root
http://localhost:8000/app/?fixture=1
node tests/make-fixture.mjs           # regenerates data/build/*.json for week 1 (dev only; A/C output wins)
node --test "tests/*.test.mjs"
```
