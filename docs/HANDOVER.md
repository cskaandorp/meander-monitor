# meander-monitor — handover

Citizen-science river monitoring. Volunteers scan a QR code at a monitoring site,
record a short video of the water with their phone, and it's uploaded to a
self-hosted Supabase. A Python worker processes the video and writes a result
back, which the volunteer sees live on the same page. An admin CMS manages the
public website, the monitoring locations (and their QR codes), and the harvested
submissions.

Last updated: 2026-07-18. Everything below is committed to `origin/main` unless
flagged otherwise.

---

## Topology (who runs where)

| Piece | Where | Notes |
|---|---|---|
| **App** (Next.js) | Patrick `192.168.178.132`, port **3050**, binds `0.0.0.0` | public at `https://mm.compunist.nl` |
| **Supabase** | Patrick, Kong on **:8002** | public at `https://mm-supa.compunist.nl` |
| **nginx / TLS** | a **different** box on the LAN | proxies to Patrick; that's why the app binds 0.0.0.0, not localhost |
| **Worker** | **Rodney** (also the deploy SSH jump host) | reaches Supabase over the public URL |
| **Repo** | `github.com/cskaandorp/meander-monitor` | **personal**, NOT in the FwdFaster org (matters for deploy — see below) |

Deploy hop: GitHub → Rodney (jump host) → Patrick.

---

## Stack / infra facts worth not rediscovering the hard way

- **Supabase runs alongside fwdvec's Supabase on Patrick.** To avoid collisions the
  meander stack uses compose project name `meander-monitor` (not the recipe's
  default `supabase`) and container names prefixed `mm-` (`mm-supabase-db`,
  `mm-supabase-kong`, …). Both `container_name:` AND the top-level `name:` in the
  compose file override folder-based isolation — both must be changed or the two
  stacks fight over the same containers.
- **Realtime needed a network alias.** The realtime container is
  `mm-realtime-dev.supabase-realtime`, but Kong's `kong.yml` dials the stock
  hostname `realtime-dev.supabase-realtime`, and that hostname is *also* the
  realtime tenant id. Fix (in the supabase compose): give the realtime service a
  network alias `realtime-dev.supabase-realtime`. Without it, WebSocket handshakes
  return **503** and neither the worker nor the volunteer page get live updates.
- **`.env` on the supabase box:** `DISABLE_SIGNUP=false`, `ENABLE_ANONYMOUS_USERS=true`
  (both required for volunteer anonymous auth — see Auth), storage
  `FILE_SIZE_LIMIT=100MB`.
- **ffmpeg is installed on Patrick.** OpenCV in the worker container uses it.
- **DB password is never a secret** — the deploy reads it on-box via
  `docker exec mm-supabase-db printenv POSTGRES_PASSWORD`.

---

## Deploy

`.github/workflows/deploy.yml` is a **vendored copy** of the fleet pipeline
(`fwddeployer/deploy-app.yml`), NOT a caller. Reason: this repo is outside the
FwdFaster org and fwddeployer is private, so the shared `uses:` recipe can't be
called from here.

- **Jobs:** `migrations-check` (replays every migration from an empty Postgres) +
  `build-check` (runs `next build`) gate the `deploy` job. Deploy is push-to-main
  only.
- **Deploy order (deliberate): backup → migrate → build → smoke-test → restart.**
  Everything non-destructive happens before `rm -rf .next`, so a failed migration
  leaves the running app untouched instead of dead.
- **Secrets (org or repo level):** `RODNEY_HOST`, `RODNEY_USER`, `RODNEY_SSH_KEY`,
  `PATRICK_USER`, `PATRICK_HOST`.
- **Two bugs already fixed here, do not reintroduce:** (1) `docker exec -i` with a
  heredoc script swallows the rest of the script as stdin — every DB `docker exec`
  is redirected `< /dev/null`; (2) the old build-first ordering broke the live app
  on any failed migration.
- **Known fork risk:** because the pipeline is vendored, fixes made to
  fwddeployer's recipe do NOT reach this repo. Port them by hand if needed.

### The worker deploys MANUALLY — not via the pipeline

On Rodney:
```bash
cd <repo>/worker
git pull
sudo docker compose up -d --build   # --build is required whenever worker.py changes
```
The heavy conda/pyorc image layer is cached; only the code layer rebuilds. The
worker is outbound-only (no inbound ports, no nginx).

---

## Auth model

- **Admins:** email/password. `profiles.is_admin` flag, `is_admin()` SQL helper.
  `proxy.ts` guards `/admin` on `is_admin` (a signed-in non-admin is bounced to
  `/`). New accounts default to `is_admin=false`; the first accounts were
  backfilled to `true`. Create/promote admins by inserting into `auth.users`
  (admin API) then setting `profiles.is_admin=true`.
