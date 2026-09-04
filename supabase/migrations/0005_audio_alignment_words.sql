-- Word timings inside each aligned unit (applied to the linked project on 2026-09-04).
alter table public.audio_alignments add column if not exists words jsonb not null default '[]'::jsonb;
comment on column public.audio_alignments.words is 'Word timings inside the unit: [{"t": text, "s": start_ms, "e": end_ms}] (absolute ms in the week recording).';
