"use client";

import { useId, useMemo, useState } from "react";

/**
 * A small dependency-free time-series chart.
 *
 * Hand-rolled SVG rather than a charting library: this is one line shape on a
 * public page that should stay light, and pulling in ~500 KB of JS to draw a
 * polyline is a poor trade. It also keeps full control of the marks, which the
 * house data-viz rules are specific about.
 *
 * ONE Y AXIS, ALWAYS. Never pass series of different units to the same chart —
 * a dual-scale plot invites exactly the false comparison it appears to make.
 * Two measures of different scale are two charts, or converted to a shared unit
 * first (which is what the pressure panel does: Pa → hPa).
 */

export interface Point {
  /** epoch milliseconds */
  t: number;
  /** the bucket average — the value actually plotted */
  v: number;
  /** bucket min/max, drawn as a range band when present */
  lo?: number | null;
  hi?: number | null;
}

export interface Series {
  key: string;
  label: string;
  /** Follows the ENTITY, not the series' position: water is blue wherever it
   *  appears, air is orange. A chart that renders a subset must not repaint. */
  color: string;
  points: Point[];
}

interface Props {
  series: Series[];
  /** Shared unit for every series. Required — it labels the axis. */
  unit: string;
  /** Decimal places for values. */
  precision?: number;
  className?: string;
}

// viewBox space. The SVG scales to its container; strokes are pinned to real
// pixels with vector-effect, so "2px line" stays literally true at any width.
const W = 800;
const H = 300;
const PAD = { top: 16, right: 68, bottom: 30, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Day-aligned x ticks. Running niceTicks over epoch milliseconds produces
 *  mathematically round numbers that are meaningless as dates — they drift off
 *  midnight and leave whole stretches of the axis unlabelled. */
function dayTicks(t0: number, t1: number, target = 5): number[] {
  const out: number[] = [];
  const d = new Date(t0);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);            // first midnight inside the window
  const step = Math.max(1, Math.round((t1 - t0) / 86_400_000 / target));
  for (let t = d.getTime(); t <= t1; t += step * 86_400_000) out.push(t);
  return out;
}

