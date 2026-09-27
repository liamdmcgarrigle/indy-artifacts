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

/** Equal ranges with round edges (5, 10, 25, 50...) covering lo to hi, about `wanted` of them. */
export function niceBins(lo: number, hi: number, wanted: number): { lo: number; width: number; n: number } {
  if (hi <= lo) return { lo: Math.floor(lo), width: 1, n: 1 };
  const raw = (hi - lo) / wanted;
  const power = 10 ** Math.floor(Math.log10(raw));
  const width = [1, 2, 2.5, 5, 10].map((m) => m * power).find((w) => w >= raw) ?? 10 * power;
  const start = Math.floor(lo / width) * width;
  // The top value goes in the last range rather than opening one past it.
  const n = Math.max(1, Math.ceil((hi - start) / width));
  return { lo: start, width, n };
}

/** The Chart.js chart type each spec type draws as, where they differ. */
const CHARTJS_TYPE: Record<string, string> = {
  area: "line",
  histogram: "bar",
  waterfall: "bar",
  funnel: "bar",
  heatmap: "matrix",
  box: "boxplot",
  sankey: "sankey",
};

/** Largest radius a bubble gets, in pixels. Area, not radius, follows the value. */
const BUBBLE_MAX = 22;

/** More slices than this and the smallest fold into one "Other". */
const MAX_SLICES = 6;

/** One bar, point, slice, cell or flow, in words: which series, which x, and its value. */
export interface ChartPoint {
  series: string;
  x: string;
  value: string;
}

