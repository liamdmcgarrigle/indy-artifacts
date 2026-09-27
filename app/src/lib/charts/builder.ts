/**
 * The chart builder's working parts, free of React: the chart kinds it offers
 * and what switching to one does to a block, how a block is written back as
 * YAML, pasting a spreadsheet in, turning the table sideways, and which kinds
 * suit the data.
 *
 * The builder edits the block's YAML as a plain object (`raw`), never the
 * checked spec, so every key the author wrote survives a change to another.
 */
import { Document, isMap, isSeq } from "yaml";
import { parseChartBlock } from "@/lib/pipeline/chart";
import { BlockError } from "@/lib/pipeline/parse";
import type { ChartSpec } from "@/lib/pipeline/types";

export type Raw = Record<string, unknown>;
export type Cell = string | number | boolean;

/** The order keys are written in: what the chart is, what it plots, how it reads, then the data. */
const ORDER = [
  "type", "title", "horizontal", "range", "stacked", "x", "y", "value", "from", "to", "group", "label", "size",
  "format", "currency", "decimals", "unit", "labels", "legend", "sort", "curve", "line", "trend", "bins", "center",
  "height", "series", "axes", "marks",
];

function empty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** A block's YAML from its object: keys in a steady order, rows and small maps on one line each. */
export function chartSource(raw: Raw): string {
  const out: Raw = {};
  for (const key of ORDER) if (!empty(raw[key])) out[key] = raw[key];
  for (const [key, value] of Object.entries(raw)) if (!(key in out) && key !== "data" && !empty(value)) out[key] = value;
  out.data = raw.data ?? [];
  const doc = new Document(out);
  const flowItems = (key: string) => {
    const node = doc.get(key, true);
    if (isSeq(node)) for (const item of node.items) if (isMap(item) || isSeq(item)) item.flow = true;
    if (isMap(node)) for (const pair of node.items) if (isMap(pair.value) || isSeq(pair.value)) pair.value.flow = true;
  };
  for (const key of ["data", "marks", "series", "axes"]) flowItems(key);
  const y = doc.get("y", true);
  if (isSeq(y)) y.flow = true;
  return doc.toString({ flowCollectionPadding: true, lineWidth: 0 }).replace(/\n$/, "");
}

/** The block read back, or why it cannot be drawn. */
export function tryChart(raw: Raw): { spec: ChartSpec } | { error: string } {
  try {
    return { spec: parseChartBlock(chartSource(raw)) };
  } catch (err) {
    return { error: err instanceof BlockError ? err.message : String(err) };
  }
}

/** Every key the rows use, the x key first. */
export function dataKeys(raw: Raw): string[] {
  const rows = Array.isArray(raw.data) ? (raw.data as Raw[]) : [];
  const keys: string[] = [];
  for (const row of rows) if (row && typeof row === "object") for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  const x = typeof raw.x === "string" ? raw.x : undefined;
  return x && keys.includes(x) ? [x, ...keys.filter((k) => k !== x)] : keys;
}

function rows(raw: Raw): Raw[] {
  return Array.isArray(raw.data) ? (raw.data as Raw[]).filter((r) => r && typeof r === "object") : [];
}

function numericKey(raw: Raw, key: string): boolean {
  const values = rows(raw).map((r) => r[key]).filter((v) => v !== undefined && v !== null && v !== "");
  return values.length > 0 && values.every((v) => typeof v === "number" || (typeof v === "string" && Number.isFinite(Number(v))));
}

/** The y keys as written, or the numeric keys after x. */
export function yKeys(raw: Raw): string[] {
  if (Array.isArray(raw.y)) return raw.y.map(String);
  if (typeof raw.y === "string") return [raw.y];
  const [x, ...rest] = dataKeys(raw);
  return rest.filter((k) => k !== x && numericKey(raw, k));
}

const without = (raw: Raw, ...keys: string[]): Raw => {
  const next = { ...raw };
  for (const k of keys) delete next[k];
  return next;
};

/** Keys that belong to one kind of chart and mean nothing, or something wrong, to the others. */
const KIND_KEYS = ["horizontal", "orientation", "range", "stacked", "curve", "group", "label", "size", "line", "trend", "bins", "center", "value", "from", "to"];

/** A kind cleared of every other kind's keys, keeping what they share. */
function base(raw: Raw, type: string, keep: string[] = []): Raw {
  const next = without(raw, ...KIND_KEYS.filter((k) => !keep.includes(k)));
  next.type = type;
  return next;
}

