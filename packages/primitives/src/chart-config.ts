/**
 * The Chart.js configuration for an <art-chart>, built from the page's spec
 * and the theme's colors. Kept apart from the element and free of the DOM, so
 * what a spec draws can be tested without a canvas.
 */
import type { ChartAxis, ChartSpec, Curve, NumberStyle } from "./chart-spec";
import { centerPlugin, marksPlugin, scaleIds, valueLabelsPlugin, type Any, type ChartTheme, type Layouts } from "./chart-draw";

export type { ChartSpec } from "./chart-spec";
export { marksPlugin, type ChartTheme, type Layouts } from "./chart-draw";

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** A value, or null when the row leaves it out: a gap in a line, no bar in the group. */
export function toValue(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  return toNumber(value);
}

/** A translucent twin of a color, for area fills and dashed bars. */
function translucent(color: string, alpha = 0.25): string {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return `${c}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  return `color-mix(in srgb, ${c} ${Math.round(alpha * 100)}%, transparent)`;
}

/** "41 min", but "12%" and "20°": a unit that is a sign sits against its number. */
export function withUnit(value: unknown, unit: string | undefined): string {
  if (!unit) return String(value);
  return /^[%°‰′″]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** A number as the chart's style reads it: 1,234 / 1.2K / 12% / $1,234, then its unit. */
export function formatNumber(value: number, style: NumberStyle = {}): string {
  if (!Number.isFinite(value)) return String(value);
  const { format, currency, decimals, unit } = style;
  let options: Intl.NumberFormatOptions;
  switch (format) {
    case "compact":
      options = { notation: "compact", maximumFractionDigits: decimals ?? 1 };
      break;
    case "percent":
      options = { style: "percent", maximumFractionDigits: decimals ?? 1 };
      break;
    case "currency":
      options = { style: "currency", currency: currency ?? "USD", minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 };
      break;
    default:
      options = { maximumFractionDigits: decimals ?? 3 };
  }
  if (decimals !== undefined && format !== "currency") options.minimumFractionDigits = decimals;
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(undefined, options)));
  return withUnit(f.format(value), unit);
}

type Side = "left" | "right";

const lineShape = (curve: Curve | undefined) =>
  curve === "step" ? { tension: 0, stepped: "middle" as const } : { tension: curve === "straight" ? 0 : 0.32, stepped: false };

/** Least squares through the points: two ends of the line that fits them. */
export function trendLine(points: { x: number; y: number }[]): { x: number; y: number }[] | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return [
    { x: lo, y: my + slope * (lo - mx) },
    { x: hi, y: my + slope * (hi - mx) },
  ];
}

/** Largest radius a bubble gets, in pixels. Area, not radius, follows the value. */
const BUBBLE_MAX = 22;

/** More slices than this and the smallest fold into one "Other". */
const MAX_SLICES = 6;

/** The Chart.js type, data and options a spec draws as. */
export function chartConfig(spec: ChartSpec, theme: ChartTheme, layouts?: Layouts): { type: string; data: Any; options: Any; plugins: Any[] } {
  const { palette, text, muted, border, surface, font } = theme;
  const isRound = spec.type === "pie" || spec.type === "doughnut";
  const isScatter = spec.type === "scatter";
  const isBubble = isScatter && !!spec.size;
  const horizontal = spec.horizontal === true && spec.type === "bar";
  const ids = scaleIds(horizontal);
  const stacked = spec.stacked === true;
  const percent = stacked && spec.percent === true;

  const axisOf = (key: string): Side => spec.series?.[key]?.axis ?? "left";
  // The left axis takes the chart's own style; the right has only its own.
  const styleOf = (side: Side): NumberStyle => {
    const own = spec.axes?.[side] ?? {};
    const base: NumberStyle = side === "left" ? { format: spec.format, currency: spec.currency, decimals: spec.decimals, unit: spec.unit } : {};
    return { format: own.format ?? base.format, currency: own.currency ?? base.currency, decimals: own.decimals ?? base.decimals, unit: own.unit ?? base.unit };
  };
  const hasRight = !isRound && spec.y.some((key) => axisOf(key) === "right");
  const colorOf = (key: string, i: number): string => {
    const c = spec.series?.[key]?.color;
    if (typeof c === "number") return palette[(c - 1) % palette.length];
    if (c === "muted") return palette[palette.length - 1] ?? muted;
    if (typeof c === "string") return theme.tones[c] ?? palette[i % palette.length];
    return palette[i % palette.length];
  };

  let labels = spec.data.map((row) => String(row[spec.x] ?? ""));
  let datasets: Record<string, unknown>[];
  /** Per dataset and point: the words for a value label and a tooltip. */
  let valueText: (di: number, i: number) => string | null;
  let tooltipLabel: (item: Any) => string;
  let tooltipTitle: ((items: Any[]) => string) | undefined;

  if (isRound) {
    // One ring: slices in order, the smallest folded into Other past six.
    let slices = spec.data.map((row) => ({ label: String(row[spec.x] ?? ""), value: toNumber(row[spec.y[0]]) }));
    let other = false;
    if (slices.length > MAX_SLICES) {
      const sorted = [...slices].sort((a, b) => b.value - a.value);
      const kept = sorted.slice(0, MAX_SLICES - 1);
      const rest = sorted.slice(MAX_SLICES - 1).reduce((s, x) => s + x.value, 0);
      slices = [...kept, { label: "Other", value: rest }];
      other = true;
    }
    labels = slices.map((s) => s.label);
    const total = slices.reduce((s, x) => s + x.value, 0);
    const style = styleOf("left");
    datasets = [
      {
        label: spec.y[0] ?? "",
        data: slices.map((s) => s.value),
        // The last palette slot is the muted one, kept for Other.
        backgroundColor: slices.map((_, i) => (other && i === slices.length - 1 ? palette[palette.length - 1] : palette[i % palette.length])),
        borderColor: surface,
        borderWidth: 1.5,
      },
    ];
    const share = (v: number) => formatNumber(total ? v / total : 0, { format: "percent", decimals: 0 });
    valueText = (_di, i) => share(slices[i]?.value ?? 0);
    tooltipLabel = (item) => `${item.label}: ${formatNumber(item.raw, style)} (${share(item.raw)})`;
    const plugins: Any[] = [];
    if (spec.labels) plugins.push(valueLabelsPlugin({ theme, horizontal: false, stacked: false, round: true, text: valueText }));
    if (spec.type === "doughnut") plugins.push(centerPlugin(theme, formatNumber(total, { ...style, format: style.format === "percent" ? undefined : style.format }), spec.center));
    return finish(plugins);
  }

  if (isScatter) {
    // One set per group (or per y key), each point carrying what its tooltip says.
    const groups: { name: string; key: string; rows: Record<string, unknown>[] }[] = [];
    if (spec.group) {
      for (const row of spec.data) {
        const name = String(row[spec.group] ?? "");
        let g = groups.find((x) => x.name === name);
        if (!g) groups.push((g = { name, key: spec.y[0], rows: [] }));
        g.rows.push(row);
      }
    } else for (const key of spec.y) groups.push({ name: key, key, rows: spec.data });

    const sizes = isBubble ? spec.data.map((row) => Math.abs(toNumber(row[spec.size!]))) : [];
    const biggest = Math.max(1e-9, ...sizes);
    datasets = [];
    groups.forEach((g, gi) => {
      const color = colorOf(g.key, gi);
      const points = g.rows
        .map((row) => ({
          x: toNumber(row[spec.x]),
          y: toNumber(row[g.key]),
          ...(spec.label ? { name: String(row[spec.label] ?? "") } : {}),
          ...(isBubble ? { r: Math.max(2, BUBBLE_MAX * Math.sqrt(Math.abs(toNumber(row[spec.size!])) / biggest)), size: toNumber(row[spec.size!]) } : {}),
        }))
        .sort((a, b) => (spec.line ? a.x - b.x : 0));
      datasets.push({
        label: g.name,
        data: points,
        backgroundColor: isBubble ? translucent(color, 0.55) : color,
        borderColor: color,
        borderWidth: isBubble ? 1.5 : 0,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        showLine: spec.line === true,
        tension: 0,
        hidden: spec.series?.[g.key]?.hidden === true && !spec.group ? true : undefined,
      });
      if (spec.trend) {
        const fit = trendLine(points);
        if (fit)
          datasets.push({
            type: "line",
            label: `${g.name} trend`,
            data: fit,
            borderColor: color,
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            artTrend: true,
          });
      }
    });
    const xStyle: NumberStyle = spec.axes?.x ?? {};
    const yStyle = styleOf("left");
    valueText = (di, i) => {
      const p = (datasets[di].data as Any[])[i];
      return p?.name ?? formatNumber(p?.y, yStyle);
    };
    tooltipTitle = (items) => items[0]?.raw?.name ?? "";
    tooltipLabel = (item) => {
      const p = item.raw;
      // Grouped, the set is the group and the value is the one y key; otherwise the set is the y key.
      const yName = spec.group ? spec.y[0] : item.dataset.label;
      const bits = [`${spec.x} ${formatNumber(p.x, xStyle)}`, `${yName} ${formatNumber(p.y, yStyle)}`];
      if (isBubble) bits.push(`${spec.size} ${formatNumber(p.size, {})}`);
      return `${spec.group ? `${item.dataset.label}: ` : ""}${bits.join(", ")}`;
    };
  } else {
    // Bars, lines and areas along categories.
    const barKeys = spec.y.filter((k) => (spec.series?.[k]?.as ?? spec.type) === "bar");
    const totals = percent ? spec.data.map((row) => spec.y.reduce((s, k) => s + (axisOf(k) === "left" ? Math.abs(toNumber(row[k])) : 0), 0)) : [];
    let firstArea = true;
    datasets = spec.y.map((key, i) => {
      const color = colorOf(key, i);
      const s = spec.series?.[key] ?? {};
      const drawn = s.as ?? spec.type;
      const bar = drawn === "bar";
      const area = drawn === "area";
      const line = drawn === "line" || area;
      const side = axisOf(key);
      const raw = spec.data.map((row) => toValue(row[key]));
      const values = percent && side === "left" ? raw.map((v, r) => (v === null ? null : totals[r] ? v / totals[r] : 0)) : raw;
      // The last bar of a stack gets the rounded cap, or every joint shows a notch.
      const capped = !(bar && stacked) || key === barKeys[barKeys.length - 1];
      const radius = horizontal ? { topLeft: 0, bottomLeft: 0, topRight: 5, bottomRight: 5 } : { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 };
      const dataset: Record<string, unknown> = {
        label: key,
        data: values,
        artRaw: raw,
        // A solid bar reads as one shape; a dashed one reads as not yet real.
        borderColor: bar && !s.dash ? "transparent" : color,
        backgroundColor: bar ? (s.dash ? translucent(color, 0.28) : color) : area ? translucent(color) : color,
        borderWidth: bar ? (s.dash ? 1.5 : 0) : 2,
        borderDash: s.dash ? [6, 4] : undefined,
        borderRadius: bar && capped ? radius : 0,
        borderSkipped: false,
        maxBarThickness: 52,
        categoryPercentage: 0.74,
        barPercentage: 0.86,
        // A group missing a series closes up instead of leaving a hole.
        skipNull: true,
        fill: area ? (stacked && !firstArea ? "-1" : "origin") : false,
        ...lineShape(s.curve ?? spec.curve),
        pointRadius: line ? (spec.type === "bar" || spec.labels ? 2.5 : 0) : 3,
        pointHoverRadius: 4,
        hoverBackgroundColor: bar ? (s.dash ? translucent(color, 0.4) : color) : undefined,
        hoverBorderColor: color,
        hidden: s.hidden === true ? true : undefined,
        // Lines drawn over bars sit in front of them.
        order: line && spec.type === "bar" ? 0 : 1,
      };
      if (area) firstArea = false;
      if (drawn !== spec.type) dataset.type = line ? "line" : "bar";
      if (horizontal) dataset.xAxisID = side === "right" ? ids.right : ids.left;
      else dataset.yAxisID = side === "right" ? ids.right : ids.left;
      // Bars stack with bars and areas with areas; a line mixed into bars stands alone.
      if (stacked) dataset.stack = drawn === spec.type ? "stack" : `own-${i}`;
      return dataset;
    });
    const sideStyle = (di: number) => styleOf(axisOf(spec.y[di] ?? ""));
    valueText = (di, i) => {
      const d = datasets[di];
      const v = (d.data as (number | null)[])[i];
      if (v === null || v === undefined) return null;
      if (percent && axisOf(spec.y[di]) === "left") return formatNumber(v, { format: "percent", decimals: 0 });
      return formatNumber(v, sideStyle(di));
    };
    tooltipLabel = (item) => {
      const d = datasets[item.datasetIndex];
      const raw = (d.artRaw as (number | null)[])[item.dataIndex] ?? 0;
      const own = formatNumber(raw, sideStyle(item.datasetIndex));
      const shown = percent && axisOf(spec.y[item.datasetIndex]) === "left" ? `${formatNumber(item.raw, { format: "percent" })} (${own})` : own;
      return `${item.dataset.label}: ${shown}`;
    };
  }

  // Grid lines are scaffolding: hairlines along the values, none across.
  const tickFont = { family: font, size: 11, weight: 500 as const };
  const titleOf = (axis: ChartAxis | undefined) =>
    axis?.title ? { display: true, text: axis.title, color: muted, font: { family: font, size: 11.5, weight: 600 as const }, padding: { top: 4, bottom: 2 } } : undefined;

  // A mark's value always shows: the axis stretches to reach it.
  const markValues = (side: Side) =>
    (spec.marks ?? []).flatMap((m) => (m.kind === "value" && m.axis === side ? [m.value] : []));

  const valueScale = (side: Side) => {
    const axis = spec.axes?.[side];
    const style = percent && side === "left" ? { format: "percent" as const, decimals: 0 } : styleOf(side);
    const values = markValues(side);
    const scale: Record<string, unknown> = {
      type: axis?.log ? "logarithmic" : "linear",
      axis: horizontal ? "x" : "y",
      stacked: stacked && side === "left",
      beginAtZero: !axis?.log,
      ticks: { color: muted, font: tickFont, padding: 8, maxTicksLimit: 6, callback: (value: unknown) => formatNumber(Number(value), style) },
      grid: side === "left" ? { color: border, lineWidth: 1, drawTicks: false } : { display: false, drawOnChartArea: false },
      border: { display: false, dash: [3, 4] },
    };
    if (side === "right") scale.position = horizontal ? "top" : "right";
    if (values.length) {
      scale.suggestedMax = Math.max(...values);
      scale.suggestedMin = Math.min(0, ...values);
    }
    if (percent && side === "left") scale.max = 1;
    // Room above the tallest bar for its value.
    else if (spec.labels) scale.grace = "8%";
    if (axis?.min !== undefined) scale.min = axis.min;
    if (axis?.max !== undefined) scale.max = axis.max;
    const title = titleOf(axis);
    if (title) scale.title = title;
    return scale;
  };

  const category: Record<string, unknown> = {
    stacked,
    ticks: { color: muted, font: tickFont, padding: 6, autoSkipPadding: 12, ...(horizontal ? { autoSkip: false } : {}) },
    grid: { display: false },
    border: { display: false },
  };
  if (horizontal) category.axis = "y";
  const xTitle = titleOf(spec.axes?.x);
  if (xTitle) category.title = xTitle;
  if (isScatter) {
    const x = spec.axes?.x ?? {};
    category.type = x.log ? "logarithmic" : "linear";
    category.position = "bottom";
    category.ticks = { ...(category.ticks as object), callback: (value: unknown) => formatNumber(Number(value), x) };
    // Both directions are values on a scatter chart, so both get hairlines.
    category.grid = { color: border, lineWidth: 1, drawTicks: false };
    if (x.min !== undefined) category.min = x.min;
    if (x.max !== undefined) category.max = x.max;
  }

  const scales: Record<string, unknown> = { [ids.category]: category, [ids.left]: valueScale("left") };
  if (hasRight) scales[ids.right] = valueScale("right");

  const plugins: Any[] = [];
  if (spec.marks?.length) plugins.push(marksPlugin(spec, theme, labels, layouts));
  if (spec.labels) plugins.push(valueLabelsPlugin({ theme, horizontal, stacked, round: false, text: valueText }));
  return finish(plugins, scales);

  function finish(extra: Any[], scaleConfig?: Record<string, unknown>) {
    const valueLines = (spec.marks ?? []).some((m) => m.kind !== "band");
    const legendShown = spec.legend !== "none" && (isRound || datasets.filter((d) => !d.artTrend).length > 1);
    return {
      type: isBubble ? "bubble" : spec.type === "area" ? "line" : spec.type,
      data: { labels: isScatter ? undefined : labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: horizontal ? "y" : "x",
        layout: { padding: { top: valueLines ? 8 : 4, right: 4 } },
        // Along categories a tooltip lists every series at that spot; on a scatter it is one point.
        interaction: isScatter ? { mode: "nearest", intersect: true } : { mode: "index", intersect: false },
        ...(spec.type === "doughnut" ? { cutout: "62%" } : {}),
        plugins: {
          legend: {
            display: legendShown,
            position: spec.legend === "bottom" ? "bottom" : "top",
            align: "start",
            labels: {
              color: muted,
              font: { family: font, size: 11.5 },
              boxWidth: 7,
              boxHeight: 7,
              padding: 14,
              usePointStyle: true,
              pointStyle: "circle",
              // Trend lines explain themselves; the legend lists the data.
              filter: (item: { datasetIndex?: number }) => !(item.datasetIndex !== undefined && datasets[item.datasetIndex]?.artTrend),
              // In the order the y keys were written, not the order they are drawn in.
              sort: (a: { datasetIndex?: number; index?: number }, b: { datasetIndex?: number; index?: number }) =>
                (a.datasetIndex ?? a.index ?? 0) - (b.datasetIndex ?? b.index ?? 0),
            },
          },
          tooltip: {
            backgroundColor: surface,
            titleColor: text,
            bodyColor: muted,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: font, size: 12, weight: 600 },
            bodyFont: { family: font, size: 12 },
            bodySpacing: 5,
            boxWidth: 7,
            boxHeight: 7,
            usePointStyle: true,
            filter: (item: { datasetIndex: number }) => !datasets[item.datasetIndex]?.artTrend,
            callbacks: { label: tooltipLabel, ...(tooltipTitle ? { title: tooltipTitle } : {}) },
          },
        },
        scales: isRound ? undefined : scaleConfig,
      },
      plugins: extra,
    };
  }
}

/** What a screen reader hears for the canvas: the chart's kind and what it plots. */
export function chartSummary(spec: ChartSpec): string {
  const kind = spec.horizontal ? "horizontal bar" : spec.type === "scatter" && spec.size ? "bubble" : spec.percent ? "100% stacked bar" : spec.type;
  const what = spec.y.join(", ");
  const head = spec.title ? `${spec.title}. ` : "";
  return `${head}${kind[0].toUpperCase()}${kind.slice(1)} chart of ${what} by ${spec.x}, ${spec.data.length} ${spec.data.length === 1 ? "point" : "points"}. The data follows as a table.`;
}
