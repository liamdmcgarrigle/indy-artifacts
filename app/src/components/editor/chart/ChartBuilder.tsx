"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { parse as parseYaml } from "yaml";
import { ArrowLeftRight, ChevronDown, Plus, SlidersHorizontal, Sparkles, Table2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  chartSource,
  dataKeys,
  KIND_GROUPS,
  kindChoices,
  kindOf,
  KINDS,
  parsePasted,
  suggestKinds,
  transposed,
  tryChart,
  withPasted,
  yKeys,
  type Cell,
  type Raw,
} from "@/lib/charts/builder";
import type { ChartSpec } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";
import { Broken, Grid, Preview } from "../DataEdit";
import { KindIcon } from "./KindIcon";

/* ------------------------------------------------------------------ helpers */

type Panel = "data" | "options" | null;

const asMap = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});

/** A copy with `key` set, or removed when the value is empty. */
function put(raw: Raw, key: string, value: unknown): Raw {
  const next = { ...raw };
  if (value === undefined || value === null || value === "" || value === false) delete next[key];
  else next[key] = value;
  return next;
}

/** A copy with a nested map's key set, and the map removed when it empties. */
function putIn(raw: Raw, path: string[], value: unknown): Raw {
  const [head, ...rest] = path;
  if (!rest.length) return put(raw, head, value);
  const inner = putIn(asMap(raw[head]), rest, value);
  return put(raw, head, Object.keys(inner).length ? inner : undefined);
}

const numberOrEmpty = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

