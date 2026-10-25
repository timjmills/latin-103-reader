# Simplifying the app: audit and plan

*2026-10-25. Written after v118, then independently reviewed and revised the same day against v119 (see "Review notes"). Goal: one simple place for grammar and forms in place of Grammar, Word Work and Sheets, keeping every feature, game mode and the newer options (progressions, table games, mixed games, both voices, how-it's-made), with fewer taps, not more.*

## What is built (v122, 2026-10-25)

Built with the review's suggested answers to §12 (Study; Course opens by area; per-device Lesson / Game; parts as numbers on rows; rare actions under More; the reading Progress page linked, not moved; "Across the conjugations / declensions").

| Plan | Built | Notes |
|---|---|---|
| §3.1 Read · Study, four tabs, one switch | ✓ | both sections always show on a phone; the switch ends the tab row; the game's ☰ lists the same tabs |
| §3.2 Today | ✓ | Find; today's plan, in progress, re-tests; This chapter (rows, Practise this chapter, forms, sheet, 🖨 Print sheet, its page); Next on your path; Review first; Choose your own practice |
| §3.3 Course | ✓ | By area / By chapter; one main button per row (`actions.js`); Practise · Mix · Parts 1–n; ▦ Across + each table; Manage folded |
| §3.0 Find | ✓ | skills by name, topic, ending; tables by name or model word; macrons ignored; Enter opens the first |
| §3.4 Skill page | ✓ | main button on top, fixed at the bottom on a phone while reading; Related + ▶ Mix them; More; meter reads "progress" |
| §3.5 Chapter page | ✓, in Study | Grammar · Forms · Sheet, Read it, chapters either side. **Differs:** it lives in Study, not inside the reader's chapter page; the reader's page keeps its own Grammar tab and its Word Work / Cheat sheet buttons now open these tabs |
| §3.6 Tables | ✓ | one page: Find a word, Practise by type, **Every table** (filters; Practise and Open on each), your learning words, the model words; the old Tables list address opens it at Every table |
| §3.7 Progress | interim | Practice chart · Stats · Reading ↗ |
| §7 Old addresses | ✓ | `routes.js` with tests |
| v119/v120 | ✓ | practice goes across the tables; anything started from a menu comes back to it; conjugation named on cards; How it's made opens on the principal parts |

| §3.4 session bar | ✓ | "← This skill"; "▦ Across the declensions (4)" in place of "Its tables" |
| §3.8 two ladders | ✓ | "⇅ Easier or harder skill?" (another skill); the game's ◂ ▸ are "Easier / Harder way to play" |
| §9 phone pass | ✓ | at 320 and 375 px, on Today, Course (both views), a skill page, a chapter page, Tables, the practice chart and a drill: no sideways scroll, the four tabs and the switch fit (the switch shows its mode's icon), every link at least 24 px tall, the skill page's main button on the first screen (523–617 px) |

Still to do: retiring the old Skills / Path page code (their addresses already redirect); Course by area on a phone still opens with its first row's button below the first screen (Next to learn is above it).

## The brief, in your words

> "Redesign to a simple-feeling app that can go **by skill progression**, or **by chapter**, or **by an isolated skill** wanting to be practised (and its related skills); also important to be able to **practise the same skill across conjugations**."

Plus, from earlier:

- "now there are too many and too complicated";
- "we don't want too much clicking to get what we need";
- show things inline so they are "all there to see" (or "a menu that expands");
- every action in both lesson mode and game mode;
- easiest → hardest made clear.

Everything below is measured against this.

## Review notes

What the review checked: the plan against the code (`app/js/grammar/ui.js`, `index.js`, `session.js`, `continuum.js`, `today.js`, `main.js`, `chapters.js`, `practised.js`, `practicelog.js`, `game.js`, `settings.js`) and against the running app (sample data, at 320, 375, 393, 768 and 1000 px wide), including v119's two changes:

- practising a skill across its tables (`wordsAcross`);
- a lesson or practice opened from a menu now comes back to that menu.

The button counts in the first draft reproduce exactly (645 on Skills). The main changes, most important first:

0. **The three ways in are now first-class, and so is "across conjugations".**
   - **By progression** is Course → By area, plus "Next on your path" on Today.
   - **By chapter** is Course → By chapter, the one chapter page, and Today's "This chapter".
   - **By one skill and its related skills:** a **Find box** (there is no way to find a skill by name today), and a skill page with a **Related** line: what it builds on and its look-alikes (exactly the skills Mix uses), and **▶ Mix them** in one tap.
   - **Across conjugations / declensions** gets one clear name on every skill with tables: **"Across the conjugations (5)"** or **"Across the declensions (4)"**. Today the same thing goes by five names ("▦ Play its tables: every word", "▶ all of them in one game", "Practise its part of the table", "Whole table", "Its tables (N)"). Since v119 Practise and each lesson part also draw their words across the tables, and the plan says so.
1. **The merge of the practice buttons was wrong on the facts, so it has been redone.** "Practise this skill" is **five** items built by the scheduler at the skill's current level, and on a skill still in Learn it sends you back to Learn. It is not "the ten". "Just drill it" (and Word Work's "Drill") is the **ten** on the skill's own sentences with the rule pinned above each, and it is the only start that sets up the 10-minute re-test. "▶ Play" on a skill with forms does not practise the skill at all: it plays its tables, and it moves the header to Word Work. These starts feed your progress differently, so the plan now keeps both paths and names them by purpose. **Practise** is the ten, with "Ten more" after it. **Review** is the due five. A table in §6 now says what each start does to your progress.
2. **No ⋯ menu on the rows.** The first draft put Practise, Mix, each lesson part and the table games behind a ⋯ menu on every row. That goes against "all there to see" and adds a tap to common tasks. Rows now show one main button, with the other ways in as small links on the same row. Only rarely used or destructive actions (Reset, Start again as new, Add to review without the lesson, History, Print) move, and they go to the skill page under **More**.
3. **The plan now counts taps (§4).** Over 14 common tasks, the first draft would have **added 10 taps**: this chapter's forms 2 → 5, the cheat sheet 2 → 6, one lesson part 3 → 4, a mixed game 3 → 4, a named skill 2 → 3. The revised plan is at or below today's count on every task, and it removes the long scrolls and the hunting through 88 rows. To get there it adds a **"This chapter" block on Today** (with a direct 🖨 Print sheet), a **Find box**, and a **▶ on every table type**.
4. **Things the audit missed are now in it and in the mapping:**
   - the chapter sets (Questions, Vocabulary, Pensa);
   - the synced setting that opens the next skill the way you opened the last one;
   - game mode's full-screen look and its ☰ "Go anywhere" menu;
   - the bulk actions (Add all / None, Start all as new, Reset all);
   - Print chart / Print sheet / Print charts;
   - Practise this chapter and the chapter's "Redo the N you missed";
   - re-tests, Resume, and the reading tie-in;
   - the chapter page's own "Word Work" and "Cheat sheet" buttons;
   - the reading Progress page, which also lists each chapter's grammar;
   - the two meanings of "part";
   - skill titles that open different pages on different lists;
   - the in-session bar (⇅ Too hard? Too easy?, ▦ Its table, ▶ Mixed game, the rule, ☰, Game mode);
   - the game's own "◂ Easier · Harder ▸" way-to-play ladder, which is a different thing from Too hard? Too easy? and needs a different name.
5. **A phone section with measurements (§1.3) and screen sketches (§3), phone and game mode included.** Today on a 375 px phone:
   - 7 tabs don't fit: Tables and Stats are scrolled out of sight;
   - the header hides the section you are in;
   - the lesson's "Start learning" is 7½ screens down;
   - Word Work's "This chapter" is about 50 screens long;
   - the table links are 16 px tall, below the 24 px minimum tap size.
6. **The Lesson / Game switch.** The draft said it is "remembered and synced". It is remembered **on each device**, not synced, so that is now a question for you (Q5). The switch moves from the site header to the end of Study's tab row, which leaves room on a phone. In game mode the header is covered, so the ✕ in the game bar is the switch and ☰ lists the same four tabs. The draft did not cover this.
7. **Course has two views, not three.** "By chapter" and "All (the path)" were the same list. There is also one proposal for **one chapter page** where the draft would have built a second one.
8. **New sections:** web addresses and Back (§7), saved data that must keep working (§8), accessibility (§9), risks (§11), and checks for each phase (§10).
9. **Phases reordered.** A "safety net" phase comes first, and the skill page comes early. It is the most-used screen and changes no navigation, so it is the safest first visible step. Phase 2 of the draft would have left pages unreachable or doubled up between releases; the interim state is now spelled out.

**Kept from the first draft, because it is right:** two sections and four tabs; one home per thing; colour by area; old links redirect; a small set of verbs for starting practice; the main button chosen by the skill's state; the "nothing is lost" mapping as the backbone; and asking you before each phase goes live.

---

## In short

| | Now | Proposed |
|---|---|---|
| Sections in the header | 4: Read · Grammar · Word Work · Sheets. On a phone only 3 show: the one you are in is hidden | **2: Read · Study**, both always visible |
| Tabs inside them | 11: Skills, Path, Chart, Practice, Paradigms, Tables, Stats · This chapter, Skill drills, Progressions, Any word & types. Sheets has none. On a phone, 7 tabs overflow | **4: Today · Course · Tables · Progress**, which fit at 320 px with the switch |
| Pages | 23 views in the Grammar code (one of them only redraws Skills), plus the reader's chapter page and the reading Progress page | **7 pages:** Today, Course, the skill page, the chapter page, Tables, the table page, Progress. The practice screens come on top of these |
| Buttons on one skill row | 7 to 9 (645 on the Skills page; 239 on Path) | **1 main button**; the other ways in as small links on the row; rare ones on the skill page under More |
| Names for starting one skill | about a dozen | **Learn · Part · Practise · Mix · Review · Across · Table**, each opening as a lesson or a game by one switch |
| Lesson or game | 3 controls, and on the Verbs/Nouns pages in game mode two of them on screen at once | **one switch** (in game mode, the ✕ in the game bar) |
| The three ways in | Progression: Path's area tabs or Word Work's Progressions. Chapter: 10 different by-chapter views. One skill: no search; hunt through 88 rows | **Course → By area**, **Course → By chapter** (and one chapter page), **Find** on Today and Course + the skill page's **Related** line |
| Same skill across conjugations | 5 different names, on some pages only | **"Across the conjugations (N)"** or **"Across the declensions (N)"** on every skill with tables, in lesson and game look |
| 14 common tasks (§4) | 35 taps, plus long scrolls and hunting | **32 taps**, no long scrolls, no hunting (the first draft: 45) |

Nothing is removed: §5 maps every current feature to its new place.

---

## 1. Audit: what there is now

### 1.1 The places

| Section | Tab / page | What it does |
|---|---|---|
| **Read** | Reader, Passage / Sentence | The readings. |
| | Weeks menu → **Today card** | The day's plan: Learn, Practice, Questions, Vocabulary, Read, each with Start; "Not today". |
| | Weeks menu → **Progress** (`#/progress`, also Settings → Progress) | All 34 chapters: reading done, **each chapter's grammar skills and their states**, time spent and time left. |
| | **Chapter page** (`#/chapter/7`, from the weeks menu's Chapters tab) | Reading / Grammar tabs, plus its own **"Word Work for Cap. N"** and **"Cheat sheet for Cap. N"** buttons. The Grammar tab shows the chapter's skill rows (the same up-to-9 buttons each), its chapter sets, Practise this chapter, Redo the N you missed, Add all / None, and the chapter's practice chart. |
| | Word popup | A word's table: Practise this table, ▶ Play, How it's made. No link into Grammar. |
| **Grammar** | **Skills**, By topic | Today plan, Resume, re-tests, "Review first · week N", category filter, Add all / None, Start all as new, Print charts, Reset all; then every skill and chapter set under its chapter, up to 9 buttons each. |
| | **Skills**, By chapter | The same rows folded by chapter, the reader's chapter open. |
| | **Path** (+ area tabs) | Every skill and table, easiest → hardest, by chapter; ▶ Climb the path. The area tabs (Verbs, Nouns, Adjectives & adverbs, Pronouns, Sentences & verb uses, Metre) each have their own "Open as Lesson mode / Game mode" switch, "Next to learn", and per row the tables as small links, "The lesson, part by part", 📖 Learn and ▶ Mixed game. |
| | **Chart** | What has been practised and what is still to do, by chapter; "Still to practise first". |
| | **Practice** | Build a mixed session: what to mix (6 presets, including Missed items), size (5, 10, 15, Open), a grid of chapters × kinds, "Include what you have not studied", Start / ▶ Play. |
| | **Paradigms** | Find a word, Random word, ▶ Play a random word, practise by type (29 types with word counts), the model words. |
| | **Tables** | The 65 tables (Nouns 20, Adjectives 9, Pronouns 16, Verbs 16, Numerals 4). A table page has: the word, filled in, one cell across words, narrow it, the whole table, "Given" level (auto, 80, 50, 20, off), its skill's drill and lesson. |
| | **Stats** | Totals, items, what you mix up, per skill (last 10); History per skill. |
| | Lesson page, Learn, Part, Drill, Unlimited, Mixed, Blocked, Session, Redo, Session over | The practice screens (§1.2). |
| **Word Work** | **This chapter** | The chapter's skills, then a card per word with its table to fill in (New + review / Only the new / Everything so far; 1–3 columns). |
| | **Skill drills** | The chapter's skills: ▶ Play, Whole table, Drill. |
| | **Progressions** | Path's area pages, but only the four about forms (no Sentences, no Metre). |
| | **Any word & types** | The Paradigms page under another name. |
| | Whole table (`wwtable`) | One skill's part of the table, word after word. |
| **Sheets** | Chapter sheet | Choose skills (this chapter's on by default; the choice is kept per chapter on this device), see each skill's rule and charts, Practise this table, ▶ Play, More examples, Print. |
| **Everywhere in game mode** | ☰ "Go anywhere" menu; game bar with ⇅ Too hard? Too easy? and ✕ Leave game mode | Game mode redraws every Grammar page full screen and covers the header and the tabs. ☰ is then the only way around: this skill (Learn as a game, its tables, its parts), Climb the path, and links to 9 pages of Grammar and Word Work. |
| **Inside any practice** | The session bar | ← · position · →; in game mode the score; ⇅ Too hard? Too easy?; ▦ Its table (the skill's part of every table it covers); ▶ Mixed game; the rule / How it's made; ☰; ▶ Game mode / ✕ Leave game mode. |
| **The reel game** (tables) | Its tool row and end screen | 📋 review, charts, the rule; **◂ Easier · ⚙ way to play · Harder ▸**, a ladder of *ways to play* (What is it? → Choose → Flash → Type it → Type it, shuffled); Shuffle, Redo misses, Move on when right, Timer, Sound. The end screen offers Next word, "Same again, harder", and What next? suggestions. |

### 1.2 The ways to practise, and what each really does

| What the learner wants | Buttons that do it today | What actually runs |
|---|---|---|
| Learn a new skill | Start learning · Start as new · Continue learning · Re-learn · ▶ Learn as a game · 📖 Learn (area pages) · ▶ Learn (Path) · Next to learn · Climb the path · Start all as new | Learn: the lesson part by part, then a check of ten. Passing puts the skill into review. Climb / Start all as new queue several skills in a row. |
| Practise one part of a lesson | "Practise one part of the lesson" (bottom of the lesson page) · "The lesson, part by part" (area rows) · the game's ☰ | Six checks on that part. Counted as ×N for the part. **Never moves the skill on.** |
| Practise one skill | **Practise this skill** (rows of skills in review, the lesson page, "Worth another look" after a session, and inside a session) | **Five** items built by the scheduler at the skill's level. A skill still in Learn is **sent to Learn** instead; a new or forgotten one joins review. |
| | **Just drill it** (rows, lesson page) · **Drill** (Skill drills) | **Ten** items, the skill's own sentences first, the rule pinned above each. A new skill joins review. While still in Learn, the answers count toward Learn's check. Sets up a **re-test 10 minutes later** and offers the reading tie-in. |
| | **Unlimited practice** | The same ten, then "Ten more" for as long as you like, nothing repeated early. |
| | **▶ Play** (rows, Skill drills, lesson page, Sheets) | On a skill **with tables**: its tables, every word, as a game, and the header **jumps to Word Work**. On a skill without tables: the ten, in game mode. |
| | **▶ Practise / ▶ Practise it** (Path) · path links, "What next?", Too hard? Too easy? | Opens the skill **the way you opened the last one** (its table game, the drill, unlimited, the lesson, part 1). This is kept in your synced settings (asked for on 2026-10-23). |
| Mix it with related skills | Mixed set · ▶ Play a mixed game · ▶ Mixed game | The skill on every other item, its look-alikes and the skills it builds on in between, ten at a time. |
| Review what is due | Today card / Today plan · Practice tab · Review first chips · Chart's "Still to practise first" · Add to mixed practice | The mixed session (10, due first). "Add to mixed practice" puts a skill into review without Learn. |
| Practise forms / tables | Tables · Paradigms · Any word & types · This chapter · Sheets · word popup · Play this whole chart · ▶ Practise the table (Path) · the small table links · one cell across words (one table's words) · practise by type | Boxes in the table, or the reel game. A table **game** never moves your review dates; a table practised from the Tables page moves its skill only if the skill is already in review. |
| **The same skill across conjugations / declensions** | ▦ Play its tables: every word (N) · ▶ all of them in one game · Practise its part of the table · Its tables (N) · Whole table (Word Work) · ▦ Its table (session bar) | One game: the skill's forms on one word of each table it covers (sum, possum, eō …; amō, moneō, regō, capiō, audiō; puella, servus, verbum …), every person and number. **Since v119** Practise (the ten) and each lesson part practised alone also go round the tables after their own words. |
| Find one skill | — | No search. Browse Skills (15 screens), Path (19) or a progression, or pick it from the Practice page's "One skill" list. |
| Fix mistakes | Redo the N you missed · Practise my misses · Play my misses · the Missed items preset | The missed items again, as ordinary items. |
| Chapter at once | Practise this chapter · Redo the N you missed (per chapter) · Add all / None (per chapter) | A mixed session drawn only from that chapter. |

### 1.3 On a phone (measured at 375 px wide)

| Page | Length | What is wrong |
|---|---|---|
| Header in Grammar | | Shows "Read · Words · Sheets": **the section you are in is hidden**. |
| Grammar's tab row | 7 tabs in 351 px | **Tables and Stats are scrolled out of sight**; nothing shows there is more. The CSS still says "five tabs fit". |
| Skills | 11,300 px (15 screens) | Each row is about 240 px tall: 7 to 9 buttons. |
| Path (Everything) | 14,300 px (19 screens) | 232 controls. |
| Verbs progression | 12,800 px (17 screens) | Rows 250 to 316 px tall. |
| A lesson page | 5,900 px (8 screens) | **"Start learning" sits at 5,550 px** and the parts list at 5,130 px: the main action is 7½ screens down. |
| Word Work · This chapter | 37,400 px (**50 screens**) | Every word's whole table, one after another. |
| Sheets | 18,000 px (24 screens) | |
| Small table links under a skill | 16 px tall | Below the 24 px minimum tap size. |

### 1.4 Problems found

1. **The same list in many places.** Skills are listed on 9 pages (Skills by topic, Skills by chapter, Path, the progressions, Chart, Skill drills, Sheets chips, Practice grid, Stats). There are 10 by-chapter views: Skills by topic (it is grouped by chapter too), Skills by chapter, Path, Chart, This chapter, Skill drills, Sheets, the chapter page's Grammar tab, the Practice grid, and the reading Progress page.
2. **Duplicate tabs.** Paradigms and Any word & types are one page under two names. Progressions is Path's area pages, minus Sentences and Metre.
3. **One action, many names, and some with hidden differences.** See §1.2. "Practise this skill" (five, scheduler-built, sends a learning skill back to Learn) and "Just drill it" (ten, own sentences, rule pinned, re-test) look the same to a learner but do different things to progress. "▶ Play" means "play its tables" on one skill and "the ten as a game" on another.
4. **Button overload.** 645 buttons on the Skills page. Rarely used ones sit on every row: Reset ×96, Start as new ×40, Add to mixed practice ×42, plus 52 "no sentences in the library yet?" labels.
5. **Progress is scattered:** Skills (state, the parts meter), Chart, Stats, History, Path (×N), the reading Progress page (each chapter's grammar again), the Today card, the chapter panel.
6. **Game mode three ways.** Game-named buttons, the in-session switch, and the progressions' Lesson/Game switch all set one choice, kept on this device only. On the Verbs/Nouns pages in game mode, the page's own switch and the game bar's ✕ sit on screen together. In game mode the tabs are covered and ☰ is a second, separate list of pages.
7. **The split follows the code, not the learner.** Skills with forms appear in both Grammar and Word Work. ▶ Play moves you from Grammar's header to Word Work's. Sheets is a third view of the same chapter. The chapter page has its own Word Work and Cheat sheet buttons as well.
8. **Coming back is uneven, though mostly fixed in v119.** A table opened from a list returns to it (v117). A lesson, part, drill, mixed set or redo opened from Path, a progression, the Chart, Word Work, Stats, Practice or Sheets now returns to that screen (v119). The Skills rows and the chapter panel still use their own older way back ("Skills" / "Cap. N"), and the game's ☰ keeps a third. There are still three rules for one job.
9. **Two tables experiences:** the Tables page (cells, narrow it, filled) and Paradigms (any word, by type) do overlapping jobs with different controls.
10. **"Part" means two things.** The meter's "0 of 6 parts" counts progress steps (lesson read, Learn passed, table, generated, in review, mastered). "Practise one part of the lesson" means a lesson's teaching parts. Both usually number six, and the learner has already read one as the other (contract §22.1).
11. **The same title opens different pages.** A skill's title opens the lesson page on Skills, Path and Chart, but opens Learn (the guided session) on the area pages and in the progression bar.
12. **Main actions sit at the bottom.** On the lesson page every way to start except the table game and the mixed game is below the whole lesson (§1.3).
13. **No way to find a skill by name.** "An isolated skill wanting to be practised" means scrolling a 15- to 19-screen list, or knowing its area and chapter. Tables have a word search; skills have none.
14. **"Across the conjugations" has no name of its own.** The one-game-over-every-table goes by five labels on different pages and is missing from others (the chapter page's rows, Sheets cards, Skill drills).
15. **Two "easier / harder" ladders share words.** ⇅ "Too hard? Too easy?" moves to another **skill**; the reel's ◂ Easier · Harder ▸ changes the **way to play** the same forms. Both are wanted. They need names that cannot be confused.

---

## 2. Principles

1. **Organise by what the learner wants**: *What do I do now?* · *Where am I in the course?* · *The forms* · *How am I doing?* One tab each.
2. **Three ways in, each first-class:** by progression, by chapter, by one skill (and its related skills). Each is at most one tap from Study's home, and all three lead to the same skill page and the same rows, so the app feels like one thing however you come in.
3. **One home per thing.** One skill page, one table page, one chapter page, one chart. Everything else links to it.
4. **The main actions are in sight; only rare ones fold away.** Each row has one main button (the next sensible step) and the other ways in as small links on the same row: the skill's tables, its parts, Practise, Mix. Rare or destructive actions (Reset, Start again as new, Add to review without the lesson, History, Print) live on the skill page under **More**, an expanding section, never in a pop-up menu on every row.
5. **Never more taps than today** for a common task (§4), and the main button always at the top of a page (and fixed at the bottom on a phone).
6. **Lesson or game is one switch.** Every start follows it, and the session's own switch still changes it mid-way. A page whose own job is to offer both (a table, the word popup) shows both.
7. **Back goes where you came from**, for every practice, not only tables.
8. **Colour by area** (verbs, nouns, adjectives, pronouns, sentences, metre) everywhere, always with its word tag, never colour alone.
9. **Old links keep working**: every old address redirects to its new home (§7).
10. **Nothing saved changes meaning** (§8): progress, answers, ×N counts and settings keep their names; new choices are added alongside.
11. **Phone first.** Every screen is checked at 320, 375 and 768 px before it ships.

---

## 3. The proposed structure

### 3.0 The three ways in, and "across the conjugations"

| Way in | Where | Taps from the reader | What you get |
|---|---|---|---|
| **By skill progression** (easiest → hardest) | Course → By area: Verbs · Nouns · Adjectives & adverbs · Pronouns · Sentences & verb uses · Metre. Also "Next on your path" on Today | 2 (Study → Course; it opens on your last area) | the area's skills and tables in order, ▶ Next to learn, ▶ Climb the path |
| **By chapter** | Course → By chapter; the chapter page (Reading · Grammar · Forms · Sheet); Today's "This chapter" | 1 to see it on Today (Study); 2 for Course → By chapter | the chapter's skills, tables, Questions · Vocabulary · Pensa, Practise this chapter, its forms, its sheet |
| **One skill, and its related skills** | **Find a skill or table** box at the top of Today and Course; any title anywhere opens the skill page | 2 + typing to start practising (Study → type "abl…" → ▶ Practise on the result) | the matching rows, and the skill page: Practise, Learn, parts, tables, and a **Related** line (what it builds on and its look-alikes) with **▶ Mix them** |
| **The same skill across conjugations / declensions** | **▦ Across the conjugations (N)** (or "the declensions", or "the irregular verbs" for sum, possum, eō …) on every skill row and skill page that has tables, the chapter page and the session bar | 1 more tap from any of the above | one game or table session: the skill's forms on one word of every table it covers, every person and number. Practise and parts also go round the tables after their own words (v119) |

All four lead to the **same row and the same skill page**, so it does not matter which way you came in.

### 3.1 The header and the one switch

```
Desktop
┌────────────────────────────────────────────────────────────────────┐
│ Week 4 · Rēs Rūsticae ▾              [ Read | Study ]          [Aa] │
├────────────────────────────────────────────────────────────────────┤
│  Today   Course   Tables   Progress              [📖 Lesson|▶ Game] │
└────────────────────────────────────────────────────────────────────┘

Phone (320–600 px)
┌──────────────────────────────────┐
│ Week 4 · Rēs… ▾   [Read|Study] Aa │   both sections always shown
│ Today  Course  Tables  Progress ▶ │   ▶ / 📖: one toggle showing the mode
└──────────────────────────────────┘

Game mode (any width): the game look covers the page
┌──────────────────────────────────┐
│ ☰   🎮 Game     ⇅ Too hard?   ✕  │   ✕ = back to lesson mode
└──────────────────────────────────┘
☰ opens: Today · Course · Tables · Progress · Read
         and, on a skill: its parts, its tables, Too hard? Too easy?
```

- The tabs and the ☰ list are built from **one list**, so they can never drift apart.
- The switch sits on Study's tab row, not in the site header: on a phone the header has no room left, and Read has no use for it.

### 3.2 Study → Today *(the home page)*

```
[ Find a skill or a table…  e.g. ablative, perfect, puella ]
Today                                         about 25 min if you do it all
┌──────────────────────────────────────────────────────────┐
│ ▶ Review 4 due skills · 10 items · about 5 min            │   the one big button
└──────────────────────────────────────────────────────────┘
In progress
  Practice session · 6 of 10 answered                   [Resume]
  Accusative: the object · lesson, part 3 of 6          [Continue]
  Re-test ready: Genitive (3 items)                     [Start]
  Learning in order: 3 to go, next Dative               [Next] · Stop
This chapter · Cap. XXVII · week 4
  ▌VERB ● Present subjunctive: forms          [Learn]
  ▌     ▦ Across the conjugations (5) · 1st · 2nd · 3rd · 3rd -iō · 4th
  ▌SENT ● Indirect command                     [Learn]
  Practise this chapter · Forms (Word Work) · Sheet · 🖨 Print sheet · Chapter page
This week's sets
  Questions · Cap. XXVII · 10 due                        [Start]
  Vocabulary · Cap. XXVII · first pass                   [Start]
Next on your path:  Verbs 12 of 35 · Imperfect: -bam    [Learn]
Review first: Person endings · 1st declension · …        (chips)
▸ Choose your own practice   (size, what to mix, chapters; today's Practice page)
Not today
```

- **Find** filters as you type and shows matching skills (by English name, Latin name, ending, e.g. "-bam") and tables (by name or model word) as ordinary rows, with their buttons. Enter opens the first one's page.
- **The big button**, in this order (Q4): due reviews → the lesson or session in progress → this week's new skill → the next skill on your path.
- **In progress** gathers what today is scattered over Skills: Resume, re-tests, the Learn-in-order run.
- **This chapter** is the chapter you are reading. It shows its new skills and tables with their main buttons, so this chapter's forms are 2 taps away (Word Work's job today), and links to the chapter's Forms, Sheet and page. **🖨 Print sheet** opens the chapter's sheet with your saved choices and the print dialog at once.
- **This week's sets** are the Questions and Vocabulary lines of today's plan, as now.
- **Choose your own practice** opens today's Practice page in place, with every option it has now (presets including Missed items, size, the chapter grid, "Include what you have not studied", Start / ▶).
- The weeks menu keeps its Today card, and its Start buttons open the same things.
- On a phone, the same order, one column; the big button stays at the top.

### 3.3 Study → Course *(where am I, what's next)*

- The **Find a skill or a table** box sits at the top, as on Today.
- A switch under it: **By area** (Verbs 35 · Nouns 23 · Adjectives & adverbs 5 · Pronouns 4 · Sentences & verb uses 19 · Metre 2, each easiest → hardest, with its tables where their first forms are taught) | **By chapter** (the path: chapter by chapter, easiest first in each, tables included, each chapter's Questions · Vocabulary · Pensa under it). The view and the area are remembered.
- At the top of an area: **▶ Next to learn: …** and ▶ Climb the path.
- At the bottom, folded, **Manage**: Add all / None to review (for the area or chapter), Learn all in order, Print charts, Reset all.

```
A skill row, desktop
│▌ 12  VERB ● Present tense: person endings     ×3 · 2 days ago  [▶ Practise] │
│▌     Learn · Mix · Parts 1 2 3 4 5 6                                       │
│▌     ▦ Across the conjugations (5) · 1st · 2nd · 3rd · 3rd -iō · 4th       │

A skill row, phone (about 170 px tall; today 240–316)
│▌ 12 VERB ● Present tense:         │
│▌    person endings · ×3 · 2d ago  │
│▌ [ ▶ Practise                   ] │
│▌ Learn · Mix · Parts 1 2 3 4 5 6  │
│▌ ▦ Across the conjugations (5)    │
│▌ 1st · 2nd · 3rd · 3rd -iō · 4th  │

A table row
│▌ ▦ The table: 1st declension · īnsula · ×2            [▶ Practise] │

A chapter-set row (By chapter only)
│  Vocabulary · Cap. XXVII · 42 words · due today            [Review] │
```

- **The title** always opens the skill page (it does not open Learn on some lists and the lesson page on others).
- **The main button** follows the skill's state (§6). The other verbs are small links beside it; the one already in the button is not repeated.
- **Parts 1–6** each open that part on its own. The numbers need each lesson's part titles in the skill list, built when the data is built, so the page does not load 89 lessons (700 KB).
- **▦ Across the conjugations (N)** plays the skill's forms on one word of every table it covers, in one game (today's "Play its tables: every word"). The table names after it each open that one table's practice, and come back to the row. The wording follows the area: conjugations for verbs, declensions for nouns and adjectives, "the pronouns" for pronouns; where a skill has one table only, the line reads "▦ Its table".
- **Every small link is at least 24 px tall**, with space between links.
- **Too hard? Too easy?** is on the skill page and in the game bar, as now.

### 3.4 The skill page *(one per skill; replaces the lesson page)*

```
← Verbs progression                                   (wherever you came from)
VERB  Verbs · 12 of 35 · ← Present: he/they · Imperfect → · whole chart
Present tense: person endings
● in review, due in 3 days ⓘ   progress 3 of 6 ⓘ   ×3
[ ▶ Practise ]   Learn · Mix · ▦ Across the conjugations (5) · ⇅ Too hard? Too easy?
Parts     1 The endings ×2 · 2 … · 3 … · 4 … · 5 … · 6 …
Tables    1st conj · 2nd conj · 3rd conj · 3rd -iō · 4th   (each opens that table's practice)
Related   builds on: Present: he/they · looks like: Imperfect: -bam   [▶ Mix them]
          (Mix: this skill with these, ten at a time; what builds on it is under Too easy?)
── The lesson ──   rule · what it applies to · How it works · How it's made (?)
                   active first, the passive below it
── What next? ──   Next in Verbs · the verbs table · Builds on · Related · Also in Cap. III
▸ More   Ten more (keep going) · Add to review without the lesson · Start again as new
         · History · Print chart · Print sheet · Reset…
```

- **Phone:** the same order. The main button and the 📖/▶ toggle sit in a bar fixed to the bottom of the screen while the lesson scrolls, so the main action is never 7 screens away.
- **Related** is the "isolated skill and its related skills" way in. It names exactly the skills Mix draws on: up to four look-alikes and skills it builds on, none beyond your chapter (today's mixed set). Each is a link to its own page, and **▶ Mix them** starts the mixed set at once. The skills that build *on* it are under ⇅ Too easy? and What next?.
- **Inside any practice**, the session bar keeps ⇅ Too hard? Too easy?, ▦ Across the conjugations (today's "Its table"), ▶ Mixed game, the rule, and ☰. It also gains a small "← this skill" link to the skill page.
- **Progress, not "parts".** The meter is called **progress** ("3 of 6"), so "part" only ever means a part of the lesson.
- **Chapter sets** (Questions, Vocabulary, Pensa) get the same page shape, without parts or tables.

### 3.5 The chapter page *(one page; Q3)*

```
← All chapters                      Cap. XXVII · Rēs Rūsticae · weeks 3 and 4
[ Reading | Grammar | Forms | Sheet ]
Grammar  the chapter's skill rows (as in Course) · its Questions · Vocabulary · Pensa
         [Practise this chapter]  Redo the 3 you missed · Add all / None
         the chapter's practice chart · the whole chart →
Forms    (Word Work's This chapter) New + review | Only the new | Everything so far
         the chapter's skills, then a card per word with its table to fill in
         (on a phone: 10 cards, then "More words", not 50 screens at once)
Sheet    choose skills (this chapter's on) · charts · ▶ Play · [Print]
```

- It is reached from Read (the Chapters menu) and from Study (Course by chapter, and Today's This chapter), and the address is the same.
- It is feasible: the reader's chapter page already hosts the grammar side's chapter panel in its Grammar tab. Forms and Sheet are two more panels, filled the same way.
- It replaces: the chapter page's two extra buttons, Word Work's This chapter and Skill drills, Sheets, and Skills by chapter's open chapter.

### 3.6 Study → Tables *(the forms)*

```
Find a word [ search…            ]  Random · ▶ random game
By type
  Verbs      1st conj · amō · 304 words  [▶]   2nd conj · moneō · 107  [▶]   …
  Nouns      1st decl · puella · 231     [▶]   …
  Adjectives · Pronouns · Numerals …
In this chapter   the tables Cap. XXVII teaches, each [▶]
```

- **The table page** keeps everything it has now: the filled table, practise in the table, ▶ play as a game, Play this whole chart, one cell across words, narrow it, "Given" level, How it's made on every cell, both voices, its skills and lesson. Here both Practise and ▶ Play show, because the page's job is the table itself.
- The word popup keeps its table, practise and play, and gains a new **"More"** link to this page.
- It replaces: Tables, Paradigms, Any word & types, Whole table, and Sheets' tables.

### 3.7 Study → Progress

```
[ Practice chart | Stats | Reading ]
Practice chart   By area | By chapter · Still to do first (N) · each skill ×N, when, what is left
Stats            totals · items · what you mix up · per skill (last 10)
Reading          the 34 chapters: read, time spent, time left (Q9)
```

- **History** of a skill opens from its skill page (More) and from Stats.
- It replaces: Chart, Stats, and the parts meters' detail. The reading Progress page appears here or stays where it is, per Q9.

### 3.8 The end of every practice *(one shape)*

```
Session over · 8 of 10 right (80%) · 3 min
[Redo the 2 you missed]  [Ten more]  [Next: Imperfect →]  ← Back to Verbs progression
Worth another look: … · Re-test in 10 minutes · See it in your reading
What next?  Next in Verbs · its table · builds on · related · also in this chapter
```

- The game's own end screen keeps what it has: Same again harder, ◂ Easier · Harder ▸, its suggestions, and Next part / Again / Back to the lesson after a part.
- **Two ladders, two names.** The reel's ◂ ▸ change *how you play the same forms*: "◂ Easier way to play · Harder way to play ▸" (the label it already shows on hover). ⇅ changes *which skill*: "⇅ Easier skill? Harder skill?", or keep "Too hard? Too easy?", which already says "skill" in its panel. Both stay, in lesson and game look.

---

## 4. Taps for common tasks

Counted from the reader, with the grammar side not yet opened in this visit and game mode already chosen once. Each tap on a tab, button or link counts one; scrolling to a row is not counted, but long scrolls are noted.

| # | Task | Now | First draft | This plan |
|---|---|---|---|---|
| 1 | Do what is suggested today | 2 (Grammar → Start) | 2 | 2 (Study → big button) |
| 2 | Review what is due | 2 (Grammar → Start on "Practice"); 3 via the Practice tab | 2 | 2 |
| 3 | Learn the next verb skill, easiest first, as a game | 4 (Grammar → Path → Verbs → Next to learn) | 4 | 3 (Study → Course, opens on Verbs → Next to learn) |
| 4 | Practise part 3 of a lesson | 3 + a **7-screen scroll** (Grammar → title → part); 5 via a progression | 4 (Course → ⋯ → part) | 3 (Study → Course → "3" on the row) |
| 5 | Play all of a skill's tables in one game, from its progression | 3 (Grammar → Path → ▶ all) | 3 | 3 (Study → Course → ▦ Across) |
| 6 | Practise the table of a word met in the reading | 2 (word → Practise this table) | 2 | 2 |
| 7 | Practise a named table (1st declension) | 4 (Grammar → Tables → Open → ▶); on a phone the Tables tab must be scrolled to first | 4 | 3 (Study → Tables → ▶ on its row) |
| 8 | Play this chapter's new forms | 2 (Word Work → ▶) | **5** (Study → Course → By chapter → Cap. → ▶) | 2 (Study → ▶ in "This chapter") |
| 9 | Print this chapter's cheat sheet | 2 (Sheets → Print) | **6** (… → chapter → Sheet → Print) | 2 (Study → 🖨 Print sheet in "This chapter") |
| 10 | A mixed game for a skill | 3 (Grammar → Path → ▶ Mixed game) | 4 (Course → ⋯ → Mix) | 3 (Study → Course → Mix) |
| 11 | See what is practised and what is left | 2 (Grammar → Chart) | 2 | 2 |
| 12 | Go on to the next skill after a game | 1 | 1 | 1 |
| 13 | Practise one skill you have in mind (e.g. the ablative absolute), then with its related skills | 2 + hunting in a 15-screen list (Grammar → Just drill it); Mixed set the same | **3** + hunting (Course → main button); Mix 4 | 2 + typing (Study → Find "abl…" → ▶ Practise on the result); Mix the same |
| 14 | Practise that skill across all its conjugations or declensions | 3 + hunting (Grammar → Path → ▶ all, or title → Play its tables: every word) | 3 + hunting | 2 + typing (Study → Find → ▦ Across) |
| | **Total** | **35**, plus long scrolls and hunting | **45** | **32**, no long scrolls, no hunting |

Honest reading: today's clutter is also a set of shortcuts, so the big gain here is in scrolling, hunting, choosing and finding things, not in raw taps. What matters is that **no task gets slower**, and that each of the three ways in (tasks 3, 8 and 13) and "across the conjugations" (task 14) takes 3 taps or fewer. Every phase's checks (§10) re-count these 14 tasks.

---

## 5. Where everything goes (nothing is lost)

| Now | Proposed home |
|---|---|
| Grammar → Skills, by topic / by chapter | Course (By area / By chapter). The topic filter becomes the area tabs; "Chapter sets" sit under each chapter |
| Today plan, Resume, re-tests, Learn-in-order run, Review first | Today |
| Add all / None, Start all as new, Print charts, Reset all | Course → Manage (folded); Add all / None per chapter on the chapter page |
| Grammar → Path, area tabs; Word Work → Progressions | Course (By chapter / By area) |
| Climb the path, Next to learn | Course (top of each area); Today's "Next on your path" |
| Grammar → Chart | Progress → Practice chart; its "Still to practise first" also on Today |
| Grammar → Practice (session builder, presets incl. Missed items, size, grid, unstudied) | Today → "Choose your own practice" |
| Grammar → Paradigms; Word Work → Any word & types | Tables → Find a word / By type |
| Grammar → Tables (catalogue, table page, Given level) | Tables → By type; the table page |
| Grammar → Stats, History | Progress; History also on the skill page |
| Lesson page | The skill page |
| Learn (guided), Part | Unchanged practice screens, started from the skill page, Course rows and Today |
| Just drill it, Drill | **Practise** (the ten) |
| Unlimited practice | "Ten more" at the end of Practise (continues the same run, so nothing repeats early) |
| Practise this skill (the five) | **Review** on a due skill; unchanged inside a session ("Practise this skill" there still returns to your place) and on "Worth another look" |
| Mixed set, ▶ Play a mixed game, ▶ Mixed game | **Mix** |
| Redo misses, Practise / Play my misses, Missed items | Unchanged: session ends, the skill page, the chapter page, Choose your own practice |
| Practise this chapter | Chapter page → Grammar; Today's This chapter |
| Add to mixed practice, Start as new, Reset, History, Print chart, Print sheet | The skill page → More |
| Learn as a game, ▶ Play (game-named copies), the progressions' "Open as" switch | The one Lesson / Game switch (+ the session's own) |
| ▦ Its tables (N), Play its tables: every word, ▶ all of them in one game, Practise its part of the table, the session bar's ▦ Its table | **▦ Across the conjugations (N)** (or declensions), the same everywhere: Course rows, the skill page, the chapter page, Today's This chapter, the session bar |
| ▶ Practise the table (Path), the small table links | Table names after "Across …" on each row (each opens that table's practice and comes back); table rows in Course |
| Play this whole chart | Stays on every chart |
| Word Work → This chapter | Chapter page → Forms; Today's This chapter |
| Word Work → Skill drills | Chapter page → Grammar (the same rows) |
| Word Work → Whole table | ▦ Across the conjugations (the same game) |
| Sheets | Chapter page → Sheet (choices kept per chapter, Print) |
| Chapter page: Grammar tab, "Word Work for Cap. N", "Cheat sheet for Cap. N" | The one chapter page's Grammar, Forms and Sheet tabs |
| Weeks menu Today card | Kept; its buttons open the same things |
| Weeks menu / Settings → Progress (reading) | Kept, and linked from Study → Progress (Q9) |
| Word popup table, Practise, Play, How it's made | Kept; a new "More" opens the table page |
| Game ☰ "Go anywhere" | Kept; lists the four tabs + Read, and this skill's parts and tables |
| The session bar (← · →, score, ⇅, ▦ Its table, ▶ Mixed game, the rule, ☰, Game mode) | Kept; ▦ renamed "Across …"; a "← this skill" link added |
| (new) Finding a skill by name | **Find a skill or a table** on Today and Course |
| (new) A skill with its related skills | The skill page's **Related** line + ▶ Mix them |
| Too hard? Too easy? (another skill), What next?, ◂ Easier · Harder ▸ (another way to play), Same again harder | Kept: skill page, game bar, session bar, ends of practice; the two ladders named apart (§3.8) |
| The way the next skill opens (kept from the last one) | Kept (Q6) |
| How it works, How it's made, both voices, active-then-passive order, area colours, ×N | Kept everywhere |
| Hint setting, show all meanings, the game's own options (Type / Choose, Shuffle, Redo misses, Move on when right, Timer, Sound) | Unchanged, inside practice and games |

---

## 6. Practice in a few plain verbs

| Verb | What it starts (what runs today) | Lesson look | Game look |
|---|---|---|---|
| **Learn** | the lesson, part by part, then its check of ten | the lesson pages | the lesson as a game |
| **Part n** | one part of the lesson on its own, six checks | items | game mode |
| **Practise** | ten on this skill alone, its own sentences first, the rule pinned; chart questions go round the conjugations / declensions (v119); "Ten more" after (today's Just drill it + Unlimited) | items | game mode |
| **Mix** | the skill with the ones it is confused with and builds on, ten at a time | items | game mode |
| **Review** | on a row: that skill's due five at its level (today's Practise this skill). On Today: the due session across skills, or one you choose | items | game mode |
| **Across** the conjugations / declensions | the skill's forms on one word of every table it covers, every person and number (today's Play its tables: every word / Whole table) | boxes, word after word (today's Whole table) | the reel game |
| **Table** | one table: fill it in, or one cell across its words (Tables page, word popup, a table link) | boxes in the table | the reel game |

**The main button on a row**, by the skill's state:

| State | Main button |
|---|---|
| new | Learn |
| learning (lesson begun) | Continue |
| forgotten (lapsed) | Re-learn |
| due for review | Review |
| in review, not due; mastered | Practise |
| nothing to drill yet (e.g. metre) | Read the lesson |
| a new Questions / Vocabulary set | Start (first pass); Pensa: Practise |

**What each start does to your progress.** This is unchanged by the plan, and every phase must keep it so:

| Start | Counts ×N for | Moves the skill on / changes when reviews fall due? |
|---|---|---|
| Learn | the skill, and each part reached | Yes: passing the check puts it into review |
| Part n | that part | **No**: a part never moves the skill on |
| Practise | the skill | Yes; a new or forgotten skill joins review now. While still in Learn, the answers count toward Learn's check instead. Sets up the 10-minute re-test |
| Mix | each skill in it | Yes for skills in review; skills still in Learn are left as they are |
| Review | each skill | Yes |
| Across, Table | the table(s), and the skill's table progress | A game: **no**. A table practised from the Tables page: only if its skill is already in review |
| Redo misses | each skill | Yes |

---

## 7. Addresses and Back

The addresses keep the word `grammar` (`#/grammar/…`). Renaming them to "study" would break more than it shows (Q1 is only about the word on the screen).

| Old address | Goes to |
|---|---|
| `#/grammar` (Skills) | Today |
| `#/grammar/map?category=…` | Course → By area (the matching area) |
| `#/grammar/map?chapter=N` | The chapter page, Grammar tab |
| `#/grammar/path` | Course → By chapter |
| `#/grammar/path?area=A&at=X`, `#/grammar/wwpath?area=A` | Course → By area A, scrolled to X |
| `#/grammar/lesson?skill=X` | The skill page for X |
| `#/grammar/chart` (`?chapter=N`) | Progress → Practice chart (that chapter) |
| `#/grammar/stats` | Progress → Stats |
| `#/grammar/history?skill=X` | Unchanged |
| `#/grammar/setup` | Today, with "Choose your own practice" open |
| `#/grammar/paradigms` (`?word=…`), `#/paradigms` | Tables (that word) |
| `#/grammar/catalogue` | Tables |
| `#/grammar/catalogue?table=T` | The table page for T |
| `#/grammar/wordwork?chapter=N`, `#/words`, `#/words/N` | The chapter page, Forms tab (the reader's chapter when none) |
| `#/grammar/wwdrills?chapter=N` | The chapter page, Grammar tab |
| `#/grammar/wwtable?chapter=N&skill=X` | ▦ Across for skill X (boxes, or the game when the old link asked to play) |
| `#/grammar/sheets?chapter=N`, `#/sheets`, `#/sheets/N` | The chapter page, Sheet tab |
| `#/grammar/blocked?skill=X` | Review of X (unchanged five) |
| `#/grammar/learn`, `part`, `drill`, `unlimited`, `mixed`, `session`, `redo` | Unchanged |
| `#/chapter/N`, `#/chapter/N/grammar` | Unchanged (plus `/forms`, `/sheet`) |
| `#/progress`, `#/progress/N` | Unchanged (Q9) |

**Also redirected, not only addresses:**

- the "come back to" place stored inside old addresses (e.g. back to Progressions, back to Skill drills · Cap. N);
- Back across the update (history entries marked Word Work or Sheets open in Study);
- a device that last had Word Work or Sheets open, which now opens Study;
- the synced "Skills view" choice: by topic is read as By area, by chapter as By chapter.

**Back:**

- Every start carries where it came from, and its end screen says "← <that place>".
- The browser's Back from an end screen goes to the page before the practice, not into it again.
- A session in progress still resumes, as now.

---

## 8. What must keep working

| What | Where it lives | Rule |
|---|---|---|
| Each skill's progress: state, level, due date, where you are in Learn | synced | unchanged |
| Every answer, with its notes (which part, a game, which table, the "given" level, generated, uncounted) | synced | unchanged: the ×N counts, the chart and History are read from these notes, so their names must not change |
| What you mix up; pensa | synced | unchanged |
| Grammar settings: mix preset, size, one skill, Skills view, hints, what to mix, include unstudied, how the next skill opens | synced | kept as they are; new choices (Course view, last area) added beside them, never renamed |
| "Not today" for the plan | synced | unchanged |
| Session in progress, Learn-in-order run, re-tests due, Learn places cache, table "Given" levels, game options, Lesson/Game, sheet choices, Word Work columns, this device's own ×N | this device | unchanged; nothing is wiped by the update |
| Reset / Reset all | synced | still asks first. Note: Reset also deletes the skill's answers, so its ×N and chart history go back to zero on every device |

---

## 9. Accessibility

- **Tabs and pages.** The four tabs are page links with the current one marked for screen readers. Each page change moves focus to its title, as now.
- **The switch** is one labelled control ("Game mode, on" / "off"). In game mode the ✕ is labelled "Back to lesson mode".
- **Expanders.** The ☰ menu, "More" and "Manage" open and close with the keyboard, Escape closes them, and focus returns to the opener.
- **Find** has a visible label, announces how many skills and tables match as you type, and works with or without macrons ("ablativus" finds *ablātīvus*).
- **Tap size.** Every small link and part number is at least 24 × 24 px with space around it; the main buttons stay 44 px tall. Today's table links are 16 px tall.
- **Colour** is never alone: each area keeps its word tag (Verb, Noun …), and states keep their dot and words.
- **Phone header** names the section you are in.
- **Reduced motion** is respected, as now.
- **Checked each phase:** a keyboard-only walk (Today → Course → a skill → Practise → end → Back), screen-reader names of the tabs and the switch, tap sizes at 375 px, and no page wider than the screen at 320 px.

---

## 10. Phases

Each phase ships on its own, after you have tried it on your phone. Each one also:

- passes every test (`node --test tests/*.test.mjs`);
- bumps the service worker version and its file list (the cached app on your devices updates cleanly);
- re-counts the 14 tasks in §4;
- runs the accessibility checks in §9.

| # | Phase | What changes for you | Size |
|---|---|---|---|
| 0 | **Safety net** | Nothing visible. A list of every page and old address, and a check that each still opens. "Before" screenshots of every page at 320 / 375 / 768 px. Tests that pin what every start runs and what it does to progress (§6). | small |
| 1 | **Plumbing** | Nothing visible. One table of old → new addresses (old names still work); one "come back to where you started" for every start; one rule for the main button; one list for the tabs and the ☰ menu; game mode read from one place. | small–medium |
| 2 | **The skill page** | One page per skill: main button on top (fixed at the bottom on a phone), parts, tables, **▦ Across the conjugations**, **Related + ▶ Mix them**, What next?, More. The lesson page's address goes there. The parts meter is renamed "progress". | medium |
| 3 | **Study and Course** | The header becomes Read · Study, with tabs Today · Course · Tables · Progress. Course's rows (with ▦ Across on each) replace Skills, Path and Progressions. **Find a skill or a table** at the top of Course and of Today. The Word Work and Sheets buttons go (their pages stay reachable, below). The progressions' "Open as" switch goes. Old addresses redirect. | large |
| 4 | **One chapter page** | Reading · Grammar · Forms · Sheet; This chapter, Skill drills, Sheets and the chapter panel fold in. | medium |
| 5 | **Tables** | Paradigms, Any word & types, Tables and Whole table become one Tables tab (with ▶ on each type) and one table page; the word popup gains "More". | medium |
| 6 | **Today and Progress** | The Today home (big button, In progress, This chapter, sets, Choose your own practice); Chart + Stats + History (+ Reading, Q9) as Progress. | medium |
| 7 | **Tidy up** | Game-named duplicate buttons go; old pages are removed (their addresses keep redirecting for good); the grammar contract and help texts are updated. | small |

**Between phases 3 and 6 nothing may go missing.** Until a tab's new page arrives, it shows today's pages under a small second row:

| Tab | In phases 3–5 it shows |
|---|---|
| Today | today's Today plan, Resume, re-tests, Review first (the top of Skills), and the Practice page under "Choose your own practice" |
| Course | the new rows, plus "This chapter" (Word Work) and "Sheet" links until phase 4 |
| Tables | Tables · Any word & types, until phase 5 |
| Progress | Practice chart · Stats, until phase 6 |

**Checks before each phase goes live:**

| Phase | It is done when… |
|---|---|
| 0 | Every address in §7 opens a page today (recorded); the §6 progress table is covered by tests; the "before" screenshots exist. |
| 1 | No visible change (screenshots match); every old address still lands exactly where it did; no saved key renamed (§8); a session in progress survives the update. |
| 2 | Every action of the old lesson page is on the skill page (checklist from §5); the main button is above the lesson, and at 375 px it is on the first screen; Back returns to where the page was opened from; part ×N counts unchanged; Related lists exactly the skills Mix draws on; ▦ Across starts the same game as today's "Play its tables: every word", in both looks. |
| 3 | Every page of today is reachable in no more taps than in §4's "This plan" column; the three ways in and Across (tasks 3, 8, 13, 14) take 3 taps or fewer; Find finds every skill by its English name, its Latin name or an ending, and every table by name or model word; tabs + switch fit at 320 px with no sideways scroll; a skill row is about 180 px tall or less at 375 px; every Course link is ≥ 24 px tall; each §7 address and old bookmark lands right; Back works across the change; ☰ in game mode lists the same four tabs; nothing on screen offers two game switches. |
| 4 | The reader's Chapters menu and Course both open the same chapter page; Forms shows no more than 10 word cards before "More words"; sheet choices and Print still work; Word Work / Sheets addresses land on the right tab. |
| 5 | Tasks 6 and 7 in §4 hit their counts; "Given" levels per table survive; table ×N counts unchanged; Play this whole chart still on every chart. |
| 6 | Tasks 1, 2, 8, 9 and 11 in §4 hit their counts; Today's suggestions match today's plan logic (its tests extended); the weeks menu's Today card opens the same things; "Not today" still syncs. |
| 7 | No game-named duplicates remain; every §7 address still redirects; the contract describes the new navigation. |

If phase 3 is too big to check in one go, ship the header and tabs first with Course showing today's Path pages, then the new rows a few days later.

---

## 11. Risks

| Risk | What could go wrong | How the plan guards against it |
|---|---|---|
| Changing what a start does | Merging buttons changes which skills move into review, or skips Learn's check | The verbs call exactly today's practice builders (§6); phase 0 pins their effects with tests |
| Broken links and Back | Bookmarks, links opened in a new tab, the back button after the update, the "come back to" place inside old links | One redirect table (§7) with a test per old page name; a browser check of every old address in phases 0, 1 and 3 |
| Lost settings or counts | A renamed key resets choices or ×N on every device | Nothing saved is renamed (§8); new choices sit beside old ones |
| A session in progress during the update | Resume breaks | The resume path is untouched; checked in phase 1 |
| The cached app | A device runs half old, half new files | Service worker version bumped every phase; new files added to its list (a test checks this) |
| Phone layout | Four tabs + switch overflow at 320 px; rows grow back | Screenshots at 320 / 375 / 768 px every phase; size limits in §10 |
| Slow pages | Showing parts on every row loads 89 lessons | Part titles built into the skill list; lessons still load only when opened |
| Find misses things | Typing without macrons, an ending ("-bam"), or the English name finds nothing | Find matches English and Latin names, endings and table names, ignoring macrons and case; a test lists a search for every skill |
| Two lists of pages | The tabs and the game's ☰ drift apart | Both built from one list (phase 1) |
| Two chapter pages | If Q3 is left open, the build makes a second one | Q3 decided before phase 4 |
| Today feels different | The big button's order changes what you are nudged to do | Q4 decided before phase 6; the order is one short rule |
| "Small links" become clutter again | Rows slowly gain buttons | The rule: one main button per row; anything new goes on the skill page |
| The written contract goes stale | GRAMMAR-CONTRACT.md describes pages that no longer exist | A new navigation section in phase 7; superseded sections marked |

---

## 12. Questions for you

1. **Name**: *Study*, or keep *Grammar* as the one section (with Word Work and Sheets folded into it)? (The addresses keep "grammar" either way.)
2. **Course's first view**: by area (verbs, nouns …), or by chapter? *Suggested: by area, then whichever you used last.*
3. **One chapter page**: the reader's chapter page gains Grammar, Forms and Sheet tabs, and Study opens the same page. Or keep two? *Suggested: one.*
4. **Today's big button order**: due reviews first, or this week's new skill first (as the Today card does now)? And should "next new skill" come from the reading week or from your easiest-to-hardest path? *Suggested: due reviews → what is in progress → this week's new skill → next on the path, with the path's next skill always listed too.*
5. **Lesson / Game**: the same on every device (synced), or per device as now (e.g. game on the phone, lessons on the laptop)? *Suggested: per device.*
6. **How the next skill opens**: today a "next" link opens the next skill the way you opened the last one (its table game, the drill, the lesson …), as you asked on 2026-10-23. Keep that for the "next" links, with rows' main buttons following the skill's state? *Suggested: yes, and the skill page says "next skills open as: table game", changeable there.*
7. **Lesson parts on every Course row** as numbers (1 2 3 4 5 6), or behind a "Parts ▸" that expands? *Suggested: numbers, so one part is 3 taps from anywhere.*
8. **Reset, Start again as new, Add to review without the lesson, History, Print**: fine under "More" on the skill page? (Reset still asks first, and it also clears that skill's ×N on every device.)
9. **Reading progress** (the Progress page): move into Study → Progress, or leave it in Read with a link from Study? *Suggested: leave it, link it both ways.*
10. **Naming "across"**: "▦ Across the conjugations (5)" / "Across the declensions (4)", or something shorter such as "▦ Every conjugation" or "▦ All its tables"? *Suggested: "Across the conjugations / declensions", since it says what you asked for.*
11. **Phase order**: as in §10 (safety net → plumbing → skill page → Study and Course → chapter page → Tables → Today and Progress → tidy up)? Or Study and Course first, because the header and tabs are the most visible mess?
