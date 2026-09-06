-- Wave 2 (applied 2026-09-06): self-graded translate attempts, and the spaced-success count mastery needs.
alter table public.drill_attempts add column if not exists self text check (self in ('right','partly','wrong'));
alter table public.skill_state add column if not exists successes_spaced integer not null default 0;
