-- Automatic reading progress: one row per sentence the learner has read (applied 2026-09-05).
create table if not exists public.reading_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  unit_id text not null, week_n integer not null,
  read_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);
create index if not exists reading_progress_week_idx on public.reading_progress (user_id, week_n);
alter table public.reading_progress enable row level security;
create policy "progress_select" on public.reading_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert" on public.reading_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update" on public.reading_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "progress_delete" on public.reading_progress for delete to authenticated using ((select auth.uid()) = user_id);
alter publication supabase_realtime add table public.reading_progress;
