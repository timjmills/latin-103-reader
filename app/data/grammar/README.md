# Grammar skill map (`skills.json`)

The map of the 87 grammar skills the grammar section teaches, drills and
schedules. It is public data (our own prose; no book text). It is generated
from `pipeline/build_skills.py`, which also validates it — edit the Python,
not the JSON, and re-run:

```
python pipeline/build_skills.py          # rebuild + validate
python pipeline/build_skills.py --check  # validate the committed file only
```

Shape and ownership: see `docs/GRAMMAR-CONTRACT.md` (section "skills.json (A)").
The why: `docs/GRAMMAR-PLAN.md` §2.

## Where the skills come from

- The learner's course notes, *Latin Grammar Topics.pdf* (120 pages, one
  lesson per "Week N: …" heading; St Andy's Latin Companion order). Every
  heading maps to a skill; `notes_pages` gives the PDF pages of that lesson.
- Merged where a heading is a sub-part of one skill: *Accusative Adjectives*
  (p12) into `adjective-agreement`; *Genitive Description* + *Genitive with
  Adjectives* into `genitive-of`; *Demonstratives* + *Demonstrative Cases* into
  `demonstratives`; *Irregular (present) Subjunctive* into `present-subjunctive`;
  *Irregular Imperfect Subjunctive* into `imperfect-subjunctive`; the duplicated
  Future Perfect page into `future-perfect`.
- Split where the 103 syllabus treats them separately: the *Imperfect* lesson
  (p105–106) into `imperfect-subjunctive` (forms) and `sequence-of-tenses`;
  *Future Passive Participle* / *Gerundives* into `gerundive`,
  `passive-periphrastic` and `dative-of-agent`; the *Optative* lesson into
  `present-subjunctive` (forms) and `subjunctive-wish-command` (use).
- Added because the 103 syllabus and `pipeline/focus.json` need them and the
  notes have no lesson: `deponent-imperatives` (the week-25 review page),
  `future-imperative`, `dative-verbs`, `dummodo`, `elegiac-couplet`,
  `prosody-scansion`. These have `notes_pages: []`.

## Fields

| field | meaning |
| --- | --- |
| `id` | kebab-case, stable forever (skill_state rows key on it) |
| `title` | short label for lists and the map |
| `plain` | the term with its everyday gloss, in the reader's plain-words wording, e.g. `the dative (the 'to/for' form)`; used on every item and feedback line |
| `latin_label` | the Latin name, shown once in the lesson |
| `category` | `noun-case` · `adjective` · `pronoun` · `verb-form` · `verb-use` · `syntax` · `vocabulary` · `questions` · `metre` (adverbs sit under `adjective`; `questions` is reserved for wave-2 question-word sets) |
| `chapter` | Familia Romana chapter where the book introduces it (1–34); the map is grouped by this |
| `course`, `week` | when the learner's course teaches it: `101` = notes weeks 1–14 → weeks 1–14; `102` = notes weeks 15–24 → weeks 1–10; `103` = notes weeks 25–34 mapped onto the 14 syllabus weeks (27 → 3/4, 28 → 5/6, 32 → 10/11, 34 → 13/14). For 103 the `week` matches the library weeks `w01`–`w14` and `pipeline/focus.json`, so "this week's skills" is `course == "103" && week == n` |
| `notes_week` | the week number as printed in the notes (1–34) |
| `notes_pages` | pages of *Latin Grammar Topics.pdf* for the lesson (`[]` if none) |
| `prereqs` | skills this one builds on; always earlier in `order`. The 103 "review first" list is the transitive closure of a week's prereqs |
| `confusable_with` | skills it is deliberately interleaved against; always symmetric (the builder adds the reverse link) |
| `paradigms` | table keys (see below) to show in the lesson and to fill in `chart` drills; `[]` when no table applies |
| `paradigm_focus` | which cells of those tables the skill is about (`{"case":"dat"}`, `{"tense":"impf","mood":"ind","voice":"act"}`); `null` = the whole table. Lessons may override per block with their own `highlight` |
| `patterns` | macron-stripped, case-insensitive regexes that find candidate sentences in `unit.la` (loose on purpose — generators then filter tokens by `parse_filter`) |
| `parse_filter` | features a token's parse must satisfy to be a target of this skill (see below); an array means any-of; `null` for metre skills, whose items come from verse units |
| `kinds` | drill kinds valid for the skill: `recognise`, `chart` (only where `paradigms` is non-empty), `parse`, `blank` |
| `summary` | one or two sentences in plain words |

