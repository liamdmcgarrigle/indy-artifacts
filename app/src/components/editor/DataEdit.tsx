"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { parse as parseYaml, stringify } from "yaml";
import { Plus, X } from "lucide-react";
import { BlockError, parseChartBlock, parseTableBlock } from "@/lib/pipeline/parse";
import { CHART_TYPES, type ChartSpec, type TableSpec } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

type Cell = string | number;

/** A number when it reads as one, so charts get numbers back. */
function coerce(raw: string): Cell {
  const t = raw.trim();
  return t !== "" && /^-?[\d,]*\.?\d+$/.test(t) ? Number(t.replace(/,/g, "")) : raw;
}

/**
 * The numbers behind a chart or table, as a grid you type into. It scrolls
 * sideways on a phone rather than squeezing its columns.
 */
function Grid({
  columns,
  rows,
  onColumns,
  onRows,
  onShape,
  fixedFirst,
}: {
  columns: string[];
  rows: Cell[][];
  /** A column renamed: the cells stay where they are. */
  onColumns: (next: string[]) => void;
  onRows: (next: Cell[][]) => void;
  /** A column added or removed: headers and cells change in one write, or the second would undo the first. */
  onShape: (columns: string[], rows: Cell[][]) => void;
  /** The first column is the chart's x key: it can be renamed, not removed. */
  fixedFirst?: boolean;
}) {
  const set = (r: number, c: number, v: string) => onRows(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? coerce(v) : cell)) : row)));
  return (
    <div className="data-grid">
      <table>
        <thead>
          <tr>
            {columns.map((col, c) => (
              <th key={c}>
                <input
                  value={col}
                  aria-label={`Column ${c + 1} name`}
                  onChange={(e) => onColumns(columns.map((x, j) => (j === c ? e.target.value : x)))}
                />
                {c > 0 || !fixedFirst ? (
                  <button
                    type="button"
                    aria-label={`Remove column ${col}`}
                    className="data-grid__x"
                    onClick={() =>
                      onShape(
                        columns.filter((_, j) => j !== c),
                        rows.map((row) => row.filter((_, j) => j !== c)),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </th>
            ))}
            <th className="data-grid__add">
              <button
                type="button"
                aria-label="Add a column"
                onClick={() =>
                  onShape(
                    [...columns, `series ${columns.length}`],
                    rows.map((row) => [...row, 0]),
                  )
                }
              >
                <Plus className="size-3.5" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <input
                    value={String(cell)}
                    inputMode={typeof cell === "number" ? "decimal" : undefined}
                    aria-label={`${columns[c]}, row ${r + 1}`}
                    onChange={(e) => set(r, c, e.target.value)}
                  />
                </td>
              ))}
              <td className="data-grid__add">
                <button type="button" aria-label={`Remove row ${r + 1}`} onClick={() => onRows(rows.filter((_, i) => i !== r))}>
                  <X className="size-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="data-grid__row" onClick={() => onRows([...rows, columns.map((_, c) => (c === 0 ? "" : 0))])}>
        <Plus className="size-3.5" /> Row
      </button>
    </div>
  );
}

/** An <art-*> element built by hand, so the primitive draws the preview. */
function Preview({ tag, attr, json }: { tag: string; attr: string; json: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement(tag);
    el.setAttribute(attr, json);
    host.current?.replaceChildren(el);
  }, [tag, attr, json]);
  return <div ref={host} className="data-edit__preview" contentEditable={false} />;
}

/** What the source says, when it cannot be read as a grid: fix it as text. */
function Broken({ code, error, onChange }: { code: string; error: string; onChange: (code: string) => void }) {
  return (
    <div className="data-edit__broken">
      <p>{error}</p>
      <textarea value={code} onChange={(e) => onChange(e.target.value)} spellCheck={false} rows={Math.min(code.split("\n").length + 1, 16)} />
    </div>
  );
}

/** Keys the grid and bar write; anything else the author set (series, axes, marks) is kept as written. */
const CHART_KEYS = new Set(["type", "orientation", "horizontal", "title", "x", "y", "stacked", "unit", "height", "data"]);

function chartYaml(spec: ChartSpec, original: Record<string, unknown>): string {
  const out: Record<string, unknown> = { type: spec.type };
  if (spec.horizontal) out.horizontal = true;
  if (spec.title) out.title = spec.title;
  out.x = spec.x;
  out.y = spec.y.length === 1 ? spec.y[0] : spec.y;
  if (spec.stacked) out.stacked = true;
  if (spec.unit) out.unit = spec.unit;
  if (original.height !== undefined) out.height = spec.height;
  for (const [key, value] of Object.entries(original)) if (!CHART_KEYS.has(key)) out[key] = value;
  out.data = spec.data;
  return stringify(out, { flowCollectionPadding: true, collectionStyle: "any" }).replace(/\n$/, "");
}

/** The type menu: bar twice, once each way up. */
const TYPE_CHOICES = CHART_TYPES.flatMap((t) => (t === "bar" ? ["bar", "barh"] : [t]));
const TYPE_NAMES: Record<string, string> = { bar: "Bar", barh: "Bar, horizontal" };

