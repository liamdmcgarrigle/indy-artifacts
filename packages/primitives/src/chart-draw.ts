/**
 * What <art-chart> draws on the canvas beyond Chart.js's own marks: reference
 * lines and shaded ranges, values written on the data, and a doughnut's total.
 * Each is a small Chart.js plugin built from the spec, so a page never loads a
 * plugin it does not use.
 */
import type { ChartMark, ChartSpec } from "./chart-spec";

export interface ChartTheme {
  palette: string[];
  text: string;
  muted: string;
  border: string;
  surface: string;
  font: string;
  /** good, warn, bad, info: for marks and series with a tone. */
  tones: Record<string, string>;
}

/** Chart.js's layout registry, passed in so these files never import Chart.js. */
export interface Layouts {
  addBox(chart: Any, box: Any): void;
}

// Chart.js's own types are far wider than anything built here; the plugins
// read plain data back off the chart, checked by the tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Which Chart.js scale is which, given the way the bars point. */
export function scaleIds(horizontal: boolean): { category: string; left: string; right: string } {
  return horizontal ? { category: "y", left: "x", right: "x2" } : { category: "x", left: "y", right: "y2" };
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

/** Height of the strip above the plot that holds the labels of lines running top to bottom. */
const STRIP = 17;

/** Marks drawn top to bottom: a value line on a sideways chart, a category line on an upright one. */
function standing(mark: ChartMark, horizontal: boolean): boolean {
  return mark.kind === "value" ? horizontal : mark.kind === "at" && !horizontal;
}

/** A box Chart.js lays out above the plot and draws nothing in. */
function strip(height: number): Any {
  return {
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
    update(this: { width: number; height: number }, width: number) {
      this.width = width;
      this.height = height;
    },
    draw() {},
  };
}

/**
 * Lines at a value, lines at one category, and shaded ranges of categories.
 * Bands go under the data, lines and every label over it.
 */
export function marksPlugin(spec: ChartSpec, theme: ChartTheme, labels: string[], layouts?: Layouts): Any {
  const marks = spec.marks ?? [];
  const horizontal = spec.horizontal === true;
  const ids = scaleIds(horizontal);
  const color = (tone?: string) => (tone && theme.tones[tone]) || theme.muted;
  // Their labels sit above the plot, where no bar or point can be under them.
  const hasStrip = marks.some((m) => m.label && standing(m, horizontal));

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
      if (hasStrip && layouts) layouts.addBox(chart, strip(STRIP));
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
        if (mark.kind === "value") {
          const scale = chart.scales[mark.axis === "right" ? ids.right : ids.left];
          across = scale ? scale.getPixelForValue(mark.value) : null;
        } else {
          across = at(chart, mark.at);
        }
        if (across === null || !Number.isFinite(across)) continue;
        if (!standing(mark, horizontal)) {
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
            const y = hasStrip && layouts ? area.top - STRIP + 2 : area.top + 4;
            drawLabel(ctx, mark.label, left, y, "left", tint, theme);
          }
        }
      }
    },
  };
}

/**
 * Values written on the data: over each bar (or inside a stacked segment),
 * over each point, and as a share inside each slice big enough to hold one.
 * `text` formats a dataset's value the way its axis does.
 */
export function valueLabelsPlugin(opts: {
  theme: ChartTheme;
  horizontal: boolean;
  stacked: boolean;
  round: boolean;
  text: (datasetIndex: number, index: number) => string | null;
}): Any {
  const { theme, horizontal, stacked, round, text } = opts;
  return {
    id: "artValueLabels",
    afterDatasetsDraw(chart: Any) {
      const ctx: CanvasRenderingContext2D = chart.ctx;
      ctx.save();
      ctx.font = `600 11px ${theme.font}`;
      chart.data.datasets.forEach((dataset: Any, di: number) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden || dataset.hidden || dataset.artTrend) return;
        const kind = meta.type ?? chart.config.type;
        meta.data.forEach((el: Any, i: number) => {
          const label = text(di, i);
          if (!label) return;
          const w = ctx.measureText(label).width;
          if (round) {
            const angle = (el.endAngle ?? 0) - (el.startAngle ?? 0);
            if (angle < 0.35) return;
            const mid = (el.startAngle + el.endAngle) / 2;
            const r = ((el.innerRadius ?? 0) + el.outerRadius) / 2;
            ctx.fillStyle = theme.surface;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, el.x + Math.cos(mid) * r, el.y + Math.sin(mid) * r);
            return;
          }
          if (kind === "matrix") {
            // Inside the cell, light on dark cells and dark on light ones.
            if (el.width < w + 6 || el.height < 14) return;
            const shade = dataset.artShare?.[i] ?? 0;
            ctx.fillStyle = shade > 0.55 ? theme.surface : theme.text;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, el.x + el.width / 2, el.y + el.height / 2);
            return;
          }
          if (kind === "bar") {
            const size = horizontal ? Math.abs(el.x - el.base) : Math.abs(el.base - el.y);
            if (stacked) {
              // Inside the segment, when the segment is big enough to hold it.
              if (size < (horizontal ? w + 8 : 16)) {
                // A funnel's narrow stages say their number beside the bar instead.
                if (!dataset.artOutside || !horizontal) return;
                ctx.fillStyle = theme.text;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(label, Math.max(el.x, el.base) + 6, el.y);
                return;
              }
              ctx.fillStyle = theme.surface;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(label, horizontal ? (el.x + el.base) / 2 : el.x, horizontal ? el.y : (el.y + el.base) / 2);
              return;
            }
            ctx.fillStyle = theme.text;
            ctx.textBaseline = horizontal ? "middle" : "bottom";
            ctx.textAlign = horizontal ? "left" : "center";
            const negative = horizontal ? el.x < el.base : el.y > el.base;
            if (horizontal) {
              ctx.textAlign = negative ? "right" : "left";
              ctx.fillText(label, el.x + (negative ? -5 : 5), el.y);
            } else {
              ctx.textBaseline = negative ? "top" : "bottom";
              ctx.fillText(label, el.x, el.y + (negative ? 4 : -4));
            }
            return;
          }
          // Points and lines: just above.
          ctx.fillStyle = theme.text;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(label, el.x, el.y - 6);
        });
      });
      ctx.restore();
    },
  };
}

/** The total in the middle of a doughnut, with optional words under it. */
export function centerPlugin(theme: ChartTheme, total: string, words?: string): Any {
  return {
    id: "artCenter",
    afterDatasetsDraw(chart: Any) {
      const meta = chart.getDatasetMeta(0);
      const arc = meta?.data?.[0];
      if (!arc) return;
      const ctx: CanvasRenderingContext2D = chart.ctx;
      const inner = arc.innerRadius ?? 0;
      if (inner < 30) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = theme.text;
      const size = Math.max(14, Math.min(26, inner * 0.42));
      ctx.font = `650 ${size}px ${theme.font}`;
      ctx.textBaseline = words ? "bottom" : "middle";
      ctx.fillText(total, arc.x, words ? arc.y + size * 0.2 : arc.y);
      if (words) {
        ctx.font = `500 11.5px ${theme.font}`;
        ctx.fillStyle = theme.muted;
        ctx.textBaseline = "top";
        ctx.fillText(words, arc.x, arc.y + size * 0.3);
      }
      ctx.restore();
    },
  };
}