/* ---------------------------------------------------------------- controls */

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("cb-field", wide && "cb-field--wide")}>
      <span className="cb-field__label">{label}</span>
      {children}
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cb-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={cn("cb-seg__opt", value === v && "is-on")} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="cb-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function KeySelect({ value, keys, onChange, empty }: { value: string; keys: string[]; onChange: (v: string) => void; empty?: string }) {
  return (
    <select className="cb-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {keys.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

const COLORS: [string, string][] = [
  ["", "Auto"],
  ["1", "Color 1"],
  ["2", "Color 2"],
  ["3", "Color 3"],
  ["4", "Color 4"],
  ["5", "Color 5"],
  ["6", "Color 6"],
  ["good", "Good"],
  ["warn", "Warning"],
  ["bad", "Bad"],
  ["info", "Info"],
  ["muted", "Muted"],
];

/* ------------------------------------------------------------- kind picker */

function KindPicker({ raw, current, suggested, onPick }: { raw: Raw; current?: string; suggested: string[]; onPick: (next: Raw) => void }) {
  const choices = useMemo(() => kindChoices(raw), [raw]);
  return (
    <div className="cb-kinds">
      {KIND_GROUPS.map((group) => (
        <div key={group} className="cb-kinds__group">
          <div className="cb-kinds__title">{group}</div>
          <div className="cb-kinds__grid">
            {choices
              .filter((c) => c.kind.group === group)
              .map(({ kind, error }) => (
                <button
                  key={kind.id}
                  type="button"
                  className={cn("cb-kind", kind.id === current && "is-on", error && "is-off")}
                  disabled={!!error}
                  title={error ? `Not with this data: ${error}` : kind.label}
                  onClick={() => onPick(kind.apply(raw))}
                >
                  <KindIcon kind={kind.id} className="cb-kind__icon" />
                  <span className="cb-kind__label">{kind.label}</span>
                  {suggested.includes(kind.id) && kind.id !== current ? <Sparkles className="cb-kind__tip size-3" aria-label="Suits this data" /> : null}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- options */

function Options({ raw, spec, setRaw }: { raw: Raw; spec: ChartSpec; setRaw: (next: Raw) => void }) {
  const t = spec.type;
  const along = (t === "bar" || t === "line" || t === "area") && !spec.range;
  const keys = dataKeys(raw);
  const y = yKeys(raw);
  const series = asMap(raw.series);
  const axes = asMap(raw.axes);
  const marks = Array.isArray(raw.marks) ? (raw.marks as Raw[]) : [];
  const hasRight = Object.values(series).some((s) => asMap(s).axis === "right");
  const format = String(raw.format ?? "").split(":")[0];
  const set = (key: string, value: unknown) => setRaw(put(raw, key, value));
  const setIn = (path: string[], value: unknown) => setRaw(putIn(raw, path, value));

  const valueAxes = along || t === "scatter" || spec.range || t === "waterfall" || t === "histogram" || t === "box";
  const canMark = along || t === "scatter" || spec.range || t === "waterfall";

  return (
    <div className="cb-options" contentEditable={false}>
      <section className="cb-section">
        <h4>Numbers</h4>
        <div className="cb-row">
          <Field label="Format">
            <select className="cb-input" value={format} onChange={(e) => setRaw(put(put(raw, "format", e.target.value || undefined), "currency", e.target.value === "currency" ? raw.currency : undefined))}>
              <option value="">1,234</option>
              <option value="compact">1.2K</option>
              <option value="percent">12% from 0.12</option>
              <option value="currency">$1,234</option>
            </select>
          </Field>
          {format === "currency" ? (
            <Field label="Currency">
              <input className="cb-input cb-input--short" value={String(raw.currency ?? "")} placeholder="USD" maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase() || undefined)} />
            </Field>
          ) : null}
          <Field label="Decimals">
            <input className="cb-input cb-input--short" inputMode="numeric" value={raw.decimals === undefined ? "" : String(raw.decimals)} placeholder="auto" onChange={(e) => set("decimals", numberOrEmpty(e.target.value))} />
          </Field>
          <Field label="Unit">
            <input className="cb-input cb-input--short" value={String(raw.unit ?? "")} placeholder="ms, %, jobs" onChange={(e) => set("unit", e.target.value || undefined)} />
          </Field>
        </div>
      </section>

      <section className="cb-section">
        <h4>Layout</h4>
        <div className="cb-row">
          {along ? (
            <Field label="Stacking">
              <Choice
                label="Stacking"
                value={raw.stacked === "percent" || raw.stacked === "100%" ? "percent" : raw.stacked === true ? "stacked" : "none"}
                options={[
                  ["none", "Side by side"],
                  ["stacked", "Stacked"],
                  ["percent", "100%"],
                ]}
                onChange={(v) => set("stacked", v === "none" ? undefined : v === "stacked" ? true : "percent")}
              />
            </Field>
          ) : null}
          {t === "line" || t === "area" || Object.values(series).some((s) => asMap(s).as === "line" || asMap(s).as === "area") ? (
            <Field label="Curve">
              <Choice
                label="Curve"
                value={String(raw.curve ?? "smooth")}
                options={[
                  ["smooth", "Smooth"],
                  ["straight", "Straight"],
                  ["step", "Step"],
                ]}
                onChange={(v) => set("curve", v === "smooth" ? undefined : v)}
              />
            </Field>
          ) : null}
          {along || t === "pie" || t === "doughnut" || spec.range ? (
            <Field label="Order">
              <Choice
                label="Order"
                value={String(raw.sort ?? "none")}
                options={[
                  ["none", "As written"],
                  ["desc", "Biggest first"],
                  ["asc", "Smallest first"],
                ]}
                onChange={(v) => set("sort", v === "none" ? undefined : v)}
              />
            </Field>
          ) : null}
          {y.length > 1 || t === "pie" || t === "doughnut" || raw.group ? (
            <Field label="Legend">
              <Choice
                label="Legend"
                value={String(raw.legend ?? "top")}
                options={[
                  ["top", "Top"],
                  ["bottom", "Bottom"],
                  ["none", "None"],
                ]}
                onChange={(v) => set("legend", v === "top" ? undefined : v)}
              />
            </Field>
          ) : null}
        </div>
        <div className="cb-row">
          {t !== "sankey" && t !== "box" ? <Switch label="Values on the data" checked={raw.labels === true || (t === "funnel" && raw.labels !== false)} onChange={(v) => set("labels", t === "funnel" ? (v ? undefined : false) : v || undefined)} /> : null}
          <Field label="Height">
            <input className="cb-input cb-input--short" inputMode="numeric" value={raw.height === undefined ? "" : String(raw.height)} placeholder={String(spec.height)} onChange={(e) => set("height", numberOrEmpty(e.target.value))} />
          </Field>
        </div>
      </section>

      {t === "histogram" || t === "doughnut" || t === "scatter" || t === "sankey" || t === "heatmap" ? (
        <section className="cb-section">
          <h4>{t === "scatter" ? (spec.size ? "Bubbles" : "Points") : t === "sankey" ? "Flows" : t === "heatmap" ? "Cells" : t === "histogram" ? "Ranges" : "Middle"}</h4>
          <div className="cb-row">
            {t === "histogram" ? (
              <Field label="How many ranges">
                <input className="cb-input cb-input--short" inputMode="numeric" value={raw.bins === undefined ? "" : String(raw.bins)} placeholder="auto" onChange={(e) => set("bins", numberOrEmpty(e.target.value))} />
              </Field>
            ) : null}
            {t === "doughnut" ? (
              <Field label="Words under the total" wide>
                <input className="cb-input" value={String(raw.center ?? "")} placeholder="requests" onChange={(e) => set("center", e.target.value || undefined)} />
              </Field>
            ) : null}
            {t === "scatter" ? (
              <>
                <Field label="Color by">
                  <KeySelect value={String(raw.group ?? "")} keys={keys.filter((k) => k !== spec.x && !spec.y.includes(k))} empty="Nothing" onChange={(v) => set("group", v || undefined)} />
                </Field>
                <Field label="Name each point by">
                  <KeySelect value={String(raw.label ?? "")} keys={keys.filter((k) => k !== spec.x && !spec.y.includes(k))} empty="Nothing" onChange={(v) => set("label", v || undefined)} />
                </Field>
                <Field label="Size by">
                  <KeySelect value={String(raw.size ?? "")} keys={keys.filter((k) => k !== spec.x && !spec.y.includes(k))} empty="Nothing" onChange={(v) => set("size", v || undefined)} />
                </Field>
                <Switch label="Join the points" checked={raw.line === true} onChange={(v) => set("line", v || undefined)} />
                <Switch label="Trend line" checked={raw.trend === "linear"} onChange={(v) => set("trend", v ? "linear" : undefined)} />
              </>
            ) : null}
            {t === "sankey" ? (
              <>
                <Field label="From">
                  <KeySelect value={spec.x} keys={keys} onChange={(v) => set("from", v)} />
                </Field>
                <Field label="To">
                  <KeySelect value={spec.y[0]} keys={keys} onChange={(v) => set("to", v)} />
                </Field>
                <Field label="Amount">
                  <KeySelect value={spec.value ?? "value"} keys={keys} onChange={(v) => set("value", v)} />
                </Field>
              </>
            ) : null}
            {t === "heatmap" ? (
              <>
                <Field label="Rows">
                  <KeySelect value={spec.y[0]} keys={keys.filter((k) => k !== spec.x)} onChange={(v) => set("y", v)} />
                </Field>
                <Field label="Shade by">
                  <KeySelect value={spec.value ?? ""} keys={keys.filter((k) => k !== spec.x)} onChange={(v) => set("value", v)} />
                </Field>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {(along || t === "radar") && y.length ? (
        <section className="cb-section">
          <h4>Series</h4>
          <div className="cb-series">
            {y.map((key) => {
              const s = asMap(series[key]);
              const color = s.color === undefined ? "" : String(s.color);
              return (
                <div key={key} className="cb-series__row">
                  <span className="cb-series__name">{key}</span>
                  <select className="cb-input" aria-label={`${key} color`} value={color} onChange={(e) => setIn(["series", key, "color"], e.target.value === "" ? undefined : /^\d$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}>
                    {COLORS.map(([v, text]) => (
                      <option key={v} value={v}>
                        {text}
                      </option>
                    ))}
                  </select>
                  {along && !spec.horizontal ? (
                    <select className="cb-input" aria-label={`${key} drawn as`} value={String(s.as ?? "")} onChange={(e) => setIn(["series", key, "as"], e.target.value || undefined)}>
                      <option value="">As the chart</option>
                      <option value="bar">Bars</option>
                      <option value="line">Line</option>
                      <option value="area">Area</option>
                    </select>
                  ) : null}
                  {along ? (
                    <select className="cb-input" aria-label={`${key} axis`} value={String(s.axis ?? "left")} onChange={(e) => setIn(["series", key, "axis"], e.target.value === "right" ? "right" : undefined)}>
                      <option value="left">{spec.horizontal ? "Bottom axis" : "Left axis"}</option>
                      <option value="right">{spec.horizontal ? "Top axis" : "Right axis"}</option>
                    </select>
                  ) : null}
                  <Switch label="Dashed" checked={s.dash === true} onChange={(v) => setIn(["series", key, "dash"], v || undefined)} />
                  <Switch label="Start hidden" checked={s.hidden === true} onChange={(v) => setIn(["series", key, "hidden"], v || undefined)} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {valueAxes ? (
        <section className="cb-section">
          <h4>Axes</h4>
          <div className="cb-row">
            <Field label={t === "scatter" || t === "histogram" ? "Across" : "Categories"}>
              <input className="cb-input" value={String(asMap(axes.x).title ?? "")} placeholder="Title" onChange={(e) => setIn(["axes", "x", "title"], e.target.value || undefined)} />
            </Field>
            <Field label={spec.horizontal ? "Values" : "Left"}>
              <input className="cb-input" value={String(asMap(axes.left).title ?? "")} placeholder="Title" onChange={(e) => setIn(["axes", "left", "title"], e.target.value || undefined)} />
            </Field>
            <Field label="From">
              <input className="cb-input cb-input--short" inputMode="decimal" value={asMap(axes.left).min === undefined ? "" : String(asMap(axes.left).min)} placeholder="auto" onChange={(e) => setIn(["axes", "left", "min"], numberOrEmpty(e.target.value))} />
            </Field>
            <Field label="To">
              <input className="cb-input cb-input--short" inputMode="decimal" value={asMap(axes.left).max === undefined ? "" : String(asMap(axes.left).max)} placeholder="auto" onChange={(e) => setIn(["axes", "left", "max"], numberOrEmpty(e.target.value))} />
            </Field>
            {along || t === "scatter" ? <Switch label="Log scale" checked={asMap(axes.left).log === true} onChange={(v) => setIn(["axes", "left", "log"], v || undefined)} /> : null}
          </div>
          {hasRight ? (
            <div className="cb-row">
              <Field label={spec.horizontal ? "Top" : "Right"}>
                <input className="cb-input" value={String(asMap(axes.right).title ?? "")} placeholder="Title" onChange={(e) => setIn(["axes", "right", "title"], e.target.value || undefined)} />
              </Field>
              <Field label="Format">
                <select className="cb-input" value={String(asMap(axes.right).format ?? "")} onChange={(e) => setIn(["axes", "right", "format"], e.target.value || undefined)}>
                  <option value="">1,234</option>
                  <option value="compact">1.2K</option>
                  <option value="percent">12% from 0.12</option>
                  <option value="currency">$1,234</option>
                </select>
              </Field>
              <Field label="Unit">
                <input className="cb-input cb-input--short" value={String(asMap(axes.right).unit ?? "")} placeholder="%" onChange={(e) => setIn(["axes", "right", "unit"], e.target.value || undefined)} />
              </Field>
            </div>
          ) : null}
        </section>
      ) : null}

      {canMark ? <Marks raw={raw} spec={spec} marks={marks} setRaw={setRaw} /> : null}
    </div>
  );
}

type MarkKind = "value" | "at" | "band";

function markKind(m: Raw): MarkKind {
  return m.from !== undefined || m.to !== undefined ? "band" : m.y !== undefined || m.value !== undefined ? "value" : "at";
}

function Marks({ raw, spec, marks, setRaw }: { raw: Raw; spec: ChartSpec; marks: Raw[]; setRaw: (next: Raw) => void }) {
  const labels = spec.data.map((row) => String(row[spec.x] ?? ""));
  const firstX = spec.type === "scatter" ? 0 : labels[0];
  const lastX = spec.type === "scatter" ? 0 : labels[labels.length - 1];
  const write = (next: Raw[]) => setRaw(put(raw, "marks", next.length ? next : undefined));
  // A new line starts where the data is, rounded, rather than on the floor.
  const values = spec.data.map((row) => Number(row[spec.y[0]])).filter(Number.isFinite);
  const mean = values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0;
  const step = mean ? 10 ** Math.floor(Math.log10(Math.abs(mean))) : 1;
  const typical = Math.round(mean / step) * step;
  const change = (i: number, m: Raw) => write(marks.map((x, j) => (j === i ? m : x)));
  const xInput = (m: Raw, key: string, i: number) =>
    spec.type === "scatter" ? (
      <input className="cb-input cb-input--short" inputMode="decimal" value={m[key] === undefined ? "" : String(m[key])} onChange={(e) => change(i, { ...m, [key]: numberOrEmpty(e.target.value) ?? 0 })} />
    ) : (
      <select className="cb-input" value={String(m[key] ?? "")} onChange={(e) => change(i, { ...m, [key]: e.target.value })}>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    );
  return (
    <section className="cb-section">
      <h4>Lines and ranges</h4>
      <div className="cb-marks">
        {marks.map((m, i) => {
          const kind = markKind(m);
          return (
            <div key={i} className="cb-marks__row">
              <select
                className="cb-input"
                aria-label="Kind of mark"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as MarkKind;
                  const keep = { ...(m.label ? { label: m.label } : {}), ...(m.tone ? { tone: m.tone } : {}) };
                  change(i, k === "value" ? { y: 0, ...keep } : k === "at" ? { x: firstX, ...keep } : { from: firstX, to: lastX, ...keep });
                }}
              >
                <option value="value">Line at a value</option>
                <option value="at">Line at one {spec.x}</option>
                <option value="band">Shaded range</option>
              </select>
              {kind === "value" ? (
                <input className="cb-input cb-input--short" inputMode="decimal" aria-label="Value" value={String(m.y ?? m.value ?? "")} onChange={(e) => change(i, { ...m, y: numberOrEmpty(e.target.value) ?? 0 })} />
              ) : kind === "at" ? (
                xInput(m, "x", i)
              ) : (
                <>
                  {xInput(m, "from", i)}
                  <span className="cb-marks__to">to</span>
                  {xInput(m, "to", i)}
                </>
              )}
              <input className="cb-input" aria-label="Label" placeholder="Label" value={String(m.label ?? "")} onChange={(e) => change(i, put(m, "label", e.target.value || undefined))} />
              <select className="cb-input" aria-label="Tone" value={String(m.tone ?? "")} onChange={(e) => change(i, put(m, "tone", e.target.value || undefined))}>
                <option value="">Muted</option>
                <option value="good">Good</option>
                <option value="warn">Warning</option>
                <option value="bad">Bad</option>
                <option value="info">Info</option>
              </select>
              <button type="button" className="cb-icon-btn" aria-label="Remove this mark" onClick={() => write(marks.filter((_, j) => j !== i))}>
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <button type="button" className="data-grid__row" onClick={() => write([...marks, { y: typical, label: "Target" }])}>
          <Plus className="size-3.5" /> Line or range
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- data */

/** Keys the chart names, so a renamed column is renamed wherever the chart refers to it. */
const NAMED = ["x", "value", "from", "to", "group", "label", "size"];

function renameKey(raw: Raw, from: string, to: string): Raw {
  const next: Raw = { ...raw };
  for (const k of NAMED) if (next[k] === from) next[k] = to;
  if (Array.isArray(next.y)) next.y = (next.y as string[]).map((k) => (k === from ? to : k));
  else if (next.y === from) next.y = to;
  const series = asMap(next.series);
  if (from in series) next.series = Object.fromEntries(Object.entries(series).map(([k, v]) => [k === from ? to : k, v]));
  next.data = (Array.isArray(raw.data) ? (raw.data as Raw[]) : []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k === from ? to : k, v])));
  return next;
}

function DataPanel({ raw, spec, setRaw }: { raw: Raw; spec: ChartSpec; setRaw: (next: Raw) => void }) {
  const columns = dataKeys(raw);
  const data = Array.isArray(raw.data) ? (raw.data as Raw[]) : [];
  const rows = data.map((d) => columns.map((k) => (d[k] ?? "") as Cell));
  const along = (spec.type === "bar" || spec.type === "line" || spec.type === "area" || spec.type === "radar") && !spec.range;
  const turned = useMemo(() => transposed(raw), [raw]);
  const toRows = (cols: string[], next: Cell[][]) => next.map((r) => Object.fromEntries(cols.map((k, i) => [k, r[i] ?? ""]).filter(([, v]) => v !== "")));

  return (
    <div
      className="cb-data"
      contentEditable={false}
      onPaste={(e) => {
        // A block of cells from a spreadsheet replaces the data; a single value goes in its cell as usual.
        const text = e.clipboardData.getData("text/plain");
        if (!/[\t\n]/.test(text.trim())) return;
        const pasted = parsePasted(text);
        if (!pasted || (pasted.rows.length < 2 && pasted.columns.length < 2)) return;
        e.preventDefault();
        setRaw(withPasted(raw, pasted));
      }}
    >
      <div className="cb-data__bar">
        <span className="cb-data__hint">Paste cells from a spreadsheet to replace the data.</span>
        {along && turned ? (
          <button type="button" className="data-edit__toggle cb-btn" onClick={() => setRaw(turned)} title="Rows become series and series become rows">
            <ArrowLeftRight className="size-3.5" /> Swap rows and series
          </button>
        ) : null}
      </div>
      <Grid
        columns={columns}
        rows={rows}
        fixedFirst
        onColumns={(next) => {
          const i = next.findIndex((k, j) => k !== columns[j]);
          if (i !== -1 && next[i]) setRaw(renameKey(raw, columns[i], next[i]));
        }}
        onRows={(next) => setRaw({ ...raw, data: toRows(columns, next) })}
        onShape={(cols, next) => {
          let updated: Raw = { ...raw, data: toRows(cols, next) };
          const added = cols.filter((k) => !columns.includes(k));
          const removed = columns.filter((k) => !cols.includes(k));
          const y = yKeys(raw);
          // A new column along categories is a new series; a removed one stops being plotted.
          if (along && added.length) updated.y = [...y, ...added];
          if (removed.length) {
            const kept = y.filter((k) => !removed.includes(k));
            updated.y = kept.length === 1 ? kept[0] : kept;
            const series = asMap(updated.series);
            for (const k of removed) delete series[k];
            updated = put(updated, "series", Object.keys(series).length ? series : undefined);
          }
          setRaw(updated);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- builder */

export function ChartEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const code = String(node.attrs.code ?? "");
  const narrow = useNarrow();
  const [panel, setPanel] = useState<Panel>("data");
  const [picking, setPicking] = useState(false);

  const parsed = useMemo(() => {
    let raw: Raw;
    try {
      const doc = parseYaml(code);
      raw = asMap(doc);
    } catch (err) {
      return { error: `The chart's YAML cannot be read: ${(err as Error).message}` };
    }
    const result = tryChart(raw);
    return "error" in result ? { error: `This chart cannot be drawn: ${result.error}`, raw } : { raw, spec: result.spec };
  }, [code]);

  const setRaw = (next: Raw) => updateAttributes({ code: chartSource(next) });

  // Typing passes through values the parser refuses ("E" on the way to "EUR", "1" on the way
  // to "12"). The builder stays up on the last chart that drew and says what is wrong, so the
  // field being typed in is not torn out from under the cursor.
  const lastGood = useRef<ChartSpec | null>(null);
  if ("spec" in parsed && parsed.spec) lastGood.current = parsed.spec;
  const pending = !("spec" in parsed && parsed.spec) && "raw" in parsed && parsed.raw && lastGood.current ? parsed.error : null;

  if (!pending && (!("spec" in parsed) || !parsed.spec)) {
    return (
      <NodeViewWrapper className="data-edit">
        <Broken code={code} error={parsed.error ?? "This chart cannot be drawn"} onChange={(c) => updateAttributes({ code: c })} />
      </NodeViewWrapper>
    );
  }
  const raw = (parsed as { raw: Raw }).raw;
  const spec = pending ? lastGood.current! : (parsed as { spec: ChartSpec }).spec;
  const current = kindOf(spec);
  const suggested = suggestKinds(raw).filter((id) => id !== current?.id);
  const toggle = (p: Panel) => setPanel((now) => (now === p ? null : p));

  const options = <Options raw={raw} spec={spec} setRaw={setRaw} />;

  return (
    <NodeViewWrapper className="data-edit chart-builder">
      <div className="data-edit__bar" contentEditable={false}>
        <input className="data-edit__title" value={String(raw.title ?? "")} placeholder="Chart title" onChange={(e) => setRaw(put(raw, "title", e.target.value || undefined))} />
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <button type="button" className="data-edit__toggle cb-btn cb-kind-btn" aria-label="Chart kind">
              <KindIcon kind={current?.id ?? "bar"} className="cb-kind-btn__icon" />
              {current?.label ?? spec.type}
              <ChevronDown className="size-3.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" collisionPadding={12} className="cb-kinds-pop w-[min(560px,calc(100vw-24px))] p-0">
            <KindPicker
              raw={raw}
              current={current?.id}
              suggested={suggested}
              onPick={(next) => {
                setRaw(next);
                setPicking(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <button type="button" className={cn("data-edit__toggle cb-btn", panel === "options" && "is-on")} onClick={() => toggle("options")}>
          <SlidersHorizontal className="size-3.5" /> Options
        </button>
        <button type="button" className={cn("data-edit__toggle cb-btn", panel === "data" && "is-on")} onClick={() => toggle("data")}>
          <Table2 className="size-3.5" /> Data
        </button>
      </div>
      {suggested.length ? (
        <div className="cb-suggest" contentEditable={false}>
          <Sparkles className="size-3.5" />
          <span>Suits this data:</span>
          {suggested.map((id) => {
            const kind = KINDS.find((k) => k.id === id)!;
            const next = kind.apply(raw);
            if ("error" in tryChart(next)) return null;
            return (
              <button key={id} type="button" className="cb-suggest__chip" onClick={() => setRaw(next)}>
                <KindIcon kind={id} className="cb-suggest__icon" />
                {kind.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {pending ? (
        <p className="cb-pending" role="status" contentEditable={false}>
          {pending}
        </p>
      ) : null}
      <Preview tag="art-chart" attr="data-chart" json={JSON.stringify(spec)} />
      {panel === "options" ? (
        narrow ? (
          <Sheet open onOpenChange={(open) => (open ? null : setPanel(null))}>
            <SheetContent side="bottom" className="cb-sheet max-h-[80vh] overflow-y-auto">
              <SheetTitle className="cb-sheet__title">Chart options</SheetTitle>
              <SheetDescription className="sr-only">How the chart reads: numbers, layout, series, axes and marks.</SheetDescription>
              {options}
            </SheetContent>
          </Sheet>
        ) : (
          options
        )
      ) : null}
      {panel === "data" ? <DataPanel raw={raw} spec={spec} setRaw={setRaw} /> : null}
    </NodeViewWrapper>
  );
}
