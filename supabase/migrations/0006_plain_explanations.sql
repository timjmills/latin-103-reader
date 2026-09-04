-- Plain-words explanations for struggling learners (applied to the linked project on 2026-09-04).
alter table public.units add column if not exists note_simple text;
alter table public.highlights add column if not exists simple text;
comment on column public.units.note_simple is 'Plain-words explanation of the grammar note for struggling learners.';
comment on column public.highlights.simple is 'Plain-words explanation of the highlight note.';
