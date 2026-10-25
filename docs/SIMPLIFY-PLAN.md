# Simplifying the app: audit and plan

*2026-10-25. Written after v118. Goal: one simple place for grammar and forms in place of Grammar, Word Work and Sheets, keeping every feature, game mode and the newer options (progressions, tables games, mixed games, both voices, how-it's-made).*

## In short

| | Now | Proposed |
|---|---|---|
| Sections in the header | 4: Read · Grammar · Word Work · Sheets | **2: Read · Study** |
| Tabs inside them | 12: Skills, Path, Chart, Practice, Paradigms, Tables, Stats · This chapter, Skill drills, Progressions, Any word & types · (Sheets) | **4: Today · Course · Tables · Progress** |
| Pages (views) | 26 | about 12 |
| Buttons on the Skills page | 645 (Reset ×96, Lesson ×88, Play ×74, Add to mixed practice ×42, Start as new ×40, Learn as a game ×34, Just drill it ×34 …) | about 180: one main button per skill, the rest in its menu |
| Ways to start practising one skill | about a dozen differently named buttons | **5 verbs: Learn · Practise · Mix · Review · Tables**, each shown as a lesson or a game by one switch |
| Lesson or game | three separate controls: "Learn as a game" / "▶ Play" buttons, the session's "Game mode" switch, the progressions' Lesson/Game switch | **one switch** in the Study header (the session's own switch stays) |

Nothing is removed: section 4 maps every current feature to its new place.

---

## 1. Audit: what there is now

### 1.1 The places

| Section | Tab / page | What it does |
|---|---|---|
| **Read** | Reader, Passage / Sentence | The readings. |
| | Weeks menu → Today card | The day's plan (due reviews, next lesson). |
| | Progress page (`#/progress`) | Reading pace and time per chapter. |
| | Chapter page → Reading / **Grammar** tab | The chapter's skills, with Play / Learn (its own panel). |
| | Word popup | A word's table: Practise this table, ▶ Play, How it's made. |
| **Grammar** | **Skills** (By topic / By chapter) | Every skill with up to 9 buttons each; Today and Review first at the top. |
| | **Path** (+ area tabs) | Every skill and table easiest → hardest; Verbs, Nouns … progressions. |
| | **Chart** | What has been practised and what is still to do, by chapter. |
| | **Practice** | Build a mixed session: size, skills, chapter sets, chapters. |
| | **Paradigms** | Any word's table; practise by type; model words. |
| | **Tables** | The 65 paradigm tables; a table page with filled table, one cell across words, whole table, narrow it. |
| | **Stats** | Totals, items, mix-ups, per skill; History per skill. |
| | Lesson page, Learn, Part, Drill, Blocked, Unlimited, Mixed, Redo, Summary | The practice sessions (§1.2). |
| **Word Work** | **This chapter** | The chapter's tables (New / Review), each practisable and playable. |
| | **Skill drills** | The chapter's skills: Play, Whole table, Drill. |
| | **Progressions** | The same page as Path's area tabs. |
| | **Any word & types** | The same page as Grammar → Paradigms. |
| | Whole table (`wwtable`) | One skill's part of the table, word after word. |
| **Sheets** | Chapter sheet | Choose skills, see their tables and rules, Practise this table, ▶ Play, Print. |

### 1.2 The ways to practise

| What the learner wants | Buttons that do it today (different names, different places) |
|---|---|
| Learn a new skill | Start learning · Lesson · ▶ Learn · ▶ Learn as a game · Learn (path) · Next to learn · Climb the path · one part of the lesson |
| Practise one skill | Practise this skill (the ten) · Just drill it · Drill · Unlimited practice · ▶ Play · ▶ Practise · Practise (path) |
| Mix it with related skills | Mixed set · ▶ Play a mixed game · ▶ Mixed game |
| Review what is due | Practice tab · Today card · Review first · Still to practise first (Chart) · Add to mixed practice |
| Practise forms / tables | Tables tab · Paradigms · Any word & types · This chapter · Whole table · Sheets · word popup · Its tables (N) / Play its tables · Practise its part of the table · Play this whole chart · Practise the table (path) · table links |
| Fix mistakes | Redo misses · Practise my misses · Play my misses |

### 1.3 Problems found

1. **The same list in many places.** Skills are listed on 9 pages (Skills by topic, Skills by chapter, Path, the progressions, Chart, Skill drills, Sheets chips, Practice chips, Stats). There are 8 by-chapter views (Skills by chapter, Path, Chart, This chapter, Skill drills, Sheets, the chapter page's Grammar tab, Practice's chapter chips).
2. **Duplicate tabs.** Paradigms and Any word & types are one page under two names; Progressions and Path's area tabs are one page.
3. **One action, many names.** "Practise this skill", "Just drill it", "Drill", "Unlimited practice", "▶ Play" and "▶ Practise" all start the skill's own practice, with small differences a learner can't see.
4. **Button overload.** 645 buttons on the Skills page. Rarely used ones sit on every row (Reset ×96, Start as new ×40, "no sentences in the library yet?" ×52).
5. **Progress is scattered:** Skills (state, parts meter), Chart, Stats, History, Path (×N), the Progress page, the Today card, the chapter panel.
6. **Game mode three ways:** game-named buttons, the in-session switch, the progressions' switch. They agree now, but the learner sees three controls.
7. **The Grammar / Word Work split follows the code, not the learner.** Forms skills appear in both; Word Work's tabs open Grammar's pages; Sheets is a third view of the same chapter.
8. **Coming back is uneven.** A table opened from a menu now returns to it (v117); a lesson, drill or mixed set returns to Skills or a summary.
9. **Two tables experiences:** the Tables page (cells, narrow it, filled) and Paradigms (any word, by type) do overlapping jobs with different controls.

---

## 2. Principles

1. **Organise by what the learner wants**: *What do I do now?* · *Where am I in the course?* · *The forms* · *How am I doing?* One tab each.
2. **One home per thing.** One skill page, one table page, one chapter page, one chart. Everything else links to it.
3. **One main button per row**: the next sensible step (Learn, Continue, Practise, Review). Everything else is one tap away in that row's **⋯** menu, or as small links under it (as the tables are now).
4. **Lesson or game is one switch**, remembered and synced. Every start follows it; the session's own switch still changes it mid-way.
5. **Back goes where you came from**, for every practice, not only tables.
6. **Colour by area** (verbs, nouns, adjectives, pronouns, sentences, metre) everywhere, as now.
7. **Old links keep working.** Every old address redirects to its new home.

---

## 3. The proposed structure

**Header:** `Read` · `Study` · and on the right `📖 Lesson | ▶ Game` (shown in Study) and `Aa`.

### Study → Today *(the home page)*
- **One big button**: what to do now, in this order: due reviews → the lesson in progress → the next skill on your path → this chapter's new forms.
- Three short lists under it: *Due for review* · *Continue* · *Next up* (each row: area colour, title, ×N, one button).
- "Choose what to review…" opens today's Practice builder (size, skills, chapter sets, chapters) as a panel.
- Replaces: Practice tab, Today card (the weeks menu keeps a copy), Review first, Chart's "Still to practise first".

### Study → Course *(where am I, what's next)*
- A switch at the top: **By area** (Verbs · Nouns · Adjectives & adverbs · Pronouns · Sentences · Metre, each easiest → hardest) | **By chapter** (the book's order) | **All** (the path).
- Each skill row: area tag · title · state · ×N · **its tables as small links** · **one main button** · **⋯** (Lesson page, each part, Practise, Ten more, Mix, Play all its tables, Redo misses, History, Reset).
- Each table row: where its forms are first taught, one link straight to its practice.
- **Chapter page** (Course → Cap. XXVII): the chapter's readings link, its skills, its tables (Word Work's *This chapter*: New / Review), and its **sheet** (choose skills, Print). The reader's chapter page Grammar tab shows this same page.
- Replaces: Skills (both views), Path, Progressions, Skill drills, This chapter, Sheets, the chapter panel.

### The skill page *(one per skill; replaces the lesson page and Learn's start)*
- Header: area tag, title, progression bar (*Verbs · 31 of 35 · ← previous · next →*), state, ×N, the **main button**.
- **The lesson**: its parts, each opens on its own (in game mode too), with How it works and How it's made.
- **Practise**: Practise (ten; "Ten more" at the end replaces Unlimited) · Mix · Redo misses.
- **Tables**: each table as a link, and all of them in one game.
- **What next**: the next in its area, its next table, related skills.

### Study → Tables *(the forms)*
- **Find a word** (search, random) → that word's table.
- **By type**: conjugations, declensions, adjectives, pronouns, numerals, each with its model word and how many words follow it.
- **In this chapter**: the tables the chapter teaches.
- **Table page**: filled table, practise in the table, ▶ play as a game, one cell across words, narrow it, How it's made on every cell, both voices.
- Replaces: Tables, Paradigms, Any word & types, Whole table (`wwtable`), Sheets' tables. The word popup keeps its table and opens this page for more.

### Study → Progress
- **Practice chart** (by area or by chapter; practised, how much, still to do).
- **Stats** and **What you mix up**; **History** per skill.
- **Reading**: the Progress page's reading pace (linked, or moved here).
- Replaces: Chart, Stats, History, the parts meters' detail.

---

## 4. Where everything goes (nothing is lost)

| Now | Proposed home |
|---|---|
| Grammar → Skills, by topic / by chapter | Course (By area / By chapter) |
| Grammar → Path, area tabs; Word Work → Progressions | Course (All / By area) |
| Grammar → Chart | Progress → Practice chart; its "Still to practise first" → Today |
| Grammar → Practice (session builder) | Today → "Choose what to review…" |
| Grammar → Paradigms; Word Work → Any word & types | Tables → Find a word / By type |
| Grammar → Tables (catalogue, table page) | Tables → By type, table page |
| Grammar → Stats, History | Progress |
| Lesson page, Learn start | The skill page |
| Learn (guided), Part | Unchanged sessions, started from the skill page |
| Practise this skill (blocked ten), Just drill it, Drill | **Practise** (the skill's own ten; a skill still in Learn gets the blocked ten, a learned one the drill) |
| Unlimited practice | "Ten more" at the end of Practise |
| Mixed set, Mixed game | **Mix** |
| Redo misses, Practise / Play my misses | Unchanged, on result screens and the skill page |
| Add to mixed practice, Start as new, Reset | The row's ⋯ menu |
| Learn as a game, ▶ Play, Game mode switches | The one Lesson / Game switch (+ the session's own) |
| Its tables (N), Play its tables, Practise its part of the table, Play this whole chart | Tables links under the skill + "all in one game"; Play this whole chart stays on charts |
| Word Work → This chapter | Course → chapter page → Tables |
| Word Work → Skill drills | Course → chapter page → Skills |
| Word Work → Whole table | Skill page → Tables |
| Sheets | Course → chapter page → Sheet (with Print) |
| Reader chapter page → Grammar tab | The same chapter page |
| Weeks menu Today card | Kept; opens Study → Today |
| Word popup table, Practise, Play, How it's made | Kept; "More" opens the table page |
| Too hard? Too easy?, What next?, Climb the path | Kept: skill page and game end |
| How it works, How it's made, both voices, active-then-passive order | Kept everywhere |

---

## 5. Practice in five verbs

| Verb | What it starts | Lesson look | Game look |
|---|---|---|---|
| **Learn** | the lesson, part by part, then its check | the lesson pages | the lesson as a game |
| **Practise** | the skill's own ten (Ten more after) | items one by one | game mode |
| **Mix** | the skill with the ones it is confused with and builds on | items | game mode |
| **Review** | what is due, across skills (or a chosen set) | items | game mode |
| **Tables** | a table, or a skill's tables, every word | boxes in the table | the reel game |

The main button on a row is one of these, chosen by the skill's state: new → Learn; learning → Continue; due → Review; otherwise Practise.

---

## 6. Phases (each one ships on its own, with tests, and you approve before it goes live)

| # | Phase | What changes for you | Size |
|---|---|---|---|
| 1 | **Plumbing** (no visible change) | One "come back to where you started" for every session and game; one `nextAction(skill)`; one area/chapter model; a table of old address → new address. | small |
| 2 | **Study section** | Header becomes Read · Study; Study's tabs are Today · Course · Tables · Progress, at first showing today's pages under the new tabs; Word Work and Sheets buttons go; old addresses redirect. | medium |
| 3 | **Course and the skill page** | One row per skill with one main button + ⋯ + table links; the skill page; the chapter page absorbs This chapter, Skill drills, Sheets and the chapter panel. | large |
| 4 | **Tables** | Paradigms, Any word & types, Tables and Whole table become one Tables tab and one table page. | medium |
| 5 | **Today and Progress** | The Today home; Chart + Stats + History as Progress. | medium |
| 6 | **One game switch, tidy up** | The header's Lesson / Game switch drives everything; game-named duplicate buttons go; dead views removed; docs and tests updated. | small |

---

## 7. Questions for you

1. **Name**: *Study*, or keep *Grammar* as the one section (with Word Work and Sheets folded into it)?
2. **Course's default view**: by area (verbs, nouns …) or by chapter?
3. **The reader's chapter page**: keep its Grammar tab (showing the same chapter page), or just link to Study?
4. **Reset / Start as new**: fine in the ⋯ menu?
5. **Reading progress** (the Progress page): move into Study → Progress, or leave it in Read?
6. **Phase order**: start with phase 1 + 2 (structure first), or phase 3 (the skill rows and skill page, where most of the clutter is)?
