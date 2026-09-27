/**
 * Reading a ```chart block: YAML in, a checked ChartSpec out. Every refusal is
 * a BlockError that says what to write instead, because the reader is usually
 * an agent that will fix the block from the message alone.
 */
import { parse as parseYaml } from "yaml";
import { BlockError, knownTone } from "./parse";
import { CHART_TYPES, type ChartAxis, type ChartFormat, type ChartMark, type ChartSeries, type ChartSpec, type Curve } from "./types";

/** Other names agents give a chart type, as the type and options Indy draws. */
const TYPE_ALIASES: Record<string, { type: ChartSpec["type"]; horizontal?: boolean; bubble?: boolean }> = {
  barh: { type: "bar", horizontal: true },
  hbar: { type: "bar", horizontal: true },
  column: { type: "bar" },
  donut: { type: "doughnut" },
  bubble: { type: "scatter", bubble: true },
};

const SIDE_ALIASES: Record<string, "left" | "right"> = { left: "left", y: "left", y1: "left", right: "right", y2: "right" };
const FORMATS: ChartFormat[] = ["number", "compact", "percent", "currency"];
const CURVES: Curve[] = ["smooth", "straight", "step"];
const SERIES_TONES = new Set(["good", "warn", "bad", "info", "muted"]);

/** Every key a chart reads. Anything else is reported, with the nearest one when it looks like a typo. */
const KEYS = [
  "type", "title", "x", "y", "data", "stacked", "unit", "height", "orientation", "horizontal", "series", "axes",
  "marks", "format", "currency", "decimals", "labels", "legend", "sort", "curve", "group", "label", "size", "line",
  "trend", "center", "bins", "range",
];

/** Keys agents reach for that mean something Indy spells differently. */
const KEY_HINTS: Record<string, string> = {
  stack: "stacked: true",
  xlabel: "axes: { x: { title: ... } }",
  ylabel: "axes: { left: { title: ... } }",
  xtitle: "axes: { x: { title: ... } }",
  ytitle: "axes: { left: { title: ... } }",
  ymin: "axes: { left: { min: ... } }",
  ymax: "axes: { left: { max: ... } }",
  colors: "series: { <key>: { color: 1-6 or good, warn, bad, info, muted } }",
  color: "series: { <key>: { color: 1-6 or good, warn, bad, info, muted } }",
  annotations: "marks: [{ y: 10, label: Target }]",
  reference: "marks: [{ y: 10, label: Target }]",
  references: "marks: [{ y: 10, label: Target }]",
  datalabels: "labels: true",
  showvalues: "labels: true",
  values: "labels: true",
  subtitle: "a sentence above the chart",
  description: "a sentence above the chart",
  smooth: "curve: smooth",
  step: "curve: step",
  y2: "series: { <key>: { axis: right } }",
  dual: "series: { <key>: { axis: right } }",
};

/** Edits from one word to another, a swap of two letters counting as one ("titel" is one from "title"). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** "did you mean" for a key a chart does not read, or nothing when nothing is close. */
export function suggestKey(key: string, known: string[] = KEYS, hints: Record<string, string> = KEY_HINTS): string | undefined {
  const lower = key.toLowerCase().replace(/[-_\s]/g, "");
  if (hints[lower]) return hints[lower];
  let best: string | undefined;
  let score = Infinity;
  for (const k of known) {
    const d = distance(lower, k.toLowerCase());
    if (d < score) [best, score] = [k, d];
  }
  return best && score <= Math.max(1, Math.floor(key.length / 4)) ? best : undefined;
}

function unknownKeys(o: Record<string, unknown>, known: string[], where: string, warn: (message: string) => void, hints: Record<string, string> = {}) {
  for (const key of Object.keys(o)) {
    if (known.includes(key)) continue;
    const hint = suggestKey(key, known, hints);
    warn(`${where} does not read "${key}"${hint ? `; did you mean ${hint}?` : ". It reads " + known.join(", ")}`);
  }
}

