import type { Metadata } from "next";
import { Droplets, Gauge, Wind, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CHART_COLORS } from "@/lib/chart-colors";
import { TimeseriesChart, type Point } from "@/components/timeseries-chart";

export const metadata: Metadata = {
  title: "Water levels — Meander Monitor",
  description:
    "Groundwater levels around Wageningen, measured continuously and updated through the day.",
};

// The sensor uploads every six hours and we harvest hourly, so the page can
// safely be a few minutes stale. Rebuilding it more often than this only costs
// database round-trips.
export const revalidate = 600;

const WINDOW_DAYS = 7;
// Two upload cycles. Past this, a sensor is not "quiet", it is a problem worth
// saying out loud rather than drawing as a confident flat line.
const STALE_AFTER_HOURS = 13;

const PROPS = {
  level: "water_level",
  water: "water_absolute_pressure",
  air: "well_covering_barometric_pressure",
} as const;

interface Row {
  measured_at: string;
  value: number;
  value_min: number | null;
  value_max: number | null;
  unit: string;
}

const fmtWhen = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

function toPoints(rows: Row[], scale = 1): Point[] {
  return rows.map((r) => ({
    t: new Date(r.measured_at).getTime(),
    v: Number(r.value) * scale,
    lo: r.value_min == null ? null : Number(r.value_min) * scale,
    hi: r.value_max == null ? null : Number(r.value_max) * scale,
  }));
}

function StatTile({
  icon: Icon, label, value, unit, when,
}: {
  icon: typeof Droplets; label: string; value: string; unit: string; when: string | null;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold text-card-foreground">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      {when && <p className="mt-1 text-xs text-muted-foreground">{when}</p>}
    </div>
  );
}