/** Series options that only a chart along categories can use. */
function categorySeries(raw: Raw, drop: string[] = []): Raw {
  const series = raw.series;
  if (!series || typeof series !== "object" || Array.isArray(series)) return raw;
  const y = yKeys(raw);
  const kept = Object.fromEntries(
    Object.entries(series as Record<string, Raw>)
      .filter(([key]) => y.includes(key))
      .map(([key, value]) => [key, without(value, ...drop)])
      .filter(([, value]) => Object.keys(value as Raw).length),
  );
  return Object.keys(kept).length ? { ...raw, series: kept } : without(raw, "series");
}

/** The flat keys of a chart laid out on its own: no axes, series or marks. */
const laidOut = (raw: Raw) => without(raw, "series", "axes", "marks", "sort", "legend");

export interface Kind {
  id: string;
  label: string;
  group: "Compare" | "Trend" | "Part of a whole" | "Change and flow" | "Distribution" | "Relationship" | "Profile";
  apply: (raw: Raw) => Raw;
  /** Whether a spec is drawn as this kind, to mark the current one. */
  is: (spec: ChartSpec) => boolean;
}

const firstY = (raw: Raw) => yKeys(raw)[0];

export const KINDS: Kind[] = [
  { id: "bar", label: "Bar", group: "Compare", apply: (r) => categorySeries(base(r, "bar")), is: (s) => s.type === "bar" && !s.horizontal && !s.stacked && !s.range && !s.series },
  { id: "barh", label: "Horizontal bar", group: "Compare", apply: (r) => categorySeries({ ...base(r, "bar"), horizontal: true }, ["as"]), is: (s) => s.type === "bar" && !!s.horizontal && !s.range && !s.stacked },
  { id: "stacked", label: "Stacked bar", group: "Compare", apply: (r) => categorySeries({ ...base(r, "bar"), stacked: true }), is: (s) => s.type === "bar" && s.stacked && !s.percent },
  { id: "percent", label: "100% stacked", group: "Part of a whole", apply: (r) => categorySeries({ ...base(r, "bar"), stacked: "percent" }), is: (s) => s.type === "bar" && !!s.percent },
  { id: "range", label: "Range bar", group: "Compare", apply: (r) => ({ ...laidOut(base(r, "bar", ["horizontal"])), range: true, y: yKeys(r).slice(0, 2) }), is: (s) => !!s.range },
  { id: "line", label: "Line", group: "Trend", apply: (r) => categorySeries(base(r, "line", ["curve"])), is: (s) => s.type === "line" },
  { id: "area", label: "Area", group: "Trend", apply: (r) => categorySeries(base(r, "area", ["curve"])), is: (s) => s.type === "area" && !s.stacked },
  { id: "stackedArea", label: "Stacked area", group: "Trend", apply: (r) => categorySeries({ ...base(r, "area", ["curve"]), stacked: true }), is: (s) => s.type === "area" && s.stacked },
  {
    id: "combo",
    label: "Bars and a line",
    group: "Trend",
    apply: (r) => {
      const y = yKeys(r);
      const last = y[y.length - 1];
      const series = { ...((r.series as Raw) ?? {}), [last]: { ...(((r.series as Raw) ?? {})[last] as Raw), as: "line", axis: "right" } };
      return { ...base(r, "bar"), series };
    },
    is: (s) => s.type === "bar" && !!s.series && Object.values(s.series).some((x) => x.as === "line" || x.as === "area"),
  },
  { id: "pie", label: "Pie", group: "Part of a whole", apply: (r) => ({ ...laidOut(base(r, "pie")), y: firstY(r) }), is: (s) => s.type === "pie" },
  { id: "doughnut", label: "Doughnut", group: "Part of a whole", apply: (r) => ({ ...laidOut(base(r, "doughnut", ["center"])), y: firstY(r) }), is: (s) => s.type === "doughnut" },
  { id: "waterfall", label: "Waterfall", group: "Change and flow", apply: (r) => ({ ...without(base(r, "waterfall"), "series", "axes", "sort"), y: firstY(r) }), is: (s) => s.type === "waterfall" },
  { id: "funnel", label: "Funnel", group: "Change and flow", apply: (r) => ({ ...laidOut(base(r, "funnel")), y: firstY(r) }), is: (s) => s.type === "funnel" },
  {
    id: "sankey",
    label: "Sankey",
    group: "Change and flow",
    apply: (r) => {
      // A flow table: two columns of names and one of amounts.
      const keys = dataKeys(r);
      const names = keys.filter((k) => !numericKey(r, k));
      const amount = keys.find((k) => numericKey(r, k));
      const next = without(laidOut(base(r, "sankey")), "x", "y", "labels");
      if (!keys.includes("from") && names[0]) next.from = names[0];
      if (!keys.includes("to") && names[1]) next.to = names[1];
      if (!keys.includes("value") && amount) next.value = amount;
      return next;
    },
    is: (s) => s.type === "sankey",
  },
  {
    id: "histogram",
    label: "Histogram",
    group: "Distribution",
    apply: (r) => {
      const keys = dataKeys(r);
      const x = numericKey(r, String(r.x ?? "")) ? String(r.x) : (yKeys(r)[0] ?? keys.find((k) => numericKey(r, k)));
      return { ...without(laidOut(base(r, "histogram", ["bins"])), "y"), x };
    },
    is: (s) => s.type === "histogram",
  },
  { id: "box", label: "Box plot", group: "Distribution", apply: (r) => without(base(r, "box", ["horizontal"]), "series", "marks", "sort", "labels"), is: (s) => s.type === "box" },
  { id: "scatter", label: "Scatter", group: "Relationship", apply: (r) => categorySeries(without(base(r, "scatter", ["group", "label", "line", "trend"]), "sort"), ["as", "axis"]), is: (s) => s.type === "scatter" && !s.size },
  {
    id: "bubble",
    label: "Bubble",
    group: "Relationship",
    apply: (r) => {
      const y = yKeys(r);
      const next = categorySeries(without(base(r, "scatter", ["group", "label", "trend"]), "sort"), ["as", "axis"]);
      const size = (typeof r.size === "string" && r.size) || y[1];
      return size ? { ...next, y: y[0], size } : next;
    },
    is: (s) => s.type === "scatter" && !!s.size,
  },
  {
    id: "heatmap",
    label: "Heatmap",
    group: "Relationship",
    apply: (r) => {
      const [x, ...rest] = dataKeys(r);
      const rowKey = rest.find((k) => !numericKey(r, k));
      const value = rest.find((k) => numericKey(r, k));
      return { ...laidOut(base(r, "heatmap")), x, ...(rowKey ? { y: rowKey } : {}), ...(value ? { value } : {}) };
    },
    is: (s) => s.type === "heatmap",
  },
  { id: "radar", label: "Radar", group: "Profile", apply: (r) => without(categorySeries(base(r, "radar"), ["as", "axis"]), "axes", "marks", "sort"), is: (s) => s.type === "radar" },
];

