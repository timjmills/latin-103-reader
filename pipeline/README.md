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

Everything under `data/build/` is gitignored (copyrighted text).

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
| 0 | Syra: "Thēseus ē labyrinthō exiēns 'Mīnōtaurus necātus est' inquit, 'Laetāminī, cīvēs meī! | 0 | Syra: "Theseus, exiting out of the labyrinth, said: 'The Minotaur has been killed! |
| 1 | Intuēminī gladium meum cruentum! | 1 | Rejoice, my citizens! |
…
```

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

- `"Nōlī" inquit "mē relinquere!` is one sentence — `inquit` inside a quotation
  never splits it.
- `'Thēseu! Thēseu! Revertere ad mē!' neque ūllum respōnsum…` — three
  exclamations, but the last runs on with lowercase `neque`, so it stays with
  the narrative.
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
   the engine's word boundaries.
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
`pictures/<user-id>/week-NN/<file>`.