- **Volunteers:** **anonymous auth** (`signInAnonymously()`), one identity per
  browser/device, stored in that browser. Real `auth.users` row + `auth.uid()`, so
  ordinary owner-based RLS applies. This is why the `/submit` page needs
  `DISABLE_SIGNUP=false` + `ENABLE_ANONYMOUS_USERS=true` on GoTrue.
- The `/submit` page filters submissions **explicitly by `user_id`** (not just RLS)
  because RLS lets admins read all rows — without the explicit filter an admin
  viewing `/submit` sees everyone's uploads.

---

## Database (migrations, in order)

Source of truth is `supabase/migrations/` (forward-only). `migrate.sh` applies
them once each via a ledger.

- `initial_pages` — CMS: `pages`, `blocks`, `page_images`, `site_settings`, `landing_items`
- `web_bucket` — public `web` bucket (website media)
- `profiles_and_admin` — `profiles`, `is_admin()`, `handle_new_user` trigger
- `cms_admin_only` — locks all CMS writes to `is_admin()`
- `submission_buckets` — **private** `submissions` + `results` buckets; RLS keys off
  the first path segment = `user_id`
- `submissions_table` — the queue table; on the `supabase_realtime` publication
- `locations` — monitoring sites (`slug`, `name`, lat/long, `is_active`);
  `submissions.location_id` (NOT NULL, `on delete restrict`)
- `locations_slug_format` — slug CHECK (`^[a-z0-9]+(-[a-z0-9]+)*$`); slugs are
  printed on QR signs, so treat as immutable once printed
- `worker_queue` — `claim_submission` RPC (FOR UPDATE SKIP LOCKED, SETOF),
  `requeue_submission` (admin lever), `worker_external` role + grants, heartbeat
  columns (`worker_id`, `last_heartbeat_at`, `attempts`, `started_at`, `finished_at`,
  `expected_duration_seconds`)
- `submission_result` — `submissions.result` jsonb (the machine numbers)

`ci-bootstrap.sql` fakes the Supabase-provided env (roles, `auth`, `storage`,
`supabase_realtime` publication) so CI can replay from zero. **Keep it in sync**
when a migration depends on a new Supabase primitive. Note: `migrations-check`
replays from an EMPTY db, so it cannot catch data-shape failures (a `NOT NULL` on
an existing column) — that class of bug only shows on the real deploy.

---

## The worker (`worker/`)

Pull-based queue consumer, modelled on the fwdvec fleet pattern
(`../fwdvec-workers`, `../fwdvec/docs/realtime-and-workers.md`). The `submissions`
table IS the queue. Claim → download raw video → `process_video()` → upload
result(s) → mark `done`/`failed`. The status UPDATE reaches the volunteer's browser
via Realtime — the worker never talks to a client. Three ways it finds work
(realtime push + drain loop + safety poll); realtime is an accelerator, and a
failed subscription degrades to poll-only rather than crashing.

- **Current processing = Tier 0** (proof of concept): OpenCV Farneback dense optical
  flow → an arrow-overlay PNG + motion stats **in pixels/frame, uncalibrated**.
  No survey data needed; works on any video. `process_video()` is written to
  BRANCH — when a location carries real calibration, that's where the calibrated
  pyorc path goes; the surrounding plumbing doesn't change.
- **Orientation** (portrait vs landscape): OpenCV ignores the phone's rotation flag,
  which made portrait results come back sideways. The worker now disables OpenCV
  auto-rotate and applies the rotation-metadata angle itself (exactly one
  rotation). **Reported working.** When the real pyorc pipeline lands, this
  rotation must sit *before* calibration/AprilTag detection too.
- **`.env` on Rodney** (`worker/.env`, gitignored — see `worker/.env.example`):
  `SUPABASE_URL=https://mm-supa.compunist.nl`, `SUPABASE_KEY=<see below>`,
  `SUBMISSIONS_BUCKET`, `RESULTS_BUCKET`, `POLL_SECONDS`, `HEARTBEAT_SECONDS`.

---

## TO-DO / open items