/** Series options follow a renamed y key; ones for a removed key go. */
function renameSeries(raw: Record<string, unknown>, from: string[], to: string[]): Record<string, unknown> {
  const series = raw.series;
  if (!series || typeof series !== "object" || Array.isArray(series)) return raw;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(series)) {
    const i = from.indexOf(key);
    if (i !== -1 && to[i] !== undefined) next[to[i]] = value;
  }
  const rest = { ...raw };
  delete rest.series;
  return Object.keys(next).length ? { ...rest, series: next } : rest;
}

/** What a new type cannot draw goes: pies have no axes, and sideways or scatter charts no lines mixed in. */
function fitToType(raw: Record<string, unknown>, picked: string): Record<string, unknown> {
  const next = { ...raw };
  if (picked === "pie" || picked === "doughnut") {
    delete next.series;
    delete next.axes;
    delete next.marks;
    return next;
  }
  const series = next.series;
  if ((picked === "barh" || picked === "scatter") && series && typeof series === "object" && !Array.isArray(series)) {
    next.series = Object.fromEntries(
      Object.entries(series as Record<string, Record<string, unknown>>).map(([key, value]) => {
        const kept = { ...value };
        delete kept.as;
        return [key, kept];
      }),
    );
  }
  return next;
}

export function ChartEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const code = String(node.attrs.code ?? "");
  const parsed = useMemo(() => {
    try {
      return { spec: parseChartBlock(code), raw: (parseYaml(code) ?? {}) as Record<string, unknown> };
    } catch (err) {
      return { error: err instanceof BlockError ? err.message : String(err) };
    }
  }, [code]);
  const [showData, setShowData] = useState(true);

  if ("error" in parsed) {
    return (
      <NodeViewWrapper className="data-edit">
        <Broken code={code} error={`This chart cannot be drawn: ${parsed.error}`} onChange={(c) => updateAttributes({ code: c })} />
      </NodeViewWrapper>
    );
  }
  const { spec, raw } = parsed;
  const write = (next: Partial<ChartSpec>, original = raw) => updateAttributes({ code: chartYaml({ ...spec, ...next }, original) });
  const columns = [spec.x, ...spec.y];
  const rows = spec.data.map((d) => columns.map((k) => (d[k] ?? "") as Cell));

  return (
    <NodeViewWrapper className="data-edit">
      <div className="data-edit__bar" contentEditable={false}>
        <input className="data-edit__title" value={spec.title ?? ""} placeholder="Chart title" onChange={(e) => write({ title: e.target.value || undefined })} />
        <select
          value={spec.horizontal ? "barh" : spec.type}
          onChange={(e) => {
            const picked = e.target.value;
            write(
              picked === "barh" ? { type: "bar", horizontal: true } : { type: picked as ChartSpec["type"], horizontal: false },
              fitToType(raw, picked),
            );
          }}
          aria-label="Chart type"
        >
          {TYPE_CHOICES.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t] ?? t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <button type="button" className={cn("data-edit__toggle", showData && "is-on")} onClick={() => setShowData((v) => !v)}>
          Data
        </button>
      </div>
      <Preview tag="art-chart" attr="data-chart" json={JSON.stringify(spec)} />
      {showData ? (
        <Grid
          columns={columns}
          rows={rows}
          fixedFirst
          onColumns={(next) => {
            // Renaming a column renames its key in every row.
            const data = spec.data.map((d) => Object.fromEntries(next.map((k, i) => [k, d[columns[i]] ?? 0])));
            write({ x: next[0], y: next.slice(1), data }, renameSeries(raw, columns, next));
          }}
          onRows={(next) => write({ data: next.map((row) => Object.fromEntries(columns.map((k, i) => [k, row[i] ?? ""]))) })}
          onShape={(cols, next) =>
            write(
              { x: cols[0], y: cols.slice(1), data: next.map((row) => Object.fromEntries(cols.map((k, i) => [k, row[i] ?? ""]))) },
              renameSeries(raw, cols, cols),
            )
          }
        />
      ) : null}
    </NodeViewWrapper>
  );
}

function csvCell(v: Cell): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tableCode(spec: TableSpec): string {
  const lines = spec.sortable ? ["# sortable"] : [];
  lines.push(spec.columns.map(csvCell).join(", "));
  for (const row of spec.rows) lines.push(row.map(csvCell).join(", "));
  return lines.join("\n");
}

export function TableEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const code = String(node.attrs.code ?? "");
  const parsed = useMemo(() => {
    try {
      return { spec: parseTableBlock(code) };
    } catch (err) {
      return { error: err instanceof BlockError ? err.message : String(err) };
    }
  }, [code]);
  if ("error" in parsed) {
    return (
      <NodeViewWrapper className="data-edit">
        <Broken code={code} error={`This table cannot be read: ${parsed.error}`} onChange={(c) => updateAttributes({ code: c })} />
      </NodeViewWrapper>
    );
  }
  const { spec } = parsed;
  const write = (next: Partial<TableSpec>) => updateAttributes({ code: tableCode({ ...spec, ...next }) });
  return (
    <NodeViewWrapper className="data-edit">
      <div className="data-edit__bar" contentEditable={false}>
        <label className="data-edit__check">
          <input type="checkbox" checked={spec.sortable} onChange={(e) => write({ sortable: e.target.checked })} /> Sortable columns
        </label>
      </div>
      <Grid columns={spec.columns} rows={spec.rows} onColumns={(columns) => write({ columns })}
        onRows={(rows) => write({ rows })}
        onShape={(columns, rows) => write({ columns, rows })}
      />
    </NodeViewWrapper>
  );
}

