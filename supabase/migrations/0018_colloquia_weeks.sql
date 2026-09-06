-- Wave 3 (applied 2026-09-06): Colloquia Personarum shelf uses week numbers 201-224.
alter table public.weeks drop constraint if exists weeks_n_check;
alter table public.weeks add constraint weeks_n_check check (n between 1 and 299);
