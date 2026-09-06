# Grammar data

Everything public the grammar section reads: the skill map (`skills.json`), the
lessons (`lessons/`), the question sets (`questions/`) and the vocabulary decks
(`vocab/`), each with a manifest. No book text lives here — only our own prose,
Whitaker-derived dictionary forms, and unit ids the app resolves privately. The
pensa are private and live in Supabase (see "Chapter sets" below).

## The skill map (`skills.json`)

The map of the 87 grammar skills the section teaches, drills and schedules.
It is generated from `pipeline/build_skills.py`, which also validates it —
edit the Python, not the JSON, and re-run:

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
| `patterns` | macron-stripped, case-insensitive regexes that find candidate sentences in `unit.la`; a token is a drill target only inside a match (the generators then filter it by `parse_filter`), so sibling skills keep their own pools — a dative for the indirect object needs a verb of giving in the clause |
| `parse_filter` | features a token's parse must satisfy to be a target of this skill (see below); an array means any-of; `null` for metre skills, whose items come from verse units |
| `kinds` | drill kinds valid for the skill: `recognise`, `chart` (only where `paradigms` is non-empty), `parse`, `blank` |
| `feature` | what the skill's recognise / parse items ask: `case` · `gender` · `number` · `tense` · `mood` · `voice` · `person` · `degree` · `construction` · `form`; `null` for the metre skills. `construction` skills ask the *function* of the form ("What is this dative doing here?", "what kind of clause is it in?") with the confusable constructions as choices |
| `function` | construction skills only: the answer label with its plain gloss in brackets — `indirect object (the receiver)` |
| `function_keys` | extra phrases a typed function answer may use (`["receiver", "recipient"]`) |
| `exclude_patterns` | regexes over `unit.la` for sentences a sibling construction owns (a result signal word before *ut* is not a purpose clause): no candidates from them unless gold |
| `highlight_match` | a regex over the reader's grammar-focus highlight labels that names this construction; matching sentences are gold drill items (drawn first) |
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

## Manifests

Three, all written and validated by one script:

```
python pipeline/build_grammar_index.py           # write all three
python pipeline/build_grammar_index.py --check   # fail if any is stale or malformed
```

| file | shape |
| --- | --- |
| `lessons/index.json` | `{ "version": 1, "lessons": ["<skill>", …] }` |
| `questions/index.json` | `{ "version": 1, "chapters": [1, 2, …, 34] }` |
| `vocab/index.json` | `{ "version": 1, "chapters": [1, 2, …, 34] }` |

The section reads each once, so a file that is not listed is never requested
(a skill with no lesson gets the "lesson coming" placeholder; a chapter with no
set simply has none). `--check` also validates the files themselves: a lesson's
`skill` must match its name and be a skill in `skills.json`; a question set or
vocabulary deck must be an object whose `chapter` matches its `NN.json` name,
with unique item ids, non-empty `answers`, ≥ 2 `choices` on a `choice` item and
a `unit_id` on a `tap` item, and a `lemma` + `meaning` on every word. The same
lemma twice in a deck is a warning, not a failure — the loader keeps the first.

`build_lessons_index.py` is kept as an alias of this script.

After adding any of these files: re-run the script, add the file to
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
   parse_filter key is unknown, a pattern or `highlight_match` does not compile,
   a skill has no `feature` (or a construction no `function`). The count is
   pinned at 87; change the assertion when a skill is added or removed and
   say so in `docs/GRAMMAR-CONTRACT.md`.
6. Write the lesson `lessons/<id>.json` (contract section B).

## Counts (v1)

By category: noun-case 22 · verb-form 34 · syntax 12 · verb-use 7 · adjective 5
· pronoun 4 · metre 2 · vocabulary 1 (`principal-parts`) · questions 0.
By course: 101 30 · 102 30 · 103 27.

## Chapter sets (wave 2)

Beside the 87 skills the section schedules three **set skills** per chapter,
each with its own `skill_state` row and its own place in mixed practice.
Shapes: `docs/GRAMMAR-CONTRACT.md` "Wave 2 — depth".

| set | skill id | data | kind |
| --- | --- | --- | --- |
| question set | `questions-NN` | `questions/NN.json` (public, our prose) | `question` |
| vocabulary, Latin → English | `vocab-NN` | `vocab/NN.json` (public, Whitaker-derived) | `vocab` |
| vocabulary, English → Latin | `vocab-NN-rev` | the same deck, reversed | `vocab` |
| pensa | `pensum-NN` | `public.pensa` (private, Supabase) | `pensum` |

- **`questions/NN.json`** — chapters 1–34, 1322 items in all, generated by
  `pipeline/extract_pensa.py`'s sibling question pipeline and checked by
  `pipeline/check_questions.py` / `validate_questions.py`. Each item names its
  question word, the Latin question, its English, the `unit_id` of the sentence
  that answers it (shown afterwards), the accepted Latin `answers`, and an
  `input` of `type`, `choice` (with `choices`) or `tap` (the answer is a word
  in that sentence). Item key `question:<id>`.
- **`vocab/NN.json`** — chapters 1–34, 1770 words in all, from
  `pipeline/build_vocab.py`. A word belongs to the chapter where its lemma
  first occurs in the library (1–24 = the review shelf, 25–34 = the course
  weeks). `dict` carries the genitive + gender for nouns, `parts` the principal
  parts for verbs; `meaning` is the glossary's preferred sense. Recognition is
  the default: `vocab-NN` (Latin → English) is the deck the map and the Today
  card offer, and `vocab-NN-rev` is an optional extra the bulk actions and the
  week's sets leave alone. Item key `vocab:NN:<lemma>` (`…:rev` for the
  reverse deck, `vocab-match:…` for a match item).
- **Pensa are private** and are *not* in this folder: they live in
  `public.pensa` (migration 0016) and reach the section through
  `store-grammar.js`. Until that pipeline has run there are simply no Pensa
  rows — nothing errors, and the map does not mention them. An item the
  pipeline could not resolve carries `"unverified": true` and is hidden
  client-side, the surviving items keeping their original indexes so
  `pensum:NN:A:3` stays the same item. A pensum is **practise only**: it never
  offers a Learn flow.

Do not hand-edit `questions/*.json` or `vocab/*.json` — they are pipeline
output, like `skills.json`. Run `build_grammar_index.py --check` after any
change.
