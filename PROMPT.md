# Build brief: Latin 103 Reader

Build a personal Latin reading app for one user working through Ancient Language
Institute Latin 103 (Familia Romana ch. 25–34, Fabulae Syrae, Fabellae Latinae),
fall 2026, 14 weeks. Use agent teams: the workstreams in §7 are designed to run in
parallel. Read this whole file before splitting work.

The user is the sole reader. They wrote every English translation in `source/`.
The Latin is copyrighted (Ørberg, Miraglia); the recordings are ALI-exclusive.
Nothing copyrighted may be publicly reachable — see §5.

---

## 1. Decisions already made with the user (do not re-ask)

| Question | Decision |
| --- | --- |
| Default reading view | Latin, with a show/hide English toggle |
| English display modes | Hidden; or interleaved (each Latin sentence followed by its English) |
| Word definitions | Popup at the word on phones; side panel on tablet/desktop |
| User's grammar sections & paradigm tables | Leave out of the app |
| Pensa (exercises) | Leave out |
| Per-sentence grammar notes | Passage view: small marker on sentences with a note, opens as popup (phone) or side panel (wide). Sentence view: note shown beneath the translation |
| Sentence view | One sentence at a time; its English (toggleable); its grammar note; the words the user has looked up in it, listed with definitions beneath |
| Week's grammar focus | Highlight every instance in the passage with a soft glow; toggleable; tap for a note naming the construction and its role in that sentence |
| Progress | Any looked-up word gets a **yellow underline** everywhere it appears until the user marks it learned |
| Sync | Progress synced across devices via **Supabase** (free tier) |
| Hosting | **GitHub Pages or Netlify**, free. Static front end |
| Audio | **Real recordings only** (Luke Ranieri's *Familia Romana* MP3s, user-supplied). Per-sentence playback and follow-along highlighting via a one-time alignment mode |
| Reading comfort | User picks type size and typeface; include a dark mode |
| Budget | Effectively $0. No paid API calls at runtime. No LLM translation |
| Word info | Learner-first: plain meaning first, then parse, then declension/conjugation, then full paradigm with the form highlighted |
| Line numbers | Show Familia Romana and Fabulae Syrae line numbers in the margin, Ørberg-style. Fabellae Latinae has none |
| Devices | Web app used on computer, phone, tablet. Must work offline after first load (PWA) |

## 2. What "learner-first" means (this is the quality bar)

The user is a beginner-to-intermediate learner. Every piece of grammatical
information must lead with the plain answer and put the label second.

- Word tap on *labyrinthō* → first line: "to/for the labyrinth · in/by the labyrinth".
  Second line, smaller: "dative or ablative singular". Then: "*labyrinthus -ī m* ·
  2nd declension". Then an expandable paradigm table, learner order
  (nom, gen, dat, acc, abl, voc), stem and ending visually separated
  (*labyrinth‑ō*), the tapped form highlighted.
- Verbs: "they should send" → "imperfect subjunctive, 3rd pl." → "*mittō -ere
  mīsī missum* · 3rd conjugation" → full conjugation table, tapped form lit.
- Grammar-focus note on *mitterent*: "imperfect subjunctive because *imperābat*
  (past) introduces a command." Function before form.
- Plain-language glosses on labels, hoverable/tappable: "ablative — the
  'by/with/from' case", "deponent — looks passive, means active".
- No abbreviations (`gen. sg. m.`) unless the user enables a compact setting.
- Whitaker's Words definitions are terse and jargon-heavy (`w/GEN`, `(pl.)`,
  semicolon lists). **Rewrite them into readable English**, most common
  meaning first, and mark the meaning that fits the current sentence where
  that can be inferred from the user's translation.
- Function words (prepositions with the case they take, conjunctions,
  adverbs, enclitics *-que* *-ne*, particles) all get an entry explaining
  their use. Latin has no articles; where a learner might expect one, say how
  Latin handles definiteness.

## 3. Data inventory (in this folder)

```
source/week-01.md ... week-14.md      Latin text + user's literal translation + user's grammar notes
                                      (week-01 provided; the user will drop in 02–14 — same format)
data/whitaker-glossary-all-weeks.json  6,411 word forms → parses + senses, from Whitaker's Words
data/supplement-week01.json           ~80 hand-written entries Whitaker missed (proper nouns, gaps)
data/grammar-notes-week01.json        93 per-sentence grammar notes for Week 1, keyed "line.sentence"
data/week01-aligned-sentences.json    Week 1 fully sentence-aligned (the target shape for all weeks)
data/syllabus.md                      The course syllabus: weeks, topics, readings
pipeline/parse_week_reference.py      Working alignment logic + format notes (read its docstring)
```

