-- Explicit unit end and synthesised-voice flag on alignment rows (applied 2026-09-04).
alter table public.audio_alignments add column if not exists end_ms integer;
alter table public.audio_alignments add column if not exists synth boolean not null default false;
comment on column public.audio_alignments.end_ms is 'Where this unit''s audio ends (ms); null = play until the next unit starts.';
comment on column public.audio_alignments.synth is 'True when this unit is read by a synthesised voice rather than the recording.';
