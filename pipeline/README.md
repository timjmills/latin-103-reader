# pipeline/ — week documents → aligned units

Workstream A. Turns `source/week-NN.md` (your Latin + literal English) into
`data/build/week-NN.json` in the shape agreed in `CONTRACT.md`, one unit per
sentence / verse line / speaker turn, with a mismatch report next to it.

```
python -m pip install -r pipeline/requirements.txt   # once: pypdf, pytest, python-docx
python pipeline/docx_to_md.py "source/docx/*.docx"   # Word documents → source/week-NN.md
python pipeline/build_week.py 1                      # one week
python pipeline/build_week.py all                    # every week that has a source file
python -m pytest pipeline -q                         # tests
```

(Set `PYTHONIOENCODING=utf-8` on Windows.)

Files:

| file | what |
| --- | --- |
| `docx_to_md.py` | the user's Word documents → `source/week-NN.md` (week number from the file name) |
| `build_week.py` | the builder (CLI + importable `build_from_text`) |
| `weeks.py` | the 14-week table: titles, sources, chapters, grammar focus, week 13/14 overlap rule |
| `merges.py` | per-week alignment fixes (`MERGES`) and block-type overrides (`OVERRIDES`) |
| `recover_lines.py` | proposes textbook line numbers from a scan for weeks without `[n]` markers |
| `test_build_week.py` | pytest: Week 1 end to end + synthetic fixtures for every format path |
| `test_docx_to_md.py` | pytest: synthetic Word documents through the converter and the builder; Week 1 docx = week-01.md |
| `parse_week_reference.py` | the original one-off parser; kept for its format notes, not used |
| `check_copyright.py` | the copyright gate: no tracked file may carry a run of the private text (below) |

Everything under `data/build/` is gitignored (copyrighted text).

## Copyright gate: `check_copyright.py`

The book and the user's translations live only in `data/build/` and in
Supabase. Before anything is pushed, run

```
PYTHONIOENCODING=utf-8 python pipeline/check_copyright.py
```

It indexes every **5-word window** of the book's Latin in `data/build/*.json`
(units' `la` in the weeks, the review shelf and the colloquia; the scanned
lines; the margin glosses; the pensa; the picture captions; the highlighted
phrases) and every **8-word window** of the user's English `en` in
`week-*.json`, then scans **every file git tracks** — JSON values one by
one, `.js`/`.md`/`.html`/`.css` by their text — and prints each hit as
`file → JSON path (or line) → the string → the window and where it came from`.
Exit 1 on any hit; 0 on none. Matching is over normalised words (lower-case,
macrons stripped, v→u, j→i, punctuation dropped), so a hit is a hit however
it is spelt.

**What "public" means here.** GitHub Pages serves `app/`, but the repository
itself is public, so `pipeline/`, `tests/`, `docs/` and the root documents are
published just as surely. The gate scanned only `app/` until 2026-09-11, and on
the day it was widened it found the book quoted in four of them — worked
examples in `pipeline/README.md` and `CONTRACT.md` that printed a line of Latin
beside the user's own translation, three sentences baked into
`tests/fixtures/grammar/questions/25.json`, and two more in test assertions.
The walk now comes from `git ls-files`, which is both wider and narrower than a
directory walk: a newly tracked file is covered the day it is added, and
anything gitignored — `data/build`, `source/`, the audio — is never read. Pass
`--app <dir>` to scan a single tree instead.

A window of single letters (`a b c d e`, the vowels in a spelling rule) is
skipped: it is an enumeration, not the book's expression, and it was the only
source of false hits.

What is *not* indexed: our own prose that also sits in `data/build` (part
summaries, focus blurbs, notes, the English side of the margin glosses), the
Whitaker dictionary, and the ancient verse Ørberg reprints (Martial,
Catullus, Ovid — `latin_text.CLASSICAL`, public domain, which the metre
lessons quote). A dictionary line that happens to coincide with a margin
gloss (a declension note, the Roman date formula) is allow-listed by exact
file and JSON path in `ALLOW` at the top of the script, each entry with its
reason; a sentence of the book is never allow-listed — rewrite it.

`test_check_copyright.py` runs the gate under pytest. Where `data/build` is
absent (CI, a fresh clone) that test is **skipped**, not failed; the
synthetic tests in the same file still run. `--build DIR` or
`LATIN103_BUILD=DIR` points the script at a library elsewhere.

This is the wider net; `check_questions.py` keeps its own, finer line for the
question sets (answers and choices as span references, `q` never a clause of
its own sentence). Run both before a deploy.

## Dropping in weeks 02–14

1. Put the Word document in `source/docx/` (name starting `Week N …`) and run
   `python pipeline/docx_to_md.py "source/docx/*.docx"`; it writes
   `source/week-NN.md` and prints, per file, the parts it found with their Latin
   / English paragraph counts (a `<--` marks a count difference — look at it
   before building). Or write `source/week-NN.md` by hand in the format below.
   The converter keeps only the readings: Grammatica, Metrica and Pēnsa sections
   and every table are dropped; verse lines (indented paragraphs in the
   documents) are written as one block with a `\` hard break on every line.
2. Optional per-sentence notes: `data/grammar-notes-weekNN.json` (or
   `grammar-notes-week-NN.json`), keys `"line.sentence"` → note text, exactly
   like Week 1. Keys may also carry the week prefix (`"w07:b3.2"`).
3. `python pipeline/build_week.py NN`, then open `data/build/week-NN.report.md`.
4. If the report says **NEEDS REVIEW**, fix the mismatches (below) and rebuild.
5. For weeks 3, 5, 7–13 (no `[n]` markers) put the scan at
   `scans/Week-NN-*.pdf` and run `recover_lines.py` (below).

### What the document needs to look like

The builder finds every *part* by its pair of headings — a heading containing
"Textus" (or exactly "Latin") followed by a heading containing "English" or
"Translation" — and names the part after the nearest heading above them:

```markdown
## Pars I (Lines 1–41)            ← "(Lines …)" optional; any heading text works
### Textus Latīnus
[1] Latin block …
[4] Latin block …
### Literal English Translation
[1] English block …
[4] English block …
```

Grammatica, Pēnsa and front matter are ignored automatically (they have no
Latin/English pair). Blank lines separate blocks.

Four block formats are recognised; a document may mix them:

| format | how to write it | what you get |
| --- | --- | --- |
| **`[n]` blocks** | `[8] Puella in hortō sedet. …` in both Latin and English, same numbers | sentences; ids `w01:8.1`, `w01:8.2`; `line_no` 8 |
| **plain paragraphs** | no markers; Latin paragraphs and English paragraphs in the same order | sentences; ids `w07:b3.1` (b3 = 3rd block of the week); `line_no` null until recovered |
| **dialogue** | unmarked paragraphs starting `Dāvus: …` (one or two capitalised words + colon) **in a Fabellae Latīnae part**. Several turns may share a paragraph if each label follows a full stop | one unit per turn, `unit_type: "turn"`, `speaker` filled, the `Name:` prefix removed from `la`/`en` |
| **verse** | one verse line per physical line, every line ending in a Markdown hard break `\` (what `docx_to_md.py` writes; lower-case pentameters and one-line poems work), or — without breaks — ≥ 2 lines each starting with a capital; English the same way, line for line | one unit per line, `unit_type: "verse"`, never split at full stops inside the poem |

Blocks that begin with a speaker label but are not Fabellae Latīnae — Week 1's
`[4] Syra: "Quam fābulam…"` and the unmarked `Iūlius: "…"` paragraphs of the
later Familia Romana chapters — stay sentences with the label in the text,
which is how Week 1's notes are keyed and keeps the chapters consistent. To
force a block's type use `OVERRIDES` in `merges.py` (`"verse"`, `"prose"`,
`"dialogue"`); `"latin_only"` accepts a block that has no English by design
(Week 9's Pompeian graffito) and `"skip"` leaves a block out.

The first block of an unmarked part whose heading says `(Lines 60–126)` gets
`line_no` 60 (the part starts there); the other blocks stay null until
`recover_lines.py` fills them. Ids are block-based (`w07:b3.2`) either way.

**Multi-text weeks (3, 5, 10).** Give each story its own part heading naming
its source, e.g. `## Fabulae Syrae 1: Mīnōs (Lines 1–49)` and
`## Fabellae Latīnae 66: Dāvus et Mēdus` (`docx_to_md.py` writes exactly these,
taking a Fabulae Syrae range from the document's "Readings:" list when the
heading has none). The heading decides the part's
`source` (FS / FL) and a slug that goes into the ids so two stories that both
start at line 1 cannot collide: `w03:minos:1.1`, `w03:fl-66:b7.1`. Notes for
those weeks are keyed `"minos:1.1"`. The report's *Parts* table shows the slug
and source it chose for every part — check it.

