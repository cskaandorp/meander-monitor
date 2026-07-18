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
import shutil
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
def process_video(video_path: Path, location: dict, out_dir: Path) -> dict:
    """
    Produce a result for one video, writing any artifact files into out_dir.

    Contract: write output file(s) into out_dir and return
        {"primary": "<filename in out_dir to show the volunteer>",
         "stats":   {<json-serialisable numbers>}}
    Runs in a worker thread, so blocking/CPU-heavy work is fine.

    THIS IS TIER 0 — the proof-of-concept path: uncalibrated surface motion,
    straight from the pixels, needing no per-site survey data. It uses OpenCV
    dense optical flow (Farneback) to estimate how the surface moves between
    frames, then draws motion arrows over a real frame. The numbers are in
    pixels/frame, NOT m/s — there is no georeferencing here.

    When a location eventually carries real pyorc calibration, this is where the
    branch goes: if `location` has that config, run the calibrated pyorc pipeline
    instead and return metres/second (and, with a cross-section, discharge). The
    plumbing around this function does not change — only what it returns.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open video: {video_path.name}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    # Skip ~1s: the opening frames are often unsteady or still auto-focusing.
    for _ in range(int(fps)):
        cap.grab()

    WORK_W = 720       # downscale wide frames for speed; plenty for a PoC visual
    MAX_PAIRS = 60     # bound the work — ~2-3s of footage is enough to see motion

    prev_gray = None
    flow_sum = None
    base_bgr = None
    pairs = 0

    while pairs < MAX_PAIRS:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        if w > WORK_W:
            scale = WORK_W / w
            frame = cv2.resize(frame, (WORK_W, int(h * scale)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if base_bgr is None:
            base_bgr = frame.copy()
        if prev_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(
                prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
            )
            flow_sum = flow if flow_sum is None else flow_sum + flow
            pairs += 1
        prev_gray = gray

    cap.release()

    if pairs == 0 or base_bgr is None:
        raise RuntimeError("video too short to measure motion")

    mean_flow = flow_sum / pairs                       # (H, W, 2), pixels/frame
    mag = np.sqrt(mean_flow[..., 0] ** 2 + mean_flow[..., 1] ** 2)
    p95 = float(np.percentile(mag, 95))

    stats = {
        "tier": 0,
        "method": "opencv-farneback-optical-flow",
        "units": "pixels-per-frame (uncalibrated)",
        "frames_analyzed": pairs + 1,
        "fps": round(float(fps), 2),
        "mean_speed_px_per_frame": round(float(mag.mean()), 3),
        "median_speed_px_per_frame": round(float(np.median(mag)), 3),
        "p95_speed_px_per_frame": round(p95, 3),
        "max_speed_px_per_frame": round(float(mag.max()), 3),
        "frame_size_px": [int(base_bgr.shape[1]), int(base_bgr.shape[0])],
    }

    # Draw a grid of motion arrows, coloured green→red by speed, scaled so a
    # typical (p95) arrow spans about one grid cell.
    overlay = base_bgr.copy()
    H, W = mag.shape
    grid = 28
    denom = p95 if p95 > 1e-6 else max(float(mag.max()), 1.0)
    arrow_scale = grid * 0.9 / denom
    for y in range(grid // 2, H, grid):
        for x in range(grid // 2, W, grid):
            dx, dy = mean_flow[y, x]
            m = float(np.hypot(dx, dy))
            if m < 0.15:                                # skip near-static cells
                continue
            ex, ey = int(x + dx * arrow_scale), int(y + dy * arrow_scale)
            t = min(1.0, m / denom)
            color = (0, int(255 * (1 - t)), int(255 * t))   # BGR: green→red
            cv2.arrowedLine(overlay, (x, y), (ex, ey), color, 2, tipLength=0.35)

    out = cv2.addWeighted(overlay, 0.85, base_bgr, 0.15, 0)
    cv2.putText(
        out, "surface motion (uncalibrated PoC)", (12, 26),
        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA,
    )

    out_path = out_dir / "overlay.png"
    cv2.imwrite(str(out_path), out)

    return {"primary": "overlay.png", "stats": stats}


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

        # Heavy/blocking work — off the event loop so the heartbeat keeps ticking.
        out_dir = tmp / "out"
        out_dir.mkdir()
        result = await asyncio.to_thread(process_video, video_path, location, out_dir)

        # Upload every artifact under results/<user_id>/<submission_id>/... so the
        # storage RLS lets the uploader read it (policy keys off the first path
        # segment = user_id). result_path points at the primary one to display.
        primary_path = None
        for art in sorted(out_dir.iterdir()):
            dest = f"{sub['user_id']}/{sub_id}/{art.name}"
            content_type = "image/png" if art.suffix == ".png" else "application/octet-stream"
            await sb.storage.from_(RESULTS_BUCKET).upload(
                dest, art.read_bytes(), {"content-type": content_type, "upsert": "true"}
            )
            if art.name == result.get("primary"):
                primary_path = dest

        await sb.table("submissions").update(
            {
                "status": "done",
                "result_path": primary_path,
                "result": result.get("stats", {}),
                "finished_at": _now(),
                "error": None,
            }
        ).eq("id", sub_id).execute()
        print(f"[{WORKER_ID}] done {sub_id} → {primary_path}", flush=True)

    except Exception:
        err = traceback.format_exc()
        print(f"[{WORKER_ID}] FAILED {sub_id}\n{err}", flush=True)
        await sb.table("submissions").update(
            {"status": "failed", "finished_at": _now(), "error": err[:2000]}
        ).eq("id", sub_id).execute()

    finally:
        heartbeat.cancel()
        # Recursive: tmp holds the video AND the out/ subdirectory of artifacts.
        shutil.rmtree(tmp, ignore_errors=True)

    return True


def _on_insert(_payload) -> None:
    # Called from the realtime callback; just nudge the loop awake.
    _wake.set()


async def main() -> None:
    sb = await acreate_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"[{WORKER_ID}] up — {SUPABASE_URL}", flush=True)

    # Realtime wakes an idle worker the instant a video lands. It is an
    # ACCELERATOR, not a requirement: the safety poll below finds every job
    # within POLL_SECONDS regardless. So a failed subscription must NOT take the
    # worker down — degrade to poll-only and carry on. (RLS is applied per
    # subscriber, but the worker's role sees all rows.)
    try:
        channel = sb.channel("worker-submissions")
        channel.on_postgres_changes(
            "INSERT", schema="public", table="submissions", callback=_on_insert
        )
        await channel.subscribe()
        print(f"[{WORKER_ID}] realtime subscribed — instant wake enabled", flush=True)
    except Exception as e:
        print(
            f"[{WORKER_ID}] realtime unavailable ({type(e).__name__}: {e}) — "
            f"falling back to poll-only every {POLL_SECONDS}s",
            flush=True,
        )

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
