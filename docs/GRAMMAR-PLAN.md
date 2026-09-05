# Grammar section — plan

Goal: a grammar course inside the reader that re-teaches everything from Latin
101–102 while 103 adds the subjunctives, and makes it stick. Design rule:
**massed practice while a skill is new; interleaved, spaced practice once it is
in.** Every choice below follows from that rule or from the evidence behind it
(retrieval practice beats re-reading; spacing beats cramming; interleaving
confusable skills builds discrimination; immediate, explanatory feedback;
recognition before recall before production; desirable difficulty).

## 1. Where it lives

A second tab beside the reader (same app, same login, same offline PWA).
Reasons: every drill item is built from sentences already in the library with
the same dictionary and paradigm tables behind every word; progress, lookups and
the study log stay in one place. Nothing copyrighted moves to the public shell:
lessons are our own prose and ship with the app; the sentences they quote are
fetched from the private library by unit id.

## 2. The skill map

87 skills from the learner's course notes (*Latin Grammar Topics*, St Andy's
Latin Companion order), one per lesson, in Familia Romana chapter order
(ch. 1 nominative … ch. 33 gerundives), each tagged:

- `chapter`, `course` (101 / 102 / 103), `week` in that course
- `category` (noun case · adjective · pronoun · verb form · verb use · syntax · vocabulary · questions)
- `prereqs` (skills it builds on) and `confusable_with` (skills it is mixed
  against on purpose: dative/ablative; perfect/future perfect; ut purpose/result/
  indirect command; gerund/gerundive; imperfect/pluperfect subjunctive …)
- `paradigm` keys (which tables to show), `patterns` (regexes to find the
  construction in the texts), `question_words` where relevant.

Each 103 week gets an automatic "review first" list: the prerequisites of its
new skills, ordered by how far they have decayed for this learner.

## 3. Content

