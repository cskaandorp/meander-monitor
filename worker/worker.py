"""
meander-monitor video worker.

Pulls queued submissions from Supabase, runs pyorc (pyopenrivercam) to turn a
river video into a flow measurement, writes the result back, and lets the
uploader see it live — the worker's status UPDATE flows to their browser through
Realtime, so the worker never talks to a client directly.

Architecture (mirrors the fwdvec fleet):
  - The `submissions` table IS the queue. No broker.
  - claim_submission() claims the oldest queued row with FOR UPDATE SKIP LOCKED,
    so multiple workers are safe with zero coordination.
  - Three redundant ways to find work: a Realtime push wakes an idle worker
    instantly; a drain loop claims back-to-back until empty; a safety poll every
    POLL_SECONDS guarantees nothing rots even if Realtime is down. The push is a
    pure accelerator — correctness rests on the durable row + the poll.

The one thing to fill in is process_video(). Everything around it is plumbing.
"""

import asyncio
import os
import signal
import socket
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

from supabase import acreate_client, AsyncClient

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
SUBMISSIONS_BUCKET = os.environ.get("SUBMISSIONS_BUCKET", "submissions")
RESULTS_BUCKET = os.environ.get("RESULTS_BUCKET", "results")
WORKER_ID = os.environ.get("WORKER_ID") or f"{socket.gethostname()}:{os.getpid()}"
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))
HEARTBEAT_SECONDS = int(os.environ.get("HEARTBEAT_SECONDS", "60"))

_wake = asyncio.Event()
_shutdown = asyncio.Event()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── The actual work ────────────────────────────────────────────────────────
def process_video(video_path: Path, location: dict) -> dict:
    """
    Turn a river video into a flow measurement with pyorc.

    STUB — this is where your pyorc code goes. It runs in a thread (see
    process_one), so blocking/CPU-heavy work is fine here.

    `location` is the full row from the `locations` table for this submission:
    slug, name, latitude, longitude, and whatever calibration fields you add.
    LSPIV needs the camera's perspective (ground control points / homography /
    scale) — if that's per-location, store it on the location row and read it
    here. That's the reason the worker fetches the location at all.

    Return a JSON-serialisable dict — it becomes submissions.result and is what
    the uploader's page can display.
    """
    raise NotImplementedError(
        "process_video() is a stub — drop the pyorc processing in here"
    )


# ── Plumbing ───────────────────────────────────────────────────────────────
async def claim(sb: AsyncClient) -> dict | None:
    resp = await sb.rpc("claim_submission", {"p_worker_id": WORKER_ID}).execute()
    rows = resp.data or []
    return rows[0] if rows else None


async def heartbeat_loop(sb: AsyncClient, sub_id: str) -> None:
    """Ping last_heartbeat_at while the job runs, so a stall is observable."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await sb.table("submissions").update(
                {"last_heartbeat_at": _now()}
            ).eq("id", sub_id).execute()
    except asyncio.CancelledError:
        pass


async def get_location(sb: AsyncClient, location_id: str) -> dict:
    resp = await sb.table("locations").select("*").eq("id", location_id).single().execute()
    return resp.data


async def process_one(sb: AsyncClient) -> bool:
    """Claim and handle one submission. Returns False when the queue is empty."""
    sub = await claim(sb)
    if sub is None:
        return False

    sub_id = sub["id"]
    print(f"[{WORKER_ID}] claimed {sub_id} ({sub['storage_path']})", flush=True)

    heartbeat = asyncio.create_task(heartbeat_loop(sb, sub_id))
    tmp = Path(tempfile.mkdtemp(prefix="mm-"))
    try:
        location = await get_location(sb, sub["location_id"])

        # Download the raw clip from the submissions bucket.
        video_bytes = await sb.storage.from_(SUBMISSIONS_BUCKET).download(sub["storage_path"])
        video_path = tmp / Path(sub["storage_path"]).name
        video_path.write_bytes(video_bytes)

        # Heavy/blocking pyorc work — off the event loop so the heartbeat keeps ticking.
        result = await asyncio.to_thread(process_video, video_path, location)

        # Result goes to results/<user_id>/... so the storage RLS lets the
        # uploader read it (policy keys off the leading path segment).
        result_name = f"{Path(sub['storage_path']).stem}-result.json"
        result_path = f"{sub['user_id']}/{result_name}"
        import json

        await sb.storage.from_(RESULTS_BUCKET).upload(
            result_path,
            json.dumps(result).encode(),
            {"content-type": "application/json", "upsert": "true"},
        )

        await sb.table("submissions").update(
            {
                "status": "done",
                "result_path": result_path,
                "finished_at": _now(),
                "error": None,
            }
        ).eq("id", sub_id).execute()
        print(f"[{WORKER_ID}] done {sub_id}", flush=True)

    except Exception:
        err = traceback.format_exc()
        print(f"[{WORKER_ID}] FAILED {sub_id}\n{err}", flush=True)
        await sb.table("submissions").update(
            {"status": "failed", "finished_at": _now(), "error": err[:2000]}
        ).eq("id", sub_id).execute()

    finally:
        heartbeat.cancel()
        for f in tmp.glob("*"):
            f.unlink(missing_ok=True)
        tmp.rmdir()

    return True


def _on_insert(_payload) -> None:
    # Called from the realtime callback; just nudge the loop awake.
    _wake.set()


async def main() -> None:
    sb = await acreate_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"[{WORKER_ID}] up — {SUPABASE_URL}", flush=True)

    # Realtime: wake on any new submission. RLS is applied per subscriber, but
    # the worker's role sees all rows; either way the safety poll below is the
    # real guarantee, so a finicky subscription never blocks progress.
    channel = sb.channel("worker-submissions")
    channel.on_postgres_changes(
        "INSERT", schema="public", table="submissions", callback=_on_insert
    )
    await channel.subscribe()

    # Drain anything queued while we were offline before waiting on a push.
    while not _shutdown.is_set() and await process_one(sb):
        pass

    while not _shutdown.is_set():
        try:
            await asyncio.wait_for(_wake.wait(), timeout=POLL_SECONDS)
        except asyncio.TimeoutError:
            pass  # safety-net tick — poll even if no push arrived
        _wake.clear()
        while not _shutdown.is_set() and await process_one(sb):
            pass

    print(f"[{WORKER_ID}] shutting down", flush=True)


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    def stop() -> None:
        _shutdown.set()
        _wake.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop)


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)
    loop.run_until_complete(main())
