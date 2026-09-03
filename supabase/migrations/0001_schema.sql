-- Latin 103 Reader — core schema.
-- Single-user app: every row is owned by auth.uid(); RLS on every table.
-- Shapes mirror CONTRACT.md (data/build/week-NN.json, highlights-week-NN.json).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Last-write-wins guard + updated_at maintenance.
--   insert: updated_at defaults to now() when the client did not send one.
--   update: a row carrying an OLDER updated_at than the stored row is ignored
--           (the offline outbox replays writes in arbitrary order across devices).
create or replace function public.lww_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if new.updated_at is null then
    new.updated_at := now();
  elsif new.updated_at < old.updated_at then
    return null;  -- stale write: keep the stored row
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- weeks
-- ---------------------------------------------------------------------------
create table public.weeks (
  user_id          uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  n                integer     not null check (n between 1 and 99),
  id               text        not null,
  title            text        not null,
  source           text        not null check (source in ('FR', 'FS', 'FL')),
  chapter          text,
  has_line_numbers boolean     not null default true,
  focus            jsonb,
  parts            jsonb       not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  primary key (user_id, n)
);
comment on table public.weeks is 'One row per course week: title, source text, grammar focus.';

alter table public.weeks enable row level security;

create policy "weeks select own" on public.weeks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "weeks insert own" on public.weeks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "weeks update own" on public.weeks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "weeks delete own" on public.weeks
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger weeks_lww before insert or update on public.weeks
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- units  (a sentence, verse line, or speaker turn)
-- ---------------------------------------------------------------------------
create table public.units (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null,                 -- "w01:1.1"
  week_n      integer     not null,
  "order"     integer     not null,                 -- 0-based within the week
  part        text,
  line_no     integer,
  block_start boolean     not null default false,
  unit_type   text        not null default 'sentence' check (unit_type in ('sentence', 'verse', 'turn')),
  speaker     text,
  la          text        not null,
  en          text        not null default '',
  en_raw      text,
  note        text,
  tags        jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, week_n) references public.weeks (user_id, n) on delete cascade
);
comment on table public.units is 'Aligned Latin/English units in reading order. Copyrighted text: private to the owner.';

create index units_user_week_order_idx on public.units (user_id, week_n, "order");

alter table public.units enable row level security;

create policy "units select own" on public.units
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "units insert own" on public.units
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "units update own" on public.units
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "units delete own" on public.units
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger units_lww before insert or update on public.units
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- highlights  (grammar-focus spans; resolved to offsets client-side)
-- ---------------------------------------------------------------------------
create table public.highlights (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  week_n     integer     not null,
  unit_id    text        not null,
  text       text        not null,                  -- exact substring of unit.la
  occurrence integer     not null default 1 check (occurrence >= 1),
  label      text        not null,
  note       text,
  updated_at timestamptz not null default now(),
  foreign key (user_id, unit_id) references public.units (user_id, id) on delete cascade
);
comment on table public.highlights is 'Week-focus highlight spans with learner notes.';

create index highlights_user_week_idx on public.highlights (user_id, week_n);
create index highlights_user_unit_idx on public.highlights (user_id, unit_id);

alter table public.highlights enable row level security;

create policy "highlights select own" on public.highlights
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "highlights insert own" on public.highlights
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "highlights update own" on public.highlights
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "highlights delete own" on public.highlights
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger highlights_lww before insert or update on public.highlights
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- lookups  (words the reader has tapped; yellow underline until learned)
-- ---------------------------------------------------------------------------
create table public.lookups (
  user_id            uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  form               text        not null,          -- macron-stripped, lowercase
  first_seen_unit_id text,
  created_at         timestamptz not null default now(),
  learned_at         timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (user_id, form)
);
comment on table public.lookups is 'Looked-up word forms and when they were marked learned.';

alter table public.lookups enable row level security;
alter table public.lookups replica identity full;   -- realtime DELETE events carry the old row

create policy "lookups select own" on public.lookups
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "lookups insert own" on public.lookups
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lookups update own" on public.lookups
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lookups delete own" on public.lookups
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger lookups_lww before insert or update on public.lookups
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- audio_alignments  (unit start offsets in the chapter recording)
-- ---------------------------------------------------------------------------
create table public.audio_alignments (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  week_n     integer     not null,
  unit_id    text        not null,
  start_ms   integer     not null check (start_ms >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_n, unit_id)
);
comment on table public.audio_alignments is 'Per-unit start time (ms) in audio/{user_id}/week-NN.mp3.';

alter table public.audio_alignments enable row level security;

create policy "audio_alignments select own" on public.audio_alignments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "audio_alignments insert own" on public.audio_alignments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "audio_alignments update own" on public.audio_alignments
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "audio_alignments delete own" on public.audio_alignments
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger audio_alignments_lww before insert or update on public.audio_alignments
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- settings  (one jsonb blob per user)
-- ---------------------------------------------------------------------------
create table public.settings (
  user_id    uuid        not null default auth.uid() primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.settings is 'Reader preferences: size, face, theme, compact, showEnglish, showHighlights, showUnderlines.';

alter table public.settings enable row level security;

create policy "settings select own" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings insert own" on public.settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings update own" on public.settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "settings delete own" on public.settings
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger settings_lww before insert or update on public.settings
  for each row execute function public.lww_touch();

-- ---------------------------------------------------------------------------
-- Realtime: second-device live updates for progress + preferences.
-- postgres_changes honours RLS, so the subscriber only sees their own rows.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.lookups, public.settings, public.audio_alignments;
