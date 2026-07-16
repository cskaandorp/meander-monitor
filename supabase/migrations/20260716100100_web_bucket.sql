-- The `web` bucket — all media for the public website (page banners, page
-- image galleries, landing slides and tiles).
--
-- Public read so <img src> works without signed URLs; writes are limited to
-- authenticated users (accounts are admin-created — self-signup is off).
--
-- The 100 MB limit matches the storage service's stack-wide FILE_SIZE_LIMIT
-- and Next's serverActions.bodySizeLimit, so a file that clears the app is
-- never rejected here after the work of uploading it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('web', 'web', true, 104857600)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy "Public read access to web media"
  on storage.objects for select
  to public
  using (bucket_id = 'web');

create policy "Authenticated users can upload web media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'web');

create policy "Authenticated users can update web media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'web');

create policy "Authenticated users can delete web media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'web');
