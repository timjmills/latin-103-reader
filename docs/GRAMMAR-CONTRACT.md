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
      "answers": ["Iūlius", { "span": [0, 4] }],   // accepted Latin: our own wording, or where it is in the sentence
      "input": "type",                         // type | choice | tap  (tap: the answer is a word in unit_id's sentence)
      "choices": [{ "span": [0, 0] }, "Mārcus", "Quīntus", "Iūlia"],   // for choice; ≥ 3 plausible from the passage
      "hint": "a name in the nominative" } ] }
```
≥ 24 items per chapter across the question words quis/quid/cūr/ubi/quō/unde/
quandō/quōmodo/quot/quālis/uter/num/nōnne/-ne (every set uses ≥ 8 different
question words; num/nōnne/-ne answers are "Ita (est)" / "Nōn"/ "Minimē" with the
full-sentence answer accepted); answers must be answerable from the referenced
sentence alone; Latin in `q` macronised. Skill id `questions-NN`; item key
`question:<id>`; kinds `question`.

**These files are public, so the book's words are not in them** (PROMPT.md §5).
An accepted answer or a choice is one of three things:

| value | meaning |
| --- | --- |
| `"Minimē"` | our own wording — a dictionary form, a name, a phrase that borrows no two consecutive words of the sentence |
| `{ "span": [i, j] }` | words *i*…*j* (inclusive, 0-based) of the item's sentence, over `tokenize()`'s word tokens |
| `{ "parts": [ "quia", { "span": [2, 3] }, "rīdet" ] }` | our wording woven around such runs; resolved parts join with one space, none before punctuation |

`sets.js` resolves them (`resolveRef` / `resolveList`) against the sentence
`unit_id` names, adds the macron-stripped variants there, and **hides any item
whose references do not resolve** — a missing sentence never yields a crash, a
half-resolved choice list, or a right answer graded wrong. The line the public
files are held to, and the checks that enforce it, live in
`pipeline/latin_text.py`; `pipeline/span_questions.py` writes the references and
`pipeline/check_questions.py` validates them (and sweeps `lessons/`, `vocab/`
and `skills.json` for the same rule).

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

**A blank resolves only on evidence** (precision pass, 2026-09-06). Two ways,
and no third: (a) the pensum sentence IS a chapter sentence word for word —
same length, every printed word in its place, Ørberg's bracketed glosses
dropped — and the blanks take the words the chapter prints there; or (b) after
the full filter stack exactly one candidate survives, out of a pool holding
every attested form *and* every regular form `latin_forms` can build from the
chapter's lemmas. No filter is ever dropped (contradictory filters leave
nothing), a candidate must positively fit rather than merely fail to
contradict (an adverb or other indeclinable satisfies every agreement filter
vacuously and so can never win), and a reading whose case or person rests on no
filter is not evidence: where the sentence pins nothing the blank resolves to
nothing. Frequency and n-gram context no longer decide anything — they only
order the shortlist an `unverified` blank carries. Every blank of a sentence
with an unreadable token is `unverified` too (the printed principal parts
excepted: they read the verb beside them and nothing else). Subject detection
is the first nominative of the blank's own comma clause (a noun or pronoun,
never a bare adjective; carried across a comma when the next clause has none of
its own, never across `; : ! ?`), coordinated pairs plural, words a preposition
governs excluded. The pass traded coverage for correctness: 286 resolved blanks
across the 34 chapters instead of 1153, and 59 resolved A/B items instead of
332 — every one of the 286 checked against the printed page, none wrong.
Pensum C is untouched (246 of 383 items resolved, as before).

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

## Wave 3 — polish (2026-09-06)

Scope (GRAMMAR-PLAN §8 wave 3): confusion analytics, per-skill history,
printable charts, the Colloquia Personarum shelf. Ownership:

```
pipeline/colloquia.py        P  Colloquia Personarum I–XXIV from the 2005 scan → data/build/collo-NN.json → SQL
app/js/grammar/stats.js …    E  confusion analytics, per-skill history
app/css/print.css            E  printable paradigm charts and skill sheets
supabase/migrations/0018_colloquia_weeks.sql  applied: weeks.n may be 1–299
```

### Colloquia shelf (P)
Library weeks `n = 200 + colloquium`, id `c01`…`c24`, title
"Colloquium N · <speakers>", source CP, `chapter` = the Familia Romana chapter
it accompanies (colloquium N ↔ chapter N), Latin only (`en` = ""), one block
per speaker turn, `unit_type: "speech"` with `speaker` set from the printed
name before the colon, no line numbers (`has_line_numbers: false` — the 2005
printing has none), `margin` [] (no marginal glosses in this book).
**The scan's text layer has no macrons at all and heavy letter confusion**
(*liilia* → Iūlia, *Diivus* → Dāvus, *hIc* → hīc, *Cfu* → Cūr, *barum* →
hārum, *seti* → sed). Restoring the text is the work:
1. repair OCR letter confusions with a rule table verified per chapter;
2. restore macrons by mapping each macron-stripped token to the attested
   forms in `app/data/glossary.json` and, failing that, the forms generated by
   `pipeline/latin_forms.py`; a token with one candidate takes its macrons, a
   token with several is disambiguated by agreement with its sentence, and a
   token still ambiguous is left unmacronised and listed in the report;
3. every sentence that still contains an unrepaired token is dropped and
   reported, never guessed.
The weeks menu shows them under "Colloquia Personarum I–XXIV" beside the
review shelf; the reader treats them like shelf weeks (no translation, no
audio unless aligned later, speaker names shown as in the dialogue parts of
the course weeks).

### Confusion analytics and history (E)
- Stats page gains: "You mix up X and Y" — the top confusion pairs with counts,
  each with a one-line reason drawn from the two skills' `plain` strings and a
  Start that builds a 10-item session alternating exactly those two skills.
- Per-skill history: attempts over time (correct/hinted/wrong), stability and
  stage as they moved, the last 20 items with their answers, and the skill's
  own confusions. Reached from the skill map and from feedback.
- All read from `drill_attempts` and `confusions`; no new tables.

### Printable charts (E)
`app/css/print.css` plus a Print button on a paradigm and on the skill map:
paradigm tables print one per page with the cells the skill focuses on marked;
a skill sheet prints the lesson's rule, paradigm and examples. Black on white,
no app chrome, macrons preserved.

## Wave 3 — shelf notes, plain explanations and summaries (2026-09-06)

The review shelf (chapters I–XXIV) has Latin, line numbers and Ørberg's margin
glosses but none of the teaching layer the course weeks carry. Add it, in the
same shapes and register the course weeks use (pipeline/NOTES-GUIDE.md and
pipeline/PLAIN-GUIDE.md are binding).

```
data/shelf-notes-NN.json     content agents (private, gitignored like data/week*)
pipeline/build_shelf_notes.py  merges into data/build/review-NN.json + SQL, splits parts by lectio
```

### `data/shelf-notes-NN.json`
```jsonc
{
  "chapter": 7,
  "parts": [                                  // Ørberg's lectiōnēs, in order
    { "part": "Lēctiō prīma", "units": ["r07:1.1", "r07:41.3"],   // first and last unit of the section
      "summary_en": "…what happens, 60–120 words…",
      "summary_la": "…the same in simple Latin the learner can read at this chapter's level…" }
  ],
  "notes": [                                  // only where a learner needs help
    { "unit_id": "r07:12.1",
      "note": "…the course-week register: names the construction, cites the words…",
      "note_simple": "…plain words, the grammar term with its everyday gloss…" }
  ],
  "highlights": [                             // the chapter's new grammar, as the course weeks mark it
    { "unit_id": "r07:12.1", "text": "puerō", "occurrence": 1, "label": "dative: indirect object",
      "note": "…", "simple": "…" }
  ]
}
```
Rules: notes on roughly a quarter to a third of the sentences — the ones that
teach the chapter's new grammar or would stop a reader — never a note that
merely translates; 15–30 highlights per chapter, drawn from the skills whose
`chapter` equals this one in app/data/grammar/skills.json, using those skills'
`plain` strings verbatim for the grammar term; every grammar term glossed on
first use in a note; `summary_la` uses only words and constructions the learner
has met by that chapter. Unit ids must exist in data/build/review-NN.json and
the highlighted `text` must occur in that unit's `la`.

### `pipeline/build_shelf_notes.py`
Merges the file into data/build/review-NN.json (`note`, `note_simple` on units;
`week.parts` rebuilt from `parts` with `summary_en`/`summary_la`; highlights to
data/build/highlights-review-NN.json), validates every id and quoted string,
and writes SQL in seed_sql's style (units updated in place, highlights replaced).

### Wave 3 implementation notes (E, 2026-09-06)

Where the section departs from the sketch above, or pins something it left
open. Change here first if any of it should move.

- **Files.** `app/js/grammar/print.js` and `app/css/print.css` beside the wave-1
  and wave-2 modules; the analytics and history live in `stats.js` (pure) and
  `ui.js` (views). Tests: `tests/grammar.stats.wave3.test.mjs` (the pair
  merging and its reason, the pair session, the history windowing and the
  stability replay, the chart page split) and `tests/ui.colloquia.test.mjs`
  (the second shelf), with additions to `tests/grammar.store.test.mjs`
  (the windowed attempt log) and `tests/ui.shelf.test.mjs`. sw is **v38**
  (`css/print.css`, `js/grammar/print.js` precached).
- **A shelf is a hundred, and there are two of them.** `sync.js` now carries
  `COLLO_BASE` (200) beside `SHELF_BASE` (100) and `shelfKind(n)` →
  `'review' | 'colloquia' | null`; `isShelfWeek` is `shelfKind(n) != null`, so
  **101–199 and 201–299 are both shelf weeks** and everything that already
  branched on it — the 103 pace, the per-week table, the time-left estimate,
  the translation toggle, `#reader[data-shelf]`, the generators' current-week
  guard, the grammar section's "last course week" — is right for the colloquia
  with no further change. `shelfChapter(207)` is 7, not 107.
  `weekOfUnit('c07:3.1')` is 207 (`w` / `r` / `c` are the three prefixes).