export const KIND_GROUPS = ["Compare", "Trend", "Part of a whole", "Change and flow", "Distribution", "Relationship", "Profile"] as const;

export function kindOf(spec: ChartSpec): Kind | undefined {
  return KINDS.find((k) => k.is(spec));
}

/** Each kind with whether it can draw this data, and why not. */
/** Kinds that compare series with each other, and so need more than one. */
const MANY = new Set(["stacked", "percent", "stackedArea", "combo"]);

export function kindChoices(raw: Raw): { kind: Kind; error?: string }[] {
  const series = yKeys(raw).length;
  return KINDS.map((kind) => {
    if (MANY.has(kind.id) && series < 2) return { kind, error: "needs two or more y keys to compare" };
    const result = tryChart(kind.apply(raw));
    return "error" in result ? { kind, error: result.error } : { kind };
  });
}

const TIME_LIKE =
  /^(\d{4}([-/]\d{1,2}([-/]\d{1,2})?)?|q[1-4]|w\d{1,2}|week \d+|h[12]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|\d{1,2}:\d{2})/i;

/**
 * Kinds that suit the data's shape, best first: flows for from/to rows, a
 * line for time along x, sideways bars for long or many names, a doughnut for
 * a handful of parts, a scatter for numbers against numbers.
 */
export function suggestKinds(raw: Raw): string[] {
  const keys = dataKeys(raw);
  const all = rows(raw);
  if (!all.length) return [];
  const out: string[] = [];
  const names = keys.filter((k) => !numericKey(raw, k));
  const numbers = keys.filter((k) => numericKey(raw, k));
  if (keys.includes("from") && keys.includes("to")) out.push("sankey");
  if (keys.length === 1 && numbers.length === 1) out.push("histogram");
  const x = keys[0];
  const labels = all.map((r) => String(r[x] ?? ""));
  if (numericKey(raw, x) && numbers.length >= 2) out.push(numbers.length >= 3 ? "bubble" : "scatter");
  else if (labels.filter((l) => TIME_LIKE.test(l.trim())).length >= Math.max(3, labels.length * 0.8)) out.push("line");
  if (names.length >= 2 && numbers.length === 1 && new Set(labels).size < all.length) out.push("heatmap");
  if (!numericKey(raw, x)) {
    const long = Math.max(...labels.map((l) => l.length)) > 14;
    if (long || new Set(labels).size > 8) out.push("barh");
    const y = yKeys(raw);
    if (y.length === 1 && all.length <= 6 && all.every((r) => Number(r[y[0]]) >= 0)) out.push("doughnut");
    if (y.length >= 2 && all.length >= 3) out.push("stacked");
  }
  return [...new Set(out)].slice(0, 3);
}

