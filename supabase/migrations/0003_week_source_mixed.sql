-- Weeks 3, 5 and 10 read Fabulae Syrae and Fabellae Latinae together; the
-- pipeline emits source = 'FS+FL' for them (see CONTRACT.md, workstream A).
alter table public.weeks drop constraint if exists weeks_source_check;
alter table public.weeks add constraint weeks_source_check
  check (source in ('FR', 'FS', 'FL', 'FS+FL'));
