# Shared contract — Latin 103 Reader

Read this before touching anything. PROMPT.md is the brief; this file is the
set of agreements the parallel workstreams build against. If you need to
change a shape here, change this file first and say so in your final report.

## Stack (decided)

- **Front end:** vanilla JS, native ES modules, **no bundler, no build step**.
  Everything under `app/` is served as-is. Dev server: `python -m http.server 8000`
  run from the **repo root**, app at `http://localhost:8000/app/`, fixtures at
  `http://localhost:8000/data/build/…`. Production publishes only `app/`.
- **Only dependency:** `@supabase/supabase-js` vendored as a UMD file at
  `app/vendor/supabase.js`. Nothing else. No frameworks, no CDN at runtime.
- **CSS:** one token file `app/css/tokens.css` (colours, type scale, spacing,
  light + dark), then component files. `prefers-color-scheme` + manual override.
- **Python 3.13** for the pipeline (`pipeline/`). `whitakers_words` is installed.
- **Node 24** for `scripts/seed.mjs` (runs on the user's machine only).
- **Privacy:** `source/`, `data/week*`, `data/build/`, `data/grammar-notes-*`,
  `data/highlights-*`, `data/supplement-*`, `audio/` are gitignored. The
  glossary (`app/data/glossary.json`) and function-word file ship publicly.

## Folder layout

```
app/                      public shell (deployed)
  index.html
  manifest.webmanifest
  sw.js                   service worker (E)
  config.js               SUPABASE_URL, SUPABASE_KEY (anon/publishable; safe to commit)
  css/tokens.css, css/reader.css, css/panels.css …   (D)
  js/main.js              boots app; wires store + ui (D, then F)
  js/auth.js              (E)
  js/store.js             the Store interface implementation: IndexedDB cache + Supabase sync (E)
  js/store-fixture.js     same interface, reads /data/build/*.json — dev only (D)
  js/db.js                IndexedDB helpers (E)
  js/audio.js             upload, alignment mode, playback (E)
  js/reader.js            passage view + sentence view (D)
  js/wordpanel.js         word popup / side panel (D)
  js/dictionary.js        lookup + learner rewrite (B)
  js/paradigms.js         paradigm-table generator (B)
  js/tokenize.js          Latin tokeniser (B) — shared by D
  js/settings.js          type size/face/dark/compact (D)
  data/glossary.json      regenerated Whitaker export (B)
  data/function-words.json (B)
  vendor/supabase.js      (E)
pipeline/                 python: md → aligned units (A), glossary build (B)
data/build/week-NN.json   pipeline output, gitignored (A)
data/build/highlights-week-NN.json  (C)
supabase/migrations/*.sql (E)
scripts/seed.mjs          upload data/build → Supabase as the user (E)
tests/                    node --test for JS, pytest for python
```

## Data shapes

### `data/build/week-NN.json` (A produces; D, E consume)

```jsonc
{
  "week": {
    "n": 1, "id": "w01",
    "title": "Thēseus et Mīnōtaurus",
    "source": "FR",                 // FR | FS | FL
    "chapter": "XXV",               // FR/FS chapter, or FL story numbers "63–65"
    "has_line_numbers": true,       // false for Fabellae Latinae
    "focus": { "key": "deponent", "label": "Deponent verbs", "blurb": "one sentence" },
    "parts": [ { "part": "Pars I", "lines": "1–41" } ]
  },
  "units": [
    {
      "id": "w01:1.1",              // week id + line.sentence (or block.sentence when no line numbers)
      "order": 0,                    // 0-based within the week
      "part": "Pars I",
      "line_no": 1,                  // FR/FS line where the *block* starts; null when unknown
      "block_start": true,           // first unit of a [n] block → show the line number in the margin
      "unit_type": "sentence",       // sentence | verse | turn
      "speaker": null,               // "Syra" for speaker-labelled turns; else null
      "la": "Syra, postquam facta Mārcī nārrāvit, …",
      "en": "Syra, after she narrated the deeds of Marcus, …",   // CLEAN: bracket tags stripped
      "en_raw": "…",                 // original with brackets (not shown; kept for audit)
      "note": "postquam + perfect …",// per-sentence grammar note or null
      "tags": [                      // seeds extracted from brackets + explicit focus tags
        { "label": "ablative absolute", "la": "Tacente Quīntō", "kind": "gloss|construction" }
      ]
    }
  ]
}
```

Per-week mismatch report: `data/build/week-NN.report.md` — every block where
Latin/English sentence counts differ, with both lists side by side. Never guess.

### `data/build/highlights-week-NN.json` (C produces)

```jsonc
[
  { "unit_id": "w01:91.1", "text": "Laetāminī",  // exact substring of unit.la (first occurrence unless "occurrence": n)
    "label": "deponent imperative, plural",
    "note": "Command to the citizens: 'rejoice!'. Deponent, so the -minī ending looks passive but the meaning is active." }
]
```
The UI resolves `text` → char offsets at load time. Function before form in `note`.

### `app/data/glossary.json` (B produces)

```jsonc
{ "mitterent": [
    { "lemma": "mittō, mittere, mīsī, missum",   // learner citation form, with macrons where derivable
      "h": "mittō", "pos": "V",                   // N ADJ V VPAR PRON ADV CONJ PREP NUM INTERJ (gloss abbreviations: ABBR ENDING PREFIX STEM)
      "cat": [3, 1],                              // Whitaker category codes (decl/conj + variant)
      "gender": null,                             // N only: m | f | n | c; `cat` and `gender` are omitted when null
      "roots": ["mitt", "mitt", "mis", "miss"],   // Whitaker stems, used by paradigms.js
      "parses": [ { "tense": "impf", "voice": "act", "mood": "subj", "person": 3, "number": "pl" } ],
      "senses": ["send", "throw, hurl", "let go, release"],   // learner English, most common first
      "raw": "send, throw, hurl, cast; let out, release, dismiss; disregard",
      "enc": null                                 // "que" | "ne" | "ve" when the form carried an enclitic
    } ] }
```
Keys are macron-stripped, lowercase. Nouns/adjectives use
`{ "case": "dat", "number": "sg", "gender": "m" }` in parses. Supplements
(proper nouns etc.) use the same shape with `"cat": null` when unknown.

### Store interface (E implements in `store.js`; D implements `store-fixture.js`; UI calls only this)

```js
export const store = {
  ready(),                                  // Promise — after auth + cache warm
  getWeeks(),                               // Promise<week[]>
  getUnits(weekN),                          // Promise<unit[]> in order
  getHighlights(weekN),                     // Promise<highlight[]>
  getLookups(),                             // Promise<Map<form, {first_seen_unit_id, learned_at|null, created_at}>>
  addLookup(form, unitId),                  // idempotent
  markLearned(form), unlearn(form), removeLookup(form),
  getSettings(), setSettings(patch),        // {size:1-5, face:'serif'|'sans'|'dyslexic', theme:'system'|'light'|'dark', compact:false, showEnglish:'hidden'|'interleaved', showHighlights:true, showUnderlines:true}
  getAlignment(weekN), saveAlignment(weekN, rows),   // rows: [{unit_id, start_ms}]
  getAudioUrl(weekN),                       // signed URL string | null
  uploadAudio(weekN, file),                 // File → void
  onChange(cb)                              // cb(kind) when lookups/settings change from sync
};
export const auth = { signIn(email, pw), signOut(), user(), onChange(cb) };
```
Settings also mirror to `localStorage` (they are small) so the shell renders correctly before the store is ready.

## Supabase schema (E owns; others read)

Tables `weeks`, `units`, `highlights`, `lookups`, `audio_alignments`,
`settings` — columns mirror the shapes above; every table has
`user_id uuid default auth.uid()` and RLS `user_id = auth.uid()` for
select/insert/update/delete. Storage bucket `audio` is **private**; object
path `{user_id}/week-NN.mp3`; policies scoped to the folder = `auth.uid()`.

## Conventions

- Latin tokeniser (`tokenize.js`) returns `[{text, form, start, end, isWord}]`
  where `form` is lowercase, macrons stripped (ā→a etc.), punctuation removed;
  `start/end` are offsets into the original `la` string. Everyone uses this.
- Never abbreviate case/tense labels in UI text unless `settings.compact`.
- Keyboard: `j/k` or arrows move sentence; `e` toggles English; `h` highlights;
  `Esc` closes panels. Visible focus rings. `prefers-reduced-motion` respected.
- Tests: `node --test "tests/*.test.mjs"` and `python -m pytest pipeline/`.
- Do not commit anything under `data/build/`, `source/`, `audio/`.

## Dictionary / paradigm / tokeniser API (B implements; D consumes)

```js
// app/js/tokenize.js
export function tokenize(la)            // → [{ text, form, start, end, isWord }]
export function stripMacrons(s)         // ā→a etc., keeps case

// app/js/dictionary.js
export async function loadGlossary(url) // fetches + indexes app/data/glossary.json (+ function-words.json, glosses.json)
export function lookup(form)            // → { form, entries: Entry[], via: 'exact'|'lower'|'enclitic'|'miss', enclitic: 'que'|'ne'|'ve'|null }
export function describe(entry, opts)   // opts: { compact?: boolean, form?: string }  → LearnerEntry
// LearnerEntry = {
//   meaning:   "to/for the labyrinth · in/by the labyrinth",   // plain answer, first line
//   parse:     "dative or ablative singular",                  // second line (full words unless compact)
//   lemma:     "labyrinthus -ī m",                             // citation form
//   category:  "2nd declension",                               // or "3rd conjugation", "deponent", "preposition + ablative", …
//   senses:    ["labyrinth", "maze"],                          // learner English list
//   glosses:   [{ term: "dative", gloss: "the 'to/for' case" }],   // plain-language glosses for every label used above
//   usage:     "…" | null,                                     // function words: how it is used
//   paradigm:  Paradigm | null
// }

// app/js/paradigms.js
export function paradigm(entry, parse)  // → Paradigm | null
// Paradigm = { kind: 'noun'|'adjective'|'verb'|'pronoun', title, note?: string,
//   sections: [{ title, headers: [...], rows: [{ label, cells: [{ stem, ending, text, hit }] }] }] }
// Learner order: nom gen dat acc abl voc. Verbs: present, imperfect, future, perfect, pluperfect, future perfect;
// indicative then subjunctive; active then passive; imperative; infinitives; participles. `hit` marks the tapped form.
```

## Additions from workstream A (2026-09-03)

- `unit.source` and `week.parts[].source` are `FR`/`FS`/`FL`; `week.source` may be `"FS+FL"` for weeks 3, 5, 10.
- Multi-text weeks (3, 5, 10) carry a part slug in ids: `w03:minos:1.1`, `w05:fl-66:b2.1`; `week.parts[]` entries there carry `slug`. Notes for those weeks are keyed `"minos:1.1"`.
- `weeks.json` entries add `unit_count`; `week` may carry `lines` (weeks 13/14).
- `recover_lines.py --apply` sets only `line_no`; block-based ids (`w07:b3.2`) stay stable so notes/highlights keyed to them never break.

## Margin notes (added 2026-09-04)

Ørberg's/Miraglia's marginal glosses (the Latin-only explanations printed in
the book margin, e.g. `immortālēs -ium m pl = diī`) are kept. Shape:

- `unit.margin: [{ "line": 45, "la": "immortālēs -ium m pl = diī" }]` — the
  glosses printed beside the lines this unit covers (attached to the unit whose
  block contains that line; `line` is the book line the gloss sits against, or
  null for Fabellae Latinae). Empty array when none.
- Supabase: `units.margin jsonb not null default '[]'` (migration 0004).
- Source: `data/build/margin-week-NN.json` = `[{ "line": n, "la": "…" }]` per
  week, extracted from `scans/*.pdf` text layers by `pipeline/extract_margins.py`,
  merged into the week JSON by `build_week.py` when present.
- UI: a "Margin notes" toggle (default on). Desktop/tablet: a right-hand
  gutter column aligned with the sentence, small serif, dimmed. Phone: shown
  beneath the sentence, above its translation, prefixed with a small "¶"
  marker. Words inside margin notes are tappable like reading text.

## Audio alignment rows (2026-09-04)

`audio_alignments` rows are `{ unit_id, start_ms, words }` where `words` is
`[{ "t": "text", "s": start_ms, "e": end_ms }]` — absolute milliseconds in the
week's recording, from Whisper word timestamps (real recordings, produced by
`pipeline/align_audio.py`) or from Edge TTS word boundaries (synthesised parts,
`pipeline/tts_audio.py`). `store.getAlignment(weekN)` returns them in
`start_ms` order with `words` normalised to `[]`. The UI maps words to the
unit's tokens by order after macron/case/v-u normalisation; unmatched words
are skipped, never guessed. Settings gain `showAudio: true` (toggle + `a`).

