-- Grammar wave 2 (applied 2026-09-06): Ørberg's pensa per chapter, private.
create table if not exists public.pensa (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chapter integer not null check (chapter between 1 and 40),
  kind text not null check (kind in ('A','B','C')),
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter, kind));
alter table public.pensa enable row level security;
create policy "pensa_all" on public.pensa for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
