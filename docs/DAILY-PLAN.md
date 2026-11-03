# The Daily Study Plan: how a day goes

The learner's standing rules for the Daily Study Plan (Grammar → Daily Study Plan), agreed October 2026.
Change the plan only in line with these rules, or when the learner asks.

## The goal
- Master every skill **that has a table** by **15 December 2026** (73 skills). Skills with no table
  (result clause, enclitics and the like) are not in the plan.
- 45–60 minutes a day, six days a week. Sunday is the rest day unless changed.

## The order of every day: three colour-coded phases
1. **Corrections & review** (blue)
   - Corrections first: the forms got wrong, then the questions got wrong (table cells only), for **at most 15 minutes**.
   - Then review of the skills due, most overdue first, for **at most 20 minutes**.
   - When a block's time runs out, the round under way finishes and the rest of that block moves to phase 3.
2. **New lessons** (purple)
   - **This week's class first.** Read the class chapter, then learn the week's skills. They are spread over the days
     before the class (Saturday), so everything is ready for class.
   - Then the plan's other new skills, each followed by its forms on the wheel.
3. **More review & corrections** (orange)
   - Review and corrections left over, anything due or got wrong during the day, mixed practice, the weakest table,
     and a starred item.

Anything that comes up during the day goes to the end (phase 3), never in front of the new lessons.
"Later ↓" (or "Skip, come back later") moves a part to phase 3.
After each step, a "How the day is going" summary page shows the progress before the next step.

## Learning a new skill (no setup questions)
In the plan and on the course paths, a new skill is learnt as a fixed sequence (`learnRounds`, plan.js). The game never
asks which forms or words to play. Each round plays the model word of its tables, at most 4 rounds of about 12 cards,
and "Its forms" then mixes a word of each table. That makes about 20 minutes at most.
- Verbs: 1st conj. → 2nd → 3rd, 3rd -iō, 4th together → the irregular verbs.
- Nouns: 1st decl. → 2nd masculine → 2nd neuter → 3rd m/f → 3rd neuter and i-stems → 4th and 5th.
- Adjectives: 1st/2nd → 3rd → comparison. Pronouns: is → the demonstratives → the relative/interrogative → personal.
The setup ("Which conjugations / which words") remains only for free practice: the Tables pages and the "Set up the
game" buttons.

## Class weeks
- The first class was **Saturday 5 September 2026**. Week *n*'s class is 7(*n*−1) days later.
  Week 9 (Familia Romana cap. XXXI, the future passive participle) is Saturday 31 October.
- Each course week's chapter, reading and skills are in `app/data/course.json` and `skills.json` (`course: "103"`,
  `week`). The first-class date can be changed in the plan's settings ("first class").

## Kinds of question
- Skills with a table are asked **their table only**, everywhere: game mode, the plan, lessons and mistakes. There
  are no sentence questions (fill the blank, what-is-it, parse, reorder, transform, translate). The switch is
  `setTablesOnly` (items.js).
- Only a typed round counts. Before each plan round, ask whether to play Flash first or go straight to Type it.
- Show the word's principal parts in full, never masked.

## Publishing
- Publish to the live site (`main` + `gh-pages`) only when the learner says "push" or "publish".
