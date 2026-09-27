/**
 * The Chart.js configuration for an <art-chart>, built from the page's spec
 * and the theme's colors. Kept apart from the element and free of the DOM, so
 * what a spec draws can be tested without a canvas.
 */

export interface ChartSeries {
  as?: "bar" | "line" | "area";
  axis?: "left" | "right";
}

export interface ChartAxis {
  title?: string;
  unit?: string;
  min?: number;
  max?: number;
}

export type ChartMark =
  | { kind: "value"; value: number; axis: "left" | "right"; label?: string; tone?: string }
  | { kind: "at"; at: string | number; label?: string; tone?: string }
  | { kind: "band"; from: string | number; to: string | number; label?: string; tone?: string };

export interface ChartSpec {
  type: string;
  title?: string;
  x: string;
  y: string[];
  data: Record<string, unknown>[];
  stacked?: boolean;
  unit?: string;
  height?: number;
  horizontal?: boolean;
  series?: Record<string, ChartSeries>;
  axes?: { x?: ChartAxis; left?: ChartAxis; right?: ChartAxis };
  marks?: ChartMark[];
}

export interface ChartTheme {
  palette: string[];
  text: string;
  muted: string;
  border: string;
  surface: string;
  font: string;
  /** good, warn, bad, info: for marks with a tone. */
  tones: Record<string, string>;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** A translucent twin of a palette color, for area fills. */
function translucent(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? `${color.trim()}40` : color;
}

/** "41 min", but "12%" and "20°": a unit that is a sign sits against its number. */
export function withUnit(value: unknown, unit: string | undefined): string {
  if (!unit) return String(value);
  return /^[%°‰′″]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

type Side = "left" | "right";

/** Which Chart.js scale is which, given the way the bars point. */
export function scaleIds(horizontal: boolean): { category: string; left: string; right: string } {
  return horizontal ? { category: "y", left: "x", right: "x2" } : { category: "x", left: "y", right: "y2" };
}

// Chart.js's own types are far wider than anything built here; the config is
// plain data, checked by the tests that read it back.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A small label with the surface behind it, so it reads over grid lines and bars. */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: "left" | "right", color: string, theme: ChartTheme): void {
  ctx.save();
  ctx.font = `600 11px ${theme.font}`;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const w = ctx.measureText(text).width;
  const left = align === "left" ? x : x - w;
  ctx.fillStyle = theme.surface;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(left - 3, y - 2, w + 6, 15);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function dashed(ctx: CanvasRenderingContext2D, color: string, from: [number, number], to: [number, number]): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * Lines at a value, lines at one category, and shaded ranges of categories.
 * Bands go under the data, lines and every label over it.
 */
/** Chart.js's layout registry, passed in so this file never imports Chart.js. */
export interface Layouts {
  addBox(chart: Any, box: Any): void;
}

/** Height of the strip above the plot that holds the labels of lines running top to bottom. */
const STRIP = 17;

/** Marks drawn top to bottom: a value line on a sideways chart, a category line on an upright one. */
function standing(mark: ChartMark, horizontal: boolean): boolean {
  return mark.kind === "value" ? horizontal : mark.kind === "at" && !horizontal;
}

export function marksPlugin(spec: ChartSpec, theme: ChartTheme, labels: string[], layouts?: Layouts): Any {
  const marks = spec.marks ?? [];
  const horizontal = spec.horizontal === true;
  // Their labels sit above the plot, where no bar or point can be under them.
  const strip = marks.some((m) => m.label && standing(m, horizontal));
  const ids = scaleIds(horizontal);
  const color = (tone?: string) => (tone && theme.tones[tone]) || theme.muted;

  // Where a category sits along its axis. Scatter charts have numbers there.
  const at = (chart: Any, value: string | number): number | null => {
    const scale = chart.scales[ids.category];
    if (!scale) return null;
    if (typeof value === "number") return scale.getPixelForValue(value);
    const index = labels.indexOf(value);
    return index === -1 ? null : scale.getPixelForValue(index);
  };
  // Bars fill their slot, so a band covers the whole slot and not just its middle.
  const halfSlot = (chart: Any): number => {
    const scale = chart.scales[ids.category];
    if (!scale?.options?.offset || labels.length < 2) return 0;
    return Math.abs(scale.getPixelForValue(1) - scale.getPixelForValue(0)) / 2;
  };

  const bandBox = (chart: Any, mark: Extract<ChartMark, { kind: "band" }>): Box | null => {
    const a = at(chart, mark.from);
    const b = at(chart, mark.to);
    if (a === null || b === null) return null;
    const half = halfSlot(chart);
    const lo = Math.min(a, b) - half;
    const hi = Math.max(a, b) + half;
    const area: Box = chart.chartArea;
    return horizontal ? { left: area.left, right: area.right, top: lo, bottom: hi } : { left: lo, right: hi, top: area.top, bottom: area.bottom };
  };

  return {
    id: "artMarks",
    beforeInit(chart: Any) {
      if (!strip || !layouts) return;
      layouts.addBox(chart, {
        position: "top",
        // The layout reads stacking options off every box.
        options: {},
        // Nearest the plot: under the legend, over any top axis.
        weight: -1,
        fullSize: false,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        isHorizontal: () => true,
        update(this: Box & { width: number; height: number }, width: number) {
          this.width = width;
          this.height = STRIP;
        },
        draw() {},
      });
    },
    beforeDatasetsDraw(chart: Any) {
      const ctx: CanvasRenderingContext2D = chart.ctx;
      for (const mark of marks) {
        if (mark.kind !== "band") continue;
        const box = bandBox(chart, mark);
        if (!box) continue;
        ctx.save();
        ctx.fillStyle = color(mark.tone);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        ctx.restore();
      }
    },
    afterDatasetsDraw(chart: Any) {
      const ctx: CanvasRenderingContext2D = chart.ctx;
      const area: Box = chart.chartArea;
      for (const mark of marks) {
        const tint = color(mark.tone);
        if (mark.kind === "band") {
          const box = bandBox(chart, mark);
          if (box && mark.label) drawLabel(ctx, mark.label, box.left + 5, box.top + 4, "left", tint, theme);
          continue;
        }
        let across: number | null;
        // A line across the plot (value marks on upright charts, category marks on sideways ones) or down it.
        let lying: boolean;
        if (mark.kind === "value") {
          const scale = chart.scales[mark.axis === "right" ? ids.right : ids.left];
          across = scale ? scale.getPixelForValue(mark.value) : null;
          lying = !horizontal;
        } else {
          across = at(chart, mark.at);
          lying = horizontal;
        }
        if (across === null || !Number.isFinite(across)) continue;
        if (lying) {
          dashed(ctx, tint, [area.left, across], [area.right, across]);
          if (mark.label) {
            // Above the line, unless that runs off the top.
            const y = across - 18 < area.top ? across + 4 : across - 17;
            drawLabel(ctx, mark.label, area.right - 4, y, "right", tint, theme);
          }
        } else {
          dashed(ctx, tint, [across, area.top], [across, area.bottom]);
          if (mark.label) {
            ctx.save();
            ctx.font = `600 11px ${theme.font}`;
            const w = ctx.measureText(mark.label).width;
            ctx.restore();
            // Centered over the line, and slid back in when that would run off the chart.
            const edge = (chart.width ?? area.right) - 4;
            const left = Math.max(area.left, Math.min(across - w / 2, edge - w));
            const y = strip && layouts ? area.top - STRIP + 2 : area.top + 4;
            drawLabel(ctx, mark.label, left, y, "left", tint, theme);
          }
        }
      }
    },
  };
}

/** The Chart.js type, data and options a spec draws as. */
export function chartConfig(spec: ChartSpec, theme: ChartTheme, layouts?: Layouts): { type: string; data: Any; options: Any; plugins: Any[] } {
  const { palette, text, muted, border, surface, font } = theme;
  const isRound = spec.type === "pie" || spec.type === "doughnut";
  const isScatter = spec.type === "scatter";
  const horizontal = spec.horizontal === true && spec.type === "bar";
  const ids = scaleIds(horizontal);
  const base = spec.type === "area" ? "line" : spec.type;
  const labels = spec.data.map((row) => String(row[spec.x] ?? ""));
  const stacked = spec.stacked === true;

  const axisOf = (key: string): Side => spec.series?.[key]?.axis ?? "left";
  const unitOf = (side: Side): string | undefined => spec.axes?.[side]?.unit ?? (side === "left" ? spec.unit : undefined);
  const hasRight = !isRound && spec.y.some((key) => axisOf(key) === "right");

  const datasets = isRound
    ? [
        {
          label: spec.y[0] ?? "",
          data: spec.data.map((row) => toNumber(row[spec.y[0]])),
          backgroundColor: spec.data.map((_, i) => palette[i % palette.length]),
          borderColor: surface,
          borderWidth: 1,
        },
      ]
    : spec.y.map((key, i) => {
        const color = palette[i % palette.length];
        const drawn = isScatter ? "scatter" : (spec.series?.[key]?.as ?? spec.type);
        const bar = drawn === "bar";
        const area = drawn === "area";
        const line = drawn === "line" || area;
        const side = axisOf(key);
        // The last bar of a stack gets the rounded cap, or every joint shows a notch.
        const barKeys = spec.y.filter((k) => (spec.series?.[k]?.as ?? spec.type) === "bar");
        const capped = !(bar && stacked) || key === barKeys[barKeys.length - 1];
        const radius = horizontal
          ? { topLeft: 0, bottomLeft: 0, topRight: 5, bottomRight: 5 }
          : { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 };
        const dataset: Record<string, unknown> = {
          label: key,
          data: isScatter
            ? spec.data.map((row) => ({ x: toNumber(row[spec.x]), y: toNumber(row[key]) }))
            : spec.data.map((row) => toNumber(row[key])),
          borderColor: bar ? "transparent" : color,
          // A solid bar reads as one shape; an outlined wash reads as a box with something in it.
          backgroundColor: bar ? color : area ? translucent(color) : color,
          borderWidth: bar ? 0 : 2,
          borderRadius: bar && capped ? radius : 0,
          borderSkipped: false,
          maxBarThickness: 52,
          categoryPercentage: 0.74,
          barPercentage: 0.86,
          fill: area,
          tension: line ? 0.32 : 0,
          pointRadius: line ? (spec.type === "bar" ? 2.5 : 0) : 3,
          pointHoverRadius: 4,
          hoverBackgroundColor: bar ? color : undefined,
          hoverBorderColor: color,
          // Lines drawn over bars sit in front of them.
          order: line && spec.type === "bar" ? 0 : 1,
        };
        if (drawn !== spec.type && !isScatter) dataset.type = line ? "line" : "bar";
        if (horizontal) dataset.xAxisID = side === "right" ? ids.right : ids.left;
        else dataset.yAxisID = side === "right" ? ids.right : ids.left;
        // Bars stack with bars and areas with areas; a line mixed into bars stands alone.
        if (stacked) dataset.stack = drawn === spec.type ? "stack" : `own-${i}`;
        return dataset;
      });

  const tickFont = { family: font, size: 11, weight: 500 as const };
  const titleOf = (axis: ChartAxis | undefined) =>
    axis?.title ? { display: true, text: axis.title, color: muted, font: { family: font, size: 11.5, weight: 600 as const }, padding: { top: 4, bottom: 2 } } : undefined;

  // A mark's value always shows: the axis stretches to reach it.
  const markValues = (side: Side) =>
    (spec.marks ?? []).filter((m): m is Extract<ChartMark, { kind: "value" }> => m.kind === "value" && m.axis === side).map((m) => m.value);

  const valueScale = (side: Side) => {
    const axis = spec.axes?.[side];
    const unit = unitOf(side);
    const values = markValues(side);
    const scale: Record<string, unknown> = {
      type: "linear",
      stacked: stacked && side === "left",
      beginAtZero: true,
      ticks: { color: muted, font: tickFont, padding: 8, maxTicksLimit: 6, callback: (value: unknown) => withUnit(value, unit) },
      // Grid lines are scaffolding: hairlines along the values, none across.
      grid: side === "left" ? { color: border, lineWidth: 1, drawTicks: false } : { display: false, drawOnChartArea: false },
      border: { display: false, dash: [3, 4] },
    };
    if (side === "right") scale.position = horizontal ? "top" : "right";
    if (horizontal) scale.axis = "x";
    else scale.axis = "y";
    if (values.length) {
      scale.suggestedMax = Math.max(...values);
      scale.suggestedMin = Math.min(0, ...values);
    }
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
    if (spec.axes?.x?.min !== undefined) category.min = spec.axes.x.min;
    if (spec.axes?.x?.max !== undefined) category.max = spec.axes.x.max;
  }

  const scales: Record<string, unknown> = { [ids.category]: category, [ids.left]: valueScale("left") };
  if (hasRight) scales[ids.right] = valueScale("right");

  const unitFor = (datasetIndex: number): string | undefined => (isRound ? spec.unit : unitOf(axisOf(spec.y[datasetIndex] ?? "")));
  const valueLines = (spec.marks ?? []).some((m) => m.kind !== "band");

  return {
    type: base,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: horizontal ? "y" : "x",
      layout: { padding: { top: valueLines ? 8 : 4, right: 4 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: isRound || spec.y.length > 1,
          position: "top",
          align: "start",
          labels: {
            color: muted,
            font: { family: font, size: 11.5 },
            boxWidth: 7,
            boxHeight: 7,
            padding: 14,
            usePointStyle: true,
            pointStyle: "circle",
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
          callbacks: {
            label: (item: { dataset?: { label?: string }; label?: string; formattedValue: string; datasetIndex: number }) => {
              const name = isRound ? item.label : item.dataset?.label;
              return `${name ? `${name}: ` : ""}${withUnit(item.formattedValue, unitFor(item.datasetIndex))}`;
            },
          },
        },
      },
      scales: isRound ? undefined : scales,
    },
    plugins: spec.marks?.length ? [marksPlugin(spec, theme, labels, layouts)] : [],
  };
}

/** What a screen reader hears for the canvas: the chart's kind and what it plots. */
export function chartSummary(spec: ChartSpec): string {
  const kind = spec.horizontal ? "horizontal bar" : spec.type;
  const what = spec.y.join(", ");
  const head = spec.title ? `${spec.title}. ` : "";
  return `${head}${kind[0].toUpperCase()}${kind.slice(1)} chart of ${what} by ${spec.x}, ${spec.data.length} ${spec.data.length === 1 ? "point" : "points"}. The data follows as a table.`;
}
