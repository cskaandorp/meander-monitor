# Video worker

Pulls queued `submissions`, runs pyorc (pyopenrivercam) to turn a river video
into a flow measurement, writes the result back, and lets the uploader see it
live via Realtime. It is **1:1 with the app** and lives in this repo so its code
and the schema it depends on (`supabase/migrations/`) change together.

It is **not** deployed by the app's pipeline. It runs on its own box (Rodney)
and you update it by hand.

## How it fits together

The `submissions` table is the queue. The worker:

1. Claims the oldest `queued` row via `claim_submission()` — `FOR UPDATE SKIP
   LOCKED`, so multiple workers never collide.
2. Downloads the clip from the `submissions` bucket.
3. Runs `process_video()` (the pyorc step — **the one thing to fill in**).
4. Uploads the result to `results/<user_id>/…` and sets the row to `done`.
5. That UPDATE reaches the uploader's browser through Realtime. The worker never
   talks to a client.

Three ways it finds work — a Realtime push (instant), a drain loop (claims until
empty), and a safety poll every `POLL_SECONDS`. The poll is the guarantee; the
push is just an accelerator, so a flaky subscription never stalls the queue.

## Prerequisites (once)

- The `20260717140000_worker_queue.sql` migration applied (via the app pipeline).
- A key in `.env` — see `.env.example`. `worker_external` (scoped) or
  `service_role` (bring-up).
- Docker + compose on the worker box.

## Deploy / update

```bash
git pull
cp .env.example .env   # first time; then fill in SUPABASE_KEY
docker compose up -d --build
docker compose logs -f
```

First build is slow (pyorc's GDAL/OpenCV stack). Subsequent code-only changes
reuse the cached env layer.

## Filling in the processing

`process_video(video_path, location)` in `worker.py` is a stub. `location` is
the full `locations` row, so if pyorc needs per-camera calibration (ground
control points, homography, scale), store it on the location and read it there.
Return a JSON-serialisable dict — it becomes `submissions.result_path`'s content
and is what the uploader's page shows.

The function runs in a thread, so blocking/CPU-heavy pyorc code is fine as-is.

## Stuck jobs

A worker that dies mid-job leaves a row in `processing` with a stale
`last_heartbeat_at`. There is **no automatic requeue** — matching fwdvec, which
found timeouts false-positive on legitimately long jobs. Recovery is the
`requeue_submission(id)` RPC, admin-only, surfaced from the (future) admin
submissions view.

If meander-monitor's jobs turn out short and bounded enough that auto-recovery
is safe, a small sweeper resetting stale `processing` rows to `queued` would be
a clean addition — a decision to make once real processing times are known.

## Scaling

One worker suits a 1:1 app. To scale, run more replicas or this compose on
another box pointed at the same Supabase — `SKIP LOCKED` makes competing workers
safe with no further change.