**Weeks 13–14.** The six overlapping lines (*Ōdī et amō*) stay in Week 13;
Week 14 starts at *Hīs versibus recitātīs*. `weeks.py` carries this rule and
the builder drops the overlapping blocks (listed in the report); the first
kept block of Week 14 gets `line_no` 139 from `weeks.py`. If the phrase is
not at the start of a block it warns instead — split the block. A Week 13
document that already ends before the phrase gets a note, not a warning.

### English bracket tags

Tags in the English are stripped from `en` (kept in `en_raw`) and collected in
`tags`:

- `[imperfect subjunctive: mitterent]` → `{"label": "imperfect subjunctive", "la": "mitterent", "kind": "construction"}`
- `[Ablative Absolute]` → `{"label": "ablative absolute", "la": null, "kind": "construction"}`
- `[He]`, `[Why]`, `[echoed]`, `[With Quintus being silent]` → `kind: "gloss"`
- `[Martial 7.3; negative purpose: nē mittās]` → two tags, split at `;`

A bracket standing alone after a sentence (`…with me! [optative: essem].`) is
not a sentence of its own: it is glued to the sentence before it and the
dangling full stop is dropped from `en`.

A tag with a colon is always a construction. Without one it is a construction
only if it names a grammatical term (case names, moods, "gerund", "ablative
absolute", "dative of agent", "purpose clause", …); everything else is a gloss.
When you want a construction recognised for certain, write the colon form.

## Reading the report and fixing mismatches

`data/build/week-NN.report.md` starts with a status line:

- **OK** — every block's Latin and English counts agree, no warnings.
- **OK WITH WARNINGS** — counts agree; read the warnings (text before the
  first marker was ignored, an English block has no Latin partner, …).
- **NEEDS REVIEW** — at least one block where the counts differ. Units were
  still written (Latin sentences without a partner have `en: null`), but the
  translation is misaligned from that block on, so fix it before reading.

Each mismatch shows both lists numbered from 0, side by side:

```
### Block `91` (Pars III, sentence): 8 Latin vs 9 English sentences
| # | Latin | # | English |
| 0 | Magister: "Tacēte" inquit "puerī, nam fābulam legere volō! | 0 | The teacher said: "Be quiet, boys! |
| 1 | Aperīte librōs vestrōs! | 1 | I want to read a story!" |
…
```

(The rows above are invented — the report prints the real text, which is not
reproduced here. See "What never enters the repo" below.)

Here English 0 and 1 belong to Latin 0 (the Latin runs on with `inquit`).
The fix goes in `pipeline/merges.py`:

```python
MERGES = {
    1: {"en": {91: [(0, 1)], 101: [(4, 5)]}},   # week 1: join English 0+1 in block 91, 4+5 in block 101
    7: {"la": {"b3": [(1, 2)]}},                 # week 7: the translator rendered Latin 1 and 2 as one sentence
}
```

- Block key: the line number for `[n]` blocks, `"b3"` for unmarked blocks,
  `"minos:12"` / `"fl-66:b2"` in multi-text weeks — the report prints the exact
  key next to each mismatch.
- `(a, b)` joins sentences `a..b` into one. Indices refer to the list as it
  stands when that merge runs; merges for a block apply in the order listed.
- Merge English (`"en"`) when one Latin sentence became two English ones;
  merge Latin (`"la"`) when two Latin sentences became one English one.
- Verse mismatch: make the English block have one line per Latin line.
  Dialogue mismatch: check the speaker labels on both sides.

Rebuild; the report lists the merges it applied. The builder never guesses
an alignment on its own.

### Sentence splitting rules (Latin)

Split after `.` `!` `?` `…` (optionally followed by a closing quote) when the
next word starts with a capital or an opening quote; also before a lowercase
`an` after `?` (second half of a double question). Consequences:

- `"Tacē" inquit "et audī!` is one sentence — `inquit` inside a quotation
  never splits it.
- `'Audī! Audī! Respondē mihi!' neque quisquam respondit…` — three
  exclamations, but the last runs on with lowercase `neque`, so it stays with
  the narrative.

(Both examples are invented, for the same reason as above.)
- `possum...' 'Deī' inquit` splits after the ellipsis; the quotes stay on
  their sentences (text is verbatim apart from whitespace).
- Abbreviations with a full stop before a capital (`M. Tullius`) would split;
  the Ørberg/Miraglia texts do not use them.

## Recovering line numbers from a scan

For weeks whose document has no `[n]` markers:

```
python pipeline/build_week.py 7                 # first: units exist with line_no null
python pipeline/recover_lines.py 7              # reads scans/Week-07-*.pdf → data/build/week-07.lines.md + .lines.json
#   … review week-07.lines.md; edit line_no values in week-07.lines.json if needed …
python pipeline/recover_lines.py 7 --apply      # writes line_no into every unit of each block
python pipeline/recover_lines.py --selftest     # proves the tool on a generated PDF
```

The tool reads the PDF text layer (pypdf), uses the marginal numbers on the
odd pages as anchors, counts lines on the even pages, and matches the first
words of every block to propose the line where it starts. Every proposal
carries a confidence and the physical line it matched; **review each one
against the book** — OCR of macron vowels is unreliable and an unnoticed
running head shifts an even page by one line. Ids stay block-based
(`w07:b3.2`) after `--apply` so notes and highlights keyed to them survive;
only `line_no` changes. Fabellae Latinae parts are skipped (no line numbers
in the book). Full limitations in the docstring of `recover_lines.py`.

## Output

- `data/build/week-NN.json` — `{ week, units }` exactly as in `CONTRACT.md`.
  Additions: every unit and every entry of `week.parts` carries `source`
  (`FR`/`FS`/`FL`) so mixed weeks can be rendered per source; `week.source` is
  `"FS+FL"` for those weeks; multi-text parts also carry `slug`.
- `data/build/week-NN.report.md` — status, parts table, merges applied,
  warnings, mismatches side by side, the construction tags found (seed list
  for the highlight workstream), note coverage.
- `data/build/weeks.json` — index of the `week` objects for every week whose
  build exists (plus `unit_count`), refreshed on every run.

## Review shelf: Familia Romana I–XXIV from the scan

`python pipeline/review_shelf.py [chapters] [--sql]` builds
`data/build/review-NN.json` (week `n = 100 + chapter`, id `rNN`, Latin only,
one part "Capitulum N", block per printed paragraph, `lines` and `margin` as
for the other weeks) straight from the text layer of `scans/familia-romana.pdf`,
reusing `extract_margins.py` for the page geometry, line numbering and gloss
cleaning and `build_week.split_sentences` for the sentences. Unit ids are
`rNN:<line>.<k>` — the printed line the sentence starts on. `--sql` writes
`data/build/sql/rNN-*.sql` through `seed_sql.week_sql`; `--dump` prints every
classified row; `--render DIR` renders the pages for a spot check. Everything
uncertain (sentences left out, OCR repairs made, unverified tokens, layout
notes) goes to `data/build/review-REPORT.md`; the docstring of
`review_shelf.py` explains the cleaning rules. `weeks.json` is not touched.

## Colloquia shelf: Colloquia Personarum I–XXIV from the scan

`python pipeline/colloquia.py [numbers] [--sql] [--check]` builds
`data/build/collo-NN.json` (week `n = 200 + colloquium`, id `cNN`, source `CP`,
title "Colloquium N · <speakers>", `chapter` = the same-numbered Familia Romana
chapter, Latin only, `has_line_numbers: false`, `margin: []`) from the text
layer of `scans/colloquia-personarum.pdf`. One block per speaker turn; every
unit is `unit_type: "speech"` with `speaker` set from the printed name before
the colon (a bare label — "Mārcus:" — moves into `speaker` and leaves the Latin;
a narrative lead-in — "Dōrippa Mēdum salūtat:" — stays in the text and names the
speaker too). Ids are `cNN:bK.S` (block, sentence) because this book prints no
line numbers. `--sql` writes `data/build/sql/cNN-*.sql` through
`seed_sql.week_sql`; `--check` rebuilds and validates without writing anything;
`--dump` prints every classified row; `--render DIR` renders the pages at
200 dpi for a spot check. The per-colloquium report is
`data/build/collo-REPORT.md`. Nothing is uploaded and `weeks.json` is untouched.

**Why this is not `review_shelf.py`.** The Colloquia scan is a much worse text
layer than the Familia Romana one: *no macrons at all*, heavy letter confusion,
no printed line numbers, and a *hanging* indent (a turn starts flush left, its
runover lines are indented) instead of Ørberg's paragraph indent. So the page
geometry, the block rule, the token cleaning and the id scheme are this book's
own; only `build_week.split_sentences`, `extract_margins._variants` and
`seed_sql` are shared.

How the text is restored, in order (the module docstring is the full version):

1. **Pages.** The k-th page carrying a `COLLOQVIVM` heading starts colloquium k;
   the reading ends at the `DECLINATIONES` appendix. The spans are cross-checked
   against the printed *Index colloquiōrum* on p. 5 — a mismatch is reported,
   never silently fixed. Front matter (pp. 1–6) and the appendix (pp. 75–79) are
   dropped; this book has no exercises.
2. **Columns.** The marginal glosses are set at 9.0 pt in the outer margin, the
   reading at 8.1/8.2 pt. The main column's x-range is measured from the 8.x
   words, then *every* word inside that range is kept whatever its size — the
   macron capitals Ō Ā Ē Ī are set at 9.9/10.0 pt and dropping them would
   silently truncate a sentence. The glosses fall outside and are dropped.
3. **OCR repair**, by an explicit rule table built by reading the rendered
   pages, never a blind regex sweep:
   * the scan's Latin-1 accents *are* the book's macrons (é→ē, ì→ī, ò→ō, ù→ū),
     and a capital vowel inside a word is a macron vowel (margarItae →
     margarītae, fOrmosa → fōrmōsa) — both are normalisations, not guesses;
   * `CHAR_RULES`, applied as candidate generation and accepted only when the
     result is a spelling the macron index attests. They are **macron-aware**:
     `ii` and `fi` stand for an overbar vowel, so *iinus* can only be **ūnus**
     (never *anus*, whose a is short) and *liicet* only **lūcet**. Tier 1 is the
     slips the scan makes constantly (ii→ā/ē/ī/ō/ū, fi/fu/ful→ū…, f→ī,
     l/1/I/!/|→i, i→l, rn↔m, 6/0/5→ō); tier 2 (r→f, b→h, ti→d, c↔e, ro→m, …) is
     tried only when tier 1 reaches nothing;
   * `WORD_FIXES`, a word-level table for the recurring proper names
     (*liilia* → Iūlia, *Comelius* → Cornēlius, *Miircus* → Mārcus) and for the
     handful of tokens no character rule reaches, each read off the page;
   * `KEEP_AS_PRINTED`, the book's *own* words: Colloquium I is a spelling
     lesson, so *Barabia*, *Suria*, *Siria*, *Aegiptus* are Iūlia's mistakes and
     must survive, and so must the animal noises.
4. **Macrons.** Every attested form is stripped of its macrons to build a
   macron-less → macronised index in three tiers: **0** the hand-checked cast of
   the *Persōnae* page and the places, declined by `latin_forms`; **1**
   `app/data/glossary.json` run through `latin_forms`, every regular form *with
   its parse*; **2** the clean macronised corpora (`data/build/review-*.json`
   and `source/week-*.md`), for keys tier 1 does not know. One candidate takes
   its macrons; several are settled by agreement with the sentence — the
   hand-checked table first, then a preposition's case government, agreement
   with an unambiguous ablative neighbour, adjective ↔ noun concord in
   case/number/gender, a vocative after *Ō*, the one-letter prepositions ā / ē
   before a name or an ablative, then the short reading for an `-a`/`-ā` pair
   with no anchor (measured on the macronised Familia Romana text: right in
   89 % of cases), then attestation in the clean corpora. What none of those
   settles is printed without macrons and listed.
5. **Sentences.** `build_week.split_sentences`, inside each block, so a
   speaker's quoted words stay whole and keep the block's speaker.
6. **Dropping.** A sentence still holding a token the repair could not settle —
   junk characters, an un-Latin cluster, a word no tier attests and no rule
   reaches, or two repairs the sentence cannot choose between — is dropped whole
   and listed with its page. Nothing is guessed.

**Measured accuracy.** Colloquia I, VII, XIV and XXIV were checked word for word
against the 200-dpi renders of pp. 7–8, 18–19, 36–38 and 72–74: **27 words wrong
of 1642 printed (98.4 %)**, of which 20 are the one block Colloquium XXIV drops
and reports (the text layer turns *nātūrā* into *miturii* and *tonitrū* into
*toniW*). Of the words actually kept, 7 of 1622 are wrong (**99.6 %**), and
every one of those is a vowel-length choice the sentence cannot settle
(*ōris/oris*, *forīs/foris*, *īmus/imus*, *servā/serva*, *advenit/advēnit*,
*Domus/Domūs*, *tonitrūs/tonitrus*) or an OCR slip that produced another real
word (*ōrnārī* printed as *amari*), which nothing can detect.

**Known limits.** The reader shows a speaker name only for `unit_type === 'turn'`
(`app/js/reader.js`), so the shelf's `"speech"` units — the shape the contract
asks for — need that check widened before the names appear. Two of Ørberg's own
oddities are kept as printed and flagged in the report: Colloquium XIV names
*Aemilius* where *Aemilia* is speaking, and Colloquium XXIII's Greek-alphabet
table is a display block the text layer cannot read.

## Shelf notes: the teaching layer for the review shelf

```
python pipeline/build_shelf_notes.py --check     # validate all 24, write nothing
python pipeline/build_shelf_notes.py all         # validate + write data/build/sql/nNN-*.sql
python pipeline/build_shelf_notes.py 7 12        # just those chapters
for f in data/build/sql/n07-*.sql; do supabase db query --linked -f "$f"; done
```

`build_shelf_notes.py` merges `data/shelf-notes-NN.json` (the content agents'
notes, summaries and highlights — the shape in GRAMMAR-CONTRACT.md "Wave 3 —
shelf notes, plain explanations and summaries") into the live library for the
review-shelf weeks `n = 100 + chapter`. **Both inputs are read-only**:
`data/build/review-NN.json` is *not* rewritten (other workstreams read it while
this runs), so the merge exists only as SQL. `nNN-00.sql` carries the week and
the part reassignment, then one file per 25 note updates, then the highlight
inserts — `seed_sql.py`'s style and chunking, so every file stays well under
the Management API limit. Re-running a chapter is idempotent: it clears the
week's notes, deletes its highlights and writes them again.

What the SQL does per week:

- `units.note` / `units.note_simple` for the noted units (a third of the
  sentences), cleared first so a removed note does not linger;
- `units.part` set to the lēctiō the unit falls in. Not optional: the reader
  groups a passage by matching `unit.part` to `week.parts[].part`
  (`renderPassage`, `firstUnitOf` in `app/js/reader.js`), so splitting
  "Capitulum N" into Ørberg's lēctiōnēs without moving the units with it would
  render an empty week;
- `highlights` replaced for the week (delete, then insert `user_id, week_n,
  unit_id, text, occurrence, label, note, simple`);
- `weeks.parts` rebuilt as `{part, lines, source, summary_en, summary_la}` —
  the course weeks' shape (CONTRACT.md "Section summaries"), `lines` computed
  from the printed lines the section's units occupy — and `weeks.updated_at`
  bumped, which is what makes a client refetch the week (`app/js/store.js`).

Validation is a gate, not a warning: a chapter with any error writes no SQL and
the run exits non-zero. It checks the contract's keys (and rejects unknown
ones), that every `unit_id` exists in `review-NN.json`, that a highlight's
`text` occurs verbatim in that unit's `la` at least `occurrence` times, that no
unit is noted twice and no span highlighted twice, that the parts are
contiguous, uniquely named and cover every unit of the week end to end. `--check`
runs all of that over all 24 chapters without writing.

## Audio: aligning recordings and synthesising the rest

Requirements (free, local): `pip install faster-whisper imageio-ffmpeg edge-tts gTTS`.
FFmpeg is bundled by `imageio-ffmpeg`; nothing is installed system-wide.

1. Put each week's recording at `audio/week-NN.mp3` (gitignored). Weeks that
   share one chapter recording (13 and 14) use the same file twice; a week
   with two recordings (week 3: Mīnōs + Corōnis) is joined first with ffmpeg.
2. `python pipeline/align_audio.py all` transcribes with Whisper (CPU, model
   `small`) and aligns the word stream to `data/build/week-NN.json`. Output:
   `data/build/audio/week-NN.alignment.json` (passage_view / sentence_view /
   app_rows with word timings), `data/build/sql/audio-wNN.sql`, and a cached
   transcript `week-NN.transcript.json` so the alignment can be redone without
   Whisper (`--retranscribe` to force it). The log names every sentence that
   had to be interpolated.
3. Stories with no recording (week 10; the Fabellae in weeks 3 and 5; the
   Coriolānus ending in week 5): `python pipeline/tts_audio.py 10` for a whole
   week, or `python pipeline/tts_audio.py 3 5 --fill-missing` after step 2 to
   synthesise only the parts the recording lacks and lay them out in reading
   order around it. Default voice: Edge `it-IT-DiegoNeural` (church-style
   Latin); `--engine google` uses Google's Latin voice. Word timings come from
   the engine's word boundaries. `respace_runs()` then gives every word entry an
   instant of its own before the rows are built — `align_audio.respace()` over
   each run of same-source sentences separately (below). `--rebuild-alignment`
   redoes the alignment from the clips and the joined MP3 already on disk: no
   synthesis, no re-encoding of `week-NN.mp3`, no upload.
4. Upload: `--upload --user-id <auth user uuid>` on either script pushes the
   rows (`audio_alignments`, including `words`) with the Supabase CLI and the
   MP3 to the private bucket `audio/{user}/week-NN.mp3`. The app's own
   "Align audio" mode still works for a manual pass.

## Section summaries and the plain-words layer

- `data/summaries-week-NN.json` — `{slug-or-part: {en, la}}`; merged onto
  `week.parts[].summary_en/summary_la` by `build_week.py`.
- `data/grammar-notes-simple-week-NN.json` — `{unit_id: text}` → `unit.note_simple`.
- `simple` on each highlight in `data/build/highlights-week-NN.json`; `en` on
  each gloss in `data/build/margin-week-NN.json` (copied in by `attach_margins.py`).
- Writing guides: `pipeline/NOTES-GUIDE.md`, `pipeline/PLAIN-GUIDE.md`.
- After any of these change: `python pipeline/build_week.py all`, then
  `python pipeline/seed_sql.py all` and run the SQL files with the CLI.

## Pictures: cropping the illustrations and anchoring them to sentences

```
python pipeline/extract_pictures.py all          # or: 1 3 10   (--debug saves the ink masks)
python pipeline/upload_pictures.py 1 --user-id <auth user uuid>   # rows + PNGs; --sql-only to just write SQL
```

`extract_pictures.py` reuses `extract_margins.py` for the page ranges, the column
geometry and the printed-line index. FR pages are raster scans: the text layer's
word boxes, the running head and the two rules are blanked, the remaining ink is
dilated and the connected components ≥ 1.2 cm are the drawings. FS pages carry
their pictures as embedded images (their rectangles are used directly). FL, in
this edition, prints no pictures. Each picture is anchored to the numbered line
nearest its centre and then to the sentence of that block sharing most words with
the line. Ørberg's picture labels (text-layer rows inside or centred under the
drawing, not flush with the gloss column) become `caption`.