/** The Chart.js type, data and options a spec draws as, and how to name any one of its marks. */
export function chartConfig(
  spec: ChartSpec,
  theme: ChartTheme,
  layouts?: Layouts,
): { type: string; data: Any; options: Any; plugins: Any[]; describe: (datasetIndex: number, index: number) => ChartPoint | null } {
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
  let tooltipLabel: ((item: Any) => string) | undefined;
  let tooltipTitle: ((items: Any[]) => string) | undefined;

  if (spec.type === "sankey") {
    // Flows between named stages. Each stage keeps one color, and each flow is the solid color of the stage it leaves.
    const style = styleOf("left");
    const to = spec.y[0];
    const value = spec.value ?? "value";
    const flows = spec.data.map((row) => ({ from: String(row[spec.x]), to: String(row[to]), flow: toNumber(row[value]) }));
    const nodes: string[] = [];
    for (const f of flows) for (const n of [f.from, f.to]) if (!nodes.includes(n)) nodes.push(n);
    const nodeColor = (name: string) => palette[nodes.indexOf(name) % (palette.length - 1 || 1)];
    datasets = [
      {
        label: value,
        data: flows,
        colorFrom: (c: Any) => nodeColor(c.dataset.data[c.dataIndex]?.from),
        colorTo: (c: Any) => nodeColor(c.dataset.data[c.dataIndex]?.to),
        colorMode: "from",
        alpha: 0.55,
        borderWidth: 0,
        nodeWidth: 12,
        nodePadding: 14,
        size: "max",
        color: text,
        font: { family: font, size: 11.5, weight: 500 },
      },
    ];
    valueText = (_di, i) => formatNumber(flows[i].flow, style);
    tooltipTitle = () => "";
    tooltipLabel = (item) => `${item.raw.from} → ${item.raw.to}: ${formatNumber(item.raw.flow, style)}`;
    return finish([]);
  }

  if (spec.type === "heatmap") {
    // A cell per x and y value, darker for bigger numbers.
    const style = styleOf("left");
    const rowKey = spec.y[0];
    const value = spec.value ?? "value";
    const xs: string[] = [];
    const ys: string[] = [];
    for (const row of spec.data) {
      if (!xs.includes(String(row[spec.x]))) xs.push(String(row[spec.x]));
      if (!ys.includes(String(row[rowKey]))) ys.push(String(row[rowKey]));
    }
    const cells = spec.data.map((row) => ({ x: String(row[spec.x]), y: String(row[rowKey]), v: toValue(row[value]) }));
    const known = cells.map((c) => c.v).filter((v): v is number => v !== null);
    const lo = Math.min(...known);
    const span = Math.max(...known) - lo || 1;
    const share = (v: number | null) => (v === null ? 0 : (v - lo) / span);
    const color = palette[0];
    datasets = [
      {
        label: value,
        data: cells,
        backgroundColor: (c: Any) => {
          const v = c.dataset.data[c.dataIndex]?.v ?? null;
          return v === null ? "transparent" : translucent(color, 0.08 + 0.92 * share(v));
        },
        borderColor: surface,
        borderWidth: 1,
        borderRadius: 3,
        width: (c: Any) => Math.max(1, (c.chart.chartArea?.width ?? 0) / xs.length - 2),
        height: (c: Any) => Math.max(1, (c.chart.chartArea?.height ?? 0) / ys.length - 2),
        artShare: cells.map((c) => share(c.v)),
      },
    ];
    valueText = (_di, i) => (cells[i].v === null ? null : formatNumber(cells[i].v!, style));
    tooltipTitle = (items) => `${items[0]?.raw?.y} · ${items[0]?.raw?.x}`;
    tooltipLabel = (item) => `${value}: ${item.raw.v === null ? "no value" : formatNumber(item.raw.v, style)}`;
    const axis = (labels: string[], position: string) => ({
      type: "category",
      labels,
      offset: true,
      position,
      ticks: { color: muted, font: { family: font, size: 11, weight: 500 }, padding: 4, autoSkip: false },
      grid: { display: false },
      border: { display: false },
    });
    const extra = spec.labels ? [valueLabelsPlugin({ theme, horizontal: false, stacked: false, round: false, text: valueText })] : [];
    // Rows read top to bottom in the order the data gives them; the matrix plugin would flip them.
    return finish(extra, { x: axis(xs, "top"), y: { ...axis(ys, "left"), reverse: false } });
  }

  if (spec.type === "funnel") {
    // Stages as centered bars, narrowing as people drop out.
    const key = spec.y[0];
    const style = styleOf("left");
    const values = spec.data.map((row) => toNumber(row[key]));
    const first = values[0] || 1;
    datasets = [
      {
        label: key,
        data: values.map((v) => [-v / 2, v / 2]),
        backgroundColor: values.map((_, i) => translucent(palette[0], 1 - (0.55 * i) / Math.max(1, values.length - 1))),
        borderWidth: 0,
        borderRadius: 4,
        borderSkipped: false,
        categoryPercentage: 0.9,
        barPercentage: 0.94,
        xAxisID: "x",
        artOutside: true,
      },
    ];
    const pct = (a: number, b: number) => formatNumber(b ? a / b : 0, { format: "percent", decimals: 0 });
    valueText = (_di, i) => `${formatNumber(values[i], style)} · ${pct(values[i], first)}`;
    tooltipLabel = (item) => {
      const i = item.dataIndex;
      const bits = [formatNumber(values[i], style), `${pct(values[i], first)} of the first stage`];
      if (i > 0) bits.push(`${pct(values[i], values[i - 1])} of the one before`);
      return bits.join(", ");
    };
    const extra = spec.labels ? [valueLabelsPlugin({ theme, horizontal: true, stacked: true, round: false, text: valueText })] : [];
    return finish(extra, {
      y: { ticks: { color: muted, font: { family: font, size: 11.5, weight: 500 }, autoSkip: false }, grid: { display: false }, border: { display: false } },
      x: { display: false, min: -first / 2, max: first / 2 },
    });
  }

  if (spec.type === "box") {
    // Quartiles and whiskers per x value, from the raw values or the five numbers given.
    labels = [];
    for (const row of spec.data) if (!labels.includes(String(row[spec.x]))) labels.push(String(row[spec.x]));
    const style = styleOf("left");
    const keys = spec.stats ? ["box"] : spec.y;
    datasets = keys.map((key, i) => {
      const color = palette[i % palette.length];
      const data = labels.map((label) => {
        const rows = spec.data.filter((row) => String(row[spec.x]) === label);
        if (spec.stats) {
          const r = rows[0] ?? {};
          return { min: toNumber(r.min), q1: toNumber(r.q1), median: toNumber(r.median), q3: toNumber(r.q3), max: toNumber(r.max) };
        }
        return rows.map((row) => toValue(row[key])).filter((v): v is number => v !== null);
      });
      return {
        label: spec.stats ? spec.title ?? "values" : key,
        data,
        backgroundColor: translucent(color, 0.3),
        borderColor: color,
        borderWidth: 1.5,
        medianColor: color,
        outlierBackgroundColor: color,
        outlierBorderColor: color,
        outlierRadius: 2.5,
        itemRadius: 0,
        coef: 1.5,
        maxBarThickness: 52,
        categoryPercentage: 0.74,
        barPercentage: 0.86,
      };
    });
    valueText = () => null;
    tooltipLabel = undefined;
    const valueAxis = spec.horizontal ? "x" : "y";
    const categoryAxis = spec.horizontal ? "y" : "x";
    const axis = spec.axes?.left;
    const value: Record<string, unknown> = {
      beginAtZero: false,
      ticks: { color: muted, font: { family: font, size: 11, weight: 500 }, padding: 8, maxTicksLimit: 6, callback: (v: unknown) => formatNumber(Number(v), style) },
      grid: { color: border, lineWidth: 1, drawTicks: false },
      border: { display: false },
    };
    if (axis?.min !== undefined) value.min = axis.min;
    if (axis?.max !== undefined) value.max = axis.max;
    if (axis?.title) value.title = { display: true, text: axis.title, color: muted, font: { family: font, size: 11.5, weight: 600 } };
    const category: Record<string, unknown> = { ticks: { color: muted, font: { family: font, size: 11, weight: 500 } }, grid: { display: false }, border: { display: false } };
    if (spec.axes?.x?.title) category.title = { display: true, text: spec.axes.x.title, color: muted, font: { family: font, size: 11.5, weight: 600 } };
    return finish([], { [valueAxis]: value, [categoryAxis]: category });
  }

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

  if (spec.type === "radar") {
    // One ring per y key, spokes for the x values.
    const style = styleOf("left");
    datasets = spec.y.map((key, i) => {
      const color = colorOf(key, i);
      return {
        label: key,
        data: spec.data.map((row) => toValue(row[key])),
        borderColor: color,
        backgroundColor: translucent(color, 0.18),
        borderWidth: 2,
        borderDash: spec.series?.[key]?.dash ? [6, 4] : undefined,
        pointRadius: 2.5,
        pointHoverRadius: 4,
        pointBackgroundColor: color,
        hidden: spec.series?.[key]?.hidden === true ? true : undefined,
        fill: true,
      };
    });
    const axis = spec.axes?.left ?? {};
    const r: Record<string, unknown> = {
      beginAtZero: true,
      angleLines: { color: border },
      grid: { color: border },
      pointLabels: { color: muted, font: { family: font, size: 11.5, weight: 500 } },
      ticks: { color: muted, backdropColor: "transparent", font: { family: font, size: 10 }, maxTicksLimit: 5, callback: (v: unknown) => formatNumber(Number(v), style) },
    };
    if (axis.min !== undefined) r.min = axis.min;
    if (axis.max !== undefined) r.max = axis.max;
    valueText = (di, i) => {
      const v = (datasets[di].data as (number | null)[])[i];
      return v === null ? null : formatNumber(v, style);
    };
    tooltipLabel = (item) => `${item.dataset.label}: ${formatNumber(item.raw, style)}`;
    const extra: Any[] = spec.labels ? [valueLabelsPlugin({ theme, horizontal: false, stacked: false, round: false, text: valueText })] : [];
    return finish(extra, { r });
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
  } else if (spec.type === "histogram") {
    // Values counted into equal ranges; the bars touch because the ranges do.
    const values = spec.data.map((row) => toNumber(row[spec.x]));
    const wanted = spec.bins ?? Math.min(20, Math.max(5, Math.ceil(Math.log2(values.length)) + 1));
    const { lo, width, n } = niceBins(Math.min(...values), Math.max(...values), wanted);
    const counts = Array.from({ length: n }, () => 0);
    for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
    const xStyle: NumberStyle = { ...styleOf("left"), ...(spec.axes?.x ?? {}) };
    const edges = counts.map((_, i) => [lo + i * width, lo + (i + 1) * width]);
    labels = edges.map(([a, b]) => `${formatNumber(a, { ...xStyle, unit: undefined })}–${formatNumber(b, xStyle)}`);
    const color = palette[0];
    datasets = [
      {
        label: "count",
        data: counts,
        backgroundColor: color,
        hoverBackgroundColor: color,
        borderWidth: 0,
        borderRadius: 2,
        categoryPercentage: 1,
        barPercentage: 0.96,
      },
    ];
    valueText = (_di, i) => (counts[i] ? String(counts[i]) : null);
    tooltipLabel = (item) => `${item.raw} ${item.raw === 1 ? "value" : "values"}`;
  } else if (spec.type === "waterfall") {
    // Each step floats from the running total before it to the one after; totals stand on zero.
    const key = spec.y[0];
    const style = styleOf("left");
    let running = 0;
    const steps = spec.data.map((row) => {
      if (row.total === true) {
        // A total with a value sets the running total there; without one it shows it.
        const set = toValue(row[key]);
        if (set !== null) running = set;
        return { from: 0, to: running, delta: running, total: true };
      }
      const delta = toNumber(row[key]);
      const from = running;
      running += delta;
      return { from, to: running, delta, total: false };
    });
    const colors = steps.map((st) => (st.total ? palette[0] : st.delta >= 0 ? (theme.tones.good ?? palette[1]) : (theme.tones.bad ?? palette[3])));
    datasets = [
      {
        label: key,
        data: steps.map((st) => [st.from, st.to]),
        backgroundColor: colors,
        hoverBackgroundColor: colors,
        borderWidth: 0,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 52,
        categoryPercentage: 0.74,
        barPercentage: 0.86,
      },
    ];
    const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + formatNumber(Math.abs(v), style);
    valueText = (_di, i) => (steps[i].total ? formatNumber(steps[i].to, style) : signed(steps[i].delta));
    tooltipLabel = (item) => {
      const st = steps[item.dataIndex];
      return st.total ? `Total: ${formatNumber(st.to, style)}` : `${signed(st.delta)}, now ${formatNumber(st.to, style)}`;
    };
  } else if (spec.range) {
    // Each bar spans from its first y key to its second.
    const [low, high] = spec.y;
    const style = styleOf("left");
    const color = colorOf(low, 0);
    const spans = spec.data.map((row) => [toNumber(row[low]), toNumber(row[high])]);
    datasets = [
      {
        label: `${low} to ${high}`,
        data: spans,
        backgroundColor: color,
        hoverBackgroundColor: color,
        borderWidth: 0,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 40,
        categoryPercentage: 0.74,
        barPercentage: 0.86,
        ...(horizontal ? { xAxisID: ids.left } : { yAxisID: ids.left }),
      },
    ];
    valueText = () => null;
    tooltipLabel = (item) => {
      const [a, b] = spans[item.dataIndex];
      return `${formatNumber(a, style)} to ${formatNumber(b, style)}`;
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
    const style: NumberStyle =
      spec.type === "histogram" ? { decimals: 0 } : percent && side === "left" ? { format: "percent", decimals: 0 } : styleOf(side);
    const values = markValues(side);
    const scale: Record<string, unknown> = {
      type: axis?.log ? "logarithmic" : "linear",
      axis: horizontal ? "x" : "y",
      stacked: stacked && side === "left",
      // A range or a waterfall can start anywhere; everything else is measured from zero.
      beginAtZero: !axis?.log && !spec.range,
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

  function describe(di: number, i: number): ChartPoint | null {
    const d = datasets[di];
    const raw = (d?.data as Any[] | undefined)?.[i];
    if (!d || raw === undefined || d.artTrend) return null;
    const x =
      spec.type === "sankey"
        ? `${raw.from} → ${raw.to}`
        : spec.type === "heatmap"
          ? `${raw.y} · ${raw.x}`
          : isScatter
            ? (raw?.name ?? `${spec.x} ${formatNumber(raw.x, spec.axes?.x ?? {})}`)
            : labels[i];
    let value = valueText(di, i);
    if (!value && tooltipLabel) {
      // The tooltip's own words, less the series name it starts with.
      const said = tooltipLabel({ dataset: d, raw, datasetIndex: di, dataIndex: i, label: labels[i] });
      const name = `${String(d.label ?? "")}: `;
      value = said.startsWith(name) ? said.slice(name.length) : said;
    }
    const series = isRound || spec.type === "sankey" || spec.type === "heatmap" || spec.type === "waterfall" || spec.type === "funnel" ? "" : String(d.label ?? "");
    return { series, x: String(x ?? ""), value: value ?? "" };
  }

  function finish(extra: Any[], scaleConfig?: Record<string, unknown>) {
    const valueLines = (spec.marks ?? []).some((m) => m.kind !== "band");
    const single = spec.type === "waterfall" || spec.type === "heatmap" || spec.type === "funnel" || spec.type === "sankey";
    const legendShown = spec.legend !== "none" && !single && (isRound || datasets.filter((d) => !d.artTrend).length > 1);
    return {
      type: CHARTJS_TYPE[spec.type] ?? (isBubble ? "bubble" : spec.type),
      data: { labels: isScatter || spec.type === "heatmap" || spec.type === "sankey" ? undefined : labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: horizontal || spec.type === "funnel" || (spec.type === "box" && spec.horizontal) ? "y" : "x",
        layout: { padding: { top: valueLines ? 8 : 4, right: 4 } },
        // Along categories a tooltip lists every series at that spot; on a scatter, a cell or a flow it is the one under the pointer.
        interaction:
          isScatter || spec.type === "heatmap" || spec.type === "sankey" || spec.type === "box"
            ? { mode: "nearest", intersect: true }
            : { mode: "index", intersect: false },
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
            // Series in the order they were written, as in the legend.
            itemSort: (a: { datasetIndex: number }, b: { datasetIndex: number }) => a.datasetIndex - b.datasetIndex,
            callbacks: { ...(tooltipLabel ? { label: tooltipLabel } : {}), ...(tooltipTitle ? { title: tooltipTitle } : {}) },
          },
        },
        scales: isRound ? undefined : scaleConfig,
      },
      plugins: extra,
      describe,
    };
  }
}

/** What a screen reader hears for the canvas: the chart's kind and what it plots. */
export function chartSummary(spec: ChartSpec): string {
  const kind = spec.range
    ? "range bar"
    : spec.horizontal
      ? "horizontal bar"
      : spec.type === "scatter" && spec.size
        ? "bubble"
        : spec.percent
          ? "100% stacked bar"
          : spec.type;
  if (spec.type === "histogram") {
    const head = spec.title ? `${spec.title}. ` : "";
    return `${head}Histogram of ${spec.x}, ${spec.data.length} values. The values follow as a table.`;
  }
  const what = spec.y.join(", ");
  const head = spec.title ? `${spec.title}. ` : "";
  return `${head}${kind[0].toUpperCase()}${kind.slice(1)} chart of ${what} by ${spec.x}, ${spec.data.length} ${spec.data.length === 1 ? "point" : "points"}. The data follows as a table.`;
}
