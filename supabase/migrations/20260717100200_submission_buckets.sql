-- Volunteer video: `submissions` (raw) and `results` (processed).
--
-- Both are PRIVATE, unlike `web`. Volunteers filming Dutch waterways will catch
-- bystanders, houses and plates — that's personal data, and a public bucket
-- would mean a permanent unauthenticated URL for every submission. Playback goes
-- through signed URLs instead.
--
-- Access keys off the PATH, not storage.objects.owner: the Python workers write
-- results with the service key, which leaves owner null, so an owner check would
-- lock uploaders out of their own results. Hence the convention — enforced by
-- the insert policy, relied on by the select policies:
--
--     submissions/<user_id>/<file>
--     results/<user_id>/<file>
--
-- split_part(name, '/', 1) is the first path segment. (Supabase ships
-- storage.foldername() for this, but it doesn't exist on the bare Postgres CI
-- replays against; split_part is plain SQL and behaves identically here.)
--
-- Workers use service_role, which bypasses RLS entirely — no policy needed for
-- them to read submissions or write results.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('submissions', 'submissions', false, 104857600),
  ('results',     'results',     false, 104857600)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- ── submissions: volunteers write their own, read their own; admins read all ──
create policy "Users upload to their own submissions folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'submissions'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "Users read their own submissions"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submissions'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

create policy "Users delete their own submissions"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'submissions'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

-- ── results: written by workers (service_role); uploaders read their own ──────
create policy "Users read their own results"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'results'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

create policy "Admins manage results"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'results' and public.is_admin())
  with check (bucket_id = 'results' and public.is_admin());