Outputs: `data/build/pictures-week-NN.json` (CONTRACT "Pictures" shape),
`data/build/pictures/week-NN/*.png` (crops, ≤ 1600 px) and `_sheet.png` (contact
sheet with id, page, line, anchor unit, confidence, caption — check anchors
there), `data/build/pictures-REPORT.md`. Hand corrections live in
`data/pictures-overrides.json` (`{id: {caption, caption_en, unit_id}}`) and are
re-applied on every run — labels missing from the scan's text layer and the
English captions are filled in there. `upload_pictures.py` writes
`data/build/sql/pictures-wNN.sql` (delete + insert for the first auth user, the
seed_sql.py pattern) and copies the PNGs to the private bucket
`pictures/<user-id>/week-NN/<file>`. Every CLI call it makes is made on its own
and retried on a transient pooler failure (ECIRCUITBREAKER / SASL / EOF), so it
can be run while another job is uploading.

### The review shelf (Familia Romana I–XXIV, weeks 101–124)

```
python pipeline/extract_pictures.py shelf        # chapters I–XXIV → weeks 101–124
python pipeline/extract_pictures.py shelf 2 9    # selected chapters (--debug saves the ink masks)
python pipeline/upload_pictures.py shelf --user-id <auth user uuid>
```

Chapters I–XXIV are the most heavily illustrated pages in the book — the drawings
are how Ørberg teaches the vocabulary — so the shelf gets them too. Shelf mode is
a second path through the same scan: the units come from
`data/build/review-NN.json` (`review_shelf.py`), whose page set, column geometry
and line numbering are the ones used here, so a picture's printed line names a
shelf unit directly. Ids are `rNN/pPPP-k`, output goes to
`data/build/pictures-week-1NN.json`, `data/build/pictures/week-1NN/` and
`data/build/pictures-SHELF-REPORT.md`; storage paths are
`pictures/<user-id>/week-1NN/<file>`.

