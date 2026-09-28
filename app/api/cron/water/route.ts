import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Harvest WUR's Munisense water readings into our own tables.
 *
 * Triggered hourly by pg_cron from inside the database (see the
 * water_harvest_schedule migration), never by a visitor.
 * Deliberately NOT part of the video worker: that process exists to turn
 * volunteer footage into flow measurements, and an unrelated hourly HTTP job
 * has no business sharing its lifecycle.
 *
 * It fetches an OVERLAPPING window — the last week, every run — and upserts on
 * (well_id, property, measured_at). That is what makes it idempotent: a missed
 * run, a double run, a restart, or a day of downtime all self-heal on the next
 * tick, and there is no cursor to keep correct. It also means you can safely
 * curl this by hand to backfill or debug.
 *
 * See docs/MUNISENSE.md for the API itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ~12 upstream requests plus a handful of upserts. Generous, but a slow
// Munisense should fail the run, not hang the timer forever.
export const maxDuration = 120;

const MUNISENSE_URL =
  process.env.MUNISENSE_URL ?? "https://wur.water-munisense.net/webservices/v2";
// Group 36 is "River Site 1". Selecting by GROUP rather than by well id is
// deliberate: well descriptions are not unique on the portal ("Tube 1" appears
// twice), so a description is not an identifier — and a second river site then
// needs a config change, not a code change.
const GROUP_IDS = (process.env.MUNISENSE_GROUP_IDS ?? "36")
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
// last_week = 10-minute buckets, which matches the sensor's 15-minute sampling.
// last_month is hourly and would smear it.
const PRESET = process.env.MUNISENSE_PRESET ?? "last_week";

// What WUR asked us to display. Water level is the primary series; the two
// pressures are what it is derived from. Their units DIFFER (Pa vs hPa), which
// is why unit travels with every row rather than being assumed.
const PROPERTIES = [
  "water_level",
  "water_absolute_pressure",
  "well_covering_barometric_pressure",
] as const;

interface Loc {
  latitude?: number;
  longitude?: number;
  gis_description?: string;
}

interface Bucket {
  timestamp: string;
  avg?: number;
  value?: number;
  min?: number;
  max?: number;
}

function basicAuth(): string {
  const user = process.env.MUNISENSE_USER ?? "";
  const pass = process.env.MUNISENSE_PASS ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function muni<T>(path: string): Promise<T> {
  const res = await fetch(`${MUNISENSE_URL}${path}`, {
    headers: { authorization: basicAuth() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`munisense ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function POST(req: NextRequest) {
  // The app is public, so this endpoint is reachable from the internet even
  // though only the local timer should ever call it. A shared secret is the
  // whole gate — without it, anyone could make us hammer WUR's API.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.MUNISENSE_USER) {
    return NextResponse.json({ error: "MUNISENSE_USER not configured" }, { status: 503 });
  }

  // A WRITE key, not the anon key: RLS grants the public SELECT only, so an
  // anon client cannot insert here. Prefer a scoped `worker_external` JWT (the
  // migration grants it exactly select/insert/update on these two tables) over
  // service_role, which bypasses RLS entirely.
  const writeKey = process.env.SUPABASE_WRITE_KEY;
  if (!writeKey) {
    return NextResponse.json({ error: "SUPABASE_WRITE_KEY not configured" }, { status: 503 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, writeKey, {
    auth: { persistSession: false },
  });

  try {
    // Group names are cosmetic; ids are what we actually select on, so a
    // failure here must not abort the harvest.
    const groups = await muni<Record<string, { name?: string }>>(
      "/users/me/all_groups"
    ).catch(() => ({}) as Record<string, { name?: string }>);

    const wells: {
      id: number; name: string; group_id: number; group_name: string | null;
      latitude: number | null; longitude: number | null; gis_description: string | null;
    }[] = [];

    for (const gid of GROUP_IDS) {
      // rowcount=1: this endpoint returns measurements alongside the object
      // list whether we want them or not, so ask for the smallest possible
      // tail. The real series come from the preset endpoints below.
      const objects = await muni<{ object_id: number; description?: string }[]>(
        `/groundwaterwells/query?groupIds=${encodeURIComponent(gid)}&rowcount=1`
      );
      for (const o of objects) {
        // A well we cannot place is still worth recording.
        const loc: Loc = await muni<Loc>(
          `/groundwaterwells/${o.object_id}/location`
        ).catch(() => ({}) as Loc);
        wells.push({
          id: o.object_id,
          name: o.description ?? `well ${o.object_id}`,
          group_id: Number(gid),
          group_name: groups[gid]?.name ?? null,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          gis_description: loc.gis_description ?? null,
        });
      }
    }

    if (wells.length) {
      const { error } = await supabase.from("water_wells").upsert(wells, { onConflict: "id" });
      if (error) throw new Error(`upsert wells: ${error.message}`);
    }

    const rows: Record<string, unknown>[] = [];
    const failures: string[] = [];

    for (const well of wells) {
      for (const property of PROPERTIES) {
        let data: { results?: Bucket[]; meta?: { unit?: string } };
        try {
          data = await muni(
            `/groundwaterwells/${well.id}/${property}/query/presets/${PRESET}`
          );
        } catch (e) {
          // One dead series must not cost us the other eight.
          failures.push(`${well.id}/${property}: ${(e as Error).message}`);
          continue;
        }
        // The unit travels with the row. The two pressures come back in
        // DIFFERENT units (Pa vs hPa) — assuming one would silently mangle the
        // other, and it would read as a sensor fault rather than a bug.
        const unit = data.meta?.unit ?? "";
        for (const r of data.results ?? []) {
          // Presets return avg/min/max; the plain listing endpoint returns
          // `value` and no meta. Tolerate both shapes.
          const value = r.avg ?? r.value;
          if (value == null) continue;
          rows.push({
            well_id: well.id,
            property,
            measured_at: r.timestamp,
            value,
            value_min: r.min ?? null,
            value_max: r.max ?? null,
            unit,
          });
        }
      }
    }

    // Chunked: a week of three series across several wells is a few thousand
    // rows, and one oversized request is the only way this becomes fragile.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("water_measurements")
        .upsert(rows.slice(i, i + 500), {
          onConflict: "well_id,property,measured_at",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`upsert measurements: ${error.message}`);
    }

    return NextResponse.json({
      ok: true, wells: wells.length, readings: rows.length,
      ...(failures.length ? { failures } : {}),
    });
  } catch (e) {
    // 500 so the timer's journal shows a real failure rather than a quiet
    // success with no data.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