The top-level `order` array is the book order (chapters non-decreasing); the
top-level `paradigm_keys` object lists every legal paradigm key with the table
in `app/js/paradigms.js` it names.

### `parse_filter` vocabulary

Values are those of the glossary parses (`app/data/glossary.json`):
`case` nom/gen/dat/acc/abl/voc/loc · `number` sg/pl · `gender` m/f/n/c ·
`tense` pres/impf/fut/perf/plupf/futperf · `voice` act/pass ·
`mood` ind/subj/imper/inf/ptc/gerund/gerundive/supine · `person` 1/2/3 ·
`degree` comp/super · `pos` N/ADJ/V/VPAR/PRON/ADV/… A value may be a list
(any of). Three keys are entry-level rather than parse-level:

- `deponent: true` → the glossary entry's `kind` is `dep` or `semidep`;
- `enc: "que" | "ne"` → the entry's `enc` field (enclitic split off the token);
- `h: [...]` → the entry's headword (`h`) is one of the list (irregular verbs, pronoun tables);
- `decl: 3` → the noun's declension, i.e. `entry.cat[0]`.

A skill whose target is a two-word form (perfect passive `laudatus est`,
periphrastic `legendum est`, ablative absolute) filters on the participle
token; the `patterns` supply the second word.

### Paradigm keys

`decl1 decl2m decl2n decl2r decl3 decl3n decl3i decl3in decl4 decl4n decl5`
→ `NOUN_ENDINGS['1' | '2m' | …]`; `adj12 adj3 adj3cons adjcomp` → the adjective
ending tables; `conj1 conj2 conj3 conj3io conj4` → `CONJ[…]` (the whole verb;
`paradigm_focus` picks the tense/mood/voice); `sum possum eo fero volo nolo malo fio`
→ `IRREGULAR_VERBS`; `is hic ille iste ipse idem qui quis ego tu se` →
`PRON_TABLES`; `unus duo tres` → `NUM_TABLES`; `vis deus domus iuppiter` →
`IRREGULAR_NOUNS`. `paradigms.js` exports `NOUN_ENDINGS, CONJ, IRREGULAR_VERBS,
PRON_TABLES` and `paradigm(entry, parse)`; the grammar section keeps the small
key → table map (and the adjective/numeral/irregular-noun tables it needs) in
its own module.

## Lessons manifest

`lessons/index.json` = `{ "version": 1, "lessons": [ "<skill>", … ] }` — the
lesson files present, generated by `python pipeline/build_lessons_index.py`
(`--check` fails when it is stale). The section reads it once and shows the
"lesson coming" placeholder for any skill it does not list, without a
request. After adding `lessons/<id>.json`: re-run the script, add the file to
`app/sw.js` PRECACHE and bump `CACHE_VERSION` (`tests/sw.precache.test.mjs`
and `tests/grammar.lessons.test.mjs` enforce both).

## Adding a skill

1. Add a `skill(...)` call in `pipeline/build_skills.py` at its place in book
   order (the list *is* the `order`). Give it a new stable `id`; never reuse
   or rename an id that has shipped — learners' `skill_state` rows key on it.
2. Fill every field. `plain` must follow the reader's wording (term + gloss in
   brackets). `prereqs` may only name skills that appear earlier; the builder
   rejects forward references. List `confusable_with` in one direction only;
   the builder symmetrises.
3. `notes_pages`: page numbers in *Latin Grammar Topics.pdf* (the heading is
   printed at the foot of each page). Use `[]` if the notes have no lesson.
4. Choose `kinds`: include `chart` only if `paradigms` is non-empty.
5. Run `python pipeline/build_skills.py`. It refuses to write if ids are not
   unique, a prereq or confusable is unknown or out of order, `order` does not
   contain every id exactly once, chapters go backwards, a paradigm key or
   parse_filter key is unknown, or a pattern does not compile. The count is
   pinned at 87; change the assertion when a skill is added or removed and
   say so in `docs/GRAMMAR-CONTRACT.md`.
6. Write the lesson `lessons/<id>.json` (contract section B).

## Counts (v1)

By category: noun-case 22 · verb-form 34 · syntax 12 · verb-use 7 · adjective 5
· pronoun 4 · metre 2 · vocabulary 1 (`principal-parts`) · questions 0.
By course: 101 30 · 102 30 · 103 27.