Two things differ from the course path.

**Crops that do not clip.** Detection keeps a second ink mask with the text still
on it. Each box is shrunk to the drawing's real ink and then *grown* while ink
still touches an edge (up to 0.7 cm), so a stroke can never be sliced. The crop
then unions in the picture's own labels — including the small capitals Ørberg
letters over his figures (IVLIVS, MEDVS) — pulls its edges off the column rule
and off any running-text or gloss word it would show half of, and finally whites
out whatever printed text still stands inside it (a gloss set level with a margin
figure). Anything that could not be resolved is listed in the report as an
override case rather than shipped.

**Placement by what the drawing is doing.** A drawing in the main column stands
*above* the text it illustrates, so it takes the first numbered line under it; a
drawing in the gloss column stands *beside* its word, so it takes the line level
with it. The line names the sentence printed on it (for a main-column picture,
the sentence that starts there), and a labelled picture is then moved to a
neighbouring sentence that uses the label's headword — the same stem preference
`attach_margins.py` uses for the glosses.

Skipped as furniture: the running head, the page number, the chapter title, the
vertical column rule and the rule under the running head; everything below the
GRAMMATICA LATINA / PENSVM heading (the shelf's text stops there too); and the
margin's rules — the family tree of cap. II, the paradigm boxes — which are type
and rules, not drawings. Ørberg's declension and conjugation tables are set
entirely in type, so they never reach the ink mask at all. This edition prints no
running-head ornaments.

`data/pictures-overrides.json` takes two extra keys in shelf mode alongside
`caption` / `caption_en` / `unit_id`: `"skip": true` leaves a picture out
altogether, and `"rect": [x0, y0, x1, y1]` (page points) replaces the crop with a
hand-measured one. Use them rather than shipping a bad image.

## Pensa: Ørberg's PENSVM A / B / C from the scan

```
python pipeline/extract_pensa.py                 # chapters 1–34 (+ SQL, report)
python pipeline/extract_pensa.py 1 8 20 30       # selected chapters
python pipeline/extract_pensa.py --check         # validate every pensa-NN.json + sql/pNN.sql
python pipeline/extract_pensa.py 1 --dump        # print the rows and the tokens of each pensum
python pipeline/extract_pensa.py 20 --render DIR # render the pensa pages to PNG for a spot check
```

Outputs `data/build/pensa-NN.json` (`{chapter, A, B, C, bank, report}`, the shapes
of GRAMMAR-CONTRACT "Pensa"), `data/build/sql/pNN.sql` (three upserts into
`public.pensa` for the first auth user — nothing is uploaded here; run them with
`supabase db query --linked -f data/build/sql/pNN.sql`) and
`data/build/pensa-REPORT.md` (items, resolved / unverified and text-layer damage
per chapter). `--check` re-reads both files for every chapter and is what CI
should run.

**Pages and blocks.** Chapter *k* starts on the *k*-th page whose running head
reads CAPITVLVM (`review_shelf.chapter_pages`); a pensum runs from its PENSVM
heading to the next one. The heading matcher tolerates one garbled letter,
because the scan prints `PKNSVM` on p143. Rows come from `extract_margins.GEOM`
with the dashes and stops kept — unlike `review_shelf`'s cleaning pass, since the
printed blanks *are* dashes: a short dash after a stem in Pensum A (`vīll-`), an
em dash for a whole word (`—`), questions in Pensum C. The margin beside the
pensa carries the chapter's `Vocābula:` list, which is the printed word bank of
Pensum B (the chapter's `app/data/grammar/vocab/NN.json` deck is added to it).

**Blanks the text layer lost.** Roughly one printed dash in twenty is missing
from the scan's text layer — `sed — — est.` arrives as `sed` … `est.` with a
26 pt hole. Every row is measured: its median word gap is a space and its median
font size is an em dash; whatever is left of an over-wide gap once a space (and,
for a stem that lost its hyphen, a hyphen) is subtracted counts one whole-word
blank per dash width. A row that is not the last of its paragraph is justified
flush right, so a short right end is a lost mark too — the right margin is the
75th-percentile row end, not the widest one, so ordinary justification slack does
not invent blanks.

**Answers.** The pensa re-tell the chapter, so the chapter's own sentences are
the answer key, in this order:

1. *Alignment.* The chapter sentences that share most of the pensum sentence's
   words are aligned against it word by word (Needleman–Wunsch, blanks are
   wildcards). An alignment that reproduces ≥ 70 % of the printed words hands the
   blank the word the chapter prints there; two chapter sentences that disagree
   hand over nothing.
2. *Agreement.* Candidates — for Pensum A the attested forms beginning with the
   stem whose lemma has that root, for Pensum B the word bank's forms, for a
   whole-word blank inside Pensum A the chapter's own words — are filtered by the
   case a preceding preposition governs, by adjective ↔ noun agreement with the
   neighbouring word, by the number of the sentence's copula (a predicate noun is
   nominative and agrees with `est` / `sunt`), and by verb ↔ subject person and
   number. A candidate must satisfy *one* reading of itself against *all* the
   filters, so a word that is a noun under one test and an imperative under
   another is not counted as explained; filters are dropped from the end until
   something survives, so agreement never empties the pool.
3. *Context.* What survives is ranked by what the chapter prints between the same
   neighbours: trigram, then both bigrams, then either — inside the matching
   sentences first, then the chapter at large.

One survivor is *resolved* (Pensum A stores the endings and a note naming the
form); several are all accepted and the blank is `unverified`; none leaves it
`unverified` with no answers. Adjacent blanks are solved in rounds, so an
adjective and its noun each get a second look once the other has a value. A
sentence with a token the OCR left unreadable is `unverified` whatever else
happened, and so is an item with no blanks at all (cap. XXXIV Pensum A is a
scansion exercise, not a fill-in). `-isse` / `-um` after an infinitive (the
principal-parts rows of chapters XXII onwards) are answered from the glossary's
roots.

Pensum C picks the chapter sentence sharing most of the question's content lemmas
— never another question — and cuts a short Latin answer out of it by question
word (`ubi` → the prepositional phrase, `quid est X` → the predicate, `quis` →
the nominative name, `quot` → the numeral, `cūr` → the *quia* / *quod* clause,
`num` / `nōnne` / `-ne` → *Ita* / *Nōn* by whether the sentence affirms the
question). The full sentence is always accepted as well and `unit_id` names it.
A weak match, or a `ubi` / `quis` / `quot` / `cūr` question whose short answer
could not be cut, is `unverified`.

**Known limits.** The glossary is built from the library, so a Pensum A blank
whose answer occurs nowhere in Familia Romana I–XXXIV has no candidate at all —
this is why the future and future-perfect pensa (cap. XX, XXIX–XXXIII) resolve
worst: the book asks for `amābit` and `pugnāverint`, which its own narrative never
prints. Those blanks come out `unverified` rather than guessed. The pronoun
pensa (cap. VIII `h- / ill- / qu-`) are ambiguous by construction and mostly
`unverified` too. Text-layer damage per chapter is listed in the report; the
worst pages are cap. IV, XI, XVI and XXV.

## Shelf audio: word timings for Familia Romana I–XXIV

The review shelf (`review_shelf.py`, weeks 101–124 = chapters I–XXIV) gets the
same word-level audio as the course weeks, from the YouTube readings of Familia
Romana in `Course 6. Latin 101/Youtube Audio/`. Chapter *k* becomes week
`100 + k`, so the pipeline's own week numbering carries straight through:
`audio/week-1NN.mp3`, `data/build/audio/week-1NN.alignment.json`,
`data/build/sql/audio-w1NN.sql`, bucket object `audio/{user}/week-1NN.mp3`.
`align_audio.week_json()` is what routes a week ≥ 101 to `review-NN.json`
instead of `week-NN.json`; nothing else in the script needed changing.

```
# one chapter (chapter IX → week 109)
python pipeline/align_audio.py 109 --audio "…/25. … Cap.9 Pastor & Oves ….mp3"
python pipeline/align_audio.py 109 --upload --user-id <auth user uuid>

# a chapter Whisper mangled: re-run it with the larger model
python pipeline/align_audio.py 123 --model medium --retranscribe
```

**Choosing the recording.** One file per chapter, matched on the `Cap` /
`Cap.` / `Cap_` number in the file name — the `Colloquium N` files (a different
text) and the "Lingua Latina Comprehensibilis" lessons are skipped. The file
name is only a hypothesis: confirm each one by *listening by transcript*, i.e.
compare the first 30 s of the cached Whisper transcript with the chapter's
opening sentences in `review-NN.json`. Every reading opens with a spoken title
("Capitulum quārtum, Dominus et Servī, Scaena prīma") and then the chapter's
first sentence, so the check is quick and unambiguous — do not compare the
normalised token streams numerically, the reader's ecclesiastical pronunciation
comes out of Whisper as `wiha Latina` for *via Latīna* and scores badly however
right it is.

**What is aligned.** Only the reading text, which is all `review-NN.json`
holds. A recording that runs on into Grammatica Latina or the Pēnsa simply ends
up with audio past the last unit, which is correct: the last sentence ends at
its own last matched word, not at the end of the file. The spoken title before
the first sentence is left outside unit 1 the same way. In practice these
readings are the chapter only — the last unit lands at 97–99 % of every file.

**Model choice.** `small` is the default and is enough for most chapters. Where
the reader's audio defeats it the transcript degrades into nonsense tokens, no
sentence matches for a minute or more, and a run of sentences ends up pinned to
the same instant — `--model medium --retranscribe` fixes that (chapter XVII went
from 79 % to 98 % of sentences matched directly, chapter XXIII from 66 % to
87 %). The tell-tales to check per chapter are: the share of sentences matched
directly, the longest run of consecutive sentences sharing one `start_ms`, and
the number of units whose whole span is under 150 ms. `WHISPER_CPU_THREADS=4`
caps the threads per process so several chapters can be transcribed in parallel
(the transcripts cache, so the alignment can then be redone for free).

**Uploading.** Same `--upload --user-id <uuid>` as the course weeks. Two things
the Supabase CLI wants that it did not use to: the source must be a path
*relative* to the repo root (it reads a Windows `C:\…` as a URL scheme and
refuses the copy), and the content type must be named (`--content-type
audio/mpeg`; the bucket allows only `audio/*` and the CLI's guess from the
extension is sometimes `application/octet-stream`). Both are now in
`align_audio.upload()`. Expect the odd `ECIRCUITBREAKER` / SASL failure from the
pooler on the `db query` step — retry the whole step, it succeeds on the second
attempt.

A chapter with no recording would be synthesised exactly like the course weeks'
missing stories — `python pipeline/tts_audio.py <week>` with the Edge voice
`it-IT-DiegoNeural`; that script reads `review-NN.json` through the same
`week_json()`. As it stands every chapter has a real reading, chapter II
included, so nothing on the shelf is synthesised (`synth` is `false` on all
2757 rows).

### Repeated phrases, and the three passes that survive them (2026-09-06)

difflib takes its longest matching block first, which is wrong for Ørberg: the
chapters restate everything in indirect speech, so the same phrase is read twice
minutes apart, and a sentence can be matched to the *later* copy of its own
words. Everything between the two then has nowhere left to match and is crammed
into a fraction of a second. Cap. XXIII was the bad case — 19 sentences whose
speech is at 519–650 s were all pinned inside four seconds at 648 s — and
cap. XIX had a smaller one (5 sentences, up to 35 s out).

`align()` now runs three passes over the anchors:

1. `paced_blocks()` keeps only the matching blocks that agree with each other
   about the reading pace. Between two blocks the audio must be no less than a
   third and no more than twice what their word count needs (plus a pause), and
   the chain carrying the most matched tokens wins.
2. `rescue()` — the old fuzzy second pass — finds a sentence with no block of
   its own between the previous and next confident hits. A rescued sentence is
   itself a boundary for the next one, so a long run is walked forward.
3. `unlate()` moves back a sentence anchored too late. Three tells: far more
   audio before it than its words need; the sentences after it having to be read
   three times faster than the chapter's pace (measured 20 tokens ahead, because
   the sentence right after a misplaced one is usually misplaced with it); or the
   sentence sharing its instant with the next one, so it has no time of its own
   at all — which is what an anchor on a short trailing word looks like (cap. XIV
   `r14:1.3`, where the scan's "Vflla" for *Vīlla* left only "est" to match, was
   pinned to a zero-length span at 19.56 s; its speech is 15.1–19.6 s). Where the
   sentence cannot be found earlier and the room left is under 15 % of what is
   needed, the anchor is given up and the sentence is interpolated: honest,
   rather than confidently wrong. Passes 2 and 3 alternate until nothing more is
   given up.