/** Axis ticks a human would have chosen: 1/2/5 × a power of ten. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

const fmtTime = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const fmtDay = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric", month: "short", timeZone: "Europe/Amsterdam",
});

export function TimeseriesChart({ series, unit, precision = 2, className }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length) return null;

    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    // The band participates in the domain, otherwise it clips at the edges.
    const vs = all.flatMap((p) => [p.v, p.lo ?? p.v, p.hi ?? p.v]);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }       // a dead-flat series still needs a band
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;

    const x = (t: number) => PAD.left + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * PLOT_W);
    const y = (v: number) => PAD.top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

    return { t0, t1, lo, hi, x, y, yTicks: niceTicks(lo, hi), xTicks: dayTicks(t0, t1) };
  }, [series]);

  if (!model) {
    return (
      <div className={`flex h-48 items-center justify-center rounded-lg border text-sm text-muted-foreground ${className ?? ""}`}>
        No readings in this period
      </div>
    );
  }

  const { x, y, yTicks, t0, t1 } = model;

  // The hovered index is resolved per series against a shared timestamp, so the
  // crosshair reads one moment across every line rather than one point per line.
  const ticks = series[0]?.points ?? [];
  const hoveredT = hover != null ? ticks[hover]?.t : null;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / box.width;
    const t = t0 + frac * (t1 - t0);
    // Nearest sample, not the one to the left — the crosshair should snap to
    // whatever the pointer is actually closest to.
    let best = 0;
    let bestD = Infinity;
    ticks.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHover(best);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${series.map((s) => s.label).join(", ")} over time, in ${unit}`}
      >
        {/* Gridlines are recessive: hairline, border token, behind everything. */}
        {yTicks.map((v) => (
          <line
            key={v} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
            stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}

        {yTicks.map((v) => (
          <text
            key={`l${v}`} x={PAD.left - 10} y={y(v)} textAnchor="end" dominantBaseline="middle"
            fontSize={12} fill="var(--muted-foreground)" style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {v.toFixed(precision)}
          </text>
        ))}

        {model.xTicks.map((t) => (
          <text
            key={`x${t}`} x={x(t)} y={H - 10} textAnchor="middle"
            fontSize={12} fill="var(--muted-foreground)"
          >
            {fmtDay.format(new Date(t))}
          </text>
        ))}

        {/* Drawn in LAYERS, not per series: every band, then every line, then
            every label. Completing one series before starting the next lets a
            later series' translucent band tint over an earlier series' line. */}
        {series.map((s) => {
          // Most buckets come back with min == max (the water table barely
          // moves inside 10 minutes), so this is usually skipped entirely —
          // which is right. A band drawn where there is no spread is a blur,
          // not information.
          const hasBand = s.points.some(
            (p) => p.lo != null && p.hi != null && p.lo !== p.hi
          );
          if (!hasBand) return null;
          const band = [
            ...s.points.map((p) => `${x(p.t)},${y(p.hi ?? p.v)}`),
            ...[...s.points].reverse().map((p) => `${x(p.t)},${y(p.lo ?? p.v)}`),
          ].join(" ");
          return (
            <polygon key={`band-${s.key}`} points={band} fill={s.color} opacity={0.2} />
          );
        })}

        {series.map((s) => {
          if (!s.points.length) return null;
          const path = s.points
            .map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.v)}`)
            .join("");
          return (
            <g key={`line-${s.key}`}>
              {/* Surface-coloured halo, ONLY where lines can actually cross.
                  On a single-series chart it has nothing to separate and instead
                  eats the inner edge of the band, which then reads as a drop
                  shadow rather than as the spread of the measurements. */}
              {series.length > 1 && (
                <path
                  d={path} fill="none" stroke="var(--card)" strokeWidth={5}
                  strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={path} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* Direct labels last, so nothing can draw over them. Not decoration:
            the orange step sits below 3:1 on this cream surface, and a visible
            label is the required relief for that. */}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          if (!last) return null;
          return (
            <text
              key={`label-${s.key}`} x={x(last.t) + 8} y={y(last.v)} dominantBaseline="middle"
              fontSize={12} fontWeight={600} fill="var(--foreground)"
            >
              {s.label}
            </text>
          );
        })}

        {/* Crosshair */}
        {hoveredT != null && (
          <g pointerEvents="none">
            <line
              x1={x(hoveredT)} x2={x(hoveredT)} y1={PAD.top} y2={PAD.top + PLOT_H}
              stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            {series.map((s) => {
              const p = s.points.find((q) => q.t === hoveredT);
              if (!p) return null;
              return (
                <circle
                  key={s.key} cx={x(p.t)} cy={y(p.v)} r={5}
                  fill={s.color} stroke="var(--card)" strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        )}

        {/* Hit area spans the whole plot, so the pointer never has to find a
            2px line. */}
        <rect
          x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H}
          fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        />
        <desc id={uid}>{series.length} series plotted in {unit}</desc>
      </svg>

      {/* Tooltip in HTML rather than SVG — real text rendering, real wrapping.
          Positioned as a percentage of the viewBox so it tracks the scaled SVG. */}
      {hoveredT != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm"
          style={{ left: `${(x(hoveredT) / W) * 100}%` }}
        >
          <div className="mb-1 font-medium text-popover-foreground">
            {fmtTime.format(new Date(hoveredT))}
          </div>
          {series.map((s) => {
            const p = s.points.find((q) => q.t === hoveredT);
            if (!p) return null;
            return (
              <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                {/* Text stays in ink tokens; the swatch beside it carries identity. */}
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto font-medium tabular-nums text-popover-foreground">
                  {p.v.toFixed(precision)} {unit}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
