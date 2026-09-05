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