Measured over the 24 shelf chapters, this moved 37 sentences by more than 2 s:
29 fit the transcript better afterwards, 4 slightly worse (1–3 s boundary
shifts), 4 unchanged. Cap. XXIII went from 110 to 120 sentences matched directly,
its worst span from 146 s to 34 s, and its sub-150 ms spans from 11 to none. Two
sub-150 ms spans are left on the whole shelf (`r05:103.1` at 120 ms, `r15:96.1`
at 75 ms, both two- or three-word sentences whose words Whisper never heard), and
no zero-length one.

**The word cursor's leading words** — a sentence starting at its first *matched*
word, so the words before that anchor were stacked on one instant and never lit
up — was fixed in the pass below, across all 38 weeks.

### Verification of the shelf, chapter by chapter (2026-09-06)

Checked, and re-uploaded afterwards, so `public.audio_alignments` matches
`data/build/audio/week-1NN.alignment.json` exactly (row counts, every
`start_ms`/`end_ms`, every word `s`/`e`, 2757 rows, `synth` false throughout):

- every unit of `review-NN.json` has exactly one row, in order, with one word
  entry per word of its own text; times are monotonic within and across units;
  no unit has a zero or absurd span. Two chapters (V, XV) hold one span under
  150 ms each; the six spans over 30 s (cap. I, XIII, XV, XVI, XVIII, XXIII,
  longest 43 s) are long sentences read across a pause, not stretched ones;
