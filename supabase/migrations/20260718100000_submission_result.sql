-- A place for the worker's numeric result.
--
-- result_path already points at the artifact the volunteer sees (an image for
-- the Tier 0 PoC). This holds the machine-readable numbers alongside it —
-- pixels/frame now, metres/second and discharge once calibration exists. jsonb
-- so the shape can grow per tier without further migrations.
alter table submissions
  add column result jsonb;
