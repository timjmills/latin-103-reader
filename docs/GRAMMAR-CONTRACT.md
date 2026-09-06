# Grammar section — build contract (wave 1)

Read docs/GRAMMAR-PLAN.md first (the why). This file is the how: shapes and
module boundaries the parallel workstreams build against. Change this file
first if a shape must change, and say so in your report.

## Files and ownership

```
app/data/grammar/skills.json          the skill map (A)            — public
app/data/grammar/lessons/<skill>.json one lesson per skill (B)     — public (our prose; book text only by unit id)
app/data/grammar/questions/<chapter>.json  question-word sets (wave 2)
app/js/grammar/                       the section (D): index.js (mount/router), lessons.js, items.js (generators),
                                      scheduler.js, session.js (Learn + Practice flows), stats.js, ui.js, store-grammar.js
app/css/grammar.css                   (D)
pipeline/review_shelf.py              chapters 1–24 Latin-only library entries from the scan (C)
supabase/migrations/0014_grammar_wave1.sql  applied already (see below)
```
Existing files: D may add ONE hook in app/index.html (a Read / Grammar segmented
control beside Passage/Sentence and a `<section id="grammar" hidden>` mount),
ONE import + call in app/js/main.js (`mountGrammar({ store, dict, par, reader, settings, saveSettings })`)
and the precache entries in app/sw.js — nothing else in existing files. Reader
internals stay untouched.

## skills.json (A)

```jsonc
{
  "version": 1,
  "skills": [
    {
      "id": "dative-indirect-object",          // kebab-case, stable forever
      "title": "Dative: the indirect object",
      "plain": "the dative (the 'to/for' form)", // the term with its everyday gloss, used everywhere
      "latin_label": "casus datīvus",
      "category": "noun-case",                   // noun-case | adjective | pronoun | verb-form | verb-use | syntax | vocabulary | questions | metre
      "chapter": 7,                              // Familia Romana chapter where the book introduces it
      "course": "101", "week": 7,                // from the learner's notes (Latin Grammar Topics)
      "notes_pages": [23],                       // pages in Latin Grammar Topics.pdf
      "prereqs": ["nominative-subject", "accusative-object"],
      "confusable_with": ["ablative-means", "genitive-of"],
      "paradigms": ["decl1", "decl2"],           // keys understood by app/js/paradigms.js / a small table in D
      "patterns": ["\\b\\w+(ae|o|is|ibus)\\b"],  // macron-stripped regexes to find candidate forms in unit.la (loose; generators filter by parse)
      "parse_filter": { "case": "dat" },          // what the generators select: parse features that must hold
      "kinds": ["recognise", "chart", "parse", "blank"],  // drill kinds valid for this skill
      "summary": "One sentence, plain words."
    }
  ],
  "order": ["nominative-subject", "..."]        // book order; the skill map renders this order grouped by chapter
}
```
87 skills from the headings of *Latin Grammar Topics* (p1 Week 1 … p120 Week 33
Gerundives), merged where a heading is a sub-part of one skill and split where
the 103 syllabus treats them separately (e.g. ut purpose / result / indirect
command are three skills, deponent imperatives their own). `parse_filter`
uses the glossary parse vocabulary: case nom/gen/dat/acc/abl/voc/loc, number
sg/pl, gender m/f/n, tense pres/impf/fut/perf/plupf/futperf, voice act/pass,
mood ind/subj/imper/inf/ptc/gerund/gerundive/supine, person 1/2/3, plus
`pos` (N ADJ V VPAR PRON …) and `deponent: true`.

## Lesson JSON (B)

```jsonc
{
  "skill": "dative-indirect-object",
  "core": [                                      // ≤ ~180 words total, read in two minutes
    { "type": "p", "text": "…plain-words explanation; first mention: **the dative (the 'to/for' form)**…" },
    { "type": "english", "text": "In English the indirect object is the person something is given to: she gives *the boy* a book." },
    { "type": "rule", "text": "Verbs of giving, saying and showing put the receiver in the dative." },
    { "type": "paradigm", "key": "decl1", "highlight": { "case": "dat" } },
    { "type": "examples", "units": ["w01:63.1", "w01:63.9"], "invented": [ { "la": "Iūlius puerō librum dat.", "en": "Julius gives the boy a book.", "focus": "puerō" } ] },
    { "type": "confusion", "with": "ablative-means", "text": "…how to tell them apart…" }
  ],
  "more": [ { "type": "p", "text": "exceptions, fuller table, the learner's notes paraphrased" } ],
  "sources": ["notes p23", "Ørberg cap. VII Grammatica Latina", "A&G §361"]
}
```
Rules: every grammar term carries its gloss on first use in the lesson; book
examples referenced by unit id only (the app fetches the text privately);
invented examples inline and marked; ≤ 4 examples in core.

## Drill items (D generates on the device)

