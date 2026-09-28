-- Schedule the water-level harvest inside the database.
--
-- The alternative — a systemd timer on the app box curling the endpoint — was
-- built first and thrown away. It works, but it puts a piece of the
-- application's behaviour in a place the application does not own: a unit file
-- that deploys by hand, lives outside the repo's deploy, and silently stops
-- existing if the app ever moves box. pg_cron keeps the schedule with the data,
-- so it ships with a migration like everything else here.
--
-- WHAT IT DOES: pokes POST /api/cron/water once an hour. It deliberately does
-- NOT fetch or parse Munisense in SQL. pg_net is fire-and-forget — the response
-- lands in net._http_response for a later reader — so doing the real work here
-- would mean a two-phase job and JSON parsing in plpgsql. Triggering an
-- endpoint needs no response, which is exactly what pg_net is good at. The
-- harvest itself stays in TypeScript (app/api/cron/water/route.ts).
--
-- The overlapping-window upsert in that route is what makes this safe: a
-- missed tick, a double tick or a manual run are all no-ops.

-- ── CI guard ──────────────────────────────────────────────────────────────
-- migrations-check replays against plain postgres (pgvector/pgvector:pg15),
-- which has neither extension, and an unguarded `create extension pg_cron`
-- turns CI red for a schema that is perfectly correct in production. Everything
-- below is therefore conditional on the extension existing, and runs through
-- EXECUTE so nothing referencing `cron.` is even parsed when it does not.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — skipping harvest schedule (expected in CI)';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  -- Idempotent: re-running must not stack duplicate schedules.
  execute $q$
    select cron.unschedule(jobid) from cron.job where jobname = 'water-harvest'
  $q$;

  -- Hourly, on the hour. The sensor's modem uploads every six hours, so five
  -- runs in six find nothing new — that is expected and cheap. We cannot know
  -- when a batch lands, so we poll to bound staleness rather than to catch it.
  execute $q$
    select cron.schedule('water-harvest', '0 * * * *',
                         'select public.trigger_water_harvest()')
  $q$;
end$$;

-- ── The job body ──────────────────────────────────────────────────────────
-- Created unconditionally so the schema is the same shape everywhere; without
-- pg_cron nothing ever calls it.
--
-- Configuration comes from Vault, NOT from this file: a migration is committed
-- to git, and the endpoint's shared secret must not be. Until both secrets
-- exist the function is a no-op, so a fresh database schedules a job that
-- harmlessly does nothing rather than failing every hour.
--
-- Set them on the server with:
--   select vault.create_secret('https://mm.compunist.nl/api/cron/water', 'water_harvest_url');
--   select vault.create_secret('<CRON_SECRET from .env.local>',          'water_harvest_secret');
create or replace function public.trigger_water_harvest()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'water_harvest_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'water_harvest_secret';

  if v_url is null or v_secret is null then
    raise notice 'water harvest not configured (vault secrets missing) — skipping';
    return;
  end if;

  -- Fire and forget. We do not read the reply: the route is idempotent, and a
  -- failure is visible in the app's own logs and in net._http_response.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

-- Nothing reachable from a browser may trigger this.
revoke all on function public.trigger_water_harvest() from public, anon, authenticated;