Glossary schema: `{ form: [ {h: headword, t: POS, f: [feature strings], s: senses, e: enclitic} ] }`.
Forms are macron-stripped ASCII. Whitaker's Words Python port:
`pip install git+https://github.com/blagae/whitakers_words.git`. Coverage on the
actual texts is good for common vocabulary; misses are mostly proper nouns and
some gaps (*suus*, *vorō*, *labyrinthus*). Weeks 2–14 need their own supplements.
Whitaker's inflection objects carry declension/conjugation codes — use them to
**generate** paradigm tables rather than hand-writing them.

Textbook scans (user has them; ask if needed): the Familia Romana PDF text layer
carries the marginal line numbers on odd pages (every 5th line). Weeks 7, 8, 9,
11, 12, 13 documents lack `[n]` markers and need line numbers recovered from the
scan. Fabulae Syrae (weeks 3, 5, 10) likewise. The user already has the relevant
pages split out as `Week-NN-*.pdf`.

## 4. Week → grammar focus (drives the highlight feature)

| Wk | Reading | Focus |
| --- | --- | --- |
| 1 | FR 25 Theseus et Minotaurus | Deponent verbs (esp. imperatives *-re/-minī*) |
| 2 | FR 26 Daedalus et Icarus | Gerund (*-ndum/-ndī/-ndō*) |
| 3 | FS Minos, FS Coronis; FL 63–65 | Present subjunctive (indirect command *ut/nē*); supines *-um/-ū* |
| 4 | FR 27 Res Rusticae | Present subjunctive (paradigms; *ut/nē* clauses) |
| 5 | FS Coriolanus end + Nausicaa; FL 66–68 | Imperfect subjunctive (result, purpose, indirect command, indirect question) |
| 6 | FR 28 Pericula Maris | Imperfect subjunctive (sequence of tenses) |
| 7 | FR 29 Navigare Necesse Est | *ut/nē*: indirect command vs purpose vs result; deliberative subj.; *cum* clauses |
| 8 | FR 30 Convivium | Future perfect (in *sī/cum/antequam* clauses) |
| 9 | FR 31 Inter Pocula | Gerundive / passive periphrastic; dative of agent |
| 10 | FS Arachne; FL 69–74 | Perfect subjunctive (prohibitions *nē + perf. subj.*, indirect questions) |
| 11 | FR 32 Classis Romana | Perfect subjunctive; optative *utinam* |
| 12 | FR 33 Exercitus Romanus | Pluperfect subjunctive (contrary-to-fact, past wishes); future imperative |
| 13 | FR 34 De Arte Poetica 1–138 | Poetry: elegiac couplet, hendecasyllable; *dummodo*; dative verbs |
| 14 | FR 34 139–217 | Poetry: prosody, elision, scansion; Martial's epigrams |

The user's English translations already tag most focus instances in brackets,
e.g. `[imperfect subjunctive: mitterent]`, `[Ablative Absolute]`, `[gerund: ad
nāvigandum]`. Parse these as the seed list; a Latin-competent reviewer agent
fills gaps. Weeks 13–14 overlap by six lines (*Ōdī et amō*): keep in Week 13,
start Week 14 at *Hīs versibus recitātīs*.

## 5. Privacy and copyright — non-negotiable

- The **app shell** (HTML/JS/CSS) may be public on GitHub Pages / Netlify.
- **All reading text, translations, grammar notes, and audio live in Supabase
  behind auth** (email + password, single user). Row-level security on every
  table. Audio in a **private** Storage bucket served via signed URLs.
- Never commit the Latin texts, translations, or MP3s to the git repo. Add
  `source/`, `data/week*`, `audio/` to `.gitignore`. Seed Supabase from a local
  script run on the user's machine.
- The dictionary JSON is derived from Whitaker's Words (free license) and my own
  supplements — it may ship with the public app.
- Cache texts in IndexedDB for offline use after login; clear on logout.

## 6. Architecture (recommended; adjust if you have a strong reason)

- **Front end:** static PWA. Vanilla JS or a light framework (Svelte/Preact
  fine). Service worker for offline. IndexedDB for texts, glossary, progress
  cache. No localStorage for anything larger than settings.