### 1. Worker key: move from `service_role` to `worker_external`  (security)
The worker currently authenticates with the **`service_role`** key (god mode, used
for bring-up). The scoped `worker_external` role already exists in the DB. Mint its
JWT and switch `SUPABASE_KEY` in `worker/.env`:
```bash
SUPABASE_JWT_SECRET='<stack JWT_SECRET>' python3 scripts/mint_jwt.py --role worker_external --years 10
```
Matters more than usual because the worker is on a separate box holding the key.
When switching, verify **storage** up/download still works under `worker_external`
(storage-api's handling of a custom BYPASSRLS role is the one unverified bit — if
it breaks, that's the cause; fall back to service_role or add grants).

### 2. Location calibration — the real science  (biggest item; needs fieldwork, not code)
Tier 0 gives uncalibrated pixel motion. Real velocity (m/s) and discharge (m³/s)
need per-site survey data. Reference implementation is **Wouter van der Niet's
pyorc scripts** at `~/Desktop/OpenRiverCam_test/` (esp. `05_citizen_science_setup.py`).
pyorc = `pyopenrivercam`.

Two modes (a DECISION for the opdrachtgever/Wouter, it's physical setup not code):
- **Fixed camera** → store one full `CameraConfig` JSON per location (from pyorc's
  `cam_config.to_file()`), worker `load_camera_config()`s it.
- **Handheld + AprilTags** (what the citizen-science script does, and what the QR/
  volunteer model implies) → place physical AprilTags in the scene, survey each
  tag's real-world coordinate, store a small `{tag_id → coord}` table + `z_0`, CRS,
  resolution, window_size per location. Worker detects tags per video and builds
  the calibration on the fly.

What's needed per site regardless: measured reference points (m), and for discharge
a surveyed channel **cross-section** + the water level at filming time. **No code
produces a real number without this data.**

**Chosen delivery mechanism (designed, not yet built):** attach config **files** to
each location — a private `configs` bucket keyed by `location_id` + an admin
"upload calibration" panel + the worker downloads a location's config before
processing and branches on what's present (none → Tier 0; camconfig → calibrated;
+cross-section → discharge). pyorc is file-driven, so storing files commits to no
schema. The worker already fetches the `locations` row per job — the hook is there.

### 3. Slideshow CTA card copy
Still a placeholder: "TAKE PART / Film a river bend and send us your video" → `/submit`.
It's the `cta` prop on `<Slideshow>` (default in `app/(public)/slideshow.tsx`).
Needs real copy + link (public copy is English).

### 4. Logo
Header shows the text "Meander Monitor". A logo swap was declined this session
because using WUR's trademarked logo needs the official brand asset + permission,
not a scrape. When a licensed logo exists, wiring it into `components/public-nav.tsx`
is a one-line change.

### 5. Storage hygiene
- **Deleting a submission removes its files** (the admin Submissions page does
  file-then-row deletion). But there's no periodic **orphan sweep** — and
  `auth.users` for anonymous volunteers accumulate and are never pruned (deleting
  their rows leaves the user). Both want a periodic job (natural fit for the worker).
- **Storage volume is NOT backed up.** The deploy's `pg_dump` captures
  `storage.objects` rows but not the actual video files. A lost volume leaves the DB
  pointing at files that don't exist. Needs its own rsync/restic.

### 6. Scaling / smaller items
- Admin Submissions list caps at **1000 rows** (client-side pagination). Move to
  server-side `.range()` when volume grows (comment marks the spot).
- Discharge (Tier 2) is gated on cross-sections — future.

---

## Feature inventory (what works today)

- **Public site:** WUR-styled landing (custom cutout slideshow reconstructed from
  wur.nl's actual CSS — rounded panel, green CTA card in a bottom-left cutout with
  inlaid corner fillets, notched next button, capped 1000px centred) + `/[slug]`
  content pages (banner, richtext + media blocks, image gallery).
- **Admin CMS** (`/admin`, admin-only): Landing editor, Pages (drag-reorder,
  Tiptap, media blocks), Locations (CRUD + downloadable QR codes), Submissions
  (list, date filter, inline preview, bulk ZIP download over a period with a
  manifest.csv, bulk delete of files+rows).
- **Volunteer flow** (`/submit/<location>`): anonymous sign-in → phone camera →
  progress bar → "processing" (record button hidden so they don't pile up uploads)
  → result auto-scrolls into view → then "Record another video". One result per
  session view (user-scoped).
- **Worker:** claim/heartbeat/process/result end-to-end, Tier 0 optical-flow overlay,
  orientation handling, graceful realtime degradation.

## Key references
- `~/Desktop/OpenRiverCam_test/` — Wouter's pyorc scripts (the calibration + pyorc
  pipeline reference)
- `../fwdvec-workers/`, `../fwdvec/docs/realtime-and-workers.md` — fleet worker pattern
- `../fwddeployer/` — the shared deploy recipe this repo's pipeline is forked from
- pyorc docs: https://localdevices.github.io/pyorc/