- **`groupWeeks` returns three lists**, `{ course, shelf, collo }` (it returned
  two), and `settings.js` exports `SHELF_GROUPS` — the ordered shelf headings
  with their list id, settings flag (`shelfOpen` / `colloOpen`), name and
  `unit` / `plural`. `main.js` renders any of them through one
  `shelfGroupRow()`, so a further shelf is one entry in that array. The
  colloquia heading is "Colloquia Personarum I–XXIV" and its count reads
  "2 colloquia".
- **Two notes for the pipeline (P).** (1) The reader prints a speaker's name
  for `unit_type` `'turn'`; `reader.js` now treats the contract's `'speech'`
  as the same thing (`isTurn`), so either spelling works — `'speech'` as
  specified is fine. (2) `title` = "Colloquium N · <speakers>" makes the
  header read the label twice, since the app already writes "Colloquium VII"
  from `n`. `weekTitleLabel` is now idempotent (a title opening with its own
  label is left alone), so the specified shape is safe; **the speakers alone
  read better** in the weeks menu, where the numeral is already its own
  column, and that is what the fixture carries.
- **A confusion pair is symmetric.** `confusions` rows are directional ("a
  answered as b"); `stats.confusionPairs` folds both directions into one line
  and names the heavier direction first. The reason line comes from either
  lesson's `confusion` block naming the other, and only falls back to the two
  `plain` glosses — so the analytics say what the lesson says.
- **The pair's Start is not a preset.** `scheduler.buildPairSession({ a, b })`
  returns slots alternating exactly the two skills, each at its own stage, no
  two consecutive of a kind; `createPractice` takes it as a finished plan with
  the new `fill: null` (a re-queue that cannot fit is dropped rather than
  padded with a third skill), so "these two only" holds for the whole session.
  Both skills are put into rotation first, by the `startBlocked` rule.
- **The history is windowed twice.** `store-grammar` keeps a per-skill index of
  the attempts, built on demand and dropped on every write, and
  `getAttempts({ skill, limit, since })` returns only the tail;
  `stats.skillHistory` windows again at 400 and reports `total` beside `read`.
  `countAttempts(skill)` answers "does this skill have a history" without
  materialising the rows — the skill map asks it 87 times a paint.
- **The stability curve is replayed, not stored.** `skill_state` keeps one row,
  so "how stability and stage moved" can only come from the log:
  `stats.progressTrail` runs `applyAnswer` over the attempts (Learn-mode ones
  carried through without moving it, as the scheduler never did). The page says
  the curve may differ from today's stability when a skill was reset or added
  to practice by hand.
- **Printing.** `css/print.css` is linked `media="print"`; the pages are built
  into `#g-print` outside the app's tree and `html[data-printing] body >
  *:not(#g-print)` hides everything else. A chart is one paradigm section a
  page with the focus cells **boxed and bold** (a box, not a tint: it survives
  a greyscale printer) and a key naming them in the skill's plain words; a
  skill sheet is rule + forms + examples + the confusion note, allowed to run
  onto a second page rather than cutting the examples. The map's "Print charts"
  prints the current category filter's skills after a confirm naming the page
  count. `paradigmPages` / `cellText` / `focusNote` / `sheetSubtitle` are pure
  and tested; verified by printing to PDF (`qa/grammar/w3/*.pdf`).
- **Three small fixes made in passing**, all in rules this wave reuses:
  `.g-back` gained `justify-self: start` (the "← Skills" button was stretching
  and centring its label), `.g-link` gained `text-align: inherit` (a long skill
  title wrapping onto a second line centred itself on a phone), and
  `translationDesc` takes the shelf kind so it does not call a colloquium a
  review chapter.

#### Worth changing in the plan

- Nothing outstanding from wave 3. GRAMMAR-PLAN §8 wave 3's four items are
  built; the Colloquia texts themselves are P's (`pipeline/colloquia.py`).

## Wave 3 — review and QA fixes (E, 2026-09-06)

`qa/grammar/CODE-REVIEW-G3.md` and `qa/grammar/QA-REPORT-G3.md`, answered.
Tests: `tests/grammar.fix3.test.mjs` (new, all pure) plus one changed
assertion in `tests/grammar.stats.wave3.test.mjs`; sw is **v40**.

- **The `drillable` memo can no longer be poisoned (QA-B1, critical).** It is
  now `index.js`'s exported `createDrillableMemo({ items, skills })`: a miss
  answered while `ctx.items` is null — the light `lightInit()` instance the
  weeks-menu Today card is built from — returns `false` and **caches nothing**,
  and `buildSets()` clears the memo whenever the generator is rebuilt.
  `ui.refresh()` is also a no-op while there is no generator, so the light
  instance never paints the skill map at all. Reading, opening and closing the
  weeks menu, then opening Grammar used to leave 83 of 87 skills reading "no
  sentences in the library yet" for the rest of the session.
- **The history's lifetime total is passed in (QA-B2).**
  `stats.skillHistory(rows, { …, total })` takes `gstore.countAttempts(skill)`
  rather than deriving it from the already-trimmed list, so `windowed` can be
  true, the sentence that explains the gap is reachable, and the page says
  "Right of the last 400" where the figure is over the window.
- **The print root is `hidden` (G3-03 / QA-B3).** `print.css` is `media="print"`,
  so nothing in it reaches the screen; the attribute is what keeps the built
  pages out of the document, and `html[data-printing] #g-print` outranks
  `[hidden]` so the sheet still prints. Cleanup no longer waits out a timer:
  `afterprint`, plus `matchMedia('print')` going false (the Safari-dismissal
  case), with a five-minute timer only as a last resort. The title is restored
  only if it is still the one the print set, so a view drawn while the dialog
  was open keeps its own.
- **A confusion pair re-queues as a pair (G3-04).** `buildPairSession` emits a
  strict alternation, in which no *single* slot can sit between two different
  skills — so `requeue({ pair })` splices the missed skill **and its partner**
  in after an `other` slot, which is the only shape that keeps the two
  alternating and lets nothing else in. `createPractice({ pair: [a, b] })`
  carries it; `ui.startPair` passes it beside `fill: null`.
- **The replayed curve starts from the right state (G3-05).**
  `stats.progressTrail` buffers a run of Learn attempts and, at the point the
  flow judges it (the mode changes back to practice, or the log ends), applies
  `learnCriterion` over its last ten and replays `passLearn`. A self-graded
  "partly" is read from `drill_attempts.self` (migration 0017) and replays as
  the × 1 hold. "Add to mixed practice" needs no replay — its `due_at` of now is
  what a fresh row's null `due_at` already means. The page's caveat now names a
  reset, which is the one transition the log cannot record.
- **A session has a ceiling (QA-I1).** `session.sessionCeiling(asked)` = asked +
  half of it, at least two: a ten-item session may reach fifteen and no further.
  Every wrong answer still re-queues until then; past it the miss comes back in
  the next session. The runner carries `asked` / `added` / `capped`, the item
  says "N items came back after a wrong answer" (and "The session is full now"
  once capped), and the summary says how many were asked for. An open-ended
  session counts each batch of ten as more asked for, so the ceiling moves with
  it. Answering everything wrong took a ten-item session to 84 before this.
- **Bulk print (G3-09 / QA-I2).** A category filter prints straight through —
  that is the default route. "All" asks **before any work is done**, so
  declining costs nothing, and points at the category filter; the build then
  yields to the browser after the "Building…" message and every eight skills,
  so the message paints and the page keeps answering; the existing confirm
  naming the true page count still follows.
- **Minors.** `countAttempts` uses the per-skill index beside it (G3-06);
  `stats.dayList` builds the strips with calendar arithmetic so no day is lost
  or doubled across a clock change (G3-07); the history table carries a
  visually-hidden "Right / Wrong / Right, with a hint" in each row header
  (G3-08) and marks `lang="la"` only on the kinds that actually produce Latin
  (QA-B5); the scheduler-side count reads "N pairs that are easy to cross", so
  "confusion pair" means only an observed mix-up (QA-B6); the Stats page's
  Skills section says "87 skills and 8 chapter sets, counted together" (QA-B7);
  a pair's count is its own line-box and never begins a line with a separator
  (QA-B8); a skill sheet's footer runs on every page it spans, scoped by
  `.pr-doc--sheet` so bulk charts are untouched (QA-B9); the map keeps its
  scroll position across a lesson or history page (QA-B10);
  `stats.confusionList` is deleted (G3-13). In passing: a one-section table
  drops a caption that only repeats the sheet (`print.captionFor` — no more
  charts headed "cases"), a printed sheet's three examples are a named constant
  rather than `Math.max(3, Math.min(3, …))`, and a print that cannot run says
  so instead of only warning to the console (G3-10).

#### Not changed here

- G3-01 and G3-02 (the -ius vocative and the contracted genitive) live in
  `app/js/paradigms.js` and `pipeline/latin_forms.py`, which this pass does not
  own.
- QA-B4 (`cum` + a person taught as "place where") is
  `app/data/grammar/skills.json` content, likewise not owned here.
- I3 (a `confusable_with` pair with no `confusion` block in either lesson) is a
  content check over `app/data/grammar/lessons/`; I4 (`min: 2` for the stats
  page's pairs) is a pedagogy decision, not a defect, and both are left for the
  learner to rule on.

## Chapter spine — navigation by chapter (2026-09-06)

The learner asked for the book's own spine: chapters I–XXXIV, each offering
**its reading or its grammar**, with grammar also browsable **by topic**. The
course weeks stay reachable as a second view because pace, time-left and the
study log are computed per 103 week.

### The mapping (fixed, derived from `weeks.chapter`)
```
ch  1–24  reading: review shelf week 100+N   · dialogue: colloquia week 200+N
ch 25     w01      ch 26  w02      ch 29  w07   ch 30  w08   ch 31  w09
ch 27     w04 + w03 (FS Mīnōs, Corōnis; FL 63–65)
ch 28     w06 + w05 (FS Coriolānus, Nausicaa; FL 66–68)
ch 32     w11 + w10 (FS Arachnē; FL 69–74)
ch 33     w12       ch 34  w13 + w14
```
A supplement week attaches to the chapter its own `chapter` string names; each
of its parts (a Fabula Syrae, a Fabella) is listed as its own reading.

### `app/js/chapters.js` (new, pure, tested) — the single source of truth
```jsonc
chapters() -> [ { n: 7, roman: "VII", title: "Puella et Rosa",
  readings: [ { kind: "fr",     week_n: 107, label: "Familia Rōmāna", part: null },
              { kind: "collo",  week_n: 207, label: "Colloquium VII", part: null } ],
  grammar:  { skills: ["dative-indirect-object", …], questions: 7, vocab: 7, pensa: 7 } } ]
```
`kind` is `fr | collo | fs | fl`; a reading may name a `part` when a week holds
several (the supplement weeks). Nothing else may hard-code the mapping.

### Navigation (owner A: app/js/main.js, settings.js, chapters.js, index.html, reader CSS)
- The menu opens on **Chapters**, I–XXXIV in order, each row: numeral · title ·
  a reading-progress figure · whether it has audio. A second tab in the same
  menu, **My weeks**, is today's weeks list unchanged (course weeks, review
  shelf, Colloquia), so pace and time-left keep their home.
- Opening a chapter shows its **Readings** (every entry from the mapping, each
  with its own progress, audio mark and a Continue where one is part-read) and
  a **Grammar** section (owner B renders it).
- Labels stay as they are: "Cap. VII", "Colloquium VII", never "Week 107".
- Deep links: `#/chapter/7` and `#/chapter/7/grammar`.

### Grammar views (owner B: app/js/grammar/**)
- `mountChapterGrammar(el, { chapter })` renders one chapter's grammar: its
  skills with their states and actions, its question set, vocabulary deck and
  pensa, and a "Practise this chapter" that builds a mixed session drawn only
  from that chapter's skills and sets.
- The Grammar tab keeps **By topic** (today's map, category filter) and gains
  **By chapter** (the spine, each chapter's skills grouped under it) as a
  segmented choice, remembered in settings.

## Session flow — move on, step back, colour the result (2026-09-06)

Learner's request, verbatim: answering should **move the session on**; there
should be a **back arrow and a forward arrow** to move through a session's
parts; a result should be **green when correct and red when not**.

- **A correct answer moves the session on** by itself, after a short beat, so
  the learner never clicks Next to be told they were right. Enter advances at
  once.
- **A wrong answer does not move on.** The item stays, with its result and its
  explanation, and the learner tries again until it is right — that is the
  point of the drill. The only way past a wrong item is to touch the forward
  arrow deliberately.
  Scoring is unchanged by this: the **first** answer to an item is what is
  logged and what the scheduler sees; the retries that follow are for learning
  and are not logged again, so a skill cannot be inflated by trying twice.
- **Back / forward arrows** step through the items of the session that is
  running. Going back shows an answered item exactly as it was answered, with
  its result, read-only — it is never re-gradable and never touches the
  scheduler; forward returns to where the learner was. Keyboard: left and
  right arrows, when focus is not in a text field.
- **Colour**: correct green, wrong red, using tokens that hold up in both
  themes and in greyscale. Colour is never the only signal — the existing word
  ("Right" / the answer) and the visually-hidden label stay, so the result
  survives colour-blindness and a black-and-white print.

### Hints, per answer box (2026-09-06)

Learner's request: hints **per answer box**, which can be turned on, turned
off, or pressed.

- **Every answer box carries its own hint control** — a typed field, each cell
  of a chart, each blank of a Pensum A sentence, each slot of an order or match
  item. An item with four blanks has four hints, each about its own box, never
  one hint for the whole item.
- **Three modes**, a setting, remembered: *Press for a hint* (default — the
  control sits quietly beside the box and reveals on press), *Always show*
  (every box shows its hint from the start), *No hints* (the control is hidden
  altogether).
- **A hint narrows, it never answers.** Two levels per box: first what is being
  asked of it in plain words with the grammar term ("this one wants the dative
  — the 'to/for' form — singular"); pressing again gives the rule or the
  paradigm cell it comes from. Neither level may spell the accepted answer, and
  the existing sweep that fails the build when an item prints its own answer
  covers hint text too.
- **Using a hint is logged** exactly as now — a hinted correct answer is weaker
  evidence for the scheduler. *Always show* counts every answer as hinted, and
  the setting says so plainly, so the learner is not surprised by slower
  progress.
- Keyboard reachable, labelled for a screen reader, and never covering the box
  or the sentence.

### Chapter spine — grammar implementation notes (B, 2026-09-06)

Where the grammar side departs from the sketch above, or pins something it
left open. Change here first if any of it should move.

- **Files.** `app/js/grammar/chapter.js` (new, pure) beside the earlier
  modules; the views live in `ui.js` and the mount in `index.js`; tests
  `tests/grammar.chapter.test.mjs`. `js/grammar/chapter.js` must join `sw.js`'s
  PRECACHE (owner A's file) with a version bump.
- **`mountChapterGrammar(el, { chapter })`** is a module-level export of
  `app/js/grammar/index.js` *and* a method on `mountGrammar`'s handle; it needs
  `mountGrammar()` to have run. It returns `{ chapter, refresh(), destroy() }`
  and paints twice on a cold start (states first, the practisable truth once
  the library is read), because the `drillable` memo may not be answered
  without a generator (the wave-3 QA-B1 rule).
- **Two hooks on the handle, both optional.** `onChapterNav(fn)` — `fn(n,
  'grammar')` is called to get back to a chapter page from a lesson, a history
  page or a session opened there; without it the section shows its own
  by-chapter view at that chapter. `onLeaveChapter(fn)` — called before the
  section takes over the screen, since `html[data-page="chapter"]` hides
  `#grammar`; without it the section clears the chapter route (`location.hash`),
  which the shell's own hashchange handler reads as "no chapter".
- **The remembered view is `settings.grammar.view`** (`'topic' | 'chapter'`),
  riding in the same blob as `preset`, `size` and `oneSkill`.
- **The by-chapter view is the whole spine**, I–XXXIV, as folded sections; a
  chapter with no chapter list yet (chapters.js absent) still gets its numeral,
  its skills and its sets. Which chapters are open is the learner's and
  survives a redraw; each of the two views keeps its own scroll position.
- **"Practise this chapter"** is the ordinary mixed session with the chapter's
  drillable material as its whole `skillsIndex` — so the filler and the
  re-queue stay inside the chapter too — at `preset: 'review-heavy'`, ten
  items, resumable like any other session (`params: { chapter }`). Lapsed
  members re-enter the rotation first, as "Practise this skill" does. Where a
  chapter holds few grammar skills and several sets (chapter VII: one skill,
  four sets) the set window cannot hold and `buildSession`'s existing fallback
  applies: the session is the chapter's material rather than a rule kept by
  leaving items out.
- **`startBlocked` is now the view `blocked`** rather than a hand-driven
  `session`; Back leaves it, and a chapter page can open it through `ctx.go`.
- **Not changed, with reasons.** The Today card, the category filter and the
  bulk actions belong to By topic (the daily plan sits above both views); a
  chapter page shows no reading progress — that is the shell's half of the
  page.

### A chapter's practice reads like that chapter (2026-09-06)

`qa/grammar/QA-NAV-SESSION.md` **M3**: "Practise this chapter" for cap. VII kept
strictly inside chapter VII's *skills* but drilled them on sentences from the
whole library — Catullus 70 (cap. XXXIV) and a periodic sentence with an
imperfect subjunctive, in a chapter-VII session. The skills were scoped; the
Latin was not. **The sentence's chapter is now part of choosing an item.**

**The rule, one place: `app/js/grammar/chapter.js`.**

1. the chapter's **own** sentences;
2. failing those, sentences **at or before** it — Latin the learner has met;
3. only with neither, the wider library, and **the item says so in its own
   words** rather than reaching forward silently.

A sentence's chapter is its library week's, read through `app/js/chapters.js`
(`chapterOfWeek`: 107 → VII, 207 → VII, week 4 → XXVII) — the one place the
mapping lives; nothing here re-derives it. A week the spine does not name has
no chapter, so such a sentence is never "own" or "earlier" and can only be
reached in tier 3, before the ones that are demonstrably ahead.

- **`scopeByChapter(list, chapter, weekOf)`** narrows a draw to the narrowest
  non-empty tier and reports `{ list, scope: 'own' | 'earlier' | 'beyond',
  counts }`. No chapter (or an empty list) leaves everything alone with
  `scope: null` — the whole library, exactly as before.
- **`scopeNote(chapter, scope, sentence)`** is what the item carries as
  `item.scope` = `{ chapter, from, scope, beyond }`. It is set whenever a
  chapter scoped the draw, the chapter's own sentences included, because the
  pool such an item exhausts is the *chapter's* and not the library's — the
  "starting over" line says so ("Every chapter VII sentence for this skill has
  come up once"). `ui.scopeSentence(item.scope)` turns the other two tiers into
  the line printed above the item: *"This skill has no sentence in chapter IX
  itself, so this one is from chapter VII — Latin you have already read"*, and
  *"…no sentence in chapter XVI or earlier, so this one is from chapter XXV —
  further on than you have read."*
- **`chapterSentenceReport(chapter, { skills, candidates })`** is the
  measurement: per skill, the sentences (counted once each, by unit id) that are
  the chapter's `own`, `earlier`, `atOrBefore`, `later` and `unknown`, with the
  totals and `none` — the skills with nothing at or before the chapter, the ones
  whose items must say so. A chapter set is counted but never listed in `none`:
  its items are the chapter's own by construction.

**Where the scope comes from.** `buildSession({ …, chapter, currentWeekChapter })`
stamps every slot: `chapter` is the session's own (a chapter page's "Practise
this chapter", a spine row's), and `currentWeekChapter` scopes the ≈ 20 % slots
that already ask for the current week — "this week" used to mean the week's
*skills* while its sentences could come from twenty chapters ahead.
`session.createPractice({ chapter })` passes it to `buildSession` and to every
`items.generate` call, derives `currentWeekChapter` from `currentWeekN` itself,
and `requeue({ chapter })` keeps a re-queued miss in the same chapter; the
filler already came from `buildSession`. `ui.renderPracticeStart` passes the
chapter it already knew about, and a chapter's redo passes it too.

**Where it is applied.** `items.pickCandidate` (recognise, parse, blank) scopes
*after* the kind's own filters, so what is narrowed is what the learner could
actually have been shown; `items.chart` scopes the candidates its lemmas come
from (a chart has no sentence, but its word came from one); `stage3.scopeFor`
does the same for transform, reorder and translate. The tiers inside a scope —
gold, this week, nouns, short sentences — are unchanged, and so is the used-key
pool. **A redo is never scoped**: it names one exact item, and the scope could
only make that item undrawable.

Tests: `tests/grammar.chapter-scope.test.mjs` (a chapter with plenty of its own,
one with few, one with none; a chapter-VII session with nothing from a later
chapter; the current-week slots; the pure rule; the report).

#### Worth changing in the plan

- Nothing outstanding.

### Redo what was wrong (2026-09-06)

Learner's request: an option to redo the questions that were wrong.

- **At the end of a session**: "Redo the N you missed" when N > 0 — the same
  items, freshly ordered, played again as an ordinary session.
- **In Practice setup**: a "Missed items" choice beside the presets, building a
  session from items the learner has got wrong and has **not since answered
  right** — most recently missed first, mixed across skills so it is still
  interleaved practice, capped by the size chosen.
- **From a skill's history and from a chapter's grammar**: the same, narrowed
  to that skill or that chapter, with the count shown so the learner knows what
  they are taking on. Nothing to redo says so quietly.
- **What counts as missed** is derived from `drill_attempts`: an item whose most
  recent attempt was wrong. Answering it right in a redo clears it; answering it
  wrong again keeps it. Self-graded translate counts as missed only on "wrong",
  not on "partly".
- **Scoring**: a redo is an ordinary encounter and **is logged**, because it
  happens later in time and is exactly the spaced retrieval the plan wants. This
  is the opposite of the immediate retry inside an item, which is never logged —
  keep the two clearly apart in the code and say which is which in the UI.

## Progress across every chapter (2026-09-06)

Learner's request: show the timings and all the components for **every chapter**,
not only the current week. Today the study log reports pace and time-left for
the 14 course weeks; chapters I–XXIV and the dialogues have none of it, and a
chapter's grammar, questions, vocabulary and pensa are not counted anywhere.

**A Progress view listing all 34 chapters**, reachable from the menu and from
Settings beside the study log, each chapter one row that opens to its detail:

- **Reading** — per reading of that chapter (the text, the dialogue, each story):
  sentences read of the total, whether it has audio, and a Continue.
- **Timings** — time already spent on the chapter and time still to come, both
  from the study log's measured pace (minutes per sentence, per device, as the
  week figures already use). Say plainly that they are estimates from pace: the
  only measured quantity is the daily active minutes the study log records, and
  nothing may present a derived figure as a measurement.
- **Grammar** — skills of that chapter by state (new · learning · practising ·
  mastered · lapsed), the question set answered of its total, the vocabulary
  deck seen of its total, the pensa items available and done, each with the
  estimated minutes left at the learner's own drill pace (per-kind medians, as
  the Today card already computes).
- **A chapter total** — the sum of the above, so a chapter can be planned.
- Chapters with nothing done read as untouched rather than as zeros; a component
  a chapter does not have (no Colloquium after XXIV, a chapter with no pensa) is
  absent, never an empty row.

The 14 course weeks keep their existing table unchanged — this view is by
chapter and additional to it. Totals across the whole book sit at the top:
sentences read, chapters finished, skills mastered, minutes measured.

# Teaching rebuild (2026-09-09)

The learner's verdict on the grammar practice: the concepts are presented too
hard and not step by step enough; the sentences and vocabulary are too hard;
the vocabulary runs past the chapter; there is nowhere that catalogues every
paradigm for practice on several words; there is no customisation; and the
answer boxes do not check cell by cell. Their sixteen answers below are binding.

## 1. Teaching sentences (new, and the biggest change)

Ørberg's own sentences are mostly too long for teaching a new skill, so **we
write our own**. Purpose-made, pedagogically ordered, in the book's vocabulary
and syntax, **five to eight words**, never longer unless the construction
cannot be shown shorter (say so per sentence when it happens).

```
app/data/grammar/sentences/<skill>.json     public — our own Latin, not the book's
```
```jsonc
{ "skill": "dative-indirect-object",
  "chapter": 7,                         // the skill's chapter; vocabulary is cumulative to here
  "sentences": [
    { "id": "dio-01", "la": "Iūlius puerō mālum dat.", "en": "Julius gives the boy an apple.",
      "words": 4, "focus": "puerō",     // the word the skill is about; must occur in `la`
      "step": 1,                        // which teaching step it belongs to (1 = first)
      "stage": 1,                       // 1 recognise · 2 cued recall · 3 production
      "kinds": ["recognise", "parse", "blank"],
      "gloss": [ { "w": "Iūlius", "m": "Julius" }, … ]   // every word, in order
    } ]}
```
Rules, enforced by a build check:
- **Cumulative vocabulary only.** Every word must appear in `app/data/grammar/vocab/NN.json` for some NN ≤ the skill's chapter, or be a proper name of the book's cast, or be the construction's own function word. A build check fails on any word outside that set and names it.
- **Five to eight words**, counting every printed word. Longer needs a stated reason in the sentence's own `note`.
- **Correct, natural Latin with macrons**, in Ørberg's register — the kind of sentence he would write. No invented lexicon, no English word order.
- **Enough per skill** to teach and practise it: at least one per teaching step, and at least twelve in total per drillable skill so items do not repeat quickly.
- Each carries its full gloss, so no drill ever assumes a meaning.
- Book sentences are **not** retired: they remain the material for stage 3 and
  for chapter practice once a skill is in rotation. The written sentences are
  what Learn and the early stages use.

## 2. Learn, rebuilt as micro-steps (replaces the current flow)

A skill is taught in **four to six steps**, each one idea, each followed
immediately by a single check on that idea alone.

```jsonc
"teach": [
  { "n": 1, "title": "What it does",
    "say": "…one short paragraph, plain words, the term with its gloss…",
    "show": { "kind": "sentence", "id": "dio-01" },      // or a paradigm cell, or nothing
    "check": { "kind": "recognise", "sentence": "dio-02" } },
  { "n": 2, "title": "The singular endings",
    "show": { "kind": "paradigm", "key": "decl2", "reveal": ["dat.sg"] },
    "check": { "kind": "chart", "cells": ["dat.sg"] } } ]
```
- **Worked examples are completed, not read.** The first is shown fully parsed;
  the next two the learner finishes, with the reasoning prompted a step at a time.
- **A paradigm is built cell by cell**: each step reveals one cell and names its
  ending, and the learner may practise that cell **on several words** before
  moving on (the catalogue's stock words, §4).
- After the steps, the blocked ten and the existing 6-of-10 criterion stand.
- **Prerequisites**: if a skill's prereqs are unmet, Learn says so and offers
  them, and lets the learner go on.

## 3. Cell-by-cell checking (every guided and independent practice)

- A cell is judged **when the learner leaves it** (tab, click away, Enter) and
  turns **green or red** at once. Red does not block: the learner may correct it,
  press the hint, or leave it and grade the rest together.
- **The hint reveals that one cell's answer**, and marks the cell hinted.
- **A chart is one attempt** for the scheduler, correct only if every cell was
  right unaided, so a twelve-cell table does not swamp the history. Per-cell
  results are kept for the feedback and for "redo what was wrong".
- Tab moves in reading order; the last cell tabs to the grade button.

## 4. The paradigm catalogue

```
app/data/grammar/paradigms.json    catalogue entries, generated from skills.json + paradigms.js
```
Organised **by part of speech, then by table**, each entry naming the chapter
that introduces it and the category it belongs to, with a filter across both.
For each table the learner can: see it filled, practise **one cell**, practise
**the whole table**, and **switch the word** it is built on. Every table offers
**stock words** — the examples the book itself teaches with, three to five per
table, chosen and reviewed, not sampled at random — plus any word from the
library on request.

## 5. Customisation

Per skill and per table, the axes that are **logical for that skill**, or mixed:
gender, declension or conjugation, case, number, tense, person, and chapter
range. Only axes the data can honestly filter are offered, and a chosen filter
is remembered per skill. A filter that would leave no material says so instead
of producing an empty session.

## 6. The decisions behind this rebuild (2026-09-09)

The learner reported six problems with the grammar practice, verbatim:

1. the presentation of the grammar concepts is too hard and not step by step
   enough, with too little guided practice;
2. the sentences and vocabulary used in the practice are too hard — each skill
   should be presented and practised with the simplest sentences that carry the
   skill, ideally five to eight words;
3. the vocabulary often goes beyond the vocabulary introduced in the chapter;
   examples, sentences and both kinds of practice should stay inside it;
4. there is nowhere that every skill and paradigm is categorised and catalogued
   so it can be practised on several different words;
5. some skills need customisation, for instance practising feminine words only;
6. every guided and independent practice needs cell-by-cell checking (green or
   red as each cell is completed and tabbed out of) and a hint button that
   reveals the answer or part of it.

Sixteen questions were put, with a recommendation on each. The answers, which
are binding on the sections above:

| # | Question | Answer |
|---|---|---|
| 1 | Break a skill into micro-steps, each with its own one-item check? | Yes, micro-steps. |
| 2 | Should worked examples be completed rather than read? | Yes — shown, then completed. |
| 3 | Build a paradigm cell by cell before filling a blank one? | Yes, one cell at a time, **with the option to practise that cell on several words**. |
| 4 | If prerequisites are unmet, refuse or warn? | Warn and let it proceed. |
| 5 | Where do simple practice sentences come from? | **Write our own** — pedagogically sound sentences built on the book's vocabulary and syntax, but simple. |
| 6 | Chapter vocabulary strictly, or cumulative? | Cumulative. |
| 7 | When no book sentence is short enough at that chapter? | Always write a teaching sentence, or rewrite, so it is as simple as possible while still teaching the skill. |
| 8 | Allow the book's proper names freely? | Yes. |
| 9 | How should the catalogue be organised? | Left to the build: **by part of speech, then table**, each naming the chapter that introduces it, filterable by category — recorded here so it can be reviewed. |
| 10 | What can the catalogue do with a table? | See it filled, practise one cell, practise the whole table, switch the word — **with hints and automatic checking**. |
| 11 | Which words does a table offer? | Library words **and stock examples chosen for that skill**. |
| 12 | Which customisation axes? | Those that are logical for the skill, or mixed. |
| 13 | On tab out of a wrong cell? | Mark it red; then either take the hint or grade them all together. |
| 14 | What does the hint give? | The answer for that one cell. |
| 15 | Is a filled chart one attempt or one per cell? | One attempt for the chart. |
| 16 | Replace the current Learn flow or sit beside it? | Replace it. |

**The one judgement call flagged at the time**: writing teaching sentences for
every skill is the largest piece of work here, and it is the only way to
guarantee five-to-eight-word sentences inside chapter vocabulary, because the
book's own sentences rarely oblige. The learner chose it knowingly (answers 5
and 7).

**Status**: specified, not yet built. The content generation for all 88 skills
is held pending a design review.
