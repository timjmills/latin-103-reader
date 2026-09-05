-- Printed line breaks inside each sentence, for the "book lines" layout (applied 2026-09-05).
alter table public.units add column if not exists lines jsonb not null default '[]'::jsonb;
comment on column public.units.lines is 'Printed line breaks inside the sentence: [{"line": n, "start": charOffsetInLa}], first entry start 0.';
