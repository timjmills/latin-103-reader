-- Wave 3 (applied 2026-09-06): the Colloquia Personarum shelf is a fifth source.
alter table public.weeks drop constraint if exists weeks_source_check;
alter table public.weeks add constraint weeks_source_check check (source = any (array['FR','FS','FL','FS+FL','CP']));