- the last timestamp lands 8.6–16.8 s before the end of every recording;
- each recording is the chapter it claims: every reading opens by naming its
  own chapter ("Capitulum duodēvīcēsimum", "Kapitulun sextum dekimu. Tempestas")
  and all 24 match `shelf-source-map.json`;
- nothing runs on into Grammatica Latina or the Pēnsa — the transcript holds at
  most 11 words after the last unit ends, and those are stragglers of the last
  sentence itself, not new material.

The four hand-checked chapters (I, IX, XVII, XXIV): the first, a middle and the
last sentence of each were cut out of the MP3 at exactly the span their word
timings claim and re-transcribed on their own, against a decoy cut of the same
length 30 s away. Word agreement 64 / 57 / 67 / 71 % against decoys of 14 / 26 /
13 / 10 %; letter agreement (fairer, since a 1.5 s island of five words comes back as
"thans tu dos actam bigres") 51 / 66 / 79 / 80 %
against decoys of 22 / 29 / 22 / 20 %. Eleven of the twelve cuts are decisively
the words the row claims; the twelfth, cap. I's `r01:36.1`, is placed right but
its word cursor points about 3 s late — the leading-word limit above, made worse
by "Delphī" being said twice in three seconds.

### The word cursor's opening words, and cap. XXIII's last nine (2026-09-06)

