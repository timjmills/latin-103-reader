-- Grammar section, wave 1 (applied 2026-09-05): review-shelf week numbers, skill_state, drill_attempts, confusions.
alter table public.weeks drop constraint if exists weeks_n_check;
alter table public.weeks add constraint weeks_n_check check (n between 1 and 199);
create table if not exists public.skill_state (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skill text not null,
  state text not null default 'new' check (state in ('new','learning','practising','mastered','lapsed')),
  stage integer not null default 1 check (stage between 1 and 3),
  stability_days real not null default 0.5, due_at timestamptz, last_at timestamptz,
  streak integer not null default 0, successes integer not null default 0, failures integer not null default 0,
  updated_at timestamptz not null default now(), primary key (user_id, skill));
create table if not exists public.drill_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skill text not null, kind text not null, item_key text not null,
  mode text not null check (mode in ('learn','practice')),
  correct boolean not null, hinted boolean not null default false,
  answer text, expected text, confused_with text, ms integer, at timestamptz not null default now());
create index if not exists drill_attempts_user_at on public.drill_attempts (user_id, at desc);
create index if not exists drill_attempts_user_skill on public.drill_attempts (user_id, skill);
create table if not exists public.confusions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skill_a text not null, skill_b text not null, count integer not null default 0,
  updated_at timestamptz not null default now(), primary key (user_id, skill_a, skill_b));
alter table public.skill_state enable row level security;
alter table public.drill_attempts enable row level security;
alter table public.confusions enable row level security;
create policy "skill_state_all" on public.skill_state for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "drill_attempts_all" on public.drill_attempts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "confusions_all" on public.confusions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter publication supabase_realtime add table public.skill_state;
