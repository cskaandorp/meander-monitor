-- Regional water levels, harvested from WUR's Munisense portal.
--
-- Groundwater level stands in for how much water the regional system is
-- holding, which is what drives flow through the brooks and meanders the
-- volunteers film. It is context for the submissions, not a measurement of any
-- one bend. See docs/MUNISENSE.md for the API itself.
--
-- WHY A LOCAL COPY AT ALL. The obvious alternative is for the page to call
-- Munisense on demand and cache the response. Three reasons not to:
--
--   1. The public page would then hold Munisense credentials in its render
--      path. Here the page reads these tables through the anon key like any
--      other content, and the credentials stay server-side in the scheduled
--      route alone.
--   2. The sensor's 2G modem uploads on a SIX HOUR cycle. Request-driven
--      revalidation gives no guarantee anything is ever fetched — if nobody
--      visits, nothing updates, and we accumulate no history at all.
--   3. Correlating water level against submission timestamps later is a join if
--      the data is here, and an ETL job if it isn't.
--
-- The harvester is an app route (app/api/cron/water/route.ts), fired hourly by
-- a systemd timer (deploy/meander-water.timer). Deliberately NOT the video
-- worker: that process exists to turn volunteer footage into flow
-- measurements, and an unrelated HTTP job has no business sharing its
-- lifecycle or its deploy.
--
-- It pulls an OVERLAPPING window — the last week, every hour — and upserts.
-- That is what makes the job idempotent: a missed run, a double run, a restart
-- or a day of downtime all self-heal on the next tick, and there is no cursor
-- to keep correct. Cheap, too: ~2300 rows arrive, a handful are new.

-- ── Wells ─────────────────────────────────────────────────────────────────
-- id is Munisense's own object_id, not a surrogate. It is the join key back to
-- the API and it is stable, so inventing our own would only add a lookup.
--
-- The group is stored because it is the ONLY way to tell the production sensor
-- from the test rigs: four of the five wells on the portal share two
-- descriptions between them ("Tube 1" twice, "Tube 2" twice). Group 36 "River
-- Site 1" holds the real one. The harvest syncs whatever is in its configured
-- group(s), so a second river site appears here by changing one env var.
create table water_wells (
  id               integer primary key,        -- Munisense object_id
  name             text not null,              -- Munisense "description", e.g. "Tube 1"
  group_id         integer,                    -- Munisense group, e.g. 36
  group_name       text,                       -- e.g. "River Site 1"
  latitude         numeric(9, 6),
  longitude        numeric(9, 6),
  gis_description  text,                       -- free-text address from the API
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger water_wells_updated_at
  before update on water_wells
  for each row execute function handle_updated_at();

-- ── Measurements ──────────────────────────────────────────────────────────
-- Long and narrow rather than a column per variable. WUR asked for three
-- (water level, water pressure, barometric pressure) and has already hinted at
-- more sites; a `property` column absorbs a fourth variable without a migration.
--
-- `unit` is stored per row, from the response's meta.unit, and is deliberately
-- NOT assumed: the two pressures come back in DIFFERENT units (Pa for water,
-- hPa for barometric — a factor of 100). Hardcoding one would silently mangle
-- the other, and it would look like a sensor fault rather than a bug.
--
-- value/value_min/value_max mirror the API's avg/min/max for the bucket, so a
-- chart can draw a range band without re-querying. min/max are nullable — not
-- every endpoint shape returns them (see docs/MUNISENSE.md, "two result shapes").
create table water_measurements (
  well_id      integer not null references water_wells(id) on delete cascade,
  property     text not null,              -- water_level | water_absolute_pressure | well_covering_barometric_pressure
  measured_at  timestamptz not null,
  value        numeric(12, 4) not null,    -- the bucket average
  value_min    numeric(12, 4),
  value_max    numeric(12, 4),
  unit         text not null,              -- 'm NAP' | 'Pa' | 'hPa'
  -- The upsert target. Re-fetching an overlapping window must be a no-op, and
  -- this is what makes it one.
  primary key (well_id, property, measured_at)
);

-- The chart's query is "one well, one property, newest N" — the primary key
-- already orders that way and Postgres scans it backwards, so no extra index.
-- This one serves the cross-well "what arrived recently" case instead.
create index water_measurements_measured_at_idx
  on water_measurements (measured_at desc);

-- ── Latest reading per well+property ──────────────────────────────────────
-- The "current situation" panel wants one row per series, which is a DISTINCT
-- ON, not something worth hand-writing at every call site. A view keeps the
-- page's query trivial and lets the planner use the primary key.
-- security_invoker: without it a view runs as its OWNER and quietly bypasses the
-- RLS of the tables beneath it. That is harmless here (measurements are
-- public-read anyway) but it is the wrong default to establish — the next view
-- someone copies this from may sit on something private.
create view water_latest with (security_invoker = true) as
  select distinct on (well_id, property)
         well_id, property, measured_at, value, value_min, value_max, unit
    from water_measurements
   order by well_id, property, measured_at desc;

-- ── Access ────────────────────────────────────────────────────────────────
-- Public read: this is display data for the public site, same posture as
-- `locations`. Anonymous visitors must be able to read it without an account.
--
-- There is deliberately NO public write policy. The only writer is the
-- scheduled harvest route, which authenticates with a write key rather than a
-- user session — exactly like submissions.status. Nothing reachable from a
-- browser can forge a reading.
-- No `grant select ... to anon` on the tables below, deliberately. Supabase
-- ships `alter default privileges in schema public grant all on tables to anon,
-- authenticated, service_role`, so every new table here picks up its table-level
-- grant automatically and RLS does the real gating — same as `locations`.
--
-- ci-bootstrap.sql does NOT reproduce that default, so under `set role anon` in
-- CI these tables (and `locations`, and every other public table) report
-- "permission denied". That is a CI artifact, not a production bug. Don't
-- "fix" it here — an explicit grant would diverge from every other table.
alter table water_wells enable row level security;
alter table water_measurements enable row level security;

create policy "Public can read active wells"
  on water_wells for select
  using (is_active = true);

create policy "Admins manage wells"
  on water_wells for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Public can read measurements"
  on water_measurements for select
  using (true);

create policy "Admins manage measurements"
  on water_measurements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A view needs its own grant regardless of security_invoker — grants and RLS
-- are separate mechanisms. security_invoker (above) settles WHOSE row policies
-- apply; this settles who may reference the view at all.
grant select on water_latest to anon, authenticated;

-- The harvest writes with a key, not a user session, and RLS grants the public
-- SELECT only. Prefer a scoped `worker_external` JWT (these two grants are
-- exactly what it needs) over service_role, which bypasses RLS entirely.
grant select, insert, update on public.water_wells to worker_external;
grant select, insert, update on public.water_measurements to worker_external;
