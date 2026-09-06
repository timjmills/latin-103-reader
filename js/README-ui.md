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

`{ size:1-8, noteSize:1-7, face:'serif'|'sans'|'dyslexic', theme:'system'|'light'|'dark',
compact:false, showEnglish:'hidden'|'interleaved', showHighlights:true,
showUnderlines:true, showMargin:true, showAudio:true, showSummaries:true,
plainOpen:false, showGlossEnglish:false, showPictures:true, lineMode:'flow'|'book', audioRate:0.5–1.2,
panelWidth:null|px, menuTab:'chapters'|'weeks',
grammar:{ preset, size, oneSkill, view:'topic'|'chapter', hints:'press'|'always'|'off' } }` — mirrored to `localStorage['latin103.settings']`
(same key as E's `store.js`), read by the inline script in `index.html` before
first paint. `l103.week`, `l103.view` and `l103.hint.translation` also live in
localStorage (UI-only).

Notes size (`noteSize`, default 4 = today's look; `clampNoteSize()` in
`sync.js`, Settings → Type "Notes", a second stepper with its own "4 of 7"
live line): `<html data-note-size="1–7">` sets `--note-scale` (0.76 … 1.3,
tokens.css) — one factor over everything note-like and nothing else. The
`--note-xs/sm/md` tokens are the `--ui-*` steps under that factor (panel
stack rows, note bodies, entry text, "In plain words", the grammar-focus
note); em-sized notes in the text multiply the factor themselves
(`.mnotes`/`.mnote`, captions, `.sentence__note`, `.summary__en`). The
reading text, the Latin summary and the toolbar / header / dialog chrome
keep `--ui-*`. A change runs through `saveSettings()` → `applyDisplay()` →
`reader.reflow()`, so the gutter re-stacks at the new note size.

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

## Book lines (CONTRACT.md "Book lines")

`unit.lines: [{ line, start }]` — where each printed line of the book begins
inside `la` (`store.js` / the fixture pass it through, missing → `[]`;
`unitLines()` in `reader.js` is the one normaliser: sorted, integers,
duplicates dropped). `settings.lineMode: 'flow' | 'book'` (default flow;
Settings → Reading "Book lines — one printed line per line, every line
numbered", `toggles.bookLines` in `main.js`, no toolbar button) →
`<article data-line-mode="flow|book">` and `reader.setLineMode(mode)`, which
re-renders passage view and puts the current sentence back on its line.
Sentence view is unchanged.

- **Rendering** (`renderLatin()` → `renderTokens(tokens, ranges, starts)`):
  for a unit with line data, `lineStarts(tokens, lines)` (pure,
  `tests/ui.book-lines.test.mjs`) names the token that opens each printed
  line — the first token at or after the offset, never whitespace, so the
  split always falls between tokens. Before it go a `<br class="lb">` (not
  for the unit's own first line) and a `.lineno` with `data-line`, the
  whitespace token just before the break is dropped. Every printed line is
  numbered, not just block starts; `dedupeLineNumbers()` hides a number
  that lands on the same screen line as the previous one (a sentence
  continuing the line), so each line shows its number once. A sentence that
  ends a printed line gets a trailing `<br class="lb lb--unit">` after its
  `.marks` (the † and play button stay on its last line) when
  `breakAfter(unit, next)` says the next sentence opens a new line (both
  mapped: a later line number; one unmapped: a block start). Highlight
  glows, the yellow underlines, the audio word cursor and the play buttons
  are untouched — the breaks and numbers sit inside the same `.la` spans.
- **What keeps the flow layout**: units without line data (Fabellae
  Latinae, unmapped units) render as before with their block number; a
  week with none at all shows the Settings switch with the hint "This
  week's text has no printed line numbers" (`bookLinesDesc()` in
  `settings.js`, `opts.hasLines()` from `main.js` = `weekHasLines(units)`)
  — the setting still saves and applies to other weeks. Block units (verse,
  a speaker turn, the interleaved translation, a sentence with inline
  margin notes) hide their trailing break by CSS; with the notes inline
  such a sentence ends its screen line whatever the print does.
- **Margin notes in the gutter** align with the printed line their first
  gloss names: the `.mnote` carries `data-line`, and `firstLineTop()` finds
  that line's `.lineno` (in the unit, else anywhere in the prose) and
  measures the first text after it (`textTop()`, a TreeWalker over text
  nodes that skips the numbers); a line not found falls back to the
  sentence's first line as before. In book mode the gutter is kept whatever
  the density of the glosses (`positionMargin(…, { demote: false })`): an
  inline part would make every sentence with notes a block and cut the
  printed lines; dense stretches stack below their line instead.
- **One printed line per screen line** (QA-6 M1). The printed line, not the
  sentence, is the unit of layout in book mode: `renderPassage()` groups the
  mapped inline units of a line (`.unit--line`, never `has-margin`), puts
  the line's inline pictures above it and its sentences' inline notes
  (`.mnotes--line`) below it, so a sentence boundary never splits a line.
  The column is sized from the data: `printedLines(units)` (pure, tested)
  rebuilds each part's printed lines from `unit.lines`, `sizeBookColumn()`
  measures them on a canvas in the reading face once per week/face/size and
  sets the article's `max-width` to hold the widest, plus a right-hand
  column for the † and play buttons — `.unit--line .marks` is absolutely
  positioned at the text column's right edge (`--prose-pr`, `--marks-w` per
  slot, `--marks-room` for as many slots as the room allows, at least one;
  `--mark-i` on a second sentence ending on the same line; a set with no
  slot stays inline, `.marks--inline`) — so no line wraps for its marks. The
  gutter needs room for a *typical* line (the 90th percentile) plus a marks
  slot (`marginMode`'s `minEm`), which sends 768 inline with its lines
  whole; where the room is short (1100 beside the 24 rem panel, an OCR
  outlier such as week 5 line 137) the longest lines wrap and their
  numbers stay single (`lineNumberDups()`, pure: same screen line or same
  printed line as the number shown last — two verses sharing a printed
  line show it once). Book mode pads the article `--s-5` instead of `--s-7`
  on wide screens; phones keep the marks inline.
- **Scroll stability** (found while testing; general): `render()` holds the
  article's height across the DOM swap (a momentary `min-height`) and puts
  the scroll offset back, and `.margin, .mnote, .mpic { overflow-anchor: none }`
  in `reader.css` (the page keeps anchoring elsewhere: pictures decoding,
  a summary toggled, fonts arriving) — Chromium used to clamp the offset to
  the emptied document and, anchoring on a node the margin reflow then
  moved, carry a page deep in a chapter to its end on any re-render (a
  `setAudioAvailable` toggle included). One synchronous correction is not
  enough — the margin reflow (next frame), fonts and the lazy pictures each
  move the text afterwards — so every correction is a **scroll hold**
  (`holdScroll(place)`): `place()` runs now, on the next two frames, after
  every `reflow()`, after each picture `load`, at 200 ms and at 500 ms,
  with `state.settleUntil` kept ahead so `trackScroll()` never re-labels
  the current sentence meanwhile; a wheel, a touch or a scrolling key
  outside a dialog ends it (Escape/Done closing Settings does not). The
  anchor (`firstUnitInView()`) is the unit at the third line — the one the
  learner reads — and, while the DOM survives the change, the very word
  under the eye (`wordAt()`: that unit's `.w` nearest the third line, by
  geometry — hit-testing would find the modal Settings dialog's backdrop):
  a sentence spanning several lines has one top, but the lines between it
  and the reading line change with the measure. At the head of the page
  there is no anchor. `setLineMode(mode, { settle })`
  re-renders passage view only (sentence view renders on its next
  `setView`); with `settle` — the learner's own switch, never a change
  from another device — its hold is *sticky*: it puts the sentence that was
  current back on the third line (forcing `state.current`) and
  `keepInView()` leaves it alone. `applyDisplay()` in `main.js` runs under
  `reader.keepInView(fn)`, and so do `applyToDocument()` (the type / notes
  size and theme, via `applyDisplay({ first })`) and the Settings dialog's
  live preview of a size step (`opts.applyToDocument` in `settings.js`):
  a settings save deep in a chapter leaves the line being read where it is.
  Study time: `main.js` no longer counts a `scroll` event as activity
  (the boot resume, Continue and every re-placing scroll programmatically);
  pointer, keys, wheel, touch or audio only (QA-6 m7).
- **Quotes and brackets**: a line's `start` is its first *letter* (the
  pipeline's `tokens_with_offsets`), so `renderTokens()` splits the non-word
  token before the break (`; "`) at its last whitespace run: `;` ends the
  line above, `"` opens the new line after its number. An unmapped unit
  between mapped ones stands on the last mapped line (`breakAfter(u, next,
  lastMapped)`), so the next mapped sentence still opens its own line.
  `unitLines()` keeps the entries monotonic by line; `lineStarts()` snaps a
  mid-word offset to that word; `dedupeLineNumbers()` also hides a repeated
  `data-line` (a printed line that wraps on a phone).

- **Fixture**: while `data/build/week-01.json` carries no `lines`,
  `withDemoLines()` in `store-fixture.js` synthesises breaks for week 1
  (every ~55 characters at a word boundary, numbered on from each block's
  `line_no`; real data wins the moment any unit has some). `?lines=none`
  strips the line data from every week to try the switch's hint.

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

## Pictures (CONTRACT.md "Pictures")

The textbook's illustrations beside the sentence they stand next to.
`store.getPictures(weekN)` → `[{ id, unit_id, url, caption, caption_en,
page, width, height, sort }]`: `store.js` keeps the rows of table `pictures`
in IndexedDB (`pictures` store, DB version 2; pulled per week with the units)
and signs `url` lazily from the private bucket `pictures` (object
`{uid}/{path}`, 1 h TTL, re-signed after 50 min) in batches of 25 with
`createSignedUrls()` — the signed URL rides on the cached row, so an offline
reload still has one (stale → the browser cache, or the alt text). The fixture
store reads `data/build/pictures-week-NN.json` and serves the images from
`data/build/pictures/week-NN/<file>`; without the file, week 1 gets two drawn
placeholders (an SVG data URL, not the book's art) on `w01:29.1` — beside
dense margin notes — and `w01:60.1` (portrait).

`main.js` loads them with the week (`loadPictures()`, only while
`settings.showPictures` is on) and hands them to `reader.setWeek(week, units,
highlights, { audio, lookups, pictures })`; `reader.setPictures(rows)`
replaces them. `settings.showPictures` (default true; Settings → Reading
"Pictures", `toggles.pictures`, no toolbar button) → `<article
data-pictures="on|off">`; switching on re-asks the store (fresh signatures)
and renders, off drops the rows.

- **Passage view** — like the margin notes, two copies per unit
  (`pictureFigure()`; `groupPictures()` is the pure grouping, `sort` order):
  `.pic--inline` in the prose just before the unit (not inside it, so the
  line number stays beside the text; 60% of the column, centred) and `.mpic` in
  the `.margin` gutter, placed *before* the unit's `.mnote` so
  `positionMargin()` stacks the notes beneath the illustration. Picture
  blocks are `pinned` items: their `top` is the sentence's first line, and
  `marginDrift()` (pure, `tests/ui.pictures.test.mjs`) measures a note that
  rests under a picture — or on a note that does, while each rests on the
  one above — from the block above it rather than from its own sentence:
  glosses flowing under the plate are the book's own arrangement, not
  crowding. The chain ends at the first note placed at its own sentence;
  notes crowding notes still send the part inline exactly as before. Hidden
  blocks (pictures off) take no room.
- **Sentence view** — `.pic--sentence` above the Latin.
- The `<img>` is `loading="lazy"`, `decoding="async"`, with `width` /
  `height` from the row (no layout shift) and `alt` = the caption or
  "Illustration from the textbook" (`pictureAlt()`). A load error swaps it for
  `.pic__missing` (the alt text in the frame).
- Caption (`.pic__cap`): the Latin tokenised as `.w` words (`data-for` /
  `data-order` on the figure → lookups are recorded against the sentence);
  `caption_en` behind the same `.mnotes__en-btn` "en" chip as a margin gloss
  (`data-gloss="pic:<id>"`, `toggleGloss()` keeps both copies in step;
  `settings.showGlossEnglish` shows it outright).
- Tap the image (`.pic__btn`, `data-pic-open`) → `openPicture()`: one native
  `<dialog class="lightbox">` appended to `<body>` on first use, the image at
  full size with the caption, English and page. Escape (the dialog's own
  cancel), the backdrop or × closes it; focus returns to the button that
  opened it. Keydown inside it does not reach the reader's letter shortcuts.

## Reading progress and last position (CONTRACT.md "Reading progress")

Store: `store.getProgress()` → `Map<unit_id, read_at>` (first reads: what
counts, Continue, the weeks menu); `store.getProgressRows()` → `Map<unit_id,
{ unit_id, week_n, read_at, reads, last_read_at, updated_at }>` (the reader's
timers, the read batching, the study log's review figures);
`store.markRead(unitIds)`; `store.resetProgress(weekN | null)`. `store.js`
keeps table `reading_progress` in IndexedDB (`progress` store, DB version 3;
rows cached before migration 0011 are normalised on load —
`normaliseProgressRow()`: reads 1, last_read_at = read_at — no version
bump), local-first through the outbox (`reading_progress:upsert_many` per
batch, `reading_progress:delete` per reset) with a realtime subscription, so
`onChange('progress')` fires when another device reads. The fixture store
keeps `localStorage['l103.progress']` as `{ unit_id: { week_n, read_at,
reads, last_read_at } }` (an older bare `read_at` value is one pass). Lookups
are a separate table / key and are never touched by any of this.

Reviews (CONTRACT.md "Reviews"): `markRead()` splits its ids locally with
`makeProgressRows(ids, rows, now)` in `sync.js` (pure,
`tests/store.progress.test.mjs`) — an id with no row is a first read (a new
row, `reads` 1, `last_read_at` = `read_at`); one whose `last_read_at` is
≥ 30 min (`REVIEW_GAP_MS`) before `now` is a review (`reads + 1`,
`last_read_at` = now, `read_at` kept); one covered within 30 min is skipped,
so a batch is idempotent within a session. `readSettled(value, now)` is that
rule on one progress value (a row, a bare `read_at`, or `true` for a Set
entry, which is read for good). Wherever two copies of a row meet they merge
field by field — `mergeProgressRow()`: `reads` = max, `last_read_at` = max,
`read_at` = min, `updated_at` = max — in `mergeProgress()` (a pull) and
`applyProgressRealtime()` (an INSERT / UPDATE from another device; an own
echo is no change); on the server the same merge is a `before update`
trigger (migration 0012, `reading_progress_merge`), so `sendOp()`'s
`upsert_many` just sends the batch's rows as they are (`onConflict:
user_id,unit_id`, one request, no read-merge-write window) and a review made
on either device stands. `readsOf()` in `sync.js` is the one `reads`
coercion (`settings.js` re-exports it; `reader.js`, which imports nothing,
keeps a private copy). A reset clears the rows, reviews included.

What counts as read — the reader only *notices* (`reader.on('read', { unitIds,
why })`), `main.js` batches (`queueReads()` in `reader.js`, `READ_FLUSH_MS`)
into one `markRead()` and repaints (`paintProgress()`):

- Sentence view: the sentence shown, after 2 s (`READ_DWELL_MS`), or at once
  when moved past with Next / `j` (`goTo` forward) — for a *first* read. A
  review by Next needs the same 2 s: `nextCounts()` (pure,
  `tests/ui.progress.test.mjs`) counts a sentence that already has a row only
  when it has been current for `READ_DWELL_MS` (`state.currentSince`, set in
  `render()` when the current order changes), so hammering `j` through a read
  week pages through it without logging 93 instant reviews.
- Passage view: a unit whose element has been ≥ 80% in view for 2 s — an
  IntersectionObserver below the sticky header (`rootMargin: -bar-h`,
  `inViewEnough()`: 80% of the unit, or of the viewport for a taller unit)
  plus a timer per unit. Nothing counts while the tab is hidden or while a
  modal dialog (Settings, the weeks menu, the word popup, the lightbox)
  covers the text (`readsPaused()`): timers are dropped on
  `visibilitychange` / a dialog opening and re-armed for the units still in
  view when the tab is back / the dialog closes.
- Playback (`main.js` `trackPlayback()` from `audio.onState`, the rule in
  `playbackRead()` in `reader.js`): a sentence chapter playback moved past
  to the *next aligned* sentence, or one whose own playback ran to its end
  (`unitEndMs()`: its `end_ms`, else the next row's start, else the
  recording's length; the element's time within 400 ms of it). A Stop
  partway, a tap on another sentence, an error: never. Either way the time
  actually played must reach 1.5 s (`PLAYED_MIN_MS`) or 80% of a shorter
  sentence — paused stretches are not counted.
- Never un-marked automatically. After a reset the passage observer watches
  the units again but skips the ones in view at that moment
  (`observeUnits(true)`), so a reset is never followed by "1 of 93" two
  seconds later; `main.js` also drops the reads batched but not yet saved
  (`dropReads()`), and the reset line is shown inside the (modal) Settings
  dialog (`say()`), not in `#notice` behind its backdrop.
- Reviews: the reader is handed the rows (`setWeek(…, { progress: rows })`,
  `setProgress(rows)`) and `readSettled` from `sync.js` (injected as
  `createReader({ readSettled })`, so `reader.js` still has no static import
  of B's modules; default: any entry is settled). `settled(id)` gates every
  timer where `progress.has(id)` used to: a sentence read within the last
  30 min gets none; one read earlier is timed / observed again (the passage
  observer now watches every unit and `armUnit()` judges it when it comes
  into view, so a page left open past the gap works too) and moving past it
  with Next counts again once it has been current for 2 s (`nextCounts()`).
  `queueReads(queue, ids, rows, readSettled)` in
  `main.js` applies the same rule, and the store tells a review from a first
  read. Playback reads go through the same queue.
- Store side (`store.js`): `pullProgress()` merges nothing while a
  `reading_progress` op is still in the outbox or a local write landed while
  the rows were in flight (`mergeProgress()` in `sync.js`, `progressGen`), so
  a pull overlapping a reset cannot resurrect the deleted rows; `flushOutbox()`
  chains a caller that arrives mid-flush instead of dropping it; a realtime
  DELETE storm (a reset elsewhere) is one `emit('progress')` (100 ms).

UI: the weeks menu rows get a hairline bar + "42 of 93 sentences" / "not
started" / "finished ✓" (`progressText()` in `settings.js`; totals from
`weeks[].unit_count` or `store.getUnits(n).length`, read once on the first
open). `#progress` ("42 of 93 read · Continue →") is moved by `reader.js` like
the listen bar — under the first part title above the listen bar, and under
sentence view's meta line; **Continue** → `firstUnread(units, progress)` (falls
back to the last position, then the first sentence) → `reader.goToUnit(id)`.
Settings → Progress: "N of M sentences read.", **Reset this week** / **Reset
all progress** (native `confirm()` first, `initProgressSection()`), and the
line "Looked-up words are kept separately and are never reset here." Read
sentences carry no mark in the text; sentence view's meta line shows a faint
"read ✓" — "read · reviewed ✓" / "read · reviewed ×2 ✓" once later passes
have covered it (`readTickText(row)`, pure; `[data-read-label]` inside
`.sentence__read`, `reader.setProgress(rows)` → `paintReadTick()` patches
both the visibility and the label in place).

Last position: `settings.lastPosition = { week_n, unit_id, view, at }`
(`normaliseLastPosition()` in `sync.js`; default null). The reader emits
`position` whenever its current sentence changes — sentence view's sentence,
passage view's tapped / played one or, while scrolling, the unit nearest the
top third of the viewport (`nearestUnit()`, rAF-throttled; ignored while a
programmatic scroll settles or the chapter plays) — and `main.js` writes it 1 s
after the last change (`POSITION_SAVE_MS`) through `store.setLastPosition()`
(no shell repaint) — only when the place really changed (`positionKey` starts
as the loaded position) and only once boot is over (`positionArmed`: the boot
render and the resume never write, so a saved place this library lacks is
kept for the device that has it). `setLastPosition()` patches the settings
blob without bumping the row's `updated_at` (`patchLastPosition()`): the
position carries its own clock, `lastPosition.at`, and `mergeSettings()` in
`sync.js` merges it on that clock whichever row was newer, so a device that
only scrolls never outranks one that changed a real setting. On boot the week
comes from `lastPosition.week_n` (over `l103.week`), the view from `l103.view`
(the device's own), and `reader.goToUnit(unit_id, { quiet: true })` opens that
sentence in sentence view or scrolls it to the top third in passage view.
Switching views keeps the sentence: passage → sentence opens the current
(scroll-tracked) sentence; sentence → passage `scrollToCurrent()` puts it on
the same top-third line.

## Study log and time left (CONTRACT.md "Study log" / "Study log merge")

Store: `store.getStudyDays()` → `Map<day, active_ms>` (day = local
`YYYY-MM-DD`, `localDay()` in `sync.js`); `store.addActiveTime(day, ms)`;
`store.clearStudyLog()`. Table `study_days` holds **one row per (day,
device)** (migration 0012: pk `user_id, day, device`; the rows from before
it sit under device `main`). The device id is `localStorage['l103.device']`
(`DEVICE_LS_KEY`, `deviceId()` in `store.js`: a random UUID made once, never
synced; two tabs of one browser share it, so they share a row and never
double-count). Each device sends its *own* running total for the day and
the server keeps `max` per row in a `before update` trigger
(`study_days_merge`), so a re-sent total is harmless; on read
`studyDaysView()` **sums the devices' rows per day**, so a phone at
breakfast and a laptop at lunch add up. `store.js` keeps the rows in
IndexedDB (`study_rows` store, DB version 5 — the v4 day-keyed `study_days`
store is dropped on upgrade and the next pull refills from the server; key =
`studyKey(day, device)` = `day␟device`, U+241F), local-first through the
outbox — one `study_days:upsert` per `day:${day}:${device}` key (this
device's running total, so a burst of flushes coalesces to the latest
figure; `sendOp()` upserts it with `onConflict: user_id,day,device`, no
select first) and one `study_days:delete` (every row of the user's, every
device's) for a clear. `mergeStudyDays()` / `normaliseStudyRow()` /
`studyKey()` (pure, `tests/study.test.mjs`) keep the larger figure per row
on a pull and, like progress, merge nothing while a study op is still in the
outbox (a pull overlapping a clear must not bring the days back). A realtime
subscription on `study_days` (in the publication since 0012) applies each
row → `onChange('study')`. The fixture store keeps
`localStorage['l103.study']` as a plain day → ms map (one device). A library
without the table (seeded before migration 0010) logs a warning and goes
without.

Active time (`main.js`): a 15 s ticker (`ACTIVE_TICK_MS`) banks its length
while the tab is visible and there was pointer / key / wheel / scroll / touch
activity within the last 60 s (`ACTIVE_IDLE_MS`; `bump()` on capture) or
audio is playing — `activeSlice()` in `settings.js`, pure; a throttled tick
banks at most two ticks. The bank is flushed every minute
(`ACTIVE_FLUSH_MS`), at once on `visibilitychange` → hidden and `pagehide`,
and before a day boundary (to the day that is ending); coming back to a
hidden tab resets the tick clock, so time away is never banked. Each flush
re-reads the map and repaints; when the store throws (quota, private mode)
the minutes go back into the bank for the next flush instead of vanishing.
Minutes in the Settings dialog count as active though reads are paused
there — a long browse of the dialog lowers the pace a little; accepted.

Stats (`settings.js`, pure): `sentencesPerDay()` / `sentencesPerDayByWeek()`
group the progress map's `read_at` (first passes only) by local day — the
map's values may be whole rows (`store.getProgressRows()`, what `main.js`
passes) or bare `read_at` strings (`readAtOf()` / `readsOf()` take either);
`reviewsPerDay()` counts the rows with `reads > 1` on the local day of
their `last_read_at` (a sentence once per day, however many passes);
`passesByWeek()` is the largest `reads` per week. `studyLog({ progress,
studyDays, now })` → `{ today, days (the last 14, oldest first, each
{ day, ms, sentences, reviews, pace }), weeks ({ n, ms, sentences, passes,
pace }), pace, overall ({ ms, sentences, reviews, pace }) }` — counts, pace
and time left are first reads only, reviews ride along. A week's minutes are
each day's minutes **shared out by the sentences read in each week that day**
(the table has no per-week column; a day with time but no sentences is
counted in no week) — the dialog says so.
`paceOf()`: sentences per active hour over the last 7 **reading days** — days
with active time *and* first reads (`basis: 'recent'`) — else over every
reading day (`'overall'`), else `ROUGH_PACE` = 60/h (`'rough'`); a pace
needs `PACE_MIN_MS` (2 min) of time behind it. A review-only day (an hour of
revision, no first reads) is in the totals, the table and the sparkline but
never in the pace, so it cannot inflate "time left" (CONTRACT.md "Study log
merge"). `timeLeftText(unread, pace)` → "about 45 min left" (5-minute
steps from a quarter-hour up, halves of an hour from one hour up: "about 1½
h left"), "finished", "(rough estimate)" appended on the rough pace.

UI: `#progress` gains `[data-progress-left]` ("42 of 93 read · about 45 min
left · Continue →"; hidden when finished); every weeks-menu row with a
library week gets `.weeks__left` ("· about 2 h left") after its count.
`paintProgress()` recomputes `stats` on every progress or study change
(`timeLeftFor()` in `main.js`). Settings → Progress → **Study log**
(`initStudyLog()` in `settings.js`, `[data-study]` in index.html): today's
line ("Today · 12 min · 14 read · 58 reviewed · 70 / h", `todayLineText()`,
pure — minutes and reads always, reviews and pace only when there are any),
an inline SVG sparkline of minutes per day over the last 14
(`sparklinePath()`, pure; one series in `--ink-3`, the last point in
`--rubric` with a 2 px surface ring — tokens, so both themes; `role="img"`
with a `<title>` and a `<desc>` that `sparklineSummary()` fills — "5 active
days of the last 14; peak 42 min on Tue 2 Sep." — repeated once as a
visually-hidden sentence after the figure, so the 14 values reach a screen
reader; the end dot is hidden by attribute, an SVG element having no
`hidden` property), the active days of those 14 as a table (Day · Min ·
Read · Reviewed · Pace, newest first; a day with nothing reviewed shows a
quiet dash, `.study__nil`, `aria-label="none"`; a day with only reviews is
listed too; "Reviewed" is the sentences whose *latest* pass fell on the day,
so an earlier review day loses its count when the sentence is reviewed
again — a known limit of the one-row-per-sentence schema), the per-week
rows (Week · Min · Read · Passes · Pace — "93 read · 2 passes"), the pace
line naming its basis ("over the last 5 days with new sentences"; "; N
reviewed" appended overall), the apportioning hint
(which also says what a review and a pass are), and **Clear study log**
(native `confirm()`; the line is shown inside the dialog). Reset progress leaves the study log alone and the clear leaves
progress and lookups alone.

Escape: `main.js`'s keydown returns early while the Settings or weeks
dialog is open, so Escape there is the dialog's own cancel and never
`panel.escape()` behind the backdrop.

## Side panel: the sentence stack (tablet + desktop)

From 768px the `<aside id="panel">` no longer shows one entry at a time: it
holds a **stack for the current sentence** (`wordpanel.js`, `panels.css`
"stack"). Phones (< 768px) keep the anchored `<dialog id="popup">` for words
and notes, unchanged.

- Rows, top to bottom: the sentence's † grammar note (if any) collapsed to
  its first line; every grammar-focus highlight in the sentence (the glowed
  text + its label — seeded from `getHighlights`, not only the tapped ones);
  every word looked up in the sentence and not yet learned (`form —
  meaning`, seeded from the lookups map, `seedStack()`), all in **sentence
  order** — `stackWith()` sorts by kind, then by the row's character offset
  (`pos` / the highlight's `start`); rows without a position go last, in tap
  order. `stackWithout()` / `rowKey()` (pure, `tests/ui.stack.test.mjs`)
  keep that order; `sentenceTitle()` names the sentence in the header
  ("Pars I · line 4, sentence 2", or the id tail for block ids).
- Rows are buttons (`.stack__btn`, `aria-expanded`, `aria-controls`) that
  expand in place to the full content — words: enclitic, entry switch, parse,
  dictionary form + category, senses, usage, gloss terms, the paradigm
  disclosure, Learned / Unlearn / Forget; notes: the Latin, the note, "In
  plain words"; highlights: the focus note + "In plain words". Rows expand
  **independently** — several may be open at once (`expanded`, a Set of row
  keys) and none folds on its own; another sentence's stack starts collapsed.
  A tapped word is added **collapsed**, scrolled into view and focused — it
  stays quiet until pressed. The † opens its row (the one tap that does; a
  second tap on the same † folds it). Keys: Enter / Space toggle, ArrowUp /
  ArrowDown (Home / End) move between rows (stopped in the aside so sentence
  view's arrows never also fire), Escape → `panel.escape()`: a temporary view
  goes back to the stack, then every open row collapses, then the panel
  closes and focus returns to the text (`focusText()`: the tapped element, or
  the same word after a sentence-view re-render).
- The stack belongs to the current sentence. A word or † in another sentence
  (passage view) switches it. `panel.showSentence(unitId, { open })` follows
  the reader's `navigate` events: in passage view (`open: false`) only an
  *open* panel switches; in sentence view (`open: true`, from `main.js`'s
  `navigate` handler and `setView('sentence')`) the panel is **always open on
  the current sentence** — except after the learner closed it themselves (×
  or the last Escape: `userClosed` in `wordpanel.js`, QA-4 m3). That close
  holds until they open something again (a word, a †, a section summary);
  `panel.close({ user: false })` (a week change in `main.js`) does not set
  it. Leaving sentence view for passage view, `panel.closeIfEmpty()` closes
  an aside whose stack has nothing in it, so a tablet's Sentence → Passage
  round trip never leaves an empty panel open (which would narrow the prose
  and drop the margin gutter). Every sentence's rows are kept for the session
  (`stacks`, keyed by unit id), so coming back restores them; a sentence with
  a note starts with the note row (`getUnit` from `main.js`). Sentence view's
  "Words you looked up in this sentence" list is hidden from 768px
  (reader.css) — the stack replaces it; phones keep it.
- Paradigm tables in the panel (`renderParadigm`): `.pt` at `--ui-sm` from
  768px; a section with three or more value columns (adjectives: m / f / n)
  gets `.pt--wide` — `--ui-xs`, the tablet's tighter cell padding and a
  row-label column that may wrap — so it fits the panel's default width
  without the sideways scroll (QA-4 m4). `.pt__scroll` stays as the last
  resort.
- "Section summary" (sentence view) still opens in the panel, as a temporary
  view with a "Back to the sentence" control (`[data-back]`) when a stack
  exists; a word tapped inside it joins that sentence's stack as before.
- Underlines are untouched: `showWord` still records the lookup / marks a
  yellow word learned before the row is added, and Learned / Unlearn / Forget
  in a row go through `onLookupsChanged` as they did (Forget removes the
  row). `panel.refresh()` re-renders the rows on a remote lookups change.
- Crossing 768px while open: the popup's entry joins its sentence's stack;
  the stack's open row (or the summary) becomes the popup.

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

## Grammar section (GRAMMAR-CONTRACT.md, workstream D)

`app/js/grammar/index.js` is mounted once from `main.js` at the end of boot
(`mountGrammar({ store, dict, par, reader, settings, saveSettings })`). It binds
the header's Read / Grammar control (`.seg--section`, `[data-section]`) and the
`<section id="grammar" hidden>` mount; while Grammar is open `<html
data-section="grammar">` hides the reader's `.layout` (`hidden`), the View
switch, the toolbar toggles and the translation hint (`grammar.css`), and every
keydown inside the section stops before the reader's letter shortcuts. Nothing
loads until Grammar is first opened (or the device last left it open,
`localStorage['l103.section']`): then the skill map (`data/grammar/skills.json`,
falling back to `skills.sample.json`), every week's units from the store, and
the grammar store (`store-grammar.js`: IndexedDB v6 stores + `store.js`'s
`grammarHooks` outbox / realtime with the real store; localStorage
`l103.grammar.*` with the fixture). Views: skill map, lesson, Learn flow,
Practice setup, session runner, stats — all in `ui.js`; the pure parts
(`scheduler.js`, `items.js`, `stats.js`, `session.js`'s `judge`) are tested
under `tests/grammar.*.test.mjs`. `window.latinGrammar` is the section's
context (`.current` = the item on screen) for tests and debugging.

## Review shelf (2026-09-05)

Familia Romana I–XXIV as library weeks n = 100 + chapter (`r01`–`r24`, Latin
only). See `docs/GRAMMAR-CONTRACT.md` "Review shelf in the reader" for the
helpers; in the UI:

- `main.js` builds the weeks menu from `groupWeeks(outline, weeks)`
  (`settings.js`): the course rows as before, then a `.weeks__group`
  disclosure (`.weeks__group-btn[aria-expanded]` + `ol#weeks-shelf`) with one
  `.weeks__row[data-shelf]` per chapter (numeral in `.weeks__n`, title, focus
  label, progress count, no time-left). `settings.shelfOpen` remembers it;
  arrow keys move over the heading and the visible rows.
- `weekNumberLabel(n)` / `weekTitleLabel()` name the header button and the
  document title ("Cap. VII · Puella et Rosa"); `weekPhrase(n)` ("chapter VII")
  feeds Settings → Audio / Progress, the reset confirm and messages, the
  listen bar's "No recording for this chapter yet".
- `paintTranslation()` (with every week load and display change) hides the
  Translation toggle and forces `#reader[data-english="hidden"]` on a shelf
  week; `initSettings({ hasTranslation })` disables the switch with the hint
  from `translationDesc(false)`. `reader.js` skips the `.en` row for a unit
  whose `en` is empty (both views).
- `timeLeftFor(read, total, n)` returns '' for a shelf week; `studyLog()` keeps
  the pace / per-week table about the course weeks.
- `store-fixture.js` carries chapters I and VII (invented sentences) so the
  shelf can be tried with `?fixture=1`; every other shelf fetch is
  short-circuited (no 404s).

## Grammar wave 2 — depth (2026-09-06)

Stage-3 production kinds, the chapter sets, two new inputs and the daily plan.
Shapes and ownership: `docs/GRAMMAR-CONTRACT.md` "Wave 2 — depth".

- **New modules.** `app/js/grammar/stage3.js` (transform · reorder · translate,
  built from the same candidates as the wave-1 kinds), `sets.js` (the chapter
  sets: question sets, vocabulary decks, pensa — loading, item generation and
  the `setsOfChapter` / `setChapters` / `phraseIndexes` helpers), `generate.js`
  (one façade over `items.js`, `stage3.js` and `sets.js` with the wave-1
  interface: `generate`, `drillable`, `pool`), `inputs.js` (the `order` and
  `match` inputs) and `today.js` (the daily plan, pure). Tests:
  `tests/grammar.{stage3,sets,today}.test.mjs`.
- **The two new inputs are keyboard-first.** `order`: arrows walk the bank
  (Home / End to the ends), Enter or Space places, Backspace takes the last
  word back; a placed word is a button that unplaces itself; drag is added only
  under `(pointer: fine)`. `match`: arrows move within a column and across to
  the other, Enter picks a word then its meaning, and a pair is tapped again to
  break it. Every pair carries a **number on both halves** (`data-n`, drawn by
  `.g-match__b[data-n]::before`) so the mapping is visible, not just implied by
  a fill; the same number is in the `aria-label`. The on-screen `.g-keys` line
  states the keys. Targets are ≥ 44 px under a coarse pointer.
- **Chapter sets on the map.** Each chapter's skills are followed by a quieter
  `.g-sets` list (`Chapter sets`) with one `setRow` per set: Start as new · Add
  to mixed practice · Practise · Reset. A pensum has **no** Start — it is
  practise only (three independent guards: `setRow`, `startLearn`, `bulkNew`) —
  and its `unverified` items are dropped by `groupPensa` before they can reach
  an item, keeping the surviving items' original indexes so item keys stay
  stable. The reverse (English → Latin) vocabulary deck is optional: it is
  excluded from "Add all", "Start all as new" and the week's sets, and only
  appears as its own row. A "Chapter sets" filter chip shows the sets alone.
- **Pensa are private data.** They come through `store-grammar.js` from
  `public.pensa` (migration 0016) and are absent until that pipeline runs: with
  no rows a chapter simply shows no Pensa row, the map's lede stops promising
  them, and nothing throws.
- **The chapter-set share is a sliding window with a floor and a ceiling.**
  At most `SET_MAX` (3) and at least `SET_MIN` (1) set items in any
  `SET_WINDOW` (10) in a row — not a session total, so a 15-item or open-ended
  session keeps the same feel. The floor matters: review-heavy walks the skill
  map in book order and the sets sort after every grammar skill, so without a
  reservation they were starved to zero. `setFloorSlots` picks one position per
  window of ten (and per trailing part-window of five or more) and
  `buildSession` fills it with a due set. `buildSession` takes `prior` (the
  slots already played) so an open session's next batch counts across the seam,
  and `requeue` takes `played` and `setSlotFits` so a missed set item comes back
  into a window that has room on **both** sides of the splice. The preset "This
  week" and a one-skill set are uncapped and unfloored.
- **A set skill has exactly one kind, and that is honoured when the *skill* is
  picked.** Two set slots side by side would otherwise always break "no two
  consecutive items of one kind", so `vocab-01` is never placed next to
  `vocab-02` (a `questions` slot beside a `vocab` slot is fine).
- **A pensum blank is macron-sensitive; nothing else is.** Pensum items carry
  `exact: true` and `judge` compares with `matchesFormExact` (case and
  punctuation ignored, v/u and j/i folded, macrons kept). Ørberg's Pensum B for
  chapter I offers *Italiā* beside *Italia* to drill the ablative against the
  nominative, so accepting either would delete the item. A macron-only miss is
  flagged `macron: true` and the feedback names both forms, reading their case
  off the word's own paradigm. The Pensum B bank is a **multiset** — one tile
  per required occurrence — and the UI tracks tiles by position, never by text,
  so a sentence wanting the same word twice can be finished.
- **A pensum sentence owns its stem.** `text` already reads "Rōma in Itali_
  est."; `blanks[].stem` is metadata for the input's label and for accepting
  "Italiā" typed out. Neither `inlineInput` nor the "Filled in" model answer
  adds it again.
- **A chapter set's Learn is a capped, resumable pass.** `SET_LEARN_BATCH` (15)
  items with feedback, then "another 15" / "go on to the ten" / "stop for now",
  with a progress bar reading *n of N seen*. The place lives in
  `localStorage['l103.grammar.learn']`; the item pool remembers which items have
  been shown, so a resumed batch never repeats one. A deck of 119 words is not
  a sitting.
- **The weeks-menu Today card is cheap.** `mountGrammar().todayCard()` runs
  `lightInit()`, not `init()`: the skill map, the grammar store and **the
  current chapter's two JSON files** through the loader the full section later
  reuses — no unit or highlight scan over every week, no lesson-example fetch,
  no 68 chapter files. A set in rotation from another chapter gets a stub row
  carrying its title and state, which is all the card prints. Opening Grammar
  runs the full `init()`, which disposes the light UI's popstate listener and
  builds its own. When `buildToday` is called without an items generator it
  falls back to "a skill with a parse filter is drillable".
- **"Reset all" clears everything the section holds**, not only the four store
  keys: the saved practice session (resuming it re-created skill states from the
  pre-reset queue), the "start all as new" run, a set's half-finished Learn pass
  and today's dismissal.
- **The Today card** (`today.js` → `ui.js todayCard()`) renders in two places:
  the Grammar map's Today section (`place: 'map'`, with the session-in-progress
  and "start all as new" lines above it) and the weeks menu
  (`main.js paintWeeksToday()` into `#weeks-today`, `place: 'weeks'`, with the
  reading line). Lines: Learn (the current 103 week's first unlearned drillable
  skill, the rest counted) · Practice (a 10-item review-heavy session, due count
  and confusion pairs) · Questions · Vocabulary due · Read. Grammar minutes come
  from the learner's own drill pace **per kind** (`itemSecondsBy`: the median of
  the last 200 attempts of that kind once 20 exist, each attempt capped at
  120 s, the result clamped to 5–120 s, else the kind's own default — a
  recognition tap is not a translation). The Read line offers a **day's share**
  of the week (`ceil(unread / days left in the week)`) at the study log's pace
  and says so; the Questions and Vocabulary "first pass" lines cost the Learn
  batch plus the blocked ten ("15 of 43, first pass"), not the whole deck; the
  total is labelled "about N min if you do it all". Nothing on the card reads as
  a quota. "Not today" hides it for the day (`settings.todayDismissed`,
  a local date); the map offers "Show it" back. A lesson-only skill (a metre
  skill, or one with no sentences yet) never reaches the Learn line — `buildToday`
  takes the section's own `drillable` predicate, falling back to "has a parse
  filter" when it is called pure.
- **Manifests.** `pipeline/build_grammar_index.py` writes and validates all
  three (`lessons/index.json`, `questions/index.json`, `vocab/index.json`);
  `--check` fails when one is stale or a file is malformed.
  `build_lessons_index.py` is kept as an alias. Adding a set file means
  re-running it, adding the file to `app/sw.js` PRECACHE and bumping
  `CACHE_VERSION` (sw is **v36**).

## Grammar wave 3 — polish (2026-09-06)

Confusion analytics, per-skill history, printable charts, and the second
library shelf. Shapes and ownership: `docs/GRAMMAR-CONTRACT.md` "Wave 3 —
polish".

### The two shelves (`sync.js` / `settings.js` / `main.js`)

The review shelf is no longer the only one. `sync.js` now names the shape once:

- `SHELF_BASE` (100) and `COLLO_BASE` (200), each owning the hundred above it
  (`SHELF_SPAN`), so `weeks.n` 101–199 is Familia Romana and 201–299 Colloquia
  Personarum (migration 0018 allows 1–299).
- `shelfKind(n)` → `'review' | 'colloquia' | null`, with `isShelfWeek`,
  `isReviewWeek`, `isColloquiaWeek` and `shelfChapter(n)` (107 → 7, 207 → 7 —
  colloquium N accompanies chapter N) built on it. **Every place that already
  branched on `isShelfWeek` is therefore right for the colloquia with no
  change**: the 103 pace and the per-week table (`studyLog`), the time-left
  estimate, `#reader[data-shelf]`, the translation toggle and the `e`
  shortcut, `items.js` / `stage3.js`'s current-week pool guard, and the
  grammar section's "last course week".
- `weekOfUnit()` reads `c07:3.1` as 207 (`w` / `r` / `c` are the three library
  prefixes). Progress rows, resets and the menu counts follow.
- Labels: `weekNumberLabel(207)` → "Colloquium VII", `weekPhrase(207)` →
  "colloquium VII". Nothing ever says "Week 207". `weekTitleLabel` is
  idempotent — a title that already opens with its own label ("Colloquium VII ·
  Iūlius et Syra", the shape the pipeline writes) is not given it twice.
  `translationDesc(false, …, kind)` names the shelf the learner is on.
- `groupWeeks()` returns `{ course, shelf, collo }`; `SHELF_GROUPS` is the
  menu's ordered list of shelf headings — `key`, `kind`, list `id`, the
  settings flag that remembers the disclosure (`shelfOpen` / `colloOpen`), the
  heading text and its `unit` / `plural` ("2 colloquia", never "colloquiums").
  `main.js`'s `shelfGroupRow(g, entries, currentN)` renders any of them, so a
  third shelf is one entry in that array.
- `reader.js`: `isTurn(u)` treats `unit_type` `'turn'` (the course weeks) and
  `'speech'` (the colloquia) alike — the speaker's name before the Latin, the
  turn on its own line, and neither joined into a printed book line.
- `store-fixture.js` carries colloquia I and VII (invented speaker turns) as
  well as review chapters I and VII, so both shelves can be tried with
  `?fixture=1`. Their `title` is the speakers alone; the app supplies the
  "Colloquium N".

### Confusion analytics (stats page)

`stats.confusionPairs(rows, skills)` folds the two directional `confusions`
rows for a pair into one line — "you mix up X and Y" is symmetric — naming the
pair (a, b) with `a` the direction actually answered more often and keeping
both counts. The stats page's **"What you mix up"** prints each pair with:

- the plain-words reason, from `stats.confusionReason(a, b, { lessonA, lessonB })`:
  either lesson's own `confusion` block naming the other wins; failing that the
  two skills' `plain` glosses are set against each other. The lessons are
  fetched after the first paint and swapped in, so the section never waits; the
  text is lesson prose, so it goes through `inline()` for its emphasis.
- which way round it went, in words;
- a **Start** that runs `scheduler.buildPairSession({ a, b, states, skills, size })`
  — ten slots alternating exactly those two skills, each at its own stage, no
  two consecutive slots of one kind. It is not a preset: `renderPracticeStart`
  takes a `pair` param and hands the finished plan to `createPractice` with
  `fill: null`, so a missed item re-queues **within the pair** and no third
  skill is ever added.

Empty state: nothing until a wrong answer names another skill.

### Per-skill history (`view: 'history'`)

Reached from a skill-map row's **History** button (shown once the skill has an
attempt), from the stats page's per-skill list, and from an item's feedback
(inside the "Why" disclosure, so Enter on Next can never hit it mid-session).
Read from `drill_attempts` and `confusions` only — no new tables:

- `gstore.getAttempts({ skill, limit, since })` reads one skill's tail through
  a **per-skill index** built on demand and dropped on every write;
  `gstore.countAttempts(skill)` counts without materialising. The view asks for
  the last `HISTORY_WINDOW` (400) and `stats.skillHistory()` windows again,
  reporting `total` honestly beside `read` and saying so when they differ.
- `stats.progressTrail()` replays stability and stage over those attempts with
  `scheduler.applyAnswer` itself (`skill_state` keeps only today's row, so the
  shape of the curve can only come from the log); Learn-mode attempts are
  carried through without moving it, as the scheduler never did.
- On the page: the counts, a day strip of the last 21 days, the stability
  curve as an inline SVG polyline with a tick per wrong answer (no library, and
  the reading is given in words beside it), the stage changes, the last twenty
  items with the learner's own answer beside the right one (the table scrolls
  inside its own box on a phone, with the paradigm tables' edge shade), and the
  skill's confusions with a "practise the pair" each.

### Printable charts (`print.js` + `css/print.css`)

`css/print.css` is linked with `media="print"`, so it never touches the screen.
`printDocument(content, { title })` builds the pages into one `#g-print` root
outside the app's tree, sets `html[data-printing]`, calls `print()`, and takes
everything down on `afterprint` (with a timeout for the browsers that never
fire it). `html[data-printing] body > *:not(#g-print) { display: none }` — no
app chrome on the paper, A4 with a 16/14 mm margin, black on white, macrons as
the tables hold them.

- **Print chart** (a lesson, and a skill's history): `buildChart` puts one
  paradigm section on each page — `break-after: page` — with the skill's focus
  cells boxed and bold (a box, not a tint: it survives a greyscale printer) and
  a key line naming them in the skill's own plain words.
- **Print sheet** (a lesson): `buildSheet` puts the lesson's rule, the paradigm,
  the examples with their references, and the confusion note on one sheet,
  allowed to run onto a second rather than cutting the examples.
- **Print charts** (the skill map's bulk row): every skill the category filter
  is showing that has a paradigm, one table a page, after a confirm that says
  how many pages it is.
- `paradigmPages()`, `cellText()`, `focusNote()` and `sheetSubtitle()` are pure
  and tested (`tests/grammar.stats.wave3.test.mjs`).

sw is **v38**: `css/print.css` and `js/grammar/print.js` are precached.

## Grammar wave 3 — the review and QA fixes (2026-09-06)

`qa/grammar/CODE-REVIEW-G3.md` and `qa/grammar/QA-REPORT-G3.md`, answered.
The findings and what was decided are in `docs/GRAMMAR-CONTRACT.md`, "Wave 3 —
review and QA fixes"; what a reader of this file needs to know:

- **`index.js` exports `createDrillableMemo({ items, skills })`.** The section
  is built twice in a life — cheaply for the weeks-menu Today card
  (`lightInit()`, no `ctx.items`), then in full — and the memo behind
  `ctx.drillable(id)` must survive that. It answers `false` without caching
  while there is no generator, never memoises a chapter set, and is cleared by
  `buildSets()`. `ui.refresh()` is a no-op while `ctx.items` is null, so the
  light instance never paints the map. Without both, a reader who opened the
  weeks menu before Grammar saw 83 of 87 skills reading "no sentences in the
  library yet" until the page was reloaded.
- **`stats.skillHistory(rows, { total })`** takes the lifetime count from
  `gstore.countAttempts(skill)`; the rows it is handed are already trimmed, so
  it cannot know it. `countAttempts` itself now uses the per-skill index the
  windowed read builds, which the map asks 87 times a paint.
- **`stats.dayList(days, now)`** builds every day strip with calendar
  arithmetic (`new Date(y, m, d - i)`), not `now - i × 24 h`, so a clock change
  cannot lose or double a day.
- **`stats.progressTrail`** replays Learn's own pass: a run of learn-mode
  attempts is buffered and, where `learnCriterion` passes over its last ten,
  `passLearn` is applied at that attempt — the state every practice answer
  after it was really judged against. A self-graded "partly" comes from
  `drill_attempts.self`.
- **`scheduler.requeue(plan, { …, pair, cap })`.** `pair` names the other skill
  of a confusion-pair session: the plan alternates, so the re-queue is spliced
  in as the pair (`skill`, `other`), the only shape that keeps the alternation.
  `cap` is the session ceiling — `session.sessionCeiling(asked)`, asked plus
  half of it and at least two, so a ten-item session tops out at fifteen. The
  runner exposes `asked` / `added` / `capped`; the item and the summary say in
  words how many items came back and when the session is full.
- **`printDocument`** sets `root.hidden = true` (the print stylesheet is
  `media="print"` and cannot hide anything on screen) and cleans up on
  `afterprint`, on `matchMedia('print')` going false, or after five minutes —
  in that order of preference. `buildSheet` returns a `.pr-doc--sheet` wrapper
  whose footer is fixed, so it runs on both pages of a sheet that flows.
  `print.captionFor` drops a one-section table's caption, so a noun chart is no
  longer headed "cases".
- **The map's Print charts** is `async`: a category filter prints straight
  through, "All" asks before any work is done, and the build yields after the
  "Building…" message and every eight skills.

sw is **v40**.

## Grammar by chapter (2026-09-06)

The book's spine, grammar side (GRAMMAR-CONTRACT.md "Chapter spine —
navigation by chapter"). The chapter → readings mapping is `app/js/chapters.js`
(owner A); nothing under `js/grammar/` re-derives it.

- **`app/js/grammar/chapter.js`** (new, pure, `tests/grammar.chapter.test.mjs`):
  `spine(list)` — the chapters in order, from `chapters()` when it is there and
  from the numerals I–XXXIV when it is not; `chapterMaterial(n, { skills, order,
  sets, entry })` — the chapter's skills in book order (its entry's own list
  wins) and its sets in Questions · Vocabulary (· reverse) · Pensa order;
  `chapterProgress` / `chapterSummary` — the counts and the one quiet line that
  states them; `chapterPool` — the drillable members as a skills Map with the
  ids in rotation, lapsed and addable; `spineRows` — the by-chapter view's rows;
  `normaliseView`.
- **`mountChapterGrammar(el, { chapter })`** is exported from
  `js/grammar/index.js` (and carried on `mountGrammar`'s handle). It paints
  twice on a cold start — the rows and their states from the light path, then
  the whole panel once the library has been read — because what can be drilled
  is not knowable before the generator exists and no row may claim otherwise.
  Returns `{ chapter, refresh(), destroy() }`; mounted panels are repainted with
  the section (`ui.repaint`) and dropped once their element leaves the document.
- **Two hooks the shell sets on the handle.** `onChapterNav(fn)` — how a lesson,
  a history page or a session opened from a chapter page gets back
  (`fn(n, 'grammar')`); without it the section falls back to its own by-chapter
  view, scrolled to that chapter. `onLeaveChapter(fn)` — how it *leaves* the
  chapter page first, since `html[data-page="chapter"]` hides the whole section;
  without it the section clears the chapter route itself, which the shell's
  hashchange handler reads the same way.
- **The Skills page has two views**, a segmented `By topic` / `By chapter`
  (`.g-seg--views`) under the title, remembered as `settings.grammar.view`.
  By topic is the map as it was (category filter, bulk actions, Review first).
  By chapter is the spine: 34 `<details>` sections (`.g-chap--spine`), each
  summarising its counts and holding the same skill and set rows. Which
  chapters are unfolded is the learner's and survives a redraw; the chapter
  being read opens itself the first time, and each view keeps its own scroll.
- **"Practise this chapter"** is `render('session', { chapter: n })`:
  `createPractice` with the chapter's drillable material as its whole
  `skillsIndex`, so the plan, the filler and the re-queue can reach nothing
  outside it while the interleaving, confusable-pair and chapter-set rules hold
  as usual. A lapsed member is put back into rotation first (the one-skill
  rule). Where a chapter has few grammar skills and several sets, the set
  window yields — `buildSession`'s own fallback: the session is the chapter's
  material, not a rule kept by leaving items out.
- **"Practise this skill" is its own view** (`blocked`), so Back leaves it and a
  chapter page can open it through `ctx.go`. It used to render under the
  `session` view name, which built a second, unused mixed session first.
- `js/grammar/chapter.js` must be added to `sw.js`'s PRECACHE (owner A).

## Session flow — move on, step back, colour the result (2026-09-06)

GRAMMAR-CONTRACT.md "Session flow — move on, step back, colour the result" and
"Hints, per answer box". All of it is owner B's: `js/grammar/session.js` (the
rules), `js/grammar/ui.js` (the views), `css/grammar.css`, and
`tests/grammar.session-flow.test.mjs`.

### The runner (`session.js`, pure, no DOM)

`createRunner` now keeps two positions. **`index`** is the item on screen;
**`frontier`** is how far the session has got, and `index` never passes it.
Three arrays ride alongside the queue, all indexed by queue position: `made`
(the item built for that slot, or `null` when the slot built nothing and is
skipped), `results` (the **first** answer there) and the queue itself.

- **Only the first answer to an item is written down.** `answer(value)` judges a
  retry or a replay and hands the result back with `retry: true`, but it adds no
  `drill_attempts` row, no `skill_state` (so no `successes`, no
  `successes_spaced`, no streak or stage move), no `confusions` row, no
  re-queue, and no entry in `log` — which is what the Learn criterion,
  `summary()` and the stats page all read. Trying twice therefore cannot inflate
  a skill anywhere.
- **`back()` / `forward()`.** `back()` steps to the nearest item already made
  (skipping slots that built nothing) and never re-generates; `forward()` behind
  the frontier returns towards it, and *at* the frontier it is the deliberate
  press that gets past an answered item — the only way past one answered wrong.
  `canForward` is false while the item on screen has not been answered at all,
  so forward is not a way to skip a question.
- New reads on the runner: `frontier`, `replay`, `held`, `answered`,
  `resultAt(i)`, `itemAt(i)`, `canBack`, `canForward`. `snapshot()` still
  resumes at the frontier; a resumed session starts its walk there, since the
  pages before it belong to another sitting.

### The view (`ui.js` `runSession`)

- A **nav bar** above the item (`.g-runnav`): back arrow · "4 of 10" · forward
  arrow. The position lives here and not on the item, because a page is kept
  exactly as it was left and a number printed inside it would go stale as the
  session grows. The count skips slots that built nothing.
- **A right answer moves on by itself** after `ADVANCE_MS` (1400 ms). Focus goes
  to *Next*, so Enter advances at once; the back arrow cancels the beat, and
  stepping back is how a line that went by too fast is re-read.
- **A wrong answer holds.** The feedback offers *Try again* (primary — rebuilds
  the same item fresh, keeping the runner's first result) and *Move on* (quiet),
  and says in plain words that only the first answer counted.
- **Pages are cached per queue position** (`pages[i]`), so a step back shows the
  item exactly as it was left — the typed text still in the field, the choice
  still marked, its own feedback under it — and every input is already disabled
  by `submit()`, so a replay cannot be re-graded. A tapped word stays clickable
  for its gloss but no longer moves the pick mark.
- **Left / right arrow keys** do the same, **on the section's own root**, not on
  the document: `index.js` stops keydown from leaving `#grammar` so the reader's
  letter shortcuts cannot fire from inside a drill, and a document-level handler
  would never hear them. They are ignored when focus is in a field or inside
  `.g-order` / `.g-match` / `.g-chart`, which use the arrows themselves.

### Colour

`.g-fb[data-ok]` carries the result: `--success` tint for right,
`--rubric-soft` for wrong, both defined in `tokens.css` for light and dark. It
is never the only signal — the mark is a ✓ / ✗ / ~ in a ring (a shape, so it
survives greyscale and a black-and-white print), the line says the word, and a
visually-hidden "Correct." / "Not right." / "Partly right." opens it for a
screen reader.

### Hints, per answer box

`boxHints(item, { skill, describe })` in `session.js` (pure) returns one entry
per answer box: `{ id, index, label, levels }`, `id` being the key that box's
input uses (a chart cell index, a blank index, a match row, a chunk index; `'0'`
where the item has a single box). Two levels: what *this* box is being asked
for in plain words with the grammar term, then the rule or the paradigm cell it
comes from.

- **Three modes**, `settings.grammar.hints`: `press` (default), `always`, `off`,
  chosen on the Practice setup and used by every session however it was started.
  *Always show* opens each box's first level from the start and logs every
  answer as `hinted`; the setup says so where the learner chooses it. Level two
  stays a second press ("Tell me more") in every mode.
- **Where the control sits.** A single-box item keeps the familiar `<details
  class="g-hint">` under the input. A chart, a pensum, an order or a match item
  gets a small `?` per box (`.g-hintb`) and a panel under the input
  (`.g-hints`), so a hint never covers the box or the sentence. Order and match
  put their controls in a labelled row (`.g-hintrow`) instead of on the chips,
  which are already the tap and drag targets.
- **A reorder item's boxes are its word chips**: a chip cannot be tapped for its
  dictionary entry the way a word in a plain sentence can, because tapping
  places it, so the hint is where that line lives (`describe` is `ui.js`'s
  wrapper over `dict.lookup` / `dict.describe`).
- **A hint never spells an accepted answer.** `answerLeak(text, answers)` and
  `acceptedAnswers(item)` are exported beside it; `boxHints` runs every level,
  and every authored clause inside one (a pensum blank's `note`, a lesson's
  `summary`), through that check and drops what leaks — so a note reading
  "agrees with fluvius" is dropped from an item whose sibling blank accepts
  *fluvius*, and the plain statement of the blank still stands.
  `tests/grammar.session-flow.test.mjs` sweeps every drillable skill the same
  way, the build-time twin of the `fix4` B1 sweep. `recognise` and `parse` carry
  the same exemption they carry there: their answer is a label, not a form.
  Endings of one or two letters that are also ordinary English words (*a*, *is*,
  *am*, *us*) are out of the check by construction — no English sentence about
  the ablative can avoid "a", and nothing ever interpolates a Latin form into
  hint text.

### Also fixed while here

- `renderSetup` used a `from` it never took as a parameter, so the Practice tab
  threw `ReferenceError: from is not defined` and drew nothing.
- `dictLine` in `sets.js` printed a verb's principal parts twice when the deck's
  `dict` already carried them.

## The chapter spine — navigation by chapter (2026-09-06)

The book's own way in (GRAMMAR-CONTRACT.md "Chapter spine — navigation by
chapter"): Familia Romana I–XXXIV, each chapter offering its reading or its
grammar. The course weeks stay reachable as a second view, because the pace,
the time-left estimates and the study log are computed per 103 week.

### `app/js/chapters.js` (new, pure, `tests/ui.chapters.test.mjs`)

**The single source of truth for the chapter → week mapping. Nothing else in
the app may hard-code it** — `main.js`, `settings.js` and `js/grammar/` all
read it from here.

```js
chapters()            // the 34 chapters, frozen, in order
chapter(n)            // one, or null
readingsOf(n)         // its readings
chapterOfWeek(weekN)  // the reverse: 107 → 7, 4 → 27, 3 → 27, 14 → 34
weekChapters()        // Map week → chapter, built once
readingPrefix(r) / inReading(unitId, r)   // the unit ids a reading owns
metaList(names, {max}) / readingsMeta(readings, {max})
parseChapterRoute(hash) / chapterHash(n, tab)   // #/chapter/7 · #/chapter/7/grammar
CHAPTER_MAX (34) · SHELF_CHAPTER_MAX (24) · CHAPTER_TABS · SOURCE_NAMES
```

A chapter is `{ n, roman, title, readings, weeks, grammar }`; a reading is
`{ id, kind: 'fr'|'collo'|'fs'|'fl', week_n, part, label, supplement }`, and
`grammar` carries the wave-2 set ids (`questions-07`, `vocab-07`,
`vocab-07-rev`, `pensum-07`). The mapping as implemented:

```
ch  1–24  Familia Rōmāna = review shelf week 100+N   ·  Colloquium N = colloquia week 200+N
ch 25 w01   ch 26 w02   ch 29 w07   ch 30 w08   ch 31 w09   ch 33 w12
ch 27 w04 + w03's five stories (Mīnōs, Corōnis, Fabellae LXIII–LXV)
ch 28 w06 + w05's five (Coriolānus, Nausicaa, Fabellae LXVI–LXVIII)
ch 32 w11 + w10's seven (Arachnē, Fabellae LXIX–LXXIV)
ch 34 w13 + w14        (the one chapter that spans two course weeks)
```

Each part of a supplement week is a reading of its own, addressed by the slug
its unit ids carry (`w03:minos:1.1`, `w05:fl-66:b2.1`), so a story has its own
progress. All fourteen course weeks and both shelves appear exactly once; the
titles are the book's table of contents, so a chapter the library has not got
still shows its numeral and name.

### Row models (`settings.js`, pure, `tests/ui.chapter-rows.test.mjs`)

- `MENU_TABS` / `menuTab(settings)` — the menu's two tabs; **Chapters is the
  default**, and `settings.menuTab` remembers the last used.
- `chapterRows({ library, totals, read, audio })` — one row per chapter: the
  readings the library actually holds, the meta line, `read` / `total` summed
  over its **distinct** weeks (so a supplement week counts once however many
  of its stories are listed) and whether any of them has a recording.
- `chapterMeta(readings)` — the row's second line. On the shelves it is the
  readings' names ("Familia Rōmāna · Colloquium VII"); from XXV on the course
  week comes first, since that is where the pace and the study log know it
  ("Week 4 · Mīnōs · +4 more", "Weeks 13 and 14").
- `readingWhere(reading, title)` — "Review shelf", "Colloquia Persōnārum",
  "Week 4 · Rēs Rūsticae", "Week 3 · Fabulae Syrae". Never "Week 107".
- `readingRows(n, { library, units, totals, titles, progress, audio })` — one
  row per reading with its own `read` / `total`, `firstId` (where the row
  opens), `firstUnread` (the row's Continue, only while it is part-read) and
  `audio`. A part's figures come from the units whose id carries its slug; a
  whole-week reading whose units are not loaded falls back to `totals`.

### The menu (`index.html`, `main.js`, `css/chapters.css`)

`#weeks` gains a tablist (`.weeks__tabs`, roving tabindex, arrows select) over
two panels: `#weeks-panel-chapters` (`#chapters-list`) and
`#weeks-panel-weeks` (`#weeks-list`, **today's list unchanged** — course
weeks, both shelf disclosures, the pace and the time-left estimates).
`.weeks[open]` is a flex column with `overflow: hidden`, so the head and the
tabs stay put and only the open panel scrolls; `main.js` moves `#weeks-today`
(the day's plan) into whichever panel is open, inside that scroller, so a
five-line card can never leave the list three rows of room.

Chapter rows reuse the `.weeks__row` grid (roman numeral, Latin title, meta,
state, hairline bar). `keepPlace(list, render)` wraps both lists' renders: the
audio marks and every progress change repaint them while the menu is open, and
a rebuilt row would otherwise drop the keyboard's focus to the page. Arrow keys
step over disabled rows, as Tab does.

### The chapter page

`<section id="chapter">`, built by `main.js`, shown when the route says so:
`html[data-page="chapter"]` hides `.layout`, `#grammar`, both segmented
controls and the display toggles (`css/chapters.css`), so the header keeps the
week button — **relabelled with the chapter, so two numerals never share a
screen** — and Settings. `← All chapters` reopens the menu on its Chapters tab.

Two tabs of its own, `Reading` and `Grammar`, each a route:

- **Reading** is `readingRows()` as `.creads` — name, where it lives, an audio
  mark, its own progress, and `Continue →` beside it once part-read. A row
  opens its week in the reader at the reading's first sentence, Continue at the
  first unread one; both drop the hash first, so Back comes back to the chapter.
- **Grammar** calls the section's `mountChapterGrammar(el, { chapter })` after
  `mountGrammar()` has resolved. It is loaded lazily — only when the tab is
  first opened — and its absence is a quiet placeholder pointing at the Grammar
  section, never an error; a mount that returns no handle is tried again.

Routing lives in the hash and nowhere else: `parseChapterRoute(location.hash)`
on `hashchange` and once at the end of boot. `#/chapter/7` and
`#/chapter/7/grammar` are linkable; leaving for the reader is a `pushState`
that drops the hash, so Back returns to the chapter page on the tab it was on.
The reader's letter shortcuts and `j`/`k` do nothing while a chapter page is
open. The section's own hooks are wired here: `onChapterNav(fn)` sets the hash,
`onLeaveChapter(fn)` drops it.

### Fixture

`store-fixture.js` invents two course weeks — **4** (Familia Rōmāna, six
sentences) and **3** (Mīnōs, Corōnis, Fabella LXIII as three slugged parts) —
used **only when `data/build/weeks.json` is not being served, so nothing
changes on the dev server**. Offline the Chapters list then still has all three
shapes: chapter VII with two readings, chapter XXVII with a course week and a
supplement story, chapter II with neither.

`sw.js` is **v42** (`js/chapters.js`, `css/chapters.css`, and the grammar
side's `js/grammar/chapter.js`, precached).

## Redo what was wrong (2026-09-06)

GRAMMAR-CONTRACT.md "Redo what was wrong". Owner B's throughout:
`js/grammar/store-grammar.js` (the query), `scheduler.js` (the plan),
`session.js` (the run), `items.js` / `sets.js` / `stage3.js` / `generate.js`
(rebuilding one named item), `ui.js`, `css/grammar.css`, and
`tests/grammar.redo.test.mjs`. No new file, so `sw.js`'s PRECACHE is unchanged.

### What counts as missed (`store-grammar.js`)

`isMissedAttempt(a)` — the answer was wrong, and on a self-graded translate the
learner's own grade was "wrong". `judge` already counts "partly" as correct, so
the `self` clause is the belt to that brace (migration 0017 gave
`drill_attempts.self` for exactly this).

An item is named by **(skill, item_key)**, not by the key alone: the key is
stable per (kind, unit, token), but two skills scanning the same word of the
same sentence produce the same `blank:w01:1.1:x:0`.

```js
g.getMissed({ skill, skills, limit })   // rows, most recently missed first
g.countMissed({ skill, skills })        // the number every redo control prints
```

Both read a **third index beside `bySkill`**: one pass over the log keeps the
latest attempt per item, and what survives `isMissedAttempt` is cached, newest
first. It is dropped by the same `dropIndex()` every write already calls, so a
new attempt, a `resetSkill` and a `resetAll` are all seen at once. Without it
every repaint of the setup, a history page or a chapter panel would walk
thousands of rows on a phone. Attempts with an empty `item_key` are left out:
they name no item, so they could never be redone and must not inflate a count.

### Rebuilding one named item (`items.js` and the other generators)

`generate({ …, itemKey })` asks for that exact item. It threads down to
`createPool.chooseInfo(skill, kind, keys, rand, tiers, want)`, which hands the
key over (marking it used like any draw) or answers **null** when it has gone —
the sentence left the library, the deck changed, the pensum was edited. With an
`itemKey` set, **neither fallback runs**: not the current-week retry, not the
fall-through to another kind. A different sentence or a different kind would be
a different item wearing the same name. `recognise` has two shapes over one
candidate, and the key says which: `recognise-tap:` is the tap-the-word variant,
plain `recognise:` the multiple choice, so `tap` is settled by the prefix.

Nothing is thrown when an item has gone: the slot builds nothing, the runner
skips it, and the count on screen is smaller than the count offered.

### The plan (`scheduler.js`, pure)

`buildRedoSession({ misses, skills, states, size, seed })` → ordinary slots,
each carrying `itemKey` and `redo: true`. Three rules in order: the **newest
miss leads**; the `size` items are taken **round-robin across the skills that
missed** (each skill's own newest first) and then walked out so that neither the
skill nor the kind repeats beside itself while anything else is left; and
nothing outside the `skills` map handed in ever becomes a slot — the caller
hands in one skill, one chapter's material, or the whole map.

### The run (`session.js`)

`createRedo({ misses, gstore, items, skillsIndex, size, oneSkill, … })` builds
that plan and hands it to `createPractice`. Everything else is an ordinary
session: every answer is a `drill_attempts` row and goes to the scheduler,
because a redo happens later in time and is the spaced retrieval the plan wants.
A right answer clears the item (its newest attempt is now correct); a wrong one
keeps it with a fresher timestamp; a miss re-queues as usual, inside the world
handed in. `oneSkill` makes it blocked, so a miss is not re-queued beside itself.

**The redo and the in-item retry cannot be confused in the code.** A retry never
reaches `onAnswer` — `createRunner.answer` returns early with `retry: true` and
writes nothing anywhere — while a redo is a fresh slot in a fresh queue that
goes through it like any other. Two more reads support the views:
`runner.dropped` (slots that built nothing) and `summary().missed`, one row per
item with the **last** answer to it deciding (`sessionMisses(log)`, pure).

### Where it is offered (`ui.js`)

A new view, **`redo`**, in the Practice group of the nav; `renderRedo` narrows
by `skill`, by `chapter`, or not at all, and `renderNothingToRedo` is the quiet
empty state. Four ways in, each printing its own count:

- **End of a session** — "Redo the N you missed" leads the summary's actions,
  built from that session's own `summary().missed`. It is narrowed exactly as
  the session was and no further: `oneSkill` rides in the params of every mixed
  session as the remembered choice, so it names the world only when the
  `one-skill` preset was the one actually used.
- **Practice setup** — "Missed items · N" as a fifth choice beside the four
  mixes (`.g-preset--missed`, set a little apart by a rule). It is not a mix
  over skills, so Start opens the redo view instead of a session, capped by the
  size chosen. With nothing to redo the radio is disabled and says so.
- **A skill's history page** — an action beside "Practise this skill"; with
  nothing to redo, a quiet line under the buttons instead.
- **A chapter's grammar** (the by-chapter view and the chapter page's panel,
  which share `chapterBody`) — beside "Practise this chapter", with the same
  quiet line folded into the sentence under it.
- **A Learn result, once the run has passed** — the blocked ten's own misses.
  Only on a pass: a redo is logged as practice, and offering one on a failed run
  would move the skill to `practising` without its criterion ever being met. The
  same rule is why `redoable(id)` (in rotation — `practising`, `mastered` or
  `lapsed` — and drillable) filters every scope; a lapsed row re-enters with
  `addToPractice` first, as "Practise this skill" and "Practise this chapter"
  already do, so the answers that follow are not judged early.

Wording keeps the two apart on screen: a redo's note reads "Each counts towards
its skill — unlike trying an item again on the spot, which never does", against
the feedback's "Only your first answer counts towards the skill, so trying again
costs nothing".

A redo resumes like any other session — `LS_SESSION` carries `redo: true` and
the queue's slots keep their item keys — and the Today card's one Resume button
names it ("A redo is in progress") and routes to the right view.

## Progress across every chapter (2026-09-06)

The learner's request (GRAMMAR-CONTRACT.md "Progress across every chapter"):
the timings and all the components for **every chapter**, not only the current
week. A page at `#/progress` lists all thirty-four, each row opening to its
readings, its grammar and what it will take; the book's totals sit at the top.
The fourteen-week table in the study log is untouched — this is by chapter and
additional to it.

Two ways in, as the contract asks: **Progress** in the weeks menu's head
(`[data-open="progress"]`), and **Progress by chapter** in Settings → Progress
beside "Clear study log" (`[data-action="open-progress"]`, wired through
`progress.study.openBook`; the button hides when the shell offers no route).

### `app/js/progress.js` (new, pure, `tests/ui.chapter-progress.test.mjs`)

```js
parseProgressRoute(hash) / progressHash(n)   // #/progress · #/progress/7
chapterGrammar({ skills, sets, stateOf, seenOf, secondsFor, known })
setRow(set, { seenOf, stateOf, secondsFor })  // one chapter set: done of total, minutes left
skillLeftMs(state, seconds)                   // what a skill costs before it has been met once
chapterRow(readingRow, { grammar, pace })     // one chapter; `readingRow` is settings.chapterRows()'s
chapterRows(readingRows, { grammarOf, pace })
chapterLine(row) / timingLine(row)            // the row's one line · "About 40 min spent · about 2 h to come"
bookTotals(rows, { measuredMs, skillsTotal, skillsMastered })
fmtEstimate(ms) / fmtMeasured(ms) / paceNote(pace) / estimateNote(pace)
readingMs(sentences, pace) · SKILL_STATES · CHAPTER_STATES · SET_KINDS
```

It never re-derives the chapter → week mapping: the reading side arrives as
`settings.chapterRows()` rows (which read `chapters.js`), and the grammar side
as `skills` / `sets` lists the caller has already grouped.

**Measured against derived.** The only measured quantity in the app is the
active minutes the study log records (CONTRACT.md "Study log"): that is
`bookTotals().measuredMs` and the totals band's "Minutes measured", printed by
`fmtMeasured` in the plain voice. *Everything else* — every chapter's time spent
and time to come — is worked out from the study log's pace (sentences per active
hour) and the per-kind drill medians the Today card computes
(`itemSecondsBy`, `grammar/today.js`), and is printed by `fmtEstimate`, which
always says "about". `paceNote()` under the totals and `estimateNote()` under
each chapter's own total say so in words, naming the pace and adding "not
measured"; with too little reading time behind it, both name the assumed 60
sentences an hour instead. Nothing on the page presents a derived figure as a
measurement.

**What "to come" means.** A chapter's remaining grammar is *a first pass over
what has not been met yet*: the lesson and its fifteen guided items for a skill
never started, the blocked ten for one part-way through or lapsed, nothing for
one already in rotation, plus the unmet items of each set at that kind's median.
Spaced practice after that is the daily plan's business and is deliberately not
counted — estimating it would be a guess about the future rather than an
estimate of work in hand.

**Nothing done reads as nothing done.** A chapter with no reads and no answers
shows "Nothing done yet", not a row of zeros; a chapter neither in the library
nor carrying grammar shows "Not added yet"; a component a chapter does not have
(no Colloquium after XXIV, no pensa, no question set) is simply absent, and the
optional English → Latin vocabulary deck is listed only once it has been
touched. The hairline gauge appears only while a chapter is part-read.

### The page (`main.js`, `app/css/progress.css`)

`html[data-page="progress"]` hides the reader, the grammar section and the
reader's toolbar, exactly as a chapter page does. `#/progress/7` opens with that
chapter unfolded; opening a row updates the hash with `replaceState`, so a
chapter's detail can be linked to without filling the history. The rows are a
disclosure list (`aria-expanded` / `aria-controls`), arrow keys walk them as
they do in the menu, and a repaint keeps the focused row.

**How it is kept fast** (the book is 8,000+ sentences, 88 skills and 100+ sets):

- The list paints from what the shell already holds — the weeks' unit counts
  (`weekTotals`) and the progress map — so the first paint waits for no fetch.
  Measured on the fixture: **~30 ms from the route change to all 34 rows in the
  DOM, ~60 ms to pixels** (1440 × 900, warm shell).
- The grammar is read once through `mountGrammar`'s `ctx` (never past it):
  `todayCard()` warms the section's cheap start when it has not run, the chapter
  sets come from `ctx.sets` when the section has fully started and from the same
  `createSetLoader` otherwise, and the attempt log is walked **once** into
  `skill → { attempts, distinct item keys }`. All of it is memoised per chapter
  and dropped when `gstore.onChange` fires.
- A chapter's own units are fetched only when its row is opened (`unitsFor`),
  and its readings then come from `settings.readingRows()`.
- Reading progress arriving from another device repaints the page in place
  (`paintProgress` → `paintProgPage`).
