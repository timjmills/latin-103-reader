-- Study log: realtime, per-device rows, server-side merges (applied 2026-09-05).
alter publication supabase_realtime add table public.study_days;
alter table public.study_days add column if not exists device text not null default 'main';
alter table public.study_days drop constraint if exists study_days_pkey;
alter table public.study_days add primary key (user_id, day, device);
alter table public.study_days add constraint study_days_active_nonneg check (active_ms >= 0);
create or replace function public.study_days_merge() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.active_ms := greatest(new.active_ms, old.active_ms); end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists study_days_merge on public.study_days;
create trigger study_days_merge before update on public.study_days for each row execute function public.study_days_merge();
alter table public.reading_progress add constraint reading_progress_reads_min check (reads >= 1);
update public.reading_progress set last_read_at = read_at where last_read_at is null;
alter table public.reading_progress alter column last_read_at set not null;
alter table public.reading_progress alter column last_read_at set default now();
create or replace function public.reading_progress_merge() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.read_at := least(new.read_at, old.read_at);
    new.reads := greatest(new.reads, old.reads);
    new.last_read_at := greatest(coalesce(new.last_read_at, old.last_read_at), old.last_read_at);
  end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists reading_progress_merge on public.reading_progress;
create trigger reading_progress_merge before update on public.reading_progress for each row execute function public.reading_progress_merge();