function optionalNumber(value: unknown, what: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) throw new BlockError(`${what} must be a number, got "${String(value)}"`);
  return n;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function mapping(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BlockError(`${what} must be a mapping`);
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = String(value).trim().toLowerCase() as T;
  if (!allowed.includes(v)) throw new BlockError(`${what} must be ${allowed.join(", ")}, got "${String(value)}"`);
  return v;
}

/** `format: currency:EUR` or `format: currency` with `currency: EUR`. */
function numberStyle(o: Record<string, unknown>, what: string): { format?: ChartFormat; currency?: string; decimals?: number; unit?: string } {
  let format = o.format === undefined ? undefined : String(o.format).trim();
  let currency = optionalText(o.currency)?.toUpperCase();
  if (format && /^currency\s*:/i.test(format)) {
    currency = format.split(":")[1].trim().toUpperCase();
    format = "currency";
  }
  const style = {
    format: oneOf(format, FORMATS, `${what} format`),
    currency,
    decimals: optionalNumber(o.decimals, `${what} decimals`),
    unit: optionalText(o.unit),
  };
  if (style.currency && !/^[A-Z]{3}$/.test(style.currency)) throw new BlockError(`${what} currency must be a three-letter code such as USD or EUR`);
  if (style.decimals !== undefined && (style.decimals < 0 || style.decimals > 6 || !Number.isInteger(style.decimals)))
    throw new BlockError(`${what} decimals must be a whole number from 0 to 6`);
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined));
}

const AXIS_KEYS = ["title", "unit", "min", "max", "log", "format", "currency", "decimals"];

function parseAxis(value: unknown, what: string, warn: (message: string) => void): ChartAxis {
  const o = mapping(value, what);
  unknownKeys(o, AXIS_KEYS, what, warn);
  const axis: ChartAxis = {
    title: optionalText(o.title),
    min: optionalNumber(o.min, `${what}.min`),
    max: optionalNumber(o.max, `${what}.max`),
    log: o.log === true ? true : undefined,
    ...numberStyle(o, what),
  };
  return Object.fromEntries(Object.entries(axis).filter(([, v]) => v !== undefined)) as ChartAxis;
}

const SERIES_KEYS = ["as", "axis", "color", "dash", "curve", "hidden"];

function parseSeriesColor(value: unknown, what: string): number | string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
  const tone = String(value).trim().toLowerCase();
  const known = tone === "muted" ? "muted" : knownTone(tone);
  if (known && SERIES_TONES.has(known)) return known;
  throw new BlockError(`${what} color must be a palette slot from 1 to 6, or good, warn, bad, info or muted`);
}

/** A few of a chart's x values, for an error that says which ones exist. */
function someLabels(labels: string[]): string {
  const shown = labels.slice(0, 8).map((l) => `"${l}"`).join(", ");
  return labels.length > 8 ? `${shown} and ${labels.length - 8} more` : shown;
}

/**
 * Read a chart block. Anything that stops it drawing throws; anything it can
 * draw around (a key it does not read) goes to `warn`.
 */