/** A number when it reads as one, so charts get numbers back; true and false as themselves. */
export function coerceCell(raw: string): Cell {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  // A leading zero is part of a code (a zip code, an id), not a number.
  if (/^-?0\d/.test(t)) return raw;
  return t !== "" && /^-?[\d,]*\.?\d+$/.test(t) ? Number(t.replace(/,/g, "")) : raw;
}

/**
 * Cells copied from a spreadsheet (tabs) or a CSV file (commas), as a header
 * and rows. The first line is the header when it has no numbers in it.
 */
export function parsePasted(text: string): { columns: string[]; rows: Cell[][] } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 1) return null;
  const tabbed = lines.some((l) => l.includes("\t"));
  if (!tabbed && !lines.some((l) => l.includes(","))) return null;
  const split = (line: string): string[] => {
    if (tabbed) return line.split("\t").map((c) => c.trim());
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const table = lines.map(split);
  const width = Math.max(...table.map((r) => r.length));
  if (width < 1) return null;
  const header = table[0].every((c) => typeof coerceCell(c) !== "number") && table.length > 1;
  const columns = header ? table[0].map((c, i) => c || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => (i === 0 ? "label" : `series ${i}`));
  const body = (header ? table.slice(1) : table).map((r) => Array.from({ length: width }, (_, i) => coerceCell(r[i] ?? "")));
  // A header shorter than the rows gets names for the rest.
  while (columns.length < width) columns.push(`series ${columns.length}`);
  // Two columns with one name would share one key and lose a column: number the repeats.
  const seen = new Set<string>();
  for (let i = 0; i < columns.length; i++) {
    let name = columns[i];
    for (let n = 2; seen.has(name); n++) name = `${columns[i]} ${n}`;
    columns[i] = name;
    seen.add(name);
  }
  return { columns, rows: body };
}

/** A grid pasted over the chart's data: x becomes the first column, y the numeric ones after it. */
export function withPasted(raw: Raw, pasted: { columns: string[]; rows: Cell[][] }): Raw {
  const data = pasted.rows.map((r) => Object.fromEntries(pasted.columns.map((c, i) => [c, r[i]])));
  const next: Raw = { ...without(raw, "series", "marks"), x: pasted.columns[0], data };
  const probe = { ...next, y: undefined };
  const numeric = pasted.columns.slice(1).filter((c) => numericKey(probe, c));
  const [first, second] = pasted.columns;
  const amount = numeric.find((c) => c !== second) ?? numeric[0];
  if (next.type === "sankey") {
    // Flows read from, to, and an amount, in that order.
    delete next.x;
    delete next.y;
    Object.assign(next, { from: first, to: second, value: amount });
  } else if (next.type === "heatmap") {
    // A column, a row, and the amount in the cell.
    Object.assign(next, { x: first, y: second, value: amount });
  } else if (next.type === "funnel") {
    if (numeric.length) next.y = numeric[0];
  } else if (next.type === "histogram") delete next.y;
  else if (numeric.length) next.y = numeric.length === 1 ? numeric[0] : numeric;
  return next;
}

/**
 * The table turned sideways: each y key becomes a row and each x value a
 * column, so "months as rows, products as series" becomes the other way round.
 */
export function transposed(raw: Raw): Raw | null {
  const all = rows(raw);
  const x = dataKeys(raw)[0];
  const y = yKeys(raw);
  if (!x || !y.length || !all.length) return null;
  const names = all.map((r) => String(r[x] ?? ""));
  if (new Set(names).size !== names.length) return null;
  let newX = "series";
  for (let n = 2; names.includes(newX); n++) newX = `series ${n}`;
  const data = y.map((key) => ({ [newX]: key, ...Object.fromEntries(all.map((r, i) => [names[i], r[key] ?? null])) }));
  return { ...without(raw, "series", "marks", "sort"), x: newX, y: names.length === 1 ? names[0] : names, data };
}
