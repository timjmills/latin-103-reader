-- Second and later passes over a sentence are reviews, not new reads (applied 2026-09-05).
alter table public.reading_progress add column if not exists reads integer not null default 1;
alter table public.reading_progress add column if not exists last_read_at timestamptz;
update public.reading_progress set last_read_at = read_at where last_read_at is null;
comment on column public.reading_progress.reads is 'How many passes have covered this sentence; read_at is the first, last_read_at the latest.';
