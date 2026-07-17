-- Turn `submissions` into a worker job queue.
--
-- The table already models state (queued/processing/done/failed) and is on the
-- realtime publication. This adds the machinery a pull-based worker needs:
-- atomic claiming, a heartbeat, and a scoped role to connect as. The pattern is
-- fwdvec's background_tasks, reduced to our single worker type — there is no
-- `kind` column because there is exactly one worker (video → flow measurement),
-- 1:1 with this app.
--
-- The worker runs off-box (on Rodney) and reaches Supabase over the public URL
-- with a JWT. Nothing here assumes co-location.

-- ── Queue bookkeeping columns ─────────────────────────────────────────────
alter table submissions
  add column worker_id                 text,          -- who claimed it: "<host>:<pid>"
  add column last_heartbeat_at         timestamptz,   -- worker pings while alive
  add column attempts                  integer not null default 0,
  add column started_at                timestamptz,   -- set on claim
  add column finished_at               timestamptz,   -- set on done/failed
  add column expected_duration_seconds integer;       -- worker's own estimate, for a "stuck?" UI

-- ── Worker role ───────────────────────────────────────────────────────────
-- LOGIN NOINHERIT BYPASSRLS, scoped by explicit GRANTs rather than RLS. The
-- worker connects through PostgREST/Realtime/Storage as authenticator, which
-- does SET ROLE from the JWT's `role` claim — so a custom role is unusable
-- unless it is granted to authenticator (Supabase pre-grants only the standard
-- three). Guarded create because roles are cluster-global.
do $$
begin
  if not exists (select from pg_roles where rolname = 'worker_external') then
    create role worker_external with login noinherit bypassrls;
  end if;
end$$;

grant usage on schema public to worker_external;
grant select, update on public.submissions to worker_external;
grant select on public.locations to worker_external;   -- per-location camera calibration
grant worker_external to authenticator;

-- Storage: download the raw clip from `submissions`, write the result to
-- `results`. BYPASSRLS covers the row policies; these are the table privileges.
grant usage on schema storage to worker_external;
grant select on storage.buckets to worker_external;
grant select, insert, update, delete on storage.objects to worker_external;

-- ── Atomic claim ──────────────────────────────────────────────────────────
-- The whole concurrency story is FOR UPDATE SKIP LOCKED: the winning worker
-- row-locks and flips the oldest queued row; racing workers skip it and get
-- nothing back. That is what makes running N workers safe with zero
-- coordination — add replicas to scale.
--
-- RETURNS SETOF (not a bare row type) on purpose: a plpgsql function returning
-- a row type yields a row of NULLs when nothing is queued, which PostgREST
-- serialises as {id:null,...} — indistinguishable from real work. SETOF gives
-- [] vs [{...}]. This is a real bug fwdvec hit; keep the SETOF form.
create or replace function public.claim_submission(p_worker_id text)
returns setof public.submissions
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.submissions
     set status            = 'processing',
         worker_id         = p_worker_id,
         started_at        = now(),
         last_heartbeat_at = now(),
         attempts          = attempts + 1
   where id = (
     select id
       from public.submissions
      where status = 'queued'
      order by created_at
        for update skip locked
      limit 1
   )
  returning *;
$$;

revoke all on function public.claim_submission(text) from public;
-- Both keys can claim: worker_external for scoped production, service_role for
-- quick bring-up. SECURITY DEFINER runs as the owner, so either works.
grant execute on function public.claim_submission(text) to worker_external, service_role;

-- ── Admin recovery lever ──────────────────────────────────────────────────
-- If a worker dies mid-job the row sits in 'processing' with a stale heartbeat.
-- There is deliberately NO automatic requeue (see the note in worker/README).
-- This is the manual reset: an admin sends a stuck row back to 'queued', clean.
create or replace function public.requeue_submission(p_id uuid)
returns public.submissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.submissions;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.submissions
     set status            = 'queued',
         worker_id         = null,
         started_at        = null,
         last_heartbeat_at = null,
         error             = null
   where id = p_id
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.requeue_submission(uuid) from public;
grant execute on function public.requeue_submission(uuid) to authenticated;
