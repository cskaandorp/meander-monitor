-- Submission tracking.
--
-- The storage buckets hold the bytes; this table holds the state — who sent it,
-- where it landed, how processing is going, and where the result is. It is also
-- the channel the volunteer's page listens on: the worker updates the row, and
-- Realtime pushes that straight to the browser. No polling.
--
-- Volunteers are ANONYMOUS auth users (GoTrue ENABLE_ANONYMOUS_USERS). They get
-- a real auth.users row and a real auth.uid(), so ordinary owner-based RLS
-- applies — no special cases. They are also `authenticated`, which is exactly
-- why the CMS is gated on is_admin() rather than on being logged in.

create table submissions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,                 -- submissions/<user_id>/<file>
  result_path  text,                          -- results/<user_id>/<file>
  status       text not null default 'queued'
                 check (status in ('queued', 'processing', 'done', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The workers' claim query is "oldest queued first"; the volunteer's page asks
-- for "my submissions, newest first".
create index submissions_status_created_idx on submissions (status, created_at);
create index submissions_user_id_created_idx on submissions (user_id, created_at desc);

create trigger submissions_updated_at
  before update on submissions
  for each row execute function handle_updated_at();

alter table submissions enable row level security;

create policy "Users read their own submissions"
  on submissions for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "Users create their own submissions"
  on submissions for insert
  to authenticated
  with check (user_id = auth.uid());

-- Deliberately no UPDATE policy for volunteers: status and result_path are the
-- workers' to set, and they use the service key (which bypasses RLS). An
-- uploader must not be able to mark their own submission 'done'.
create policy "Admins manage submissions"
  on submissions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Realtime: the page subscribes to its own rows so a worker's UPDATE arrives as
-- a live push. Realtime applies RLS per subscriber, so the select policy above
-- is what stops one volunteer seeing another's.
alter publication supabase_realtime add table submissions;