- **Backend:** Supabase. Tables: `weeks`, `units` (a sentence, verse line, or
  speaker turn; `week_id, order, line_no, la, en, note, unit_type`),
  `highlights` (`unit_id, span_start, span_end, label, note`), `lookups`
  (`form, first_seen_unit_id, learned_at`), `audio_alignments`
  (`week_id, unit_id, start_ms`), `settings`. Auth: one user. RLS: `user_id = auth.uid()`.
- **Dictionary:** glossary JSON bundled with the app + per-week supplement
  JSON; lookup strips macrons/punctuation, tries exact, lowercase, then
  strips enclitics *-que/-ne/-ve*. Miss → "not in dictionary" with an online
  fallback link to Logeion when online.
- **Paradigm generator:** from Whitaker declension/conjugation codes, build
  full tables (all 5 declensions incl. i-stem/Greek variants; 4 conjugations
  incl. 3rd -iō, deponents, irregular *sum/eō/ferō/volō/possum*). Highlight the
  tapped form. Learner ordering. Stem–ending split.
- **Audio:** user uploads chapter MP3s to the private bucket. Alignment mode:
  play the chapter; user taps each unit as it begins; store `start_ms`. After
  alignment, tap-to-play a unit (plays `start_ms` to next unit's `start_ms`)
  and follow-along highlighting during full playback.
- **Reader typography:** default a serif with good macron support
  (system stack `"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif`;
  optionally bundle Gentium Plus, which is OFL). User-selectable size (5 steps)
  and face (serif/sans/dyslexia-friendly). Dark mode. Line numbers in the left
  margin every 5 lines. Yellow underline for looked-up words; a soft glow
  (subtle box-shadow / background) for grammar-focus spans; both toggleable.

## 7. Agent-team workstreams

Run A–E in parallel after a short shared kickoff to agree on the `units`
schema and the aligned-JSON shape (use `data/week01-aligned-sentences.json` as
the contract). F depends on all.

**A. Data pipeline (Latin-competent agent).** Parse `source/week-*.md` →
aligned units for all 14 weeks. Handle the format variations in the parser
docstring. Recover line numbers for weeks 3, 5, 7–13 from the scans (ask the
user for the `Week-NN-*.pdf` files). Strip bracketed grammar tags from the
displayed English but keep them as structured highlight seeds. Produce a
per-week mismatch report for human review; never silently guess an alignment.

**B. Dictionary & paradigms.** Extend the glossary to every form in weeks 2–14
(run Whitaker on the token set; write supplements for misses). Rewrite
Whitaker senses into learner English. Build the paradigm generator and test it
against Ørberg's tables for each declension/conjugation type. Build the
function-word explanations.

**C. Grammar notes & highlights (Latin-competent agent).** Using the seed tags
from A and `data/grammar-notes-week01.json` as the model, write per-sentence
notes for weeks 2–14 and the highlight spans + notes for each week's focus.
Function before form; one to two sentences per note.

**D. Reader UI.** Passage view, sentence view, word popup/panel, note
markers, English toggle (hidden/interleaved), highlight toggle, type controls,
dark mode, responsive breakpoints (≈380px phone → tablet → desktop), keyboard
navigation, visible focus, reduced-motion respected.

**E. Supabase, auth, sync, audio, PWA.** Schema + RLS, seed script, auth flow,
IndexedDB cache with sync, private audio bucket + signed URLs, alignment mode,
playback, service worker, offline behaviour, logout clears cache.

**F. Integration, QA, deploy.** Wire D to E and data from A–C. Test on phone
viewport. Deploy shell to GitHub Pages/Netlify; document the seed and audio
upload steps for the user in `README.md`.

## 8. Acceptance criteria

- All 14 weeks load; every unit shows Latin, English (toggle), line number
  where the source has one.
- Tap any word → learner-first entry (§2) within 200 ms offline.
- Looked-up words are yellow-underlined everywhere until marked learned;
  state survives reload and syncs to a second device.
- Week focus highlights toggle; tapping a highlight shows a note.
- Sentence view shows one unit with its English, note, and looked-up words.
- With an MP3 uploaded and aligned, tapping a sentence plays just that
  sentence; full playback highlights the current sentence.
- Works offline after first login. No copyrighted text or audio reachable
  without auth. Zero runtime API cost.
- Type size/face/dark mode persist.

## 9. Ask the user before starting

1. Supabase: confirm project creation (free tier) and that they will run the
   seed script locally.
2. GitHub or Netlify account name.
3. Location of `source/week-02.md … week-14.md` and the `Week-NN-*.pdf` scans.
4. Whether the Ranieri MP3s are downloaded yet (not blocking).