export function parseChartBlock(body: string, warn: (message: string) => void = () => {}): ChartSpec {
  let doc: unknown;
  try {
    doc = parseYaml(body);
  } catch (err) {
    throw new BlockError(`chart YAML is invalid: ${(err as Error).message}`);
  }
  const o = doc as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new BlockError("chart block must be a YAML mapping");
  unknownKeys(o, KEYS, "chart", warn, KEY_HINTS);

  const written = String(o.type ?? "").trim().toLowerCase();
  const alias = TYPE_ALIASES[written];
  const type = alias?.type ?? written;
  if (!(CHART_TYPES as readonly string[]).includes(type))
    throw new BlockError(`chart type must be one of ${[...CHART_TYPES, "bubble"].join(", ")}, got "${written || "nothing"}"${written.includes("sankey") || ["heatmap", "boxplot", "box", "funnel", "matrix"].includes(written) ? ". That type is coming; draw it another way for now" : ""}`);

  if (!Array.isArray(o.data) || o.data.length === 0) throw new BlockError("chart needs a non-empty data list");
  // A histogram can take its values as a plain list.
  const plain = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
  const rows: unknown[] = type === "histogram" && o.data.every(plain) ? o.data.map((v) => ({ [String(o.x ?? "value")]: Number(v) })) : o.data;
  let data = rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new BlockError(`chart data item ${i + 1} must be a mapping`);
    return row as Record<string, unknown>;
  });

  // Every key any row has: a series may start late or stop early.
  const keys = [...new Set(data.flatMap((row) => Object.keys(row)))];
  const x = String(o.x ?? keys[0] ?? "");
  if (!x) throw new BlockError("chart needs an x key");

  // Keys that say how to read a point rather than what to plot.
  const pointKeys = [o.group, o.label, o.size].filter((k) => typeof k === "string") as string[];
  // A waterfall row marks a running total with total: true.
  if (type === "waterfall") pointKeys.push("total");
  let y: string[];
  if (type === "histogram") {
    if (o.y !== undefined) throw new BlockError("a histogram counts the values of its x key itself; leave out y");
    y = [];
  } else if (Array.isArray(o.y)) y = o.y.map(String);
  else if (typeof o.y === "string") y = [o.y];
  else y = keys.filter((k) => k !== x && !pointKeys.includes(k));
  if (y.length === 0 && type !== "histogram") throw new BlockError("chart needs at least one y key");

  const missing = [x, ...y, ...pointKeys.filter((k) => k !== "total")].filter((k) => !keys.includes(k));
  if (missing.length) throw new BlockError(`chart keys not present in data: ${missing.join(", ")}. The rows have ${keys.join(", ")}`);

  const round = type === "pie" || type === "doughnut";
  const scatter = type === "scatter";
  // These three draw their own layout: no second axis, no stacking, no lines mixed in.
  const own = type === "radar" || type === "histogram" || type === "waterfall";
  for (const key of ["series", "stacked", "horizontal", "orientation"] as const)
    if (own && o[key] !== undefined && !(key === "series" && type === "radar")) throw new BlockError(`${key} does not apply to ${type} charts`);
  if (type === "radar" && (o.marks !== undefined || o.axes !== undefined)) throw new BlockError("radar charts take no marks or axes");
  if (type === "waterfall" && y.length !== 1) throw new BlockError("a waterfall takes one y key: the change at each step");
  if (type === "histogram") {
    const bad = data.find((row) => !Number.isFinite(Number(row[x])));
    if (bad) throw new BlockError(`a histogram needs numbers in ${x}, got "${String(bad[x])}"`);
  }
  let bins: number | undefined;
  if (o.bins !== undefined) {
    if (type !== "histogram") throw new BlockError("bins applies to histograms");
    bins = optionalNumber(o.bins, "chart bins");
    if (!bins || !Number.isInteger(bins) || bins < 2 || bins > 50) throw new BlockError("chart bins must be a whole number from 2 to 50");
  }
  if (o.range !== undefined) {
    if (type !== "bar" || o.range !== true) throw new BlockError("range: true applies to bar charts");
    if (y.length !== 2) throw new BlockError("a range bar chart takes two y keys, where each bar starts and where it ends");
    if (o.stacked !== undefined || o.series !== undefined) throw new BlockError("range bars cannot stack or mix in lines");
  }

  const orientation = oneOf(o.orientation, ["horizontal", "vertical"] as const, "chart orientation");
  const horizontal = alias?.horizontal === true || o.horizontal === true || orientation === "horizontal";
  if (horizontal && type !== "bar") throw new BlockError(`horizontal applies to bar charts, not ${type}`);

  // stacked: true, or stacked: percent for shares of each column's total.
  const stackedRaw = typeof o.stacked === "string" ? o.stacked.trim().toLowerCase() : o.stacked;
  if (stackedRaw !== undefined && stackedRaw !== true && stackedRaw !== false && stackedRaw !== "percent" && stackedRaw !== "100%")
    throw new BlockError(`chart stacked must be true, false or percent, got "${String(o.stacked)}"`);
  const percent = stackedRaw === "percent" || stackedRaw === "100%";
  const stacked = stackedRaw === true || percent;
  if (stacked && (round || scatter)) throw new BlockError(`stacked does not apply to ${type} charts`);

  let series: Record<string, ChartSeries> | undefined;
  if (o.series !== undefined) {
    if (round) throw new BlockError(`series options do not apply to ${type} charts`);
    series = {};
    for (const [key, raw] of Object.entries(mapping(o.series, "chart series"))) {
      if (!y.includes(key)) throw new BlockError(`chart series "${key}" is not one of the y keys: ${y.join(", ")}`);
      const what = `chart series "${key}"`;
      const s = mapping(raw, what);
      unknownKeys(s, SERIES_KEYS, what, warn);
      const entry: ChartSeries = {};
      const as = oneOf(s.as, ["bar", "line", "area"] as const, `${what} as`);
      if (as) {
        if (scatter) throw new BlockError("series as does not apply to scatter charts");
        entry.as = as;
      }
      if (s.axis !== undefined) {
        const side = SIDE_ALIASES[String(s.axis).toLowerCase()];
        if (!side) throw new BlockError(`${what} axis must be left or right, got "${String(s.axis)}"`);
        entry.axis = side;
      }
      const color = parseSeriesColor(s.color, what);
      if (color !== undefined) entry.color = color;
      if (s.dash === true) entry.dash = true;
      const curve = oneOf(s.curve, CURVES, `${what} curve`);
      if (curve) entry.curve = curve;
      if (s.hidden === true) entry.hidden = true;
      series[key] = entry;
    }
  }
  if (horizontal && series && Object.values(series).some((s) => s.as && s.as !== "bar"))
    throw new BlockError("a horizontal bar chart cannot mix in lines; leave out horizontal to draw bars and lines together");

  let axes: ChartSpec["axes"];
  if (o.axes !== undefined) {
    if (round) throw new BlockError(`axes do not apply to ${type} charts`);
    axes = {};
    for (const [name, raw] of Object.entries(mapping(o.axes, "chart axes"))) {
      const lower = name.toLowerCase();
      const side = lower === "x" ? "x" : SIDE_ALIASES[lower];
      if (!side) throw new BlockError(`chart axes are x, left and right, got "${name}"`);
      axes[side] = parseAxis(raw, `chart axes.${name}`, warn);
    }
    if (axes.x && !scatter && (axes.x.min !== undefined || axes.x.max !== undefined || axes.x.log))
      throw new BlockError("axes.x takes min, max and log on scatter charts only; the x values here are categories");
  }

  const style = numberStyle(o, "chart");

  // A percent format means fractions. Values like 45 are already percents, and would read as 4,500%.
  const checkPercent = (keys: string[], format: ChartFormat | undefined, what: string) => {
    if (format !== "percent" || percent) return;
    const big = keys.flatMap((k) => data.map((row) => Math.abs(Number(row[k])))).find((v) => Number.isFinite(v) && v > 1.5);
    if (big !== undefined)
      throw new BlockError(`${what} format: percent reads 0.25 as 25%, but the data has ${big}. For values that are already percentages, use unit: "%" instead`);
  };
  const onSide = (side: "left" | "right") => y.filter((k) => (series?.[k]?.axis ?? "left") === side);
  checkPercent(onSide("left"), axes?.left?.format ?? style.format, "chart");
  checkPercent(onSide("right"), axes?.right?.format, "chart axes.right");

  const labels = data.map((row) => String(row[x] ?? ""));
  const onX = (value: unknown, what: string): string | number => {
    if (scatter) {
      const n = optionalNumber(value, what);
      if (n === undefined) throw new BlockError(`${what} needs a value`);
      return n;
    }
    const label = String(value ?? "");
    if (!labels.includes(label)) throw new BlockError(`${what} "${label}" is not an x value in the data. It has ${someLabels(labels)}`);
    return label;
  };

  let marks: ChartMark[] | undefined;
  if (o.marks !== undefined) {
    if (round) throw new BlockError(`marks do not apply to ${type} charts`);
    if (!Array.isArray(o.marks)) throw new BlockError("chart marks must be a list");
    marks = o.marks.map((raw, i) => {
      const what = `chart mark ${i + 1}`;
      const m = mapping(raw, what);
      unknownKeys(m, ["x", "y", "value", "from", "to", "label", "tone", "axis"], what, warn);
      const label = optionalText(m.label);
      const tone = m.tone === undefined ? undefined : knownTone(String(m.tone));
      if (m.tone !== undefined && !tone) throw new BlockError(`${what} tone must be good, warn, bad, info or neutral`);
      const extra = { ...(label ? { label } : {}), ...(tone ? { tone } : {}) };
      if (m.from !== undefined || m.to !== undefined) {
        if (m.from === undefined || m.to === undefined) throw new BlockError(`${what} needs both from and to`);
        return { kind: "band", from: onX(m.from, `${what} from`), to: onX(m.to, `${what} to`), ...extra } as ChartMark;
      }
      // y (or value) is always the value axis, whichever way the bars point.
      const valueRaw = m.y ?? m.value;
      if (valueRaw !== undefined) {
        const value = optionalNumber(valueRaw, `${what} y`)!;
        const side = m.axis === undefined ? "left" : SIDE_ALIASES[String(m.axis).toLowerCase()];
        if (!side) throw new BlockError(`${what} axis must be left or right`);
        return { kind: "value", value, axis: side, ...extra } as ChartMark;
      }
      if (m.x !== undefined) return { kind: "at", at: onX(m.x, `${what} x`), ...extra } as ChartMark;
      throw new BlockError(`${what} needs y (a line at a value), x (a line at one x value), or from and to (a shaded range)`);
    });
  }

  // Scatter options: what splits, names and sizes the points.
  const scatterOnly = { group: o.group, label: o.label, size: o.size, line: o.line, trend: o.trend };
  for (const [key, value] of Object.entries(scatterOnly))
    if (value !== undefined && !scatter) throw new BlockError(`${key} applies to scatter and bubble charts, not ${type}`);
  if (alias?.bubble && o.size === undefined) throw new BlockError("a bubble chart needs size: the key whose values size each point");
  const trend = oneOf(o.trend, ["linear"] as const, "chart trend");
  if (scatter && typeof o.group === "string" && y.length > 1)
    throw new BlockError("group splits one y key into colored sets; give a single y key with group");

  if (o.center !== undefined && type !== "doughnut") throw new BlockError("center applies to doughnut charts");

  const sort = oneOf(o.sort, ["none", "asc", "desc"] as const, "chart sort");
  if (sort && sort !== "none") {
    if (type === "histogram" || type === "waterfall" || type === "radar") throw new BlockError(`sort does not apply to ${type} charts; the order is part of what they show`);
    if (scatter) throw new BlockError("sort does not apply to scatter charts; their x values already set the order");
    const total = (row: Record<string, unknown>) => y.reduce((sum, k) => sum + (Number(row[k]) || 0), 0);
    data = [...data].sort((a, b) => (sort === "asc" ? total(a) - total(b) : total(b) - total(a)));
  }

  // A radar's spokes and labels need more room than a row of bars.
  const height = Number(o.height ?? (type === "radar" ? 360 : 280));
  const spec: ChartSpec = {
    type: type as ChartSpec["type"],
    title: optionalText(o.title),
    x,
    y,
    data,
    stacked,
    height: Number.isFinite(height) ? Math.min(Math.max(height, 80), 900) : 280,
    ...style,
  };
  if (percent) spec.percent = true;
  if (horizontal) spec.horizontal = true;
  if (series && Object.keys(series).length) spec.series = series;
  if (axes && Object.keys(axes).length) spec.axes = axes;
  if (marks?.length) spec.marks = marks;
  if (o.labels === true) spec.labels = true;
  const legend = oneOf(o.legend, ["top", "bottom", "none"] as const, "chart legend");
  if (legend) spec.legend = legend;
  const curve = oneOf(o.curve, CURVES, "chart curve");
  if (curve) {
    if (type !== "line" && type !== "area" && !series) throw new BlockError("curve applies to line and area charts");
    spec.curve = curve;
  }
  if (typeof o.group === "string") spec.group = o.group;
  if (typeof o.label === "string") spec.label = o.label;
  if (typeof o.size === "string") spec.size = o.size;
  if (o.line === true) spec.line = true;
  if (trend) spec.trend = trend;
  if (o.center !== undefined) spec.center = String(o.center);
  if (bins) spec.bins = bins;
  if (o.range === true) spec.range = true;
  return spec;
}
