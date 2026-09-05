-- Grammar wave 1 review fixes (applied 2026-09-06): attempts cannot double on retry/sync; confusion counts merge by max.
create unique index if not exists drill_attempts_dedupe on public.drill_attempts (user_id, at, skill, item_key);
create or replace function public.confusions_merge_max() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.count < old.count then new.count := old.count; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists confusions_merge_max on public.confusions;
create trigger confusions_merge_max before update on public.confusions for each row execute function public.confusions_merge_max();
