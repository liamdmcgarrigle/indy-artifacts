"use client";

import { useEffect, useMemo, useRef } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Plus, X } from "lucide-react";
import { BlockError, parseTableBlock } from "@/lib/pipeline/parse";
import type { TableSpec } from "@/lib/pipeline/types";
import { coerceCell, type Cell } from "@/lib/charts/builder";
import { cn } from "@/lib/utils";


/**
 * The numbers behind a chart or table, as a grid you type into. It scrolls
 * sideways on a phone rather than squeezing its columns.
 */
export function Grid({
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
  const set = (r: number, c: number, v: string) => onRows(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? coerceCell(v) : cell)) : row)));
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
export function Preview({ tag, attr, json }: { tag: string; attr: string; json: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement(tag);
    el.setAttribute(attr, json);
    host.current?.replaceChildren(el);
  }, [tag, attr, json]);
  return <div ref={host} className="data-edit__preview" contentEditable={false} />;
}

/** What the source says, when it cannot be read as a grid: fix it as text. */
export function Broken({ code, error, onChange }: { code: string; error: string; onChange: (code: string) => void }) {
  return (
    <div className="data-edit__broken">
      <p>{error}</p>
      <textarea value={code} onChange={(e) => onChange(e.target.value)} spellCheck={false} rows={Math.min(code.split("\n").length + 1, 16)} />
    </div>
  );
}

/** A table shows what was typed: true and false stay words. */
const asText = (rows: Cell[][]) => rows.map((r) => r.map((c) => (typeof c === "boolean" ? String(c) : c)));

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
      <Grid
        columns={spec.columns}
        rows={spec.rows}
        onColumns={(columns) => write({ columns })}
        onRows={(rows) => write({ rows: asText(rows) })}
        onShape={(columns, rows) => write({ columns, rows: asText(rows) })}
      />
    </NodeViewWrapper>
  );
}

