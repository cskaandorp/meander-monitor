/**
 * Series colours for the public charts.
 *
 * Colour follows the ENTITY, not the series' position in a list: water is blue
 * wherever it appears, air is orange. So a chart rendering a subset of series
 * never repaints the survivors, and the water-level chart agrees with the
 * pressure chart without anyone having to notice.
 *
 * These two were validated as a categorical pair against the WUR card surface
 * (#f3ecd3), not against a generic white — contrast and CVD results are only
 * meaningful against the surface the chart actually renders on:
 *
 *   CVD separation      ΔE 24.7 (protan), 32.7 (tritan)   — target ≥ 8
 *   Normal vision       ΔE 33.6                            — floor ≥ 15
 *   Lightness band      both inside L 0.43–0.77
 *
 * One caveat, and it is load-bearing: AIR sits at 2.7:1 against the cream
 * surface, below the 3:1 bar. That is legal only with relief — which is why
 * every chart using it ships a visible direct label at the line end. Don't drop
 * those labels to "clean up" a chart; they are the accessibility mitigation.
 *
 * WUR's own primary green (#004d00) was tried first and fails the lightness
 * band at L 0.364 — too dark to read as a data mark rather than as ink.
 */
export const CHART_COLORS = {
  /** Water: level, and the pressure of the water column. */
  WATER: "#2a78d6",
  /** Air: barometric pressure. */
  AIR: "#eb6834",
} as const;