Two defects the pass above left behind, both fixed across the whole library —
the fourteen course weeks and the twenty-four shelf chapters, 4306 rows.

**1. A sentence never lit its opening words.** `align()` started a sentence at
its first word Whisper *matched*, which is usually not its first word: Whisper
drops quiet openings, and Ørberg's sentences begin with short ones (`nam`, `at`,
`ecce`, a name). `token_times()` then had no room at all for the words before
that anchor and stacked them on the anchor's instant, and `wordAt()` in
`app/js/audio.js` shows only the *last* word at a given instant, so they never
lit up. Measured over all 38 weeks: **4448 of 40370 word entries were
zero-length, and 1504 of the 4306 sentences opened on such a stack.**

`respace()` now lays every maximal run of unheard words out over the audio
between the heard words on either side of it, and a sentence begins where its own
first word begins:

- the run's words that *open* a sentence take LEAD_S (0.30 s) apiece, so the
  sentence's start moves back far enough to cover them and no further. Backing
  it further off would make "play this sentence" start in silence or in the
  previous sentence's speech, since the row's `start_ms` is exactly where
  playback begins. The share is also capped at the run's proportional part of
  the gap, so the boundary can never cross the previous sentence's last heard
  word;
- where the sentence's own anchor is *earlier* than that (Whisper hands back
  *posthāc* as the two words "post tāc", so no single word matched at the true
  start) the anchor wins — it is evidence, and 0.30 s a word is only a default;
- everything else in the run — the tail of the sentence before, and any sentence
  in between that was never heard at all — is spread by letter count over what
  is left, exactly as the interpolation always did: there is no evidence of where
  those words fall, and bunching them at one end would invent some;
- where a word still has less than MIN_S (0.09 s) of its own, because the two
  heard words either side are contiguous in the transcript and it was swallowed
  by one of them, the run reaches back into the tail of the heard word before it,
  leaving that word MIN_S and never moving its start. This stays inside one
  sentence: a run that *begins* a sentence is left stacked rather than moved
  across a boundary on no evidence.

A sentence wedged between two anchors with no audio between them would now get a
zero-length row, and the app plays a row from its `start_ms` to its `end_ms`:
`MIN_ROW_S` (0.15 s) is the floor, so its play button still does something. That
is the only place rows overlap, and by at most 0.15 s.

**2. Cap. XXIII's nine late sentences.** `r23:107.1` through `r23:117.1` — the
593–648 s stretch — were still 3 to 18 s late. `seek()`, the fuzzy pass that
places a sentence with no matching block of its own, took the first whisper word
anywhere in its window that fuzzily matched the sentence's *first distinctive
word*. One sentence of `review-23` (unit 86), spoken at 592 s, has "Mārcum"
as its first distinctive word, and the reader's "Marcus" in the next
paragraph at 610 s scores 0.83 against it — so the sentence was pinned there and
the eight after it were crammed into what was left.

`seek()` now scores every position in its window by the character-level agreement
of the sentence's opening 40 letters with the transcript's letters read from
there, weighting the first 12 letters at 0.35 because it is a *start* being
placed. Letters, not words: this reader's ecclesiastical Latin reaches Whisper
with the word boundaries in the wrong places (*sūmit ac surgit* comes back as
"sumitac surgit", *Nōlī eum* as "Noleum"). Calibrated on ten weeks' worth of
sentences whose first word difflib itself matched, a true opening scores 0.84 at
the median and 0.73 at the 5th percentile, while a decoy 25 words away tops out
at 0.59 — so a best score under `SEEK_FLOOR` (0.58) is not evidence and the
sentence is interpolated instead. The earliest position within `SEEK_SLACK`
(0.03) of the best one wins: Ørberg says everything twice, narrative then
indirect speech, and scanning forward from the previous sentence's last heard
word the first copy is the one this sentence wants.

**Weeks 3, 5 and 10 are not the aligner's to re-run.** They are a real recording
with the stories it lacks synthesised around it, laid out by `tts_audio.py`, and
re-running `align_audio.py` on them would throw the joined layout away (and the
MP3s are already uploaded). `tts_audio.respace_runs()` does the same pass for
them, on `al` before `app_rows` is built: the real recording's words keep their
"i" flag when they are shifted into the joined file (tts_audio used to drop it
when it merged the two sources), and every word of a synthesised row counts as
heard, since an Edge word boundary is exact. It runs `respace()` on each run of
same-source rows separately — the runs the joined MP3 is made of: the real
reading and each synthesised block are different audio joined end to end with a
2 s pause between, and a word the recogniser missed in the reading must not be
given time out of the synthesised part after it. The row's own start then follows
its first word back, and its end is held between its own start and the next row's
(the joined layout leaves gaps, so an end is not simply the next start). Week 10
is wholly synthesised and has no unheard word to place, so it passes through
unchanged — the one week of the 38 whose rows this pass does not change.

This began as `data/build/audio/_verify/repair_tts_weeks.py`, which applied the
pass to the finished rows in place; the script is retired (it now only prints
what it did), because a plain run of `tts_audio.py` would have silently undone
the fix for those two weeks. **The pipeline pass was proved equivalent to it**
before the script was retired: rebuilding both weeks from the audio already on
disk, and week 10 with them —

```
python pipeline/tts_audio.py 3 5 --fill-missing --rebuild-alignment
python pipeline/tts_audio.py 10 --rebuild-alignment
```