### Lessons (authored once, by Latin-competent agents, reviewed)
Two-minute core: what it does in plain words with the term beside it
("the dative (the 'to/for' form) marks the person something is given or said
to"), the minimal rule, the paradigm table, three book examples linked to their
sentences in the reader, the classic confusion and how to tell it apart, then
an expandable "more" (exceptions, fuller table, the learner's own notes quoted).
Source order: the learner's course notes, then Ørberg's Grammatica Latina
(paraphrased, never copied), then Allen & Greenough for exceptions.

### The review library
Familia Romana chapters 1–24 are added to the library as a "Review" shelf:
Latin only (no translations exist), built by the same pipeline from the scan,
private like everything else. It exists so the early skills have real examples
and drill material. Colloquia Personarum can follow the same way later.

### Drill items (generated, not hand-written)
Every word in the library carries its parses, so these are produced by rules
from the texts, fresh each session, never repeating an item until the pool is
exhausted:

| kind | what the learner does | stage |
| --- | --- | --- |
| recognise | multiple choice: which case/tense/mood is this word (in its sentence)? distractors = the confusable forms | 1 |
| chart | fill a paradigm (whole chart when learning; one cell when interleaved) | 1–2 |
| parse | type the case/number/gender or tense/voice/mood/person of a highlighted word | 2 |
| blank | the sentence with one word blanked; given the dictionary form, type the right form | 3 |
| transform | change a sentence: singular→plural, present→perfect, active→passive, statement→indirect command … (the book sentence is the answer key) | 3 |
| reorder | put a scrambled book sentence (≤ 12 words) back in order | 3 |
| translate | short book sentence; self-graded against the model answer with the key words marked | 3 |
| question | quis/quid/cūr/ubi/quō/unde/quandō/quōmodo/quot/quālis/uter/num/nōnne/-ne about the passage; pick or type the Latin answer, the passage sentence shown after | 3 |
| pensum | Ørberg's own Pensum A/B/C for the chapter, reconstructed from the scan | 2–3 |
| vocab | chapter's new words, Latin→English then English→Latin, principal parts / genitive + gender required | 1–3 |

**Meanings are never assumed.** Every Latin word in a drill item shows its
meaning: the target word's dictionary form and plain meaning sit under the
item ("*puellae* — from *puella*, girl"), and every other word in the sentence
is tappable for its entry exactly as in the reader, with an "show all
meanings" switch that prints a running gloss under the sentence. A grammar
drill tests the grammar point, not whether the learner remembers the word;
only the vocabulary drills withhold meanings.

Stage = difficulty ladder per skill: recognition → cued recall → production in
context. A learner moves up a stage on the skill after 4 correct in a row at
the current stage; interleaved sessions draw from the skill's current stage
and one below.

## 4. Two modes

### Learn (massed, for a new skill)
1. Lesson (2 min).
2. Three worked examples from the book, each parsed aloud in plain words.
3. Guided drill: 5 items with hints available (the paradigm, the rule).
4. Blocked drill: 10 items on this skill only, kinds mixed, hints off,
   feedback after each.
5. Criterion: 8 of 10 across at least two kinds. Miss it → the feedback
   points to what was missed, the lesson's relevant line is highlighted,
   and the blocked drill runs again with fresh items. Pass → the skill enters
   the interleaved rotation with its first review due tomorrow.

Massed practice is limited to a skill's first sitting and to "re-learn" when a
skill has decayed to *lapsed*; everything else is interleaved.

### Practice (interleaved, spaced)
Sessions of 5, 10, 15 or open-ended. The scheduler builds each session:

- **Due skills first** (spacing): each skill carries a stability in days;
  correct → stability × 1.7 (× 2.2 when answered fast and unaided); wrong →
  stability × 0.3, floor half a day; due = last review + stability.
- **Deliberate interleaving**: never two consecutive items on the same skill;
  at least one *confusable pair* per five items (e.g. an ablative item
  followed within three items by a dative item), because discrimination is
  what mixed practice trains.
- **Current week**: about a third of items come from this 103 week's new
  skills once they have passed Learn.
- **Kinds mixed**: no two consecutive items of the same kind.
- **Errors feed back**: a wrong answer re-queues that skill later in the same
  session (not immediately), logs the confusion pair (answered dative for an
  ablative), and the next sessions bias toward that pair.

### Feedback (every item, both modes)
One line: your answer · the right answer · why, in plain words with the term
("*puellae* here is genitive — the 'of' form — because it tells whose book it
is; the dative would be 'to the girl'"). Expandable: the full lesson paragraph,
the paradigm with the cell lit, the sentence in the reader. A "Practice this
skill" link opens a 5-item blocked set on that skill without leaving the
session's place.

## 5. Daily plan

The reader's home shows a suggested set, never forced: "Today · Learn:
imperfect subjunctive of purpose (new this week) · Practice: 10 items, 4 due
skills, 1 confusion pair". Learn comes before Practice on days a new skill is
due; Practice alone on other days. Estimated minutes shown from the study log's
pace.

## 6. Mastery and progress

- Skill states: *new* → *learning* (in Learn) → *practising* (in rotation) →
  *mastered* (stability > 21 days and three spaced successes) → *lapsed*
  (overdue by more than twice its stability; goes back through a short Learn).
- The skill map shows state per skill; each chapter's row shows mastered/total;
  each 103 week shows its prerequisites' states.
- Everything feeds the study log (minutes, items, accuracy per day) and a
  "skills mastered" count beside sentences read.

## 7. Data

- Public (in the app bundle): `skills.json` (the map), `lessons/*.json` (our
  prose; book sentences referenced by unit id, invented examples inline and
  marked), question-word sets referencing unit ids, vocabulary per chapter
  (dictionary forms and meanings are Whitaker-derived and fine to ship).
- Private (Supabase, RLS as everywhere): review-library texts (ch. 1–24),
  pensa, and the learner's `skill_state` (skill, stability, due_at, stage,
  streak, state), `drill_attempts` (skill, kind, item key, correct, answer,
  ms, at), `confusions` (skill_a, skill_b, count). Local-first with the
  outbox, like lookups.
- Item generation runs on the device from the private texts + the glossary:
  zero runtime cost, nothing copyrighted leaves the library.

## 8. Build waves

1. **Core** — skill map for all 87 skills; lessons for all 87 (agents, then
   review); chapters 1–24 review shelf; drill engine with recognise, chart,
   parse, blank; Learn flow with criterion; Practice with the scheduler,
   confusion pairs and feedback; skill map + mastery; study-log integration.
2. **Depth** — transform, reorder, translate (self-graded), question-word sets
   for every chapter, vocabulary decks, pensa from the scan, daily plan on home.
3. **Polish** — confusion analytics ("you mix up X and Y"), per-skill history,
   printable charts, Colloquia Personarum shelf.

Each wave goes through the same gates as the reader (independent code review
and live QA) before it deploys.

## 9a. Learner's answers (2026-09-05)

1–10, 12, 13, 16, 17, 19–24: recommended options accepted.
11: links from lesson examples into the reader are optional, not required.
14: **several input ways, chosen per item** — typing; multiple choice; tap-to-order
(words into a sentence, endings into a chart); drag/match (word ↔ case, form ↔
meaning); chart fill; tap the word in the sentence that answers the question.
15: sentence reorder items are **at most 8 words**.
18: the session mix is **the learner's choice** — presets in the session setup
("Review-heavy" = due skills first with confusable pairs, the default; "This
week" = two-thirds current skills; "Even mix" = random across everything in
rotation; "One skill" = blocked), remembered as a setting.
25: **grammar keeps its own stats page** (skills mastered, accuracy, items per
day, minutes) — not mixed into the reading study log (the study log's active
timer still runs while practising; it is one app).
26–28: recommended (suggested daily set, single cells on phones, three waves).
29: **hints always available**, use logged (a hinted answer counts as weaker
evidence for the scheduler).
30: Learn criterion **6 of 10**.
31: response time measured quietly, never shown as a countdown.
32: **no audio in drills.**
33–34: recommended (target word glossed under the item, others on tap, a
"show all meanings" switch; macrons optional, feedback macronised).
35: **no cap** on new skills per day.
36: short inline English-grammar refreshers where a lesson needs them.
37: Read / Grammar switch in the header. 38: calm, no gamification.
39: English term + plain gloss, the Latin label once in the lesson.
40: a few items per mixed session come from the current week's text.
41: **per skill, the learner chooses**: "Start as new" (goes through Learn) or
"Add to mixed practice" (enters the rotation as practising); an "add all" and a
"start all as new" shortcut on the skill map; no forced diagnostic.
42: Colloquia Personarum shelf in wave 3. 43: question sets for every chapter
1–34. 44: reset per skill and reset all, with confirm.
Vocabulary (from the chat): **recognition is the focus** — Latin→English decks
by default; English→Latin only as an optional extra deck.

## 9. What is decided (the 28 questions)

Same app · all 87 skills, 103's eight deepened first · ch. 1–24 added as a
review shelf · pensa included · chapter spine with category filter · prerequisite
review lists · learner's notes first · poetry last · two-minute lessons with
"more" · book examples first, invented ones marked · links to the passage ·
typing with macrons optional (recognition stage uses multiple choice) · whole
chart when learning, one cell when interleaved · dictionary form → inflected
form first · reorder ≤ 12 words · translation self-graded · 5/10/15/open ·
scheduler weighting as in §4 · short feedback expandable · wrong answers
re-queue in-session plus a practice link · question words as listed ·
vocabulary both directions, new words per chapter · shared study log plus
mastery · suggested daily set · one cell at a time on phones · three waves.
