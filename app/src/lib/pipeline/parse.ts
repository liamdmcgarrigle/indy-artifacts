import { parse as parseYaml } from "yaml";
import { toString as mdToString } from "mdast-util-to-string";
import { CHART_TYPES, type ChartAxis, type ChartMark, type ChartSeries, type ChartSpec, type TableSpec } from "./types";

export class BlockError extends Error {}

/** Split a CSV line, honouring double-quoted fields with "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function coerce(value: string): string | number {
  if (value === "") return "";
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) && /^[-+]?[\d,]*\.?\d+%?$/.test(value.trim()) && !value.endsWith("%")
    ? n
    : value;
}

export function parseTableBlock(body: string): TableSpec {
  const lines = body.split("\n");
  let sortable = false;
  while (lines.length && (lines[0].trim() === "" || /^#\s*sortable\s*$/i.test(lines[0].trim()))) {
    if (/^#\s*sortable\s*$/i.test(lines[0].trim())) sortable = true;
    lines.shift();
  }
  const rest = lines.join("\n").trim();
  if (!rest) throw new BlockError("table block is empty");

  if (/^columns\s*:/m.test(rest)) {
    let doc: unknown;
    try {
      doc = parseYaml(rest);
    } catch (err) {
      throw new BlockError(`table YAML is invalid: ${(err as Error).message}`);
    }
    const obj = doc as { columns?: unknown; rows?: unknown; sortable?: unknown };
    if (!Array.isArray(obj?.columns)) throw new BlockError("table needs a columns list");
    if (!Array.isArray(obj?.rows)) throw new BlockError("table needs a rows list");
    const columns = obj.columns.map(String);
    const rows = obj.rows.map((r, i) => {
      if (!Array.isArray(r)) throw new BlockError(`table row ${i + 1} is not a list`);
      if (r.length !== columns.length)
        throw new BlockError(`table row ${i + 1} has ${r.length} cells, expected ${columns.length}`);
      return r.map((c) => (typeof c === "number" ? c : String(c ?? "")));
    });
    return { columns, rows, sortable: sortable || obj.sortable === true };
  }

  const csv = rest.split("\n").filter((l) => l.trim() !== "");
  const columns = splitCsvLine(csv[0]);
  const rows = csv.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    if (cells.length !== columns.length)
      throw new BlockError(`table row ${i + 1} has ${cells.length} cells, expected ${columns.length}`);
    return cells.map(coerce);
  });
  return { columns, rows, sortable };
}

/** Other names agents give a chart type, as the type and orientation Indy draws. */
const CHART_TYPE_ALIASES: Record<string, { type: ChartSpec["type"]; horizontal?: boolean }> = {
  barh: { type: "bar", horizontal: true },
  hbar: { type: "bar", horizontal: true },
  column: { type: "bar" },
  donut: { type: "doughnut" },
};

const SIDE_ALIASES: Record<string, "left" | "right"> = { left: "left", y: "left", y1: "left", right: "right", y2: "right" };

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

function parseAxis(value: unknown, what: string): ChartAxis {
  const o = mapping(value, what);
  const axis: ChartAxis = {
    title: optionalText(o.title),
    unit: optionalText(o.unit),
    min: optionalNumber(o.min, `${what}.min`),
    max: optionalNumber(o.max, `${what}.max`),
  };
  return Object.fromEntries(Object.entries(axis).filter(([, v]) => v !== undefined)) as ChartAxis;
}

/** A few of a chart's x values, for an error that says which ones exist. */
function someLabels(labels: string[]): string {
  const shown = labels.slice(0, 8).map((l) => `"${l}"`).join(", ");
  return labels.length > 8 ? `${shown} and ${labels.length - 8} more` : shown;
}