```jsonc
{ "key": "blank:w03:minos:b2.1:puellae",       // stable per (kind, unit, token) so history is per item
  "skill": "dative-indirect-object", "kind": "blank", "stage": 3,
  "input": "type",                              // type | choice | order | match | chart | tap
  "unit_id": "w03:minos:b2.1",                  // null for chart/vocab
  "prompt": { "la": "Ariadna Thēseō ___ dedit.", "gloss": "fīlum — from fīlum, thread", "hint": "the receiver of a gift" },
  "answer": ["fīlum", "filum"],                  // accepted answers, macron-stripped variants included
  "choices": null,                               // for choice/order/match: options incl. confusable distractors
  "feedback": { "short": "…", "term": "the dative (the 'to/for' form)", "paradigm": {"key":"decl2","highlight":{"case":"dat"}} },
  "meanings": [ { "text": "Ariadna", "form": "ariadna" }, … ]   // every token, for tap-to-gloss
}
```
Kinds in wave 1: `recognise` (choice), `chart` (chart / single cell), `parse`
(choice at stage 1, type at 2+), `blank` (type; choice at stage 1). Items come
from library units whose parses satisfy `parse_filter` (via dictionary.lookup
on each token); distractors from `confusable_with` skills' parse filters.
Never repeat an item key until the pool for that skill/kind is exhausted.
Every item shows the target word's dictionary form + meaning; every token is
tappable (reuse the reader's word panel / popup).

## Scheduler (D, pure functions in scheduler.js, tested)

skill_state per skill: state new|learning|practising|mastered|lapsed, stage
1–3, stability_days, due_at, streak, successes, failures.
- correct unaided: stability × 1.7 (× 2.2 if ms < 8 s); hinted correct: × 1.2; wrong: × 0.3, floor 0.5 d.
  due_at = now + stability. streak/successes/failures updated. stage +1 after 4 correct in a row at the stage.
- mastered when stability > 21 d and successes_spaced ≥ 3; lapsed when overdue > 2 × stability.
- Learn criterion: 6 of the last 10 learn-mode items correct across ≥ 2 kinds → state practising, due tomorrow.
- Session builder (mixed): inputs = states, confusions, preset (review-heavy | this-week | even | one-skill),
  current week's skills, size. Rules: due skills first; no two consecutive items on one skill or of one kind;
  ≥ 1 confusable pair per 5 items (a skill and one of its confusable_with within 3 items);
  a few items (≈ 20 %) built from the current week's units; wrong answer → the skill re-queues 3–6 items later.

## Supabase (applied: migration 0014)

`skill_state` (pk user_id, skill), `drill_attempts` (append-only), `confusions`
(pk user_id, skill_a, skill_b) — RLS on all; skill_state in realtime. Local-first
through the same outbox pattern as lookups (store-grammar.js wraps store.js's
client/outbox helpers; do not fork them). `weeks.n` may now be 101–124 for the
review shelf.

## Review shelf (C)

Chapters I–XXIV of Familia Romana as library weeks n = 100 + chapter, id
`r01`…`r24`, title = the chapter title, source FR, has_line_numbers true,
units Latin only (`en` = ""), block per printed paragraph, `lines` and `margin`
as for other weeks, no highlights, notes empty. Built from the scan's text
layer (pipeline/extract_margins.py has the page geometry and the printed-line
index; reuse it) into data/build/review-NN.json and seeded with seed_sql-style
files. The weeks menu shows them under a "Review shelf · Familia Romana I–XXIV"
heading; the reader shows them like any week (translation toggle disabled).

## Grammar stats (D)

Own page inside the section: skills by state, items today / 7 days, accuracy,
per-skill history (last 10 attempts), confusions list. Not merged into the
reading study log (the study-log active timer keeps running — it is one app).

## Amendments from the skill map (A, 2026-09-05)

- `week` = week within the course (101: 1–14, 102: 1–10, 103: 1–14 matching `w01`–`w14`); `notes_week` (1–34) keeps the notes' numbering.
- Top-level `paradigm_keys` map (key → table in paradigms.js): decl1–decl5, adj12/adj3/adj3cons/adjcomp, conj1–conj4/conj3io, named tables sum…fio, is…se, unus/duo/tres, vis/deus/domus/iuppiter. D builds its key → table lookup from it (paradigms.js only exposes `paradigm(entry, parse)`).
- `paradigm_focus` = the cells a skill is about (highlighting, single-cell items).
- `parse_filter` may be an array (any-of); extra entry-level keys: `deponent: true` (glossary `kind: "dep"|"semidep"`), `enc: "que"|"ne"`, `h: [...]` headwords, `decl: 3` (= entry.cat[0]); `null` for the two metre skills (lesson only, no generated items).
- Categories in use: noun-case, verb-form, syntax, verb-use, adjective (incl. adverbs), pronoun, metre, vocabulary; `questions` reserved for wave 2.
- Lessons: a missing `lessons/<skill>.json` renders a "lesson coming" placeholder, never an error.
- sw.js: CACHE_VERSION is v31 after the book-lines deploy; the grammar hook bumps to v32 and precaches js/grammar/*, css/grammar.css, data/grammar/skills.json and every lessons/*.json; `.sample.json` fixtures are removed before deploy.

## Wave 1 implementation notes (D, 2026-09-05)

What the section relies on and where it departs from the shapes above. Change
here first if any of it should move.

- **Files.** `app/js/grammar/{index,lessons,items,scheduler,session,stats,ui,store-grammar}.js`,
  `app/css/grammar.css`; tests `tests/grammar.{scheduler,items,store}.test.mjs`.
  Hooks: the `.seg--section` Read / Grammar control and `<section id="grammar" hidden>`
  in `index.html` (+ the `grammar.css` link), `mountGrammar({ store, dict, par, reader, settings, saveSettings })`
  from `main.js` (one import, one call at the end of boot), the precache entries
  in `sw.js` (v32 — every `lessons/*.json` must be listed: `tests/sw.precache.test.mjs`
  enforces it, so a new lesson file means a new precache line and a version bump).
  `window.latinGrammar` exposes the section's context (`.current` = the item on screen).
- **skills.json as shipped** goes beyond the sketch above and the section
  accepts all of it: any filter value may be a list (`tense: ["pres","impf"]`,
  `gender: [...]`), `h: [...]` and `decl` are entry-level (headword, `cat[0]`),
  `enc` is entry-level and the enclitics skill's filter is an any-of *array* of
  filters, `degree` is a parse key (`pos` when a parse carries a case but no
  degree), `parse_filter: null` (metre) yields no wave-1 items, `paradigm_focus`
  lights the lesson's table when a block has no `highlight`. `pos` accepts `V`
  for `VPAR` entries. The feature a skill's recognise / parse items ask about is
  inferred: `case` (nouns, adjectives, pronouns), `tense + mood` (verbs;
  participles / infinitives as "perfect participle", "present infinitive"),
  `degree`, or none (adverbs: blank items only).
- **Item generation rules added.** A form that reads as more than one part of
  speech across its dictionary entries (`īrī`: Īris / īre; `ibi`: adverb / ibis)
  is never a target — the first entry is not always the sentence's. A form whose
  ending reads as two values of the feature (`puellae`, `servīs`) is skipped by
  recognise / parse and used by blank only when fewer than five unambiguous forms
  exist, with feedback that names both readings instead of asserting one.
  Sentences ≤ 180 characters are drawn first while at least five exist. Every
  other recognise item is the `tap` input ("tap the word that is …", accepted
  answers = every word index the filter fits). Item keys:
  `recognise:<unit>:<form>:<wordIndex>` (`recognise-tap:` for the tap form),
  `parse:…`, `blank:…`, `chart:<headword>:<section>.<row>.<col>`; used keys per
  skill/kind live in `localStorage['l103.grammar.used']`.
- **Scheduler additions.** A correct answer *before* the skill was due grows
  stability by at most × 1.2 (so an "even mix" evening cannot master a fresh
  skill); a wrong answer always drops mastered → practising; stage-up resets
  `streak` (so `streak` = correct in a row at the current stage; no extra
  column needed). `successes_spaced` **is** stored (migration 0017) and mastery
  is counted on it: mastered = stability > 21 d and `successes_spaced ≥ 3`,
  where a spaced success is correct, unaided and given when the skill was
  already due. A wrong answer clears the count.
  Learn-mode attempts never touch stability / due_at. "Add to mixed practice"
  = practising, due now, stability 0.5 d.
- **Server rows.** `drill_attempts` has no client id: the local id is
  `${at}|${skill}|${item_key}` and pulls (last 2000 rows) dedupe on it.
  Attempts and confusions are pulled after every `syncAll()`
  (`grammarHooks.onSynced`); skill_state also arrives in realtime through the
  shared channel (`grammarHooks.onRealtime`). Resets delete server-side too
  (`skill_state:delete`, `drill_attempts:delete`, `confusions:delete` ops).
- **Settings.** The practice preferences ride in the settings blob as
  `settings.grammar = { preset, size, oneSkill }` (unknown keys are kept by
  `patchSettings`).
- **Resolved (integration, 2026-09-05).** (1) `lessons/index.json` — the
  manifest generated by `pipeline/build_lessons_index.py` (`--check` to
  verify) lists the lesson files present; `lessons.js` reads it once and
  renders the "lesson coming" placeholder for any skill it does not list,
  with no request. Run it after adding a lesson (and add the file to `sw.js`;
  `tests/grammar.lessons.test.mjs` checks manifest ↔ directory ↔ skills.json).
  The `.sample.json` fixtures are gone: `?fixture=1` uses the real
  `skills.json` and manifest, `loadSkills()` has no fallback. (2)
  `weekOfUnit()` (sync.js) reads `r07:…` as week 107, so shelf progress rows,
  resets and the weeks menu counts work like any week's; `items.js` takes
  `week_n` from the row or the id, shelf units are in the general pool, and
  the ≈ 20 % current-week slots draw only from a course week (`isShelfWeek`
  guard). Also: the confusable pair enclitics ↔ subjunctive-wish-command is
  in `build_skills.py`; `buildSession()` widens to the skill's other kinds
  when a stage offers one kind only (genitive-of at stage 1), so two
  consecutive items never share a kind.

## Review shelf in the reader (integration, 2026-09-05)

- Helpers in `sync.js`: `SHELF_BASE` (100), `isShelfWeek(n)`, `shelfChapter(n)`, `roman(n)`; `weekOfUnit('r07:1.1')` → 107.
- Labels (`settings.js`): `weekNumberLabel(107)` → "Cap. VII", `weekPhrase(107)` → "chapter VII", `weekTitleLabel(n, title)`; the header button, document title, Settings → Audio / Progress and the reset messages use them. Nothing ever says "Week 107".
- Weeks menu: `groupWeeks(outline, weeks)` → `{ course, shelf }`; the shelf renders under a "Review shelf · Familia Romana I–XXIV" disclosure (roman numeral, title, focus label, read count; no time-left), collapsed by default, remembered as `settings.shelfOpen`, opened for the visit when the current week is on it.
- Reading a shelf week: the Translation toggle is hidden and the settings switch disabled ("No English for this chapter"), `data-english` is forced to `hidden` (the setting is kept), `e` does nothing; `reader.js` renders no `.en` row for a unit with `en` = "". Highlights/notes/summaries/pictures/audio are simply absent (the fixture store short-circuits every fetch for n > 100).
- Study log (`studyLog()` in settings.js): shelf sentences count in a day's minutes and "N read" and in the overall totals; the pace, the per-week table and the time-left estimates are the course weeks' only (`isCourse` = not a shelf week). A shelf-only day shows no pace.
- Fixture store: chapters I and VII (n = 101, 107; ids r01/r07) with twelve invented Latin-only sentences each.
- sw.js v33: `data/grammar/lessons/index.json` precached, the sample fixtures dropped.

## G1 fixes (D, 2026-09-06) — what changed in the shapes

From `qa/grammar/CODE-REVIEW-G1.md` and `qa/grammar/QA-REPORT-G1.md`.

- **skills.json (A) gains four fields**, all generated by `pipeline/build_skills.py`
  (edit the Python, not the JSON):
  - `feature`: what the skill's recognise / parse items ask about —
    `case | gender | number | tense | mood | voice | person | degree | construction | form`,
    `null` for the two metre skills. `tense` and `mood` both ask "which tense and
    mood" (the value is the `tense mood` pair; non-finite forms are `pres inf`,
    `perf ptc`, `gerund` …); `voice` offers active / passive / deponent; `person`
    asks person + number; `form` covers the enclitics (-que / -ne / -ve) and the
    principal-parts stems. `construction` = the function-named case skills
    (indirect object, possession, agent, means, place, origin, destination,
    time, degree, comparison, dative verbs, dative of agent, the ablative
    absolutes) and the syntax / verb-use skills (purpose, result, indirect
    command, cum clauses, indirect question, wishes, deliberative, potential,
    conditions, dummodo, periphrastic, noli, indirect statement, perfect
    passive / deponent): the item asks the *function* ("What is this dative
    (puerō) doing here?", "mitteret is subjunctive: what kind of clause is it
    in?") and the choices are the confusable constructions — the dative's
    other jobs for a dative, the other clause types for a clause — so a wrong
    answer names the pair. Parse items for these skills ask the function too
    (choice at stage 1 "dative — indirect object" …, typed from stage 2, graded
    by `matchFunction` over the accepted phrases).
  - `function`: the answer label for construction skills, its plain gloss in
    brackets ("indirect object (the receiver)"); `function_keys`: extra phrases
    a typed answer may use.
  - `highlight_match`: a regex over the reader's grammar-focus highlight labels
    (`data/build/highlights-week-NN.json`, `store.getHighlights`) naming the
    construction. Those sentences, and the lesson's own `examples.units`, are
    **gold** drill items: drawn first, and in the pool whether or not a
    pattern matches them.
  - `exclude_patterns`: sentences a sibling construction owns (a result signal word
    or a verb of commanding before *ut* for the purpose clause, *mihi est* for the
    indirect object …) yield nothing for the skill unless they are gold.
  - `latin_label` now carries macrons (G1-21).
- **`patterns` are used** (M3): a token is a candidate only when it sits inside
  a match of one of the skill's patterns on the macron-stripped sentence (or in a
  gold span). Sibling skills therefore have their own pools; the dative pattern
  requires a verb of giving / saying / showing in the clause.
- **Whitaker's parses are trimmed by the sentence** (M9, G1-04): a reading the
  entry's own paradigm cannot produce is dropped (`volārem` is never *velle*);
  when the sentence is macronised, a cell that matches the form exactly beats
  one that matches only without macrons (*puella* nom, *puellā* abl; *venit*
  present, *vēnit* perfect); a preposition up to four words back (over nominals
  and *et*) fixes the case; a vocative reading counts only where someone is
  addressed (a 2nd-person verb or imperative, an exclamation mark, *ō*, commas
  around the word); a nominal with several case readings keeps those a
  neighbouring nominal agrees with; adverbs never satisfy a case filter, nouns
  never a tense filter; noun and adjective readings that disagree on the
  feature are treated as distinct classes (the word is skipped); the enclitic
  fallback never yields a pronoun / conjunction (*quisque*, *itaque*). A
  construction's ambiguity is judged on its case or tense (`ambKey`), not on
  the function. Every recognise / parse item needs ≥ 2 real choices or the
  slot falls through to another kind.
- **Pools** (M2): `createPool.chooseInfo` draws from the whole key list, the
  unused keys first, and within them the tiers gold → this week → nouns (for a
  case construction, while ≥ 5 exist) → short sentences; the used-set resets
  only when every key has been drawn and the item then carries `repeat: true`
  (the runner shows "Every sentence for this skill has come up once; starting
  over"). `items.drillable(id)` = a parse filter and at least one candidate;
  skills that are not drillable never enter a plan, "Add all" or the Today
  line and show "no sentences in the library yet" / "lesson only" on the map
  (M8). Pool sizes are computed lazily per skill and warmed in idle time.
- **Parse prompts name what they grade** (M4): the question is built from
  `expect.required` ("Parse missus: tense, voice, case, number and gender (it is
  a participle)"), the placeholder per feature; voice is graded (m3), never
  for a deponent.
- **Chart cells** (M6, G1-03, G1-22): infinitive, imperative, participle,
  gerund(ive) and supine cells are drillable; an adjective table names the
  degree in the cell label and the question ("superlative, dative sg.
  feminine"), a non-degree skill stays in the positive section, and a case
  skill filling a whole chart fills the case's row across the genders. On a
  phone the single cell shown rewrites the question ("Give the accusative
  singular of cāsus", G1-15). `generate()` tries the other kinds with the
  neighbours' kinds last (`avoid`) and returns the item's real kind.
- **Confusions from every input** (P7, m6): items carry `confuse`
  (`values` feature value → skill, `indexes` word index → skill for tap items,
  `forms` other paradigm cells → skill); `confusedWith()` maps a wrong choice,
  tap, typed parse, typed function, typed or chart form to the confusable skill.
- **Scheduler** (M1, M7, G1-05, m1): a one-skill plan ignores decay (a lapsed
  row can be practised; `startBlocked` persists `addToPractice` for a lapsed or
  new row and sends a `learning` skill back to Learn); `requeue(plan, { fill })`
  re-queues 3–6 items later, never beside itself, never a neighbour's kind,
  and when fewer than three items remain asks `fill(n, exclude)` for filler
  slots on other skills first — with none to be had the re-queue is dropped
  (a one-skill set never re-queues); "this week" round-robins over the week's
  skills. The Learn guided five are stage-1 items, the blocked ten stages 1–2.
- **Store** (C2, M10): `normaliseAttempt` canonicalises `at` to `…Z` with
  milliseconds so a row pulled back as `+00:00` has the same id; the attempt
  insert is an `upsert(…, { onConflict: 'user_id,at,skill,item_key',
  ignoreDuplicates: true })` against migration 0015's unique index; confusion
  counts merge by max on the client (`mergeConfusion`) as the server trigger does.
- **UI**: lesson paradigm blocks resolve their key through `paradigm_keys`
  (named tables by headword; `decl*` / `conj*` / `adj*` by class, the skill's own
  sentences first, then model words: `KEY_CLASS` / `KEY_MODELS` in lessons.js;
  the imperfect-subjunctive lesson shows a regular 3rd-conjugation verb and
  *esse*) and light every cell the highlight names (G1-01); the blank of a
  blank item is the marked target (G1-02); worked examples gloss the matched
  parse (G1-04); Read ← Grammar restores the reader's scroll and title (G1-06
  / 07); every view is a history entry and a practice session in progress is
  kept in `localStorage['l103.grammar.session']` (plan, position, log) — Back,
  Reload and the map's Today line offer Resume (G1-08); the new heading takes
  focus on every view change and at the session's end (G1-09); lesson prose
  follows the notes size and the Latin the reading size (G1-10); the "Start
  all as new" queue lives in `localStorage['l103.grammar.learnQueue']` and the
  map shows what is next (G1-11); the last course week is remembered while the
  reader is on the shelf (`l103.grammar.courseWeek`; G1-12); substitutes for
  missing lesson examples are labelled "From the library" and missing ids are
  warned about (G1-13); a multi-word `focus` lights every word (G1-14); tap
  items keep their punctuation inside the word (G1-16); 44 px targets under a
  coarse pointer (G1-17); the popover lists every entry (G1-18); the
  Read / Grammar control shares the week row on phones as a single button naming
  the *other* section ("Grammar" while reading, "Read" in grammar), so the reader
  keeps two header rows and the week title its room (G1-19). The feedback block is announced once (through `#live`).
- **Not changed, with reasons**: `ctx.settings`
  stays the boot snapshot refreshed by `savePrefs` (m13: a getter would be a
  second hook in main.js); `unit.flags` for OCR-unverified tokens (m18) is
  pipeline work; "Add all" still makes every skill due at once (a spread is a
  scheduler policy the learner has not asked for).
- sw.js is **v34**.


## Wave 2 — depth (2026-09-06)

Scope (GRAMMAR-PLAN §8 wave 2): transform, reorder (≤ 8 words), translate
(self-graded), question-word sets for chapters 1–34, vocabulary recognition
decks per chapter, pensa from the scan, the daily plan. Ownership:

```
pipeline/extract_pensa.py             P  Pensum A/B/C for chapters 1–34 → data/build/pensa-NN.json → SQL for public.pensa (private)
pipeline/build_vocab.py               P  chapter vocabulary → app/data/grammar/vocab/NN.json (public: Whitaker-derived)
app/data/grammar/questions/NN.json    Q  question-word sets per chapter (our prose; answers by unit id + short Latin)
app/js/grammar/* (new kinds, inputs, daily plan)  E
supabase/migrations/0016_grammar_wave2.sql  applied: public.pensa (user_id, chapter, kind A|B|C, items jsonb, updated_at), RLS
```

### Vocabulary deck `vocab/NN.json` (P → E)
```jsonc
{ "chapter": 7, "words": [
  { "lemma": "puella", "dict": "puella, -ae f.", "pos": "N", "gender": "f", "decl": 1,
    "meaning": "girl", "parts": null, "unit_id": "r01:18.1", "count": 12 } ] }
```
A word belongs to the chapter where its lemma first occurs in the library
(chapters 1–24 = the shelf, 25–34 = the course weeks by `weeks.chapter`);
verbs carry `parts` (principal parts), nouns `dict` with genitive + gender,
adjectives their three forms. Meanings from the glossary's preferred sense
(build_glossary PREFERRED/SENSE_OVERRIDES). Skill ids for the scheduler:
`vocab-NN` (Latin → English, default) and `vocab-NN-rev` (English → Latin,
optional extra deck). Items: `kind: "vocab"`, `input: "choice"` (4 options,
distractors = same chapter, same pos) at stage 1, `"type"` at stage 2+ for the
reverse deck; item key `vocab:NN:<lemma>:<pos>[:rev]` — three shipped decks
hold one lemma under two parts of speech (*līber* / *liber* in ch. 2, *mare* in
10, *anus* in 32) and without the `pos` the second is unreachable. A word shown
as a four-pair `match` keeps that same key and carries `variant: "match"`, so a
word's history is one row however it was shown. Distractors are the same
chapter and the same part of speech, topped up from the same part of speech in
the nearest chapters — **never** another part of speech, which would let the
learner answer by shape.

### Question sets `questions/NN.json` (Q → E)
```jsonc
{ "chapter": 7, "week_id": "r07",            // or "w03" etc. for 25–34
  "items": [
    { "id": "q07-01", "qword": "quis", "q": "Quis Mārcum pulsat?", "en": "Who hits Marcus?",
      "unit_id": "r07:12.1",                  // the sentence that answers it (shown after)
      "answers": ["Iūlius", "Iulius"],         // accepted Latin (macron-stripped variants added by E)
      "input": "type",                         // type | choice | tap  (tap: the answer is a word in unit_id's sentence)
      "choices": ["Iūlius", "Mārcus", "Quīntus", "Iūlia"],   // for choice; ≥ 3 plausible from the passage
      "hint": "a name in the nominative" } ] }
```
≥ 24 items per chapter across the question words quis/quid/cūr/ubi/quō/unde/
quandō/quōmodo/quot/quālis/uter/num/nōnne/-ne (every set uses ≥ 8 different
question words; num/nōnne/-ne answers are "Ita (est)" / "Nōn"/ "Minimē" with the
full-sentence answer accepted); answers must be answerable from the referenced
sentence alone; Latin in `q` macronised. Skill id `questions-NN`; item key
`question:<id>`; kinds `question`.

### Pensa (P → Supabase → E)
`public.pensa` rows: `{ chapter, kind: "A"|"B"|"C", items: [...] }`, private.
```jsonc
// A: endings blanked   { "text": "Iūlius in vīll_ habitat.", "blanks": [ { "i": 0, "stem": "vīll", "answers": ["ā"], "note": "abl. after in" } ] }
//    `text` is authoritative and already contains the stem; `blanks[].stem` is metadata (the input's label, and
//    "vīllā" typed out in full is accepted). Neither the prompt nor the model answer ever adds it again.
//    The number of `_` runs in `text` must equal `blanks.length`, or E hides the item.
// B: words blanked     { "text": "Mārcus ___ Quīntum pulsat.", "blanks": [ { "i": 0, "answers": ["frātrem"], "bank": ["frātrem", "sorōrem", "puerum"] } ] }
// C: questions         { "q": "Ubi habitat Iūlius?", "answers": ["in vīllā", "Iūlius in vīllā habitat."], "unit_id": "r01:…" }
```
Blanks recovered from the scan's text layer (the printed dashes); answers
computed from the glossary + agreement with the sentence and checked against
the chapter text (the pensa re-tell the chapter); an item the pipeline could
not resolve carries `"unverified": true` and E hides it. Skill id
`pensum-NN` (kinds `pensum`; item key `pensum:NN:A:3`).

### Generated kinds (E, from library units)
- `transform` (stage 3, input type): one word of a book sentence changed by
  paradigms.js (sg↔pl, pres→perf/impf, act↔pass, statement→indirect command
  after *imperat ut*), the learner types the changed form; feedback shows the
  original sentence. Only forms paradigms.js can produce unambiguously.
- `reorder` (stage 3, input order): a book sentence of ≤ 8 words scrambled;
  accept any order the book uses (the original), punctuation kept with words.
- `translate` (stage 3, self-graded): a course-week sentence (units with `en`;
  shelf units have none) with its English hidden; the learner writes, reveals,
  and grades themselves right / partly / wrong with the key words marked (the
  skill's pattern match) — graded attempts log `self: true`.
- Inputs added: `order` (tap words into a row, undo, and drag on pointer
  devices), `match` (word ↔ case / form ↔ meaning pairs, tap-tap), `tap`
  reused for question answers.

### Daily plan (E)
A "Today" card at the top of the weeks menu and of the Grammar map: Learn
(the current 103 week's unlearned skills, one suggested) · Practice (10 items:
due skills count, confusion pairs) · Questions for the current week's passage ·
Vocabulary due; estimated minutes from the study log's pace; never forced;
dismissible per day (settings.todayDismissed = date).

### Wave 2 implementation notes (E, 2026-09-06)

Where the section departs from the sketch above, or pins something the sketch
left open. Change here first if any of it should move.

- **Files.** `app/js/grammar/{stage3,sets,generate,inputs,today}.js` beside the
  wave-1 modules; tests `tests/grammar.{stage3,sets,today}.test.mjs`.
  `generate.js` is one façade over `items.js` + `stage3.js` + `sets.js` keeping
  the wave-1 interface (`generate`, `drillable`, `pool`), so `session.js` and
  `ui.js` never branch on which module owns a kind.
- **The chapter-set share is a sliding window, not a session total.**
  `SET_MAX` (3) items in any `SET_WINDOW` (10) in a row, and since the fix pass
  a floor of `SET_MIN` (1) per window too — a 15-item session therefore holds
  two or three, never four in one ten and never none. (The sentence that stood
  here said "about five"; it described the ceiling and was wrong.) `buildSession` takes
  `prior` (the slots already played) so an open-ended session's next batch of
  ten counts across the seam, and `requeue` takes `played` so a missed set item
  returns into a window with room (it is let back regardless only when no such
  spot exists — re-exposing an error outranks the mix). `SET_SHARE` is kept as
  the ratio the two constants come from. Uncapped for "This week" and one-skill.
- **`transform` refuses an op-ambiguous form.** Wave 1 judged a candidate's
  ambiguity on the skill's own feature; a transform must also be unambiguous in
  *the feature the instruction moves*. A form that reads as two numbers (or
  genders, tenses, voices, moods) is skipped, so "make oblīta singular" — where
  *oblīta* is both nominative singular feminine and nominative plural neuter —
  is never asked. 61 of the 87 skills still yield transform items. A proper
  noun's answer keeps the book's capital (the tables hold lower-case stems).
- **`self` is carried in the attempt's `answer`, not as a column.** The
  in-memory attempt has `self: true` / `partial`, but `drill_attempts` has no
  such column, so the stored row keeps only `answer: "self: right|partly|wrong"`
  and `hinted: true` (a self-graded answer is weighted as hinted). Filtering
  self-graded attempts in stats would need a server column.
- **`buildToday` takes a `drillable` predicate.** A lesson-only skill (the two
  metre skills, or one with no sentences in the library yet) never reaches the
  Learn line — the G1 rule, now applied to the Today card too. Called pure, it
  falls back to "the skill has a `parse_filter`". The Learn line's detail counts
  only drillable skills, and says "(new this week)" when the week holds one.
- **Grammar minutes come from the drill log, not the study log.** `itemSeconds`
  = the mean of the last 200 attempts once twenty exist (clamped 8–90 s), else
  25 s. Only the Today card's Read line uses the study log's pace.
- **`match` numbers its pairs.** Both halves of a pair carry the same index
  (`data-n`, drawn by CSS, repeated in the `aria-label`): a fill alone never
  says which of four boxes goes with which.
- **Manifests.** `pipeline/build_grammar_index.py` owns all three
  (`lessons/`, `questions/`, `vocab/`); `build_lessons_index.py` is an alias.
  `--check` validates the files, not only the manifests' freshness.
- **Shipped data.** `questions/01–34.json` = 1322 items; `vocab/01–34.json` =
  1770 words. sw.js is **v36**.

### Wave 2 fix pass (E, 2026-09-06)

Answering `qa/grammar/CODE-REVIEW-G2.md` and `qa/grammar/QA-REPORT-G2.md`.
Tests: `tests/grammar.sets.fix2.test.mjs`, `tests/grammar.mix.fix2.test.mjs`,
and additions to `grammar.stage3` / `grammar.today` / `grammar.store`.

- **A pensum blank is macron-sensitive; every other drill is not.** Ørberg's
  Pensum B for chapter I offers *Italiā* beside *Italia* precisely to drill the
  ablative against the nominative, so accepting either would delete the
  exercise. Pensum items carry `exact: true`; `judge` then uses
  `matchesFormExact` (case and punctuation ignored, v/u and j/i folded, macrons
  kept) and marks a macron-only miss `macron: true`, which the feedback names
  by reading both forms off the word's own paradigm ("Italia is the nominative
  singular; here the blank wants the ablative, Italiā (abl. after in) — they
  differ only in the macron"). Pensum answers are no longer given
  macron-stripped variants. "Macrons optional" (GRAMMAR-PLAN §9a) still holds
  everywhere else, Pensum C included (it is a typed question, not an ending).
- **A Pensum B bank is a multiset.** One tile per required occurrence plus the
  book's distractors; the UI tracks tiles by position, never by text, so a
  sentence wanting the same word twice can be finished.
- **`reorder` and `translate` run `!ambiguous && verified`,** the filter
  `transform` already used: neither may state a parse the sentence did not
  settle. `translate` additionally intersects its pattern spans with the
  verified candidates before lighting a word, so a loose regex can no longer
  light *cui* as a genitive. `reorder` also excludes the verse weeks (13, 14):
  a metrical line's order cannot be reasoned to from grammar.
- **Chapter sets have a floor as well as a ceiling.** `SET_MIN` (1) per
  `SET_WINDOW` (10) while any set is in rotation: `setFloorSlots` reserves one
  position per window of ten (and per trailing part-window of five or more) and
  `buildSession` fills it with a due set. A mixed ten therefore holds 1–3 set
  items, a fifteen 2–3 in any ten. "This week" and one-skill stay uncapped and
  unfloored. **The earlier sentence "a 15-item session therefore holds about
  five" described the ceiling only and was never true of review-heavy, which
  starved the sets to zero.**
- **A set skill's single kind is honoured when picking the skill,** not only
  when picking the kind: two set slots side by side may not share a kind, so
  `vocab-01` never sits beside `vocab-02`.
- **`requeue` checks the windows on both sides** of the insertion point
  (`setSlotFits`), since the splice shifts everything after it.
- **A set's Learn pass is a capped, resumable batch.** `SET_LEARN_BATCH` (15)
  items with feedback, then "another 15" / "go on to the ten" / "stop for now",
  with a progress bar reading *n of N seen*. The place is kept in
  `localStorage['l103.grammar.learn']` and the item pool already remembers what
  has been shown, so nothing repeats inside a pass.
- **The Today card's arithmetic is a day's.** The Read line offers
  `ceil(unread / days left in the week)` at the study log's pace and says so;
  the Questions and Vocabulary "first pass" lines cost the batch plus the
  blocked ten ("15 of 43, first pass"); `itemSeconds` is per kind, the **median**
  of the last 200 of that kind, each attempt capped at 120 s and the result
  clamped to 5–120 s, with a per-kind default until twenty attempts exist. The
  total is labelled "about N min if you do it all".
- **"Reset all" clears the saved session, the "start all as new" run, a set's
  Learn place and today's dismissal** as well as the four store keys.
- **Migration 0017's columns are used.** `drill_attempts.self` carries the
  learner's own grade on a translate item; `skill_state.successes_spaced` is
  written by `applyAnswer` and read by mastery.
- **The weeks-menu Today card no longer boots the section.** `todayCard()` runs
  a light path: the skill map, the grammar store, and **the current chapter's
  two files** through the same loader the full section later reuses. A set in
  rotation from another chapter gets a stub row (title, state, at most a
  ten-item session). Opening Grammar still runs the full `init()`, which
  replaces the light UI (the first instance's popstate listener is disposed).
- **A failed chapter-set fetch is logged and retried**, never memoised as
  `null` for the life of the page; `load()` returns `failed` so the caller can
  say so.
- **Minor rules also settled here.** A tap answer must be the whole answer
  (`answerIndexes(..., { whole: true })` — a tap on *in* no longer answers *in
  vīllā*; the feedback still lights the whole phrase). A question's own words
  are glossable whatever the input, `type` and `choice` included. `qword` is
  normalised to its lemma (*cuius* → *quis*) with the printed form kept in
  `qwordForm`. `reorder` chips drop the sentence's final stop. `transform`
  capitalises by the lemma, not by sentence-initial position, and skips number
  transforms on the personal pronouns. A pensum row whose content changed is
  written locally even when `updated_at` and the item count did not. Ordinary
  drills: "macrons optional" unchanged.

**Left alone, with reasons.** The vocabulary pipeline findings (CR M1, M2, M7,
m8) belong to `pipeline/build_vocab.py`, another agent's file. `reorder` does
not lower-case a sentence-initial word (QA m1's other half): without a
proper-noun test in `stage3.js`, printing *rōma* would be a worse error than the
giveaway. The unbalanced quotation mark (QA m19) is the book's own text, one
sentence of a longer quoted speech, and is not the app's to close. Commit
`0eebc68`'s wrong item count (CR m13) is in history.

#### Worth changing in the plan

- Nothing outstanding from wave 2.
