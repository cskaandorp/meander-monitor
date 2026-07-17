-- Monitoring locations.
--
-- QR codes are printed and mounted at specific spots along the water. Each
-- encodes /submit/<slug>, so the URL itself carries the location — the
-- volunteer never picks one, and can't pick the wrong one. A recording belongs
-- to exactly one location, always.
--
-- The slug is the contract with the physical world: it is printed on a sign
-- that may be outdoors for years. Renaming one orphans the sign, so treat slugs
-- as immutable once a code is printed and retire locations with is_active
-- instead of deleting them.

create table locations (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,       -- appears in the QR URL
  name        text not null,              -- shown to the volunteer
  description text,
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger locations_updated_at
  before update on locations
  for each row execute function handle_updated_at();

alter table locations enable row level security;

-- The submit page is public and resolves the slug before anyone signs in.
create policy "Public can read active locations"
  on locations for select
  using (is_active = true);

create policy "Admins manage locations"
  on locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Tie submissions to a location ─────────────────────────────────────────
-- on delete restrict: a location with recordings cannot be deleted out from
-- under them — the location IS the scientific meaning of the video. Retire it
-- with is_active instead.
alter table submissions
  add column location_id uuid references locations(id) on delete restrict;

-- Any submission that predates this migration has no location and cannot be
-- given one — we do not know where it was filmed, and guessing would poison the
-- data. Such rows can only be test uploads from the day /submit was built, and
-- a recording without a location is exactly what this table now refuses to
-- hold, so they go.
--
-- This can never match a row created after this point: location_id is NOT NULL
-- from the next statement onward. On a fresh database (CI) it is a no-op.
delete from submissions where location_id is null;

alter table submissions
  alter column location_id set not null;

create index submissions_location_id_created_idx
  on submissions (location_id, created_at desc);
