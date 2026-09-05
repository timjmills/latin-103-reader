-- Illustrations cropped from the textbook scans, anchored to sentences (applied 2026-09-05).
-- See CONTRACT.md "Pictures". Private bucket `pictures`, objects at {user}/week-NN/<file>.
create table if not exists public.pictures (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null, week_n integer not null, unit_id text not null, path text not null,
  caption text, caption_en text, page integer, width integer, height integer,
  sort integer not null default 0, updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists pictures_week_idx on public.pictures (user_id, week_n);
alter table public.pictures enable row level security;
create policy "pictures_select" on public.pictures for select to authenticated using ((select auth.uid()) = user_id);
create policy "pictures_insert" on public.pictures for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "pictures_update" on public.pictures for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "pictures_delete" on public.pictures for delete to authenticated using ((select auth.uid()) = user_id);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pictures', 'pictures', false, 10485760, array['image/png','image/jpeg','image/webp']) on conflict (id) do nothing;
create policy "pictures_obj_select" on storage.objects for select to authenticated using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pictures_obj_insert" on storage.objects for insert to authenticated with check (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pictures_obj_update" on storage.objects for update to authenticated using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pictures_obj_delete" on storage.objects for delete to authenticated using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