export function parseChartBlock(body: string): ChartSpec {
  let doc: unknown;
  try {
    doc = parseYaml(body);
  } catch (err) {
    throw new BlockError(`chart YAML is invalid: ${(err as Error).message}`);
  }
  const o = doc as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new BlockError("chart block must be a YAML mapping");

  const written = String(o.type ?? "").trim().toLowerCase();
  const alias = CHART_TYPE_ALIASES[written];
  const type = alias?.type ?? written;
  if (!(CHART_TYPES as readonly string[]).includes(type))
    throw new BlockError(`chart type must be one of ${CHART_TYPES.join(", ")}, got "${written || "nothing"}"`);

  if (!Array.isArray(o.data) || o.data.length === 0)
    throw new BlockError("chart needs a non-empty data list");
  const data = o.data.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new BlockError(`chart data item ${i + 1} must be a mapping`);
    return row as Record<string, unknown>;
  });

  const keys = Object.keys(data[0]);
  const x = String(o.x ?? keys[0] ?? "");
  if (!x) throw new BlockError("chart needs an x key");

  let y: string[];
  if (Array.isArray(o.y)) y = o.y.map(String);
  else if (typeof o.y === "string") y = [o.y];
  else y = keys.filter((k) => k !== x);
  if (y.length === 0) throw new BlockError("chart needs at least one y key");

  const missing = [x, ...y].filter((k) => !keys.includes(k));
  if (missing.length) throw new BlockError(`chart keys not present in data: ${missing.join(", ")}`);

  const round = type === "pie" || type === "doughnut";

  // Sideways bars, however the author put it.
  const orientation = String(o.orientation ?? "").trim().toLowerCase();
  if (orientation && orientation !== "horizontal" && orientation !== "vertical")
    throw new BlockError(`chart orientation must be horizontal or vertical, got "${orientation}"`);
  const horizontal = alias?.horizontal === true || o.horizontal === true || orientation === "horizontal";
  if (horizontal && type !== "bar") throw new BlockError(`horizontal applies to bar charts, not ${type}`);

  let series: Record<string, ChartSeries> | undefined;
  if (o.series !== undefined) {
    if (round) throw new BlockError(`series options do not apply to ${type} charts`);
    series = {};
    for (const [key, raw] of Object.entries(mapping(o.series, "chart series"))) {
      if (!y.includes(key)) throw new BlockError(`chart series "${key}" is not one of the y keys: ${y.join(", ")}`);
      const s = mapping(raw, `chart series "${key}"`);
      const entry: ChartSeries = {};
      if (s.as !== undefined) {
        const as = String(s.as).toLowerCase();
        if (as !== "bar" && as !== "line" && as !== "area")
          throw new BlockError(`chart series "${key}" as must be bar, line or area, got "${as}"`);
        if (type === "scatter") throw new BlockError(`series as does not apply to scatter charts`);
        entry.as = as;
      }
      if (s.axis !== undefined) {
        const side = SIDE_ALIASES[String(s.axis).toLowerCase()];
        if (!side) throw new BlockError(`chart series "${key}" axis must be left or right, got "${String(s.axis)}"`);
        entry.axis = side;
      }
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
      axes[side] = parseAxis(raw, `chart axes.${name}`);
    }
  }

  const labels = data.map((row) => String(row[x] ?? ""));
  const onX = (value: unknown, what: string): string | number => {
    if (type === "scatter") {
      const n = optionalNumber(value, what);
      if (n === undefined) throw new BlockError(`${what} needs a value`);
      return n;
    }
    const label = String(value ?? "");
    if (!labels.includes(label))
      throw new BlockError(`${what} "${label}" is not an x value in the data. It has ${someLabels(labels)}`);
    return label;
  };

  let marks: ChartMark[] | undefined;
  if (o.marks !== undefined) {
    if (round) throw new BlockError(`marks do not apply to ${type} charts`);
    if (!Array.isArray(o.marks)) throw new BlockError("chart marks must be a list");
    marks = o.marks.map((raw, i) => {
      const what = `chart mark ${i + 1}`;
      const m = mapping(raw, what);
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

  const height = Number(o.height ?? 280);
  const spec: ChartSpec = {
    type: type as ChartSpec["type"],
    title: o.title ? String(o.title) : undefined,
    x,
    y,
    data,
    stacked: o.stacked === true,
    unit: o.unit ? String(o.unit) : undefined,
    height: Number.isFinite(height) ? Math.min(Math.max(height, 80), 900) : 280,
  };
  if (horizontal) spec.horizontal = true;
  if (series && Object.keys(series).length) spec.series = series;
  if (axes && Object.keys(axes).length) spec.axes = axes;
  if (marks?.length) spec.marks = marks;
  return spec;
}

export interface KpiItem {
  label: string;
  value: string;
  tone?: string;
  delta?: string;
  note?: string;
}

const TONES = new Set(["good", "warn", "bad", "info", "neutral"]);

/** Tone words agents reach for, as the ones Indy draws. */
const TONE_ALIASES: Record<string, string> = { success: "good", danger: "bad", error: "bad", warning: "warn" };

/** A tone as written, as one of Indy's, or undefined when it is none of them. */
export function knownTone(raw: string | undefined | null): string | undefined {
  const t = String(raw ?? "").trim().toLowerCase();
  const tone = TONE_ALIASES[t] ?? t;
  return TONES.has(tone) ? tone : undefined;
}

/** `:badge[Recommended]{tone=good}`: the one inline directive, and only with words in it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isBadge(node: any): boolean {
  return node?.name === "badge" && mdToString(node).trim() !== "";
}

/** The classes a `:badge[...]` is drawn with, by the pipeline and the editor alike. */
export function badgeClass(tone: string | undefined | null): string {
  return `art-badge art-badge--${knownTone(tone) ?? "neutral"}`;
}

/** A `{tone=bad note="..."}` group on a counter line. Agents often write two, one per option. */
const KPI_OPTIONS = /\{\s*((?:tone|note)\s*=[^{}]*)\}/gi;

/** Text that looks like a directive's `{key=value}` options: on a page it shows as typed. */
export const STRAY_OPTIONS = /\{\s*[a-z][\w-]*\s*=[^{}\n]*\}/i;

export function parseKpiLine(text: string): KpiItem | null {
  const raw = text.trim();
  if (!raw) return null;
  let rest = raw;
  let tone: string | undefined;
  let delta: string | undefined;
  let note: string | undefined;

  for (const options of raw.matchAll(KPI_OPTIONS)) {
    for (const m of options[1].matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|([^\s"]+))/gi)) {
      const key = m[1].toLowerCase();
      const value = (m[2] ?? m[3] ?? "").trim();
      if (key === "tone") tone = knownTone(value);
      else if (key === "note" && value) note = value;
    }
    rest = rest.replace(options[0], " ");
  }
  rest = rest.replace(/\s+/g, " ").trim();
  const deltaMatch = rest.match(/\(([^()]*)\)\s*$/);
  if (deltaMatch) {
    delta = deltaMatch[1].trim();
    rest = rest.slice(0, deltaMatch.index).trim();
  }
  const sep = rest.indexOf(":");
  if (sep === -1) return { label: rest, value: "", tone, delta, note };
  return {
    label: rest.slice(0, sep).trim(),
    value: rest.slice(sep + 1).trim(),
    tone,
    delta,
    note,
  };
}
