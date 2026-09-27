/**
 * A chart block after the server has read and checked it: what the page
 * carries in data-chart and what <art-chart> draws. The server's parser
 * (app/src/lib/pipeline/chart.ts) is the only thing that writes one.
 */

export type ChartType = "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";

/** How numbers read: 1,234 / 1.2k / 12% (from 0.12) / $1,234. */
export type ChartFormat = "number" | "compact" | "percent" | "currency";

export interface NumberStyle {
  format?: ChartFormat;
  /** ISO code for currency, USD unless set. */
  currency?: string;
  decimals?: number;
  unit?: string;
}

export type Curve = "smooth" | "straight" | "step";

/** How one y key is drawn when it differs from the chart's type. */
export interface ChartSeries {
  as?: "bar" | "line" | "area";
  axis?: "left" | "right";
  /** A palette slot, 1 to 6, or a tone: good, warn, bad, info, muted. */
  color?: number | string;
  dash?: boolean;
  curve?: Curve;
  /** Drawn but switched off in the legend until someone turns it on. */
  hidden?: boolean;
}

/** A value axis (left, right) or the category axis (x). */
export interface ChartAxis extends NumberStyle {
  title?: string;
  min?: number;
  max?: number;
  log?: boolean;
}

/**
 * Something drawn on the chart that is not data: a line at a value (a budget,
 * a target), a line at one category, or a shaded range of categories.
 */
export type ChartMark =
  | { kind: "value"; value: number; axis: "left" | "right"; label?: string; tone?: string }
  | { kind: "at"; at: string | number; label?: string; tone?: string }
  | { kind: "band"; from: string | number; to: string | number; label?: string; tone?: string };

export interface ChartSpec extends NumberStyle {
  type: ChartType;
  title?: string;
  x: string;
  y: string[];
  data: Record<string, unknown>[];
  stacked: boolean;
  height: number;
  /** Stacked to 100%: each column shows shares of its total. */
  percent?: boolean;
  /** Bars run sideways, categories down the left. */
  horizontal?: boolean;
  series?: Record<string, ChartSeries>;
  axes?: { x?: ChartAxis; left?: ChartAxis; right?: ChartAxis };
  marks?: ChartMark[];
  /** Values written on the bars, points or slices. */
  labels?: boolean;
  legend?: "top" | "bottom" | "none";
  curve?: Curve;
  /** Scatter: the key whose values split the points into colored groups. */
  group?: string;
  /** Scatter: the key that names each point in its tooltip. */
  label?: string;
  /** Scatter: the key that sizes each point, which makes it a bubble chart. */
  size?: string;
  /** Scatter: join each group's points in x order. */
  line?: boolean;
  /** Scatter: a least-squares line through each group. */
  trend?: "linear";
  /** Pie and doughnut: the words under the total in the middle of a doughnut. */
  center?: string;
}
