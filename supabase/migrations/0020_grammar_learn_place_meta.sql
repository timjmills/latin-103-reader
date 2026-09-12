-- The two columns that let a second device see the same lesson (applied 2026-09-12, GRAMMAR-CONTRACT.md §25).
-- Both are NULL on every existing row, and NULL means different things in the two of them — see the comments.
alter table public.skill_state add column if not exists learn_place jsonb;
comment on column public.skill_state.learn_place is
  'Where the learner is in this skill''s lesson: { done: [step index...], seen, at }. NULL means unknown, not "no steps done".';

-- NULL `meta` is the one place the "NULL is unknown" rule does NOT hold for the client, and the column
-- comment below (as applied) should be read with §25 beside it: `given` absent is unknown, but an attempt
-- with no `meta` at all is **counted**. Before §20 an uncounted attempt was not written down at all, so
-- every row that predates this column is genuinely ordinary practice.
alter table public.drill_attempts add column if not exists meta jsonb;
comment on column public.drill_attempts.meta is
  'Per-attempt facts the scheduler does not key on: given (the scaffold rung a chart was finished at), uncounted (practised from the Tables tab, counts towards the progress sheet but never towards review), generated (a made-up sentence). NULL means unknown.';
