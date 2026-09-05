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
plainOpen:false, showGlossEnglish:false, showPictures:true, audioRate:0.5–1.2,
panelWidth:null|px }` — mirrored to `localStorage['latin103.settings']`
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

Store: `store.getProgress()` → `Map<unit_id, read_at>`; `store.markRead(unitIds)`
(idempotent: ids already read are skipped — `makeProgressRows()` in `sync.js`);
`store.resetProgress(weekN | null)`. `store.js` keeps table `reading_progress`
in IndexedDB (`progress` store, DB version 3), local-first through the outbox
(`reading_progress:upsert_many` per batch, `reading_progress:delete` per reset)
with a realtime subscription, so `onChange('progress')` fires when another
device reads. The fixture store keeps `localStorage['l103.progress']`. Lookups
are a separate table / key and are never touched by any of this.

What counts as read — the reader only *notices* (`reader.on('read', { unitIds,
why })`), `main.js` batches (`queueReads()` in `reader.js`, `READ_FLUSH_MS`)
into one `markRead()` and repaints (`paintProgress()`):

- Sentence view: the sentence shown, after 2 s (`READ_DWELL_MS`), or at once
  when moved past with Next / `j` (`goTo` forward).
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
"read ✓" (`.sentence__read`, `reader.setProgress(map)` patches it in place).

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

## Study log and time left (CONTRACT.md "Study log")

Store: `store.getStudyDays()` → `Map<day, active_ms>` (day = local
`YYYY-MM-DD`, `localDay()` in `sync.js`); `store.addActiveTime(day, ms)`;
`store.clearStudyLog()`. `store.js` keeps table `study_days` in IndexedDB
(`study_days` store, DB version 4), local-first through the outbox — one
`study_days:upsert` per day key (the day's running total, so a burst of
flushes coalesces to the latest figure) and one `study_days:delete` for a
clear — with the **additive-max** rule on both sides: `sendOp()` reads the
server's total and upserts `max(server, local)`; `mergeStudyDays()` (pure,
`tests/study.test.mjs`) keeps the larger figure per day on a pull and, like
progress, merges nothing while a study op is still in the outbox (a pull
overlapping a clear must not bring the days back). A realtime subscription
on `study_days` → `onChange('study')`. The fixture store keeps
`localStorage['l103.study']`. A library without the table (seeded before
migration 0010) logs a warning and goes without.

Active time (`main.js`): a 15 s ticker (`ACTIVE_TICK_MS`) banks its length
while the tab is visible and there was pointer / key / wheel / scroll / touch
activity within the last 60 s (`ACTIVE_IDLE_MS`; `bump()` on capture) or
audio is playing — `activeSlice()` in `settings.js`, pure; a throttled tick
banks at most two ticks. The bank is flushed every minute
(`ACTIVE_FLUSH_MS`), at once on `visibilitychange` → hidden and `pagehide`,
and before a day boundary (to the day that is ending); coming back to a
hidden tab resets the tick clock, so time away is never banked. Each flush
re-reads the map and repaints.

Stats (`settings.js`, pure): `sentencesPerDay()` / `sentencesPerDayByWeek()`
group the progress map's `read_at` by local day; `studyLog({ progress,
studyDays, now })` → `{ today, days (the last 14, oldest first, each
{ day, ms, sentences, pace }), weeks ({ n, ms, sentences, pace }), pace,
overall }`. A week's minutes are each day's minutes **shared out by the
sentences read in each week that day** (the table has no per-week column; a
day with time but no sentences is counted in no week) — the dialog says so.
`paceOf()`: sentences per active hour over the last 7 active days
(`basis: 'recent'`), else over every active day (`'overall'`), else
`ROUGH_PACE` = 60/h (`'rough'`); a pace needs `PACE_MIN_MS` (2 min) of time
behind it. `timeLeftText(unread, pace)` → "about 45 min left" (5-minute
steps from a quarter-hour up, halves of an hour from one hour up: "about 1½
h left"), "finished", "(rough estimate)" appended on the rough pace.

UI: `#progress` gains `[data-progress-left]` ("42 of 93 read · about 45 min
left · Continue →"; hidden when finished); every weeks-menu row with a
library week gets `.weeks__left` ("· about 2 h left") after its count.
`paintProgress()` recomputes `stats` on every progress or study change
(`timeLeftFor()` in `main.js`). Settings → Progress → **Study log**
(`initStudyLog()` in `settings.js`, `[data-study]` in index.html): today's
line (minutes · sentences · pace), an inline SVG sparkline of minutes per
day over the last 14 (`sparklinePath()`, pure; one series in `--ink-3`, the
last point in `--rubric` with a 2 px surface ring — tokens, so both themes),
the active days of those 14 as a table (day · min · sentences · pace, newest
first), the per-week rows, the pace line naming its basis, the apportioning
hint, and **Clear study log** (native `confirm()`; the line is shown inside
the dialog). Reset progress leaves the study log alone and the clear leaves
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