## Section summaries (2026-09-04)

`data/summaries-week-NN.json` — `{ "<slug or part name>": { "en": "English summary", "la": "Latin summary" } }`.
`build_week.py` copies them onto `week.parts[]` as `summary_en` / `summary_la`
(stored in `weeks.parts` jsonb; no schema change). The UI shows a collapsible
"Summary" under each part heading: English first, then the Latin.

## Plain-words layer (2026-09-04)

For struggling learners every note gets a simpler second layer:
- `data/grammar-notes-simple-week-NN.json` — `{unit_id: "plain-words explanation"}` → `unit.note_simple` (column `units.note_simple`).
- `data/build/highlights-week-NN.json` entries gain `"simple"` → column `highlights.simple`.
- `data/build/margin-week-NN.json` entries gain `"en"` (short English rendering of Ørberg's Latin gloss) → carried into `unit.margin[].en`.
UI: an "In plain words" disclosure under each note (sentence note, highlight note) and the English shown beneath a margin gloss when tapped/expanded.
- (2026-09-04, later) alignment rows also carry `end_ms` (int|null; the last unit of a shared recording needs it) and `synth` (bool). `words` now has one entry per token of the unit (`t` = the unit's own word text), with times interpolated between confidently matched anchors; interpolated entries carry `"i": true`.

## Pictures (2026-09-05)

Illustrations cropped from the textbook scans, anchored to the sentence they stand beside.
- Pipeline output `data/build/pictures-week-NN.json`: `[{ "id": "w01/p197-1", "file": "data/build/pictures/week-01/p197-1.png", "page": 197, "unit_id": "w01:29.1", "caption": "labyrinthus -ī m", "caption_en": "labyrinth", "width": 900, "height": 620, "sort": 0 }]`.
- Table `pictures` (see migration 0008); objects in the private bucket `pictures` at `{user}/week-NN/p197-1.png`.
- `store.getPictures(weekN)` → `[{ id, unit_id, url (signed), caption, caption_en, width, height, sort }]`, cached per session; offline → whatever is cached in IndexedDB (rows only; images come from the browser cache).
- UI: passage view shows a picture beside its sentence (gutter column on wide screens, above that sentence's margin notes; full-width above the sentence on phones), caption in the reading face, tappable Latin; sentence view shows it above the Latin. Setting `showPictures` (default true).

## Reading progress (2026-09-05)

Table `reading_progress` (user_id, unit_id, week_n, read_at): one row per sentence the learner has read. A sentence counts as read when it has been the current sentence in sentence view for ≥ 2 s or moved past with Next, when it has been played, or when its block has been fully in view for ≥ 2 s in passage view (IntersectionObserver). Local-first with the outbox like lookups; realtime keeps devices in step.
`store.getProgress()` → `Map<unit_id, read_at>`; `store.markRead(unitIds[])`; `store.resetProgress(weekN|null)` (one week or everything, after a confirm). Lookups are never touched by progress or by any reseed.
UI: the weeks menu shows a thin bar and "42 of 93 sentences" per week; the current week's heading shows the same; "Continue where you left off" jumps to the first unread sentence; Settings → Progress has Reset this week / Reset all.
Last position: `settings.lastPosition = { week_n, unit_id, view, at }` is written (debounced) whenever the current sentence changes in either view; on boot the app opens that week and scrolls to / navigates to that sentence (synced through settings like everything else). The weeks menu also opens on the last week.
