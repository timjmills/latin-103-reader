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
  - `attach({ setPlayingUnit, setPlayingWord, wordTexts }, store)` at boot —
    follow-along highlighting and the spoken-word cursor.
  - `playUnit(unitId)` when a per-unit play button is tapped; a rejection is
    shown in `#notice` and announced through `#live`.
  - `playAll(fromUnitId)` — "Play passage" in the listen bar (from the first
    unit), "Play from here" (sentence view) and "Play chapter" in the settings
    menu; while a chapter plays, `#transport` (Pause / Stop, "sentence N of M")
    is shown from `audio.onState`.
  - `alignmentEndMs(rows)` — the latest row end (`end_ms`) / word end / row
    start, used as the recording's length in the listen bar ("Aligned · 14
    min"). `paintListen()` takes the `<audio>` element's own duration only
    while `audio.status().weekN` is the week being painted — after a week
    switch the element still holds the previous file until the next play —
    and the alignment figure is also the right one when two weeks share a
    recording (13 / 14).
  - Alignment rows may carry `end_ms` (int | null) and `synth` (bool) besides
    `start_ms` / `words` (CONTRACT.md). `normaliseAlignmentRows()` in
    `sync.js` passes both through (`end_ms` null when absent or unusable —
    manual alignments, rows cached before migration 0007; `synth` false
    unless true), so both stores and the fixture agree. `playUnit` stops at
    the row's `end_ms` when present, else at the next row's `start_ms`
    (`unitStopMs()`); `playAll` stops at the last row's `end_ms` when present
    (`chapterStopMs()`) so week 13 never runs on into week 14's half of the
    shared recording. `synth` feeds the listen bar's quiet line
    (`synthHintText()` in `settings.js`, `[data-listen-synth]`): in sentence
    view when the current row is synthesised, in passage view when any row
    is ("Some or all of this week is read by a synthesised voice").
