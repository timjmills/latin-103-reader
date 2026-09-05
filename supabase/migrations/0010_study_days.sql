-- Study log: active reading time per local day (applied 2026-09-05). Sentences per day come from reading_progress.read_at.
create table if not exists public.study_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null, active_ms integer not null default 0, updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.study_days enable row level security;
create policy "study_select" on public.study_days for select to authenticated using ((select auth.uid()) = user_id);
create policy "study_insert" on public.study_days for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "study_update" on public.study_days for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "study_delete" on public.study_days for delete to authenticated using ((select auth.uid()) = user_id);
