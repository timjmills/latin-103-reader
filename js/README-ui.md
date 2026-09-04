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

`{ size:1-8, face:'serif'|'sans'|'dyslexic', theme:'system'|'light'|'dark',
compact:false, showEnglish:'hidden'|'interleaved', showHighlights:true,
showUnderlines:true, showMargin:true, panelWidth:null|px }` — mirrored to `localStorage['latin103.settings']`
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

## Margin notes (CONTRACT.md "Margin notes")

`unit.margin: [{line, la}]` (missing → `[]`, normalised by `marginNotes()` in
`reader.js`). Toggle `data-toggle="margin"` / key `m` / `settings.showMargin`
→ `<article data-margin="on|off">`. The reader picks the presentation itself
and writes `data-margin-mode="gutter|inline"`:

- **gutter** (≥ 768px with room: `marginMode()` needs an 18em prose column
  beside the `--margin-col` gutter, 14rem on tablets and 15rem from 1100px)
  — a `.margin` column inside each `.prose`, one `.mnote` block per unit set
  level with the first line box of its Latin (`marginTop()` +
  `stackMargin()`, re-run from the ResizeObserver on the reader and `#main`);
  the `.prose` gets a `min-height` reaching the last stacked note so dense
  glosses never hang over the next part. While the gutter is in use the
  measure narrows to 26em (the book's own proportion) so the glosses keep
  pace with the lines. Density is checked **per part**: `stackMargin()`
  pushes overlapping blocks down and pulls each run back up (balanced, at
  most one text line above a block's own sentence); if any block would still
  sit more than one text line below its sentence, that `.part` gets
  `data-margin-mode="inline"` and shows its `.mnotes` beneath the sentences
  while its neighbours keep the gutter. The CSS follows the part attribute;
  the article's `data-margin-mode` is "gutter" while any part keeps it (it
  only widens the reader's max-width).
- **inline** (phones, or a tablet with the panel open / very large type) —
  the `.mnotes` block inside the unit, beneath the Latin and above the
  translation, each gloss prefixed with a "¶".

Words inside notes are tokenised and tappable; `wordFrom()` resolves the unit
through `data-for`, so lookups are recorded against the sentence. Sentence
view shows the same block between the Latin and the translation. The fixture
store injects sample notes on week 1 with `?fixture=1&margins=demo`.

## Side panel width

`#divider` (role="separator", between `#main` and `#panel`) resizes the panel
by pointer drag or, following the APG window-splitter pattern, the keyboard:
ArrowRight/ArrowUp widen the panel, ArrowLeft/ArrowDown narrow it (16px;
Shift = 64px), Home = narrowest, End = widest, Escape cancels a drag in
progress and restores the previous width, double-click resets to the CSS
default (announced as "Panel width reset"; a drag past the right edge stops
at `--panel-min`). Drag end and every key announce the new width in `#live`. The width is clamped to `--panel-min … --panel-max` (tokens.css,
read by `main.js`; `clampPanelWidth()` in `settings.js`), written to
`--panel-w` on `.layout` and persisted as `settings.panelWidth`. On desktop
(≥ 1100px) the column is `--panel-default` whether the panel is open or not;
the tablet-only `min(22rem, 44vw)` column appears while the panel is open.
The debounced save never overwrites a width the user is still changing.

`settings.size` is clamped to an integer 1–8 everywhere it is read
(`clampSize()` in `sync.js`, mirrored by the inline script in `index.html`).

## Dev

```
python -m http.server 8000            # from the repo root
http://localhost:8000/app/?fixture=1   # add &margins=demo for sample margin notes
node tests/make-fixture.mjs           # regenerates data/build/*.json for week 1 (dev only; A/C output wins)
node --test "tests/*.test.mjs"
```
