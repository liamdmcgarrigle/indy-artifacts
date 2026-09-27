import { parse as parseYaml } from "yaml";
import { toString as mdToString } from "mdast-util-to-string";
import type { TableSpec } from "./types";

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

export interface KpiItem {
  label: string;
  value: string;
  tone?: string;
  delta?: string;
  note?: string;
  /** Recent values, oldest first, drawn as a sparkline: "3,5,4,8". */
  trend?: string;
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

/** A `{tone=bad note="..." trend="3,5,4"}` group on a counter line. Agents often write one per option. */
const KPI_OPTIONS = /\{\s*((?:tone|note|trend)\s*=[^{}]*)\}/gi;

/** A sparkline's values as written, or undefined when they are not 2 to 60 numbers. */
export function kpiTrend(raw: string): string | undefined {
  const values = raw.split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length < 2 || values.length > 60 || values.some((v) => !Number.isFinite(v))) return undefined;
  return values.join(",");
}

/** Text that looks like a directive's `{key=value}` options: on a page it shows as typed. */
export const STRAY_OPTIONS = /\{\s*[a-z][\w-]*\s*=[^{}\n]*\}/i;

export function parseKpiLine(text: string): KpiItem | null {
  const raw = text.trim();
  if (!raw) return null;
  let rest = raw;
  let tone: string | undefined;
  let delta: string | undefined;
  let note: string | undefined;
  let trend: string | undefined;

  for (const options of raw.matchAll(KPI_OPTIONS)) {
    for (const m of options[1].matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|([^\s"]+))/gi)) {
      const key = m[1].toLowerCase();
      const value = (m[2] ?? m[3] ?? "").trim();
      if (key === "tone") tone = knownTone(value);
      else if (key === "note" && value) note = value;
      else if (key === "trend") trend = kpiTrend(value);
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
  const extra = trend ? { trend } : {};
  if (sep === -1) return { label: rest, value: "", tone, delta, note, ...extra };
  return {
    label: rest.slice(0, sep).trim(),
    value: rest.slice(sep + 1).trim(),
    tone,
    delta,
    note,
    ...extra,
  };
}