export default async function WaterPage() {
  const supabase = await createClient();

  const { data: wells } = await supabase
    .from("water_wells")
    .select("id, name, group_name, gis_description")
    .eq("is_active", true)
    .order("name");

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // One query per well × property. PostgREST caps a response at 1000 rows on
  // most deployments, and a week of 10-minute buckets is ~1000 per series — so
  // a single combined query would silently truncate, and the truncation would
  // look like a sensor gap. Ordering newest-first and reversing means that if a
  // cap ever does bite, we lose the OLD end of the window, not the current
  // reading the page is actually about.
  const sections = await Promise.all(
    (wells ?? []).map(async (well) => {
      const series = await Promise.all(
        Object.values(PROPS).map(async (property) => {
          const { data } = await supabase
            .from("water_measurements")
            .select("measured_at, value, value_min, value_max, unit")
            .eq("well_id", well.id)
            .eq("property", property)
            .gte("measured_at", since)
            .order("measured_at", { ascending: false })
            .limit(1000);
          return [property, ((data as Row[]) ?? []).reverse()] as const;
        })
      );
      return { well, byProp: Object.fromEntries(series) as Record<string, Row[]> };
    })
  );

  const hasAnything = sections.some((s) =>
    Object.values(s.byProp).some((rows) => rows.length > 0)
  );

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10">
      <h1 className="text-3xl font-semibold">Water in the region</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        How much water the landscape around Wageningen is holding. Groundwater
        level is a good proxy for the state of the whole system — it is what
        feeds the brooks and meanders, so it sets the context for the videos
        volunteers send us.
      </p>

      {!hasAnything && (
        <div className="mt-8 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No measurements have arrived yet.
        </div>
      )}

      {sections.map(({ well, byProp }) => {
        const level = byProp[PROPS.level] ?? [];
        const water = byProp[PROPS.water] ?? [];
        const air = byProp[PROPS.air] ?? [];
        if (!level.length && !water.length && !air.length) return null;

        const newest = level.at(-1) ?? water.at(-1) ?? air.at(-1) ?? null;
        const newestAt = newest ? new Date(newest.measured_at) : null;
        const ageHours = newestAt ? (Date.now() - newestAt.getTime()) / 3_600_000 : Infinity;
        const stale = ageHours > STALE_AFTER_HOURS;
        const when = newestAt ? `at ${fmtWhen.format(newestAt)}` : null;

        const lastLevel = level.at(-1);
        const lastWater = water.at(-1);
        const lastAir = air.at(-1);

        return (
          <section key={well.id} className="mt-10">
            <h2 className="text-xl font-semibold">
              {well.group_name ?? well.name}
            </h2>
            {well.gis_description && (
              <p className="text-sm text-muted-foreground">{well.gis_description}</p>
            )}

            {/* Current situation. The timestamp is not decoration: the modem
                uploads on a six-hour cycle, so a perfectly healthy sensor can
                legitimately be hours behind — without saying when a reading is
                from, the page looks broken exactly when it isn't. */}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <StatTile
                icon={Droplets} label="Water level"
                value={lastLevel ? Number(lastLevel.value).toFixed(3) : "—"}
                unit={lastLevel?.unit ?? "m NAP"} when={when}
              />
              <StatTile
                icon={Gauge} label="Water pressure"
                value={lastWater ? (Number(lastWater.value) / 100).toFixed(1) : "—"}
                unit="hPa" when={null}
              />
              <StatTile
                icon={Wind} label="Barometric pressure"
                value={lastAir ? Number(lastAir.value).toFixed(1) : "—"}
                unit="hPa" when={null}
              />
            </div>

            {stale && newestAt && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                <span>
                  No new readings for {Math.floor(ageHours)} hours — this sensor
                  may be offline.
                </span>
              </p>
            )}

            {level.length > 0 && (
              <figure className="mt-8 rounded-xl border bg-card p-4">
                <figcaption className="mb-1 font-medium text-card-foreground">
                  Water level
                </figcaption>
                {/* A single series names itself in the caption, so no legend. */}
                <p className="mb-3 text-sm text-muted-foreground">
                  Metres above NAP, last {WINDOW_DAYS} days. The band shows the
                  spread within each measurement bucket.
                </p>
                <TimeseriesChart
                  unit={lastLevel?.unit ?? "m NAP"}
                  precision={3}
                  series={[
                    {
                      key: "level", label: "Level",
                      color: CHART_COLORS.WATER, points: toPoints(level),
                    },
                  ]}
                />
              </figure>
            )}

            {(water.length > 0 || air.length > 0) && (
              <figure className="mt-6 rounded-xl border bg-card p-4">
                <figcaption className="mb-1 font-medium text-card-foreground">
                  Pressure
                </figcaption>
                <p className="mb-3 text-sm text-muted-foreground">
                  Water level is derived from the gap between these two: the
                  water column above the sensor is what is left after air
                  pressure is subtracted. Both are shown in hPa — the API
                  reports water pressure in Pa, converted here so a single axis
                  is honest.
                </p>
                <div className="mb-3 flex flex-wrap gap-4 text-sm">
                  {[
                    { label: "Water", color: CHART_COLORS.WATER },
                    { label: "Air", color: CHART_COLORS.AIR },
                  ].map((s) => (
                    <span key={s.label} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                        aria-hidden
                      />
                      <span className="text-muted-foreground">{s.label}</span>
                    </span>
                  ))}
                </div>
                <TimeseriesChart
                  unit="hPa"
                  precision={1}
                  series={[
                    // Pa → hPa. Never plot the two raw: they differ by a factor
                    // of 100 and a shared axis would flatten the air line onto
                    // the floor.
                    {
                      key: "water", label: "Water",
                      color: CHART_COLORS.WATER, points: toPoints(water, 0.01),
                    },
                    {
                      key: "air", label: "Air",
                      color: CHART_COLORS.AIR, points: toPoints(air),
                    },
                  ]}
                />
              </figure>
            )}
          </section>
        );
      })}

      <p className="mt-10 text-xs text-muted-foreground">
        Measurements by Wageningen University &amp; Research, collected via the
        Munisense platform. Samples are taken every 15 minutes and transmitted
        in batches roughly every six hours.
      </p>
    </div>
  );
}