- Listen bar (`#listen`, index.html; painted by `paintListen()` in `main.js`):
  the in-text home of whole-passage playback and the speed. `createReader({…,
  listen })` moves the one element into every render — under the first part
  title in passage view, between the meta line and the Latin in sentence view
  (not sticky; `reader.on('render')` repaints it). `data-state`:
  - `ready` — "▶ Play passage" (`audio.playAll(units[0].id)`) or, in sentence
    view, "▶ Play sentence" (`playUnit`) + "Play from here" (`playAll(unit)`),
    the "1.0×" speed button (opens the same `rate-chips` row as the transport
    and Settings → Audio) and a status line from
    `listenStatusText()` in `settings.js` ("Aligned · 14 min", "Aligned 12 of
    14 · …"). A sentence with no alignment row gets both buttons disabled.
  - `playing` (any mode but idle) — Pause / Resume + Stop, the speed, "Playing
    · sentence N of M" / "Playing this sentence"; the bottom `#transport` still
    appears for chapter playback. Focus follows the button swap (Play → Pause)
    and stays on the bar's control while chapter playback moves sentence view
    from sentence to sentence (see `setPlayingUnit` under Reader hooks); the
    transport's Stop puts focus on the bar's Play button. While the transport
    is shown `main.js` sets `<html data-transport="on">` and `--transport-h`
    (its measured height, from a ResizeObserver) so `#main` gets that much
    bottom padding and the document a `scroll-padding-bottom`: the last
    sentence and sentence view's Next stay reachable above it.
    Touch (`pointer: coarse`): the bar's buttons are the full 44 px.
  - `quiet` — one line, no controls: "No recording for this week yet",
    "Recording uploaded — align it in Settings → Audio to listen" or "Audio is
    off — turn it on in the toolbar". The bar never disappears once a week has
    loaded.
- Per-sentence marks (passage view): the dagger and the play button are wrapped
  in `.marks` (`white-space: nowrap`, preceded by a word joiner) so they stay
  on the sentence's last line together. Each button is its own ≥ 24 px target
  (`.notemark` 24×24 with negative block margins so the line box is untouched;
  `.playbtn` `clamp(24px, 1.6em, 2.75rem)` — 32 px from size 3 up), with
  `0.6em` between the two boxes at every size. Sentence view has no inline play button — the bar's
  "Play sentence" replaces it.
  - `startAlignment(weekN)` — "Align audio…" in the settings menu. While the
    overlay is open every key stops at it (capture) and `main.js` also bails
    when `audio.status().mode === 'align'`, so the reader's letter shortcuts
    cannot toggle settings or stop playback underneath.
  - A media `error` (expired signed URL after an hour, dropped connection)
    drops the cached URL so the next play re-signs, stops the cursor loop and
    returns to idle (the alignment overlay keeps its mode). The cached URL is
    also re-asked of the store before a play once it is 50 minutes old.
  - `invalidate(weekN)` after an upload or a new alignment.
- Settings → Audio section (`initSettings(dialog, { audio })`): Speed chips,
  state line ("No recording" / "uploaded — not aligned" / "Aligned N of M"),
  Upload chapter MP3 (`store.uploadAudio(weekN, file)`), Align, Play chapter /
  Pause / Stop. The section is hidden when `audio` is null.
- Playback speed (`settings.audioRate`, default 1, one of `RATE_STEPS` =
  0.5 … 1.2 in tenths; `clampRate()` in `sync.js` rounds and clamps everywhere
  it is read). Three controls write it: the Speed chips in Settings → Audio and
  the "1.0×" buttons in `#listen` and `#transport`, which open the same chip
  row. All three are one helper, `rateMenu({ btn, row, value, scope, onPick })`
  in `settings.js` (chips, the "0.8×" value, `aria-expanded`, focus to the
  pressed chip on open; opening one row closes any other, a pick closes the
  row and refocuses its button, Escape closes the open row wherever focus is
  — refocusing the button when focus was inside `scope` — and
  ArrowLeft/Right (Home/End) move between the chips; without a `btn` the row
  is always shown, as in the dialog); `paint(rate)` on each keeps them in
  step, and `main.js` closes the listen bar's row when playback returns to
  idle.
  `main.js` calls `audio.setRate(rate)` from `applyDisplay()`, so a change
  applies at once, on every device, to sentence, chapter and alignment
  playback alike: `audio.js` sets `playbackRate` + `defaultPlaybackRate` and
  `preservesPitch = true` on its one element, and re-applies them before each
  play (a new `src` resets the rate). The word cursor and sentence follow-along
  read `currentTime`, so they keep pace at any rate. A change announces just
  the new rate in `#live` ("0.8×") — the chip's `aria-pressed` says the rest —
  and the transport announces once when it appears ("Playing chapter at 1.0×.").
- Per-unit play buttons are shown only when the week has a recording **and**
  an alignment (`reader.setWeek(week, units, highlights, { audio, lookups })`
  renders once with both) **and** the toolbar Audio toggle is on.
- Audio toggle (`data-toggle="audio"`, key `a`, `settings.showAudio`, default
  true): off = no play buttons, no transport, no follow-along highlight or word
  cursor, playback stopped; `<article data-audio="on|off">`. Settings → Audio
  (upload / align / play chapter) stays available; "Play chapter" from there
  turns the toggle back on first.
- Toolbar toggles (Translation, Grammar focus, Underlines, Margin notes,
  Audio): each is a button with `aria-pressed` and a small switch drawn by
  CSS (`.toggle::before` track, `::after` knob) so on/off reads the same for
  all five. Labels are short below 768px (`data-short`), except Translation,
  which keeps its full name from 480px up. The same five appear in Settings →
  Reading as `role="switch"` checkboxes with shortcut hints (`e`, `h`, `m`,
  `a`), bound to the same `toggles` map in `main.js` (`initSettings(dialog,
  { toggles, focusLabel })`), so both places always agree.
- First-run hint: while the translation is hidden and
  `localStorage['l103.hint.translation']` is unset, `#hint-translation` is
  shown once as a row of the header under the toolbar (it pushes the text
  down — never over the part heading; `placeHint()` sets its left offset and
  caret under the Translation toggle, clamped to the header) after the first week loads
  ("Tap Translation to show the English under each sentence"), announced in
  `#live`, and the key is set at once so it never returns. "Got it" or turning
  the translation on dismisses it.
- Word cursor: alignment rows may carry `words: [{t, s, e}]` (absolute ms,
  CONTRACT.md "Audio alignment rows"). While a unit or the chapter plays,
  `audio.js` maps the row's words to the unit's word tokens
  (`reader.wordTexts(unitId)`) by order — `mapWordsToTokens()`, a longest
  common subsequence over normalised forms (lowercase, macrons stripped, v→u,
  j→i, punctuation dropped); unmatched words are skipped — and calls
  `reader.setPlayingWord(unitId, tokenIndex)` from its animation frame. The
  word gets `.w--now` (tokens `--cursor-bg` / `--cursor-line`); the sentence
  keeps `.is-playing`. Rows without words (manual alignment) fall back to the
  sentence highlight alone. Pause / stop clear the cursor.

## Reader hooks (E)

- `window.latinReader.reader.setPlayingUnit(unitId | null)` — adds
  `.is-playing` to the unit (passage or sentence view) and scrolls it into
  view; `null` clears. In sentence view it also moves to that sentence, so
  chapter playback follows along — silently: unlike `goTo()` it neither
  announces the sentence in `#live` nor moves keyboard focus (a focus inside
  `#listen` is put back on the same control after the re-render; a focus on
  the old sentence moves to the new one without scrolling).
  (`audio.attach` receives the same function.)
- `reader.setPlayingWord(unitId, idx | null)` — `.w--now` on the unit's
  `idx`-th word token (text order, as `reader.wordTexts(unitId)` lists them);
  `null` clears. Re-applied across re-renders.
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
showUnderlines:true, showMargin:true, showAudio:true, showSummaries:true,
plainOpen:false, showGlossEnglish:false, audioRate:0.5–1.2,
panelWidth:null|px }` — mirrored to `localStorage['latin103.settings']`
(same key as E's `store.js`), read by the inline script in `index.html` before
first paint. `l103.week`, `l103.view` and `l103.hint.translation` also live in
localStorage (UI-only).

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

## Section summaries (CONTRACT.md "Section summaries")

`week.parts[]` entries may carry `summary_en` / `summary_la` (strings;
`partSummary()` in `reader.js` trims them and returns null when a part has
neither — such parts show nothing). Passage view renders a native
`<details class="summary">` under each part heading (above the listen bar):
"Summary" toggle, the English paragraph, an "In Latin" sub-heading and the
Latin summary tokenised with `tokenize()` and rendered as `.w` words like the
reading text — lookups, underlines and the panel all work. The Latin block
carries `data-for` / `data-order` of the part's first unit, so
`wordFrom()` records a lookup made there against that sentence (with no unit
at all the panel passes `null` to `store.addLookup`). Closed by default;
open/closed is remembered per week and part in
`localStorage[summaryStorageKey(week.id, part.part)]` (`l103.summary.<week
id>.<part slug>`). Sentence view shows a "Section summary" button in the
meta line; `reader.on('summary', { part, unitId, el, body })` →
`panel.showSummary()` opens the same body (`reader.summaryBody(part)`) in the
side panel / popup via the note path; a word tapped inside it comes back
through the panel's `onWord` option (anchored on that button on phones).
`settings.showSummaries` (default true; Settings → Reading "Section
summaries", no toolbar button, `toggles.summaries` in `main.js`) →
`<article data-summaries="on|off">`, which hides the disclosures and the
sentence-view button. The fixture store injects two invented demo summaries
on week 1's first two parts while the build has none.

## Plain-words layer (CONTRACT.md "Plain-words layer")

A simpler second layer under every note, for the learner who "doesn't always
understand the notes". Data: `unit.note_simple` (string | null),
`highlight.simple` (string | null), `unit.margin[].en` (string | null).
`store.js` passes all three through `getUnits()` / `getHighlights()` with
missing values normalised to null (`marginNotes()` in `reader.js` does the
same for `en`); the fixture store injects invented sample text on week 1
(`withPlainDemo()`: the first three notes, first two highlights, first three
glosses) only while the build carries none. `plainWords(text)` (pure) trims
or returns null.

- **"In plain words"** — `plainDisclosure(text, plain)` in `reader.js`: a
  native `<details class="plain">` (summary-toggle idiom, `panels.css`)
  holding the plain text. Rendered under the sentence note in the panel /
  popup (`wordpanel.js` `noteContent`), under the grammar-focus note of a
  glowed span (`focusBlock`; `hl.simple` travels on the span as
  `data-hl-simple` through `wordFrom()`), and under the note block in sentence
  view. Absent text → no disclosure at all. `settings.plainOpen` (default
  false) is the learner's last choice: `main.js` hands both modules
  `plain = { get, set }`; every disclosure opens with it and writes back on
  toggle, so once opened the layer stays open on every note until closed.
- **Gloss English** — a gloss with `en` gets a small "en" chip
  (`.mnotes__en-btn`, a 24×24 button with the pill drawn inside it,
  `aria-expanded`, `data-gloss-toggle="<unit id>#<i>"`)
  after the Latin in both copies of the block (gutter and inline, and in
  sentence view); a tap or Enter/Space shows the English beneath the Latin
  (`.mnotes__en`, UI face, `--ink-2`). Open state lives in
  `state.glossOpen` (per week) so both copies agree across re-renders;
  `toggleGloss()` re-runs the margin layout because the gutter blocks grow.
  Latin words inside glosses stay tappable. `settings.showGlossEnglish`
  (default false; Settings → Reading "English under margin notes",
  `toggles.glossEnglish`, no toolbar button) → `<article
  data-gloss-en="on|off">`: on, every English rendering is shown and the
  chips are hidden. With every gloss doubled in height the density check
  usually moves a part to the inline presentation — expected.

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
