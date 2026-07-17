# meander-monitor

Citizen-science river monitoring: volunteers upload video, Python workers process it,
results come back to the uploader. This repo is the Next.js app and its database schema.

## Status

The public website + admin CMS + auth are in place. The worker/realtime layer is not
built yet.

## Stack

- **Next.js 16** (App Router, standalone output), React 19, Tailwind 4, shadcn/ui
- **Supabase** (self-hosted on Patrick at `mm-supa.compunist.nl`) — Postgres, GoTrue,
  PostgREST, Storage, Realtime
- Auth is email/password. **Self-signup is disabled** — accounts are admin-created.

## Layout

```
app/(public)/       landing page + /[slug] content pages
app/admin/          CMS: pages, landing, sign-in
lib/supabase/       server/browser clients, storage helpers, image URL transforms
supabase/migrations/  the schema — forward-only SQL, the source of truth
supabase/migrate.sh   applies pending migrations, exactly once each
supabase/ci-bootstrap.sql  CI-only: fakes the Supabase-managed env so CI replays from zero
deploy/             systemd unit template
```

## Database

The schema is defined **only** by `supabase/migrations/` — no snapshot to keep in sync.
`migrate.sh` applies them in filename order, exactly once each, recorded in a
`supabase_migrations.schema_migrations` ledger. Re-running is a no-op.

Name migrations `<UTC-timestamp>_<short_name>.sql`. Forward-only: never edit one that's
been applied anywhere — fix forward with a new file.

Run them against the server (no exposed Postgres port needed):

```bash
PSQL='ssh -T casper@patrick docker exec -i -e PGPASSWORD=<pw> mm-supabase-db psql -U postgres -d postgres' \
  ./supabase/migrate.sh
```

## Deploy

Push to `main` → `.github/workflows/deploy.yml`. Two jobs:

1. **`migrations-check`** (also runs on PRs) — replays every migration from an empty
   Postgres and asserts the ledger matches the file count. Gates the deploy.
2. **`deploy`** (push-to-main only) — SSH via Rodney to Patrick, then
   **build → backup → migrate → restart**. Any failure aborts before the restart, so the
   running app stays on old code.

The workflow is a **vendored copy** of fwddeployer's shared `deploy-app.yml`. This repo
sits outside the FwdFaster org and fwddeployer is private, so the shared recipe can't be
called from here. Fleet fixes do not reach this file automatically — port them by hand.

## Server (Patrick, `192.168.178.132`)

| | |
|---|---|
| App | port 3050, binds `0.0.0.0` (nginx is on a different box) |
| App URL | `https://mm.compunist.nl` |
| Supabase | Kong on `:8002`, public at `https://mm-supa.compunist.nl` |
| DB container | `mm-supabase-db` |
| Storage buckets | `web` (public read, website media) · `submissions` + `results` (private, volunteer video) |

`.env.local` on the box holds `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. It's gitignored and read at **build** time, so it must
exist before the first build. The systemd unit injects it at runtime via
`EnvironmentFile` — the standalone server does not auto-load it.

## Known gaps

- **Deleting a submission leaves its video on disk.** There is no cascade from a
  database row to a storage file, and there cannot be a simple one: `storage.objects`
  is only metadata, and the bytes live in the storage volume under storage-api's
  control. Deleting the row — by FK cascade, by hand, or otherwise — orphans the file
  silently. Files must be removed through the storage API *before* their row goes.

  Live orphan sources today: any manual `delete from submissions`, and
  `submissions.user_id`'s `ON DELETE CASCADE` from `auth.users` (pruning anonymous
  users, which we will eventually want, drops rows and keeps every video).

  **Needs:** app-level delete (storage API, then row) for the paths we control, plus a
  periodic orphan sweep — list the bucket, drop anything with no matching
  `submissions.storage_path` — as the safety net that makes it actually true. The
  sweep most naturally belongs to the Python workers.

- **Storage files aren't backed up.** The deploy's `pg_dump` captures `storage.objects`
  rows but no actual files. A lost volume leaves the database pointing confidently at
  videos that no longer exist. The storage volume needs its own backup.

- **No workers yet.** Nothing writes to `results`, so submissions sit at `queued`
  forever. The volunteer page says so honestly, but the loop is not closed.

- **`migrations-check` cannot catch data-shape failures.** It replays from an empty
  database, so a `NOT NULL` or new constraint on an existing table passes CI and fails
  on the server against real rows. Happened on 2026-07-17 with `submissions.location_id`.