— reproduced the repaired rows exactly. Every `start_ms`, `end_ms`, `synth` flag
and every word `s`, `e` and `i` is identical, `sentence_view` with them, and
`data/build/sql/audio-wNN.sql` came out byte-identical; week 10's file did not
change at all, and none of the three MP3s was rewritten. The same rows were
checked against `public.audio_alignments` — an md5 over `unit_id | start_ms |
end_ms | synth |` every word's `t:s:e:i`, ordered by `unit_id`, computed in
Postgres and again locally — and match for all three weeks (82, 105 and 156
rows, one user each). Nothing was uploaded: the database already held the
repaired rows. The only difference is `passage_view`, which the repair script
never updated and which had therefore kept the times from before the pass; it is
now built from the respaced words like everything else, and is not uploaded.

The three weeks, measured on their `app_rows` before the pass (the untouched
output in `_verify/before2`) and after it:

| week | rows | word entries | zero-length | rows with one | opening on a stack | non-monotonic within / across rows | rows overlapping the next |
|---|---|---|---|---|---|---|---|
| 3 | 82 | 1375 | 78 → **2** | 23 → 2 | 18 → **0** | 0 / 0 → 0 / 0 | 0 → 0 |
| 5 | 105 | 1662 | 84 → **8** | 25 → 2 | 18 → **0** | 0 / 0 → 0 / 0 | 0 → 0 |
| 10 | 156 | 2634 | 0 → 0 | 0 → 0 | 0 → 0 | 0 / 0 → 0 / 0 | 0 → 0 |

The ten entries left without an instant are all interpolated words in the *real*
recording with no room either side — `respace()`'s honest case, where the stack
stands rather than invent evidence — and none of them opens a sentence: week 3's
are the 4th word of `w03:minos:b5.2` and the 8th of `w03:coronis:b12.4`, week 5's
the 4th of `w05:nausicaa:147.5` and seven inside `w05:nausicaa:230.2`.

### Validation of both fixes, all 38 weeks (2026-09-06)

**Measured before and after, over all 4306 rows and 40370 word entries:**

| | before | after |
|---|---|---|
| zero-length word entries | 4448 | **243** |
| …of them, before the sentence's first heard word | 3180 | 50 |
| sentences opening on a stack | 1504 of 4306 | **33** |
| rows with any zero-length entry | 1896 | 115 |
| sentence starts before the previous sentence's last heard word | 9 | **0** |
| word times non-monotonic within a row / across rows | 0 / 0 | 0 / 0 |
| rows under 150 ms | 3 | 0 |
| word entries outside their own row's span | 0 | 0 |
| rows starting before the previous row ends (beyond MIN_ROW_S) | 0 | 0 |
| sentences matched directly | 4192 | 4190 |

On the shelf alone the zero-length entries go from 2761 of 21318 to 149 and the
stack-opening sentences from 945 to 29; on the course weeks, 1687 to 60 and 559
to 4.

**Placement, measured independently.** For every unit, the best character-level
match of its opening 40 letters is found in the raw transcript within ±25 s of
the row's start, and the offset between that and the row is measured — it
searches the transcript, not the alignment, so before and after are comparable.
Over 3831 units: median |offset| **0.64 s → 0.26 s**, p90 2.82 → 2.07, p95 4.16 →
2.89; units more than 3 s out **320 → 173**, more than 5 s out 123 → 76. Of the
119 units this pass moved by more than 2 s, 86 fit the transcript better
afterwards, 27 unchanged, 6 worse — and four of those six are sentences the
recogniser never heard at all, scoring near zero either way.

The two sentences net lost from the direct-match count are the honest half of
the same trade: `SEEK_FLOOR` refuses evidence the old pass accepted. Of the units
that gave up a direct match and are recognisable in the transcript at all, nine
of twelve ended up *closer* to their speech (median |offset| 7.77 s → 5.04 s),
and 23 units gained a direct match (median 1.65 s → 0.00 s).

**Cap. XXIII.** The nine sentences are now within 0.05 s of what the transcript
says, except `r23:115.1` ("Nōlī eum verberāre!", three words, which Whisper
merged into "Noleum") at 0.72 s early. Across the whole chapter, median |offset|
0.56 s → 0.00 s, worst 18.01 s → 5.26 s, units more than 3 s out 13 → 2, and
**38 units improved by more than 0.5 s with none worsened**. Sentences matched
directly: 120 → 126 of 126.

**Hand checks by ear** (`data/build/audio/_verify/earcheck3.py`): the audio is cut
at exactly the span a row claims, with a second of decoding lead-in and lead-out,
re-transcribed on its own, and scored against a decoy cut of the same length 30 s
away — the control that says the timings point at *these* words and not at Latin
in general.

- **Twenty sentences, one per week across both libraries** (weeks 1, 2, 3, 5, 6,
  8, 9, 11, 13, 14 and chapters I, IV, VII, X, XII, XIV, XVI, XIX, XXI, XXIV),
  each chosen as its week's worst case: the sentence with the longest run of
  unheard opening words that used to be a single stack. Word agreement **65 %
  against a decoy's 17 %**, letter agreement 68 % against 24 %. Every one of the
  twenty beats its decoy on words; nineteen of twenty on letters (`r10:111.2`,
  a ten-word sentence, scores 60 % vs 30 % on words but 51 % vs 53 % on letters).
- **Cap. XXIII's nine**: word agreement **70 % against 16 %**, letter agreement
  **80 % against 26 %**; all nine beat their decoy on letters, eight of nine on
  words (`r23:111.1` is the three-word "Ecce clāvis cubiculī", which comes back
  as "e khe kla wiz ku bi qli" — no whole word matches, 61 % of the letters do,
  against the decoy's 0 %). Cut at their **old** spans the same nine score 23 %
  words and 28 % letters against decoys of 10 % and 22 % — barely distinguishable
  from unrelated audio, which is what being 3–18 s late looks like.

`EAR_BEAM=1` runs the check greedily, which is three or four times faster and
agrees with the beam of 5 within a few points — but not always: the greedy decode
of `r16:87.1` came back as diacritic noise and scored 0 %, where the beam of 5
hears the sentence plainly (60 % against a decoy's 20 %). Re-check anything that
scores near zero before believing it.

**Uploaded.** All 37 changed weeks' `audio_alignments` rows were pushed one week
at a time (`_verify/upload_rows.py`), all first attempt, no pooler failures. The
MP3s are untouched by this pass and were **not** re-uploaded.
`_verify/db_match.py` then compared the database with the local files on row
count, the sum of every `start_ms` and `end_ms`, the number of word entries, the
sum of every word `s` and `e`, the `synth` flags and an md5 over the word texts
in order: **4306 rows, matching exactly.**

**What is left.** 243 word entries (0.6 %) and 33 sentence openings (0.8 %) still
share an instant, and 35 rows hold a run of four or more. They are all downstream
of a mis-anchored *sentence*, not of `respace()`: `w11:b4.4` is the worst, 21
words stacked because `token_times()` anchored the sentence's second word
"atque" to the reader's "que" 20 s into it, and the transcript holds no audio at
all for the first half of the sentence. `LEAD_S` is also too small for a long
unheard opening — `r16:87.1` opens with seven words the recogniser missed, so its
row can only reach 2.1 s back where the speech begins 4 s earlier, and the cursor
lags across those seven words. Both want better sentence-level anchoring, not
more word-level redistribution.

