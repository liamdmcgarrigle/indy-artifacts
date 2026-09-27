/**
 * The <art-*> custom elements the artifact renderer emits.
 *
 * Plain HTMLElement subclasses in light DOM: no shadow root, no framework, so
 * theme CSS cascades straight in and a page needs no runtime beyond this file.
 *
 * Two rules every element here follows.
 *
 *   1. Markup arrives server-rendered — `<art-card title="T"><p>body</p></art-card>`
 *      — so an element WRAPS the children it finds instead of replacing them.
 *   2. Rendering is idempotent. connectedCallback fires again every time the
 *      node is moved in the DOM, and it must not duplicate anything.
 */

import { chartConfig, chartCsv, chartSummary, type ChartPoint, type ChartSpec, type ChartTheme } from "./chart-config";

declare global {
  interface Window {
    /** Origin/prefix the sandboxed embed frames are served from. */
    __ARTIFACT_EMBED_BASE?: string;
  }
}

/* ------------------------------------------------------------------ helpers */

const CHART_FALLBACK = ["#2563EB", "#0D9488", "#D97706", "#7C3AED", "#DB2777", "#64748B"];

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${(++uid).toString(36)}`;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Trimmed attribute value, or "" when absent. */
function attr(host: Element, name: string): string {
  return (host.getAttribute(name) ?? "").trim();
}

/** Move every current child of `host` into a fresh wrapper. Nothing is cloned. */
function wrapChildren(host: HTMLElement, className: string): HTMLElement {
  const box = make("div", className);
  while (host.firstChild) box.appendChild(host.firstChild);
  return box;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Base class. Subclasses implement render(); the guard keeps a re-connect, a
 * move, or a double upgrade from rendering twice.
 */
abstract class ArtElement extends HTMLElement {
  #rendered = false;

  connectedCallback(): void {
    if (this.#rendered) return;
    this.#rendered = true;
    this.render();
  }

  protected abstract render(): void;
}

/* -------------------------------------------------------------------- card */

class ArtCard extends ArtElement {
  protected render(): void {
    this.classList.add("art-card");
    const body = wrapChildren(this, "art-card__body");

    const title = attr(this, "title");
    if (title) {
      const head = make("div", "art-card__head");
      head.appendChild(make("div", "art-card__title", title));
      const subtitle = attr(this, "subtitle");
      if (subtitle) head.appendChild(make("div", "art-card__subtitle", subtitle));
      this.appendChild(head);
    }
    this.appendChild(body);
  }
}

/* ----------------------------------------------------------------- callout */

const CALLOUT_GLYPH: Record<string, string> = {
  info: "ℹ", // information source
  good: "✓", // check mark
  warn: "▲", // black up-pointing triangle
  bad: "✕", // multiplication x
};

class ArtCallout extends ArtElement {
  protected render(): void {
    const raw = attr(this, "tone").toLowerCase();
    const tone = raw in CALLOUT_GLYPH ? raw : "info";
    this.classList.add("art-callout", `art-callout--${tone}`);
    if (raw !== tone) this.setAttribute("tone", tone);

    const body = wrapChildren(this, "art-callout__body");

    const icon = make("span", "art-callout__icon", CALLOUT_GLYPH[tone]);
    icon.setAttribute("aria-hidden", "true");
    this.appendChild(icon);

    const main = make("div", "art-callout__main");
    const title = attr(this, "title");
    if (title) main.appendChild(make("div", "art-callout__title", title));
    main.appendChild(body);
    this.appendChild(main);
  }
}

/* --------------------------------------------------------------- kpis, kpi */

class ArtKpis extends ArtElement {
  protected render(): void {
    this.classList.add("art-kpis");
  }
}

class ArtKpi extends ArtElement {
  protected render(): void {
    this.classList.add("art-kpi");
    const tone = attr(this, "tone");
    if (tone) this.classList.add(`art-kpi--${tone}`);

    const value = make("div", "art-kpi__value", attr(this, "value"));
    const delta = attr(this, "delta");
    if (delta) value.appendChild(make("span", "art-kpi__delta", delta));
    this.appendChild(value);
    this.appendChild(make("div", "art-kpi__label", attr(this, "label")));
    const note = attr(this, "note");
    if (note) this.appendChild(make("div", "art-kpi__note", note));
    const trend = sparkline(attr(this, "trend"));
    if (trend) this.appendChild(trend);
  }
}

/** Recent values as a small line under a counter, last point marked. SVG, so it needs no chart library. */
function sparkline(raw: string): SVGSVGElement | null {
  const values = raw.split(",").map(Number).filter(Number.isFinite);
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const pad = 3;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const points = values.map((v, i) => [pad + (i * (W - pad * 2)) / (values.length - 1), H - pad - ((v - lo) * (H - pad * 2)) / span]);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "art-kpi__trend");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Trend: ${values.join(", ")}`);
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);
  const [lx, ly] = points[points.length - 1];
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", lx.toFixed(1));
  dot.setAttribute("cy", ly.toFixed(1));
  dot.setAttribute("r", "2.5");
  svg.appendChild(dot);
  return svg;
}

/* --------------------------------------------------------- columns, column */

class ArtColumns extends ArtElement {
  protected render(): void {
    this.classList.add("art-columns");
    const n = Math.min(Math.max(Math.trunc(Number(attr(this, "n"))) || 2, 2), 4);
    this.style.setProperty("--art-cols", String(n));
    this.style.setProperty("--art-cols-narrow", String(Math.min(n, 2)));
  }
}

class ArtCol extends ArtElement {
  protected render(): void {
    this.classList.add("art-col");
  }
}

/* -------------------------------------------------------------------- tabs */

class ArtTabs extends ArtElement {
  #buttons: HTMLButtonElement[] = [];
  #panels: HTMLElement[] = [];

  protected render(): void {
    this.classList.add("art-tabs");

    const panels = Array.from(this.children).filter(
      (child): child is HTMLElement => child.tagName.toLowerCase() === "art-tab",
    );
    if (panels.length === 0) return;

    const bar = make("div", "art-tabs__bar");
    bar.setAttribute("role", "tablist");

    const buttons = panels.map((panel, index) => {
      const panelId = panel.id || nextId("art-tabpanel");
      const tabId = nextId("art-tab");
      panel.id = panelId;
      panel.setAttribute("aria-labelledby", tabId);

      const button = make("button", "art-tabs__tab", attr(panel, "label") || `Tab ${index + 1}`);
      button.type = "button";
      button.id = tabId;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panelId);
      button.addEventListener("click", () => this.#select(index, false));
      bar.appendChild(button);
      return button;
    });

    bar.addEventListener("keydown", (event) => this.#onKeydown(event));

    this.#buttons = buttons;
    this.#panels = panels;
    this.insertBefore(bar, panels[0]);
    this.#select(0, false);
  }

  #onKeydown(event: KeyboardEvent): void {
    const current = this.#buttons.findIndex((b) => b.getAttribute("aria-selected") === "true");
    if (current < 0) return;
    const last = this.#buttons.length - 1;
    let next = current;
    if (event.key === "ArrowRight") next = current === last ? 0 : current + 1;
    else if (event.key === "ArrowLeft") next = current === 0 ? last : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    this.#select(next, true);
  }

  #select(index: number, focus: boolean): void {
    this.#buttons.forEach((button, i) => {
      const active = i === index;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("is-active", active);
      const panel = this.#panels[i];
      if (panel) panel.hidden = !active;
    });
    if (focus) this.#buttons[index]?.focus();
  }
}

class ArtTab extends ArtElement {
  protected render(): void {
    this.classList.add("art-tab");
    this.setAttribute("role", "tabpanel");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
  }
}

/* ----------------------------------------------------------------- details */

class ArtDetails extends ArtElement {
  protected render(): void {
    this.classList.add("art-details");
    const body = wrapChildren(this, "art-details__body");

    const details = make("details", "art-details__native");
    if (this.hasAttribute("open")) details.open = true;
    details.appendChild(make("summary", "art-details__summary", attr(this, "summary") || "Details"));
    details.appendChild(body);
    this.appendChild(details);
  }
}

/* --------------------------------------------------------- timeline, event */

/** Marker kinds: the callout tones, plus a plain milestone and an inferred gap. */
const EVENT_KINDS = new Set(["neutral", "key", "good", "warn", "bad", "info", "gap"]);
const EVENT_ALIASES: Record<string, string> = {
  success: "good",
  danger: "bad",
  error: "bad",
  warning: "warn",
  milestone: "key",
  inferred: "gap",
};

export function eventKind(raw: string): string {
  const k = raw.trim().toLowerCase();
  const kind = EVENT_ALIASES[k] ?? k;
  return EVENT_KINDS.has(kind) ? kind : "neutral";
}

/** `legend="good:Shipped, bad:Outage"` as kind and label pairs, in order. */
export function parseLegend(raw: string): { kind: string; label: string }[] {
  return raw
    .split(",")
    .map((part) => {
      const sep = part.indexOf(":");
      const label = (sep === -1 ? part : part.slice(sep + 1)).trim();
      return { kind: eventKind(sep === -1 ? "" : part.slice(0, sep)), label };
    })
    .filter((item) => item.label);
}

class ArtTimeline extends ArtElement {
  protected render(): void {
    this.classList.add("art-timeline");
    const list = wrapChildren(this, "art-timeline__list");
    list.setAttribute("role", "list");

    const legend = parseLegend(attr(this, "legend"));
    if (legend.length) {
      const row = make("div", "art-timeline__legend");
      for (const item of legend) {
        const key = make("span", `art-timeline__key art-timeline__key--${item.kind}`);
        const dot = make("span", "art-timeline__dot");
        dot.setAttribute("aria-hidden", "true");
        key.append(dot, item.label);
        row.appendChild(key);
      }
      this.appendChild(row);
    }
    this.appendChild(list);
  }
}

class ArtEvent extends ArtElement {
  protected render(): void {
    const kind = eventKind(attr(this, "kind"));
    this.classList.add("art-event", `art-event--${kind}`);
    this.setAttribute("role", "listitem");
    const body = wrapChildren(this, "art-event__body");

    const rail = make("div", "art-event__rail");
    rail.setAttribute("aria-hidden", "true");
    rail.appendChild(make("span", "art-event__marker"));

    const main = make("div", "art-event__main");
    const title = attr(this, "title");
    const source = attr(this, "source");
    if (title || source) {
      const head = make("div", "art-event__head");
      if (title) head.appendChild(make("span", "art-event__title", title));
      if (source) head.appendChild(make("span", "art-event__source", source));
      main.appendChild(head);
    }
    main.appendChild(body);

    this.append(make("div", "art-event__date", attr(this, "date")), rail, main);
  }
}

/* ------------------------------------------------------------------- table */

interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
  sortable?: boolean;
}

function compareCells(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

class ArtTable extends ArtElement {
  protected render(): void {
    const spec = parseJson<TableSpec>(this.dataset.table);
    if (!spec || !Array.isArray(spec.columns) || !Array.isArray(spec.rows)) return;

    this.classList.add("art-table");
    const columns = spec.columns.map(String);
    const rows = spec.rows.filter(Array.isArray);
    // A column is numeric when every value it holds is a number.
    const numeric = columns.map((_, c) =>
      rows.length > 0 && rows.every((row) => typeof row[c] === "number"),
    );

    const table = make("table", "art-table__table");
    const thead = make("thead");
    const headRow = make("tr");
    const tbody = make("tbody");

    let sortColumn = -1;
    let ascending = true;

    const paint = () => {
      const ordered =
        sortColumn < 0
          ? rows
          : [...rows].sort((a, b) => {
              const d = compareCells(a[sortColumn], b[sortColumn]);
              return ascending ? d : -d;
            });
      tbody.replaceChildren(
        ...ordered.map((row) => {
          const tr = make("tr");
          columns.forEach((_, c) => {
            const cell = row[c];
            const td = make("td", numeric[c] || typeof cell === "number" ? "num" : undefined);
            td.textContent = cell === undefined || cell === null ? "" : String(cell);
            tr.appendChild(td);
          });
          return tr;
        }),
      );
    };

    columns.forEach((name, c) => {
      const th = make("th", numeric[c] ? "num" : undefined);
      th.scope = "col";
      if (spec.sortable) {
        th.setAttribute("aria-sort", "none");
        const button = make("button", "art-table__sort");
        button.type = "button";
        button.appendChild(make("span", "art-table__sort-label", name));
        button.appendChild(make("span", "art-table__sort-mark"));
        button.addEventListener("click", () => {
          ascending = sortColumn === c ? !ascending : true;
          sortColumn = c;
          headRow.querySelectorAll("th").forEach((cell, i) => {
            cell.setAttribute("aria-sort", i === c ? (ascending ? "ascending" : "descending") : "none");
          });
          paint();
        });
        th.appendChild(button);
      } else {
        th.textContent = name;
      }
      headRow.appendChild(th);
    });

    paint();
    thead.appendChild(headRow);
    table.appendChild(thead);
    table.appendChild(tbody);

    const scroll = make("div", "art-table__scroll");
    scroll.appendChild(table);
    this.appendChild(scroll);
  }
}

/* ------------------------------------------------------------------- chart */

/**
 * The chart types Chart.js does not draw itself come from plugins, each a
 * chunk of its own that loads the first time a page draws that type.
 */
async function registerChartType(Chart: { register: (...items: unknown[]) => void }, type: string): Promise<void> {
  if (type === "heatmap") {
    const m = await import("chartjs-chart-matrix");
    Chart.register(m.MatrixController, m.MatrixElement);
  } else if (type === "box") {
    const b = await import("@sgratzl/chartjs-chart-boxplot");
    Chart.register(b.BoxPlotController, b.BoxAndWiskers);
  } else if (type === "sankey") {
    const k = await import("chartjs-chart-sankey");
    Chart.register(k.SankeyController, k.Flow);
  }
}

/** The slice of Chart.js's chart the element reads back. */
interface DrawnChart {
  destroy?: () => void;
  getElementsAtEventForMode: (e: Event, mode: string, options: { intersect: boolean }, useFinal: boolean) => { datasetIndex: number; index: number }[];
  getDatasetMeta: (i: number) => { data: { x: number; y: number; getCenterPoint?: () => { x: number; y: number } }[] };
  data: { datasets: unknown[] };
}

/** A file handed to the browser to save. */
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileName(spec: ChartSpec): string {
  const base = (spec.title ?? "chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base.slice(0, 60) || "chart";
}

/**
 * Chart.js sizes its axes by measuring label text once, when it draws. A web font
 * still loading at that moment is measured in the fallback font and then drawn
 * wider, which clips the start of long labels ("roduct page"). A canvas never asks
 * for a font by itself, so load the weights the chart uses first, but never wait
 * long: a slow font is drawn in the fallback first, and `late` settles when it
 * arrives so the chart can be measured again.
 */
function fontsFor(family: string): { ready: Promise<boolean>; late: Promise<unknown> } {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts?.load) return { ready: Promise.resolve(true), late: Promise.resolve() };
  const late = Promise.all(["400", "500", "600", "700"].map((weight) => fonts.load(`${weight} 12px ${family}`).catch(() => null)));
  const ready = Promise.race([late.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 1500))]);
  return { ready, late };
}

class ArtChart extends ArtElement {
  #spec: ChartSpec | null = null;
  #chart: DrawnChart | null = null;
  #describe: ((datasetIndex: number, index: number) => ChartPoint | null) | null = null;

  /** The bar, point, slice, cell or flow under a screen position, in words; null over empty space. */
  pointAt(clientX: number, clientY: number): ChartPoint | null {
    const chart = this.#chart;
    if (!chart || !this.#describe) return null;
    const canvas = this.querySelector("canvas");
    if (!canvas) return null;
    // Chart.js takes a position already inside the canvas this way; a bare MouseEvent that was never dispatched reads wrong.
    const box = canvas.getBoundingClientRect();
    const at = { type: "mousemove", native: null, x: clientX - box.left, y: clientY - box.top } as unknown as Event;
    // On the mark itself first; failing that, the nearest one, so a tap above a short bar still means that bar.
    const hits = chart.getElementsAtEventForMode(at, "nearest", { intersect: true }, false);
    const near = hits.length ? hits : chart.getElementsAtEventForMode(at, "nearest", { intersect: false }, false);
    const hit = near.find((h) => this.#describe!(h.datasetIndex, h.index));
    return hit ? this.#describe(hit.datasetIndex, hit.index) : null;
  }

  /** Where a named point is drawn now, in screen coordinates, so a comment's pin can find it again. */
  pixelOf(point: { series: string; x: string }): { x: number; y: number } | null {
    const chart = this.#chart;
    const canvas = this.querySelector("canvas");
    if (!chart || !this.#describe || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    for (let di = 0; di < chart.data.datasets.length; di++) {
      const meta = chart.getDatasetMeta(di);
      for (let i = 0; i < meta.data.length; i++) {
        const named = this.#describe(di, i);
        if (!named || named.series !== point.series || named.x !== point.x) continue;
        const el = meta.data[i];
        const c = el.getCenterPoint ? el.getCenterPoint() : { x: el.x, y: el.y };
        return { x: box.left + c.x, y: box.top + c.y };
      }
    }
    return null;
  }
  #drawing = false;
  /** The scheme changed while a drawing was under way: draw again when it lands. */
  #again = false;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("art:scheme", this.#onScheme);
    // Drawing lives here rather than in render() so a chart destroyed on
    // disconnect comes back when the element is re-attached.
    this.#redraw();
  }

  disconnectedCallback(): void {
    window.removeEventListener("art:scheme", this.#onScheme);
    this.#destroy();
  }

  /** The colors are read once per drawing, so a new scheme means a new drawing. */
  #onScheme = (): void => {
    // The page swaps its variables in the same tick; read them on the next frame.
    requestAnimationFrame(() => {
      if (!this.isConnected) return;
      if (this.#drawing) {
        this.#again = true;
        return;
      }
      this.#destroy();
      this.#redraw();
    });
  };

  #destroy(): void {
    try {
      this.#chart?.destroy?.();
    } catch {
      /* a half-built chart is nothing to complain about */
    }
    this.#chart = null;
  }

  #redraw(): void {
    if (this.#chart || this.#drawing || !this.#spec) return;
    const canvas = this.querySelector("canvas");
    if (!canvas) return;
    this.#drawing = true;
    void this.#draw(canvas, this.#spec).finally(() => {
      this.#drawing = false;
      if (this.#again && this.isConnected) {
        this.#again = false;
        this.#destroy();
        this.#redraw();
      }
    });
  }

  protected render(): void {
    const spec = parseJson<ChartSpec>(this.dataset.chart);
    if (!spec || !Array.isArray(spec.data) || !Array.isArray(spec.y)) return;
    this.#spec = spec;
    this.classList.add("art-chart");

    const head = make("div", "art-chart__head");
    if (spec.title) head.appendChild(make("div", "art-chart__title", spec.title));
    head.appendChild(this.#menu(spec));
    this.appendChild(head);

    const frame = make("div", "art-chart__canvas");
    const height = Number(spec.height);
    frame.style.height = `${Number.isFinite(height) && height > 0 ? height : 280}px`;
    frame.setAttribute("role", "img");
    frame.setAttribute("aria-label", chartSummary(spec));
    const canvas = make("canvas");
    canvas.setAttribute("aria-hidden", "true");
    frame.appendChild(canvas);
    this.appendChild(frame);
    this.appendChild(this.#table(spec));
  }

  /**
   * A small menu for reading the chart another way: its numbers as a table,
   * the drawing as an image, the data as a CSV file.
   */
  #menu(spec: ChartSpec): HTMLElement {
    const wrap = make("div", "art-chart__menu");
    const button = make("button", "art-chart__more");
    button.type = "button";
    button.setAttribute("aria-label", "Chart menu");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';
    const list = make("div", "art-chart__list");
    list.setAttribute("role", "menu");
    list.hidden = true;
    const close = () => {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
    };
    const outside = (e: Event) => {
      if (!wrap.contains(e.target as Node)) close();
    };
    const item = (text: string, run: () => void) => {
      const b = make("button", "art-chart__item", text);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => {
        close();
        run();
      });
      list.appendChild(b);
      return b;
    };
    const numbers = item("Show the numbers", () => {
      const box = this.querySelector<HTMLElement>(".art-chart__data, .art-sr-only");
      if (!box) return;
      const showing = box.classList.toggle("art-chart__data");
      box.classList.toggle("art-sr-only", !showing);
      numbers.textContent = showing ? "Hide the numbers" : "Show the numbers";
    });
    item("Download image", () => this.#downloadImage(spec));
    item("Download data (CSV)", () => download(`${fileName(spec)}.csv`, new Blob([chartCsv(spec)], { type: "text/csv" })));
    button.addEventListener("click", () => {
      const opening = list.hidden;
      list.hidden = !opening;
      button.setAttribute("aria-expanded", String(opening));
      if (opening) document.addEventListener("pointerdown", outside, true);
      else document.removeEventListener("pointerdown", outside, true);
    });
    wrap.append(button, list);
    return wrap;
  }

  /** The drawing on the chart's own background, with its title over it, as a PNG. */
  #downloadImage(spec: ChartSpec): void {
    const canvas = this.querySelector("canvas");
    if (!canvas) return;
    const style = getComputedStyle(this);
    const token = (name: string, fallback: string) => (style.getPropertyValue(name) || "").trim() || fallback;
    const scale = canvas.width / (canvas.clientWidth || canvas.width);
    const pad = Math.round(20 * scale);
    const titleSpace = spec.title ? Math.round(34 * scale) : 0;
    const out = document.createElement("canvas");
    out.width = canvas.width + pad * 2;
    out.height = canvas.height + pad * 2 + titleSpace;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = token("--art-surface", "#ffffff");
    ctx.fillRect(0, 0, out.width, out.height);
    if (spec.title) {
      ctx.fillStyle = token("--art-text", "#1b1b1a");
      ctx.font = `600 ${Math.round(15 * scale)}px ${token("--art-font-sans", "system-ui, sans-serif")}`;
      ctx.textBaseline = "top";
      ctx.fillText(spec.title, pad, pad);
    }
    ctx.drawImage(canvas, pad, pad + titleSpace);
    out.toBlob((blob) => blob && download(`${fileName(spec)}.png`, blob), "image/png");
  }

  /** The numbers behind the drawing, for screen readers. A table grows to fit its rows whatever its height, so it sits in a box that is clipped. */
  #table(spec: ChartSpec): HTMLElement {
    const box = make("div", "art-sr-only");
    const table = box.appendChild(make("table"));
    if (spec.title) table.appendChild(make("caption", undefined, spec.title));
    // Every key the rows use, so a sankey's amounts or a heatmap's values are there too.
    const keys: string[] = [spec.x, ...spec.y];
    for (const row of spec.data) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    const head = make("tr");
    for (const key of keys) head.appendChild(make("th", undefined, key));
    table.appendChild(make("thead")).appendChild(head);
    const body = make("tbody");
    for (const row of spec.data.slice(0, 500)) {
      const tr = make("tr");
      tr.appendChild(make("th", undefined, String(row[spec.x] ?? "")));
      for (const key of keys.slice(1)) tr.appendChild(make("td", undefined, String(row[key] ?? "")));
      body.appendChild(tr);
    }
    table.appendChild(body);
    return box;
  }

  async #draw(canvas: HTMLCanvasElement, spec: ChartSpec): Promise<void> {
    try {
      const style = getComputedStyle(this);
      const token = (name: string, fallback: string) => (style.getPropertyValue(name) || "").trim() || fallback;
      const theme: ChartTheme = {
        palette: CHART_FALLBACK.map((fallback, i) => token(`--art-chart-${i + 1}`, fallback)),
        text: token("--art-text", "#1B1B1A"),
        muted: token("--art-text-muted", "#5F5F5B"),
        border: token("--art-border", "#E3E3E0"),
        surface: token("--art-surface", "#FFFFFF"),
        font: token("--art-font-sans", "system-ui, sans-serif"),
        tones: {
          good: token("--art-good", "#15803D"),
          warn: token("--art-warn", "#B45309"),
          bad: token("--art-bad", "#B91C1C"),
          info: token("--art-info", "#2563EB"),
        },
      };
      const { default: Chart, layouts } = await import("chart.js/auto");
      await registerChartType(Chart, spec.type);
      const fonts = fontsFor(theme.font);
      if (!(await fonts.ready)) {
        // Drawn in the fallback: draw again, measured in the real font, once it lands.
        void fonts.late.then(() => {
          if (!this.isConnected || !this.#chart) return;
          this.#destroy();
          this.#redraw();
        });
      }
      const config = chartConfig(spec, theme, layouts);
      this.#describe = config.describe;
      if (!canvas.isConnected) return;
      this.#chart = new Chart(canvas, config as never) as unknown as DrawnChart;
    } catch (err) {
      // A chart that cannot be drawn (bad spec, no canvas, no chart.js) leaves
      // the empty frame in place rather than taking the page down with it.
      console.warn("art-chart: could not draw", err);
      // A page left open across an update asks for drawing code that has since
      // been replaced; say so rather than showing an empty box.
      if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String((err as Error)?.message ?? err))) {
        canvas.parentElement?.replaceChildren(make("p", "art-chart__stale", "Indy was updated while this page was open. Reload to see this chart."));
      }
    }
  }
}

/* ------------------------------------------------------------------- embed */

// The frame reports the height of its content, so the floor only has to keep a
// frame that reported nothing from collapsing out of sight.
const EMBED_MIN = 24;
const EMBED_MAX = 4000;

/**
 * A story drawn at a device size never takes the whole screen: a phone reader
 * always keeps some page above, below and beside it to scroll by, since a
 * finger on the story scrolls the story.
 */
function storyMaxHeight(): number {
  // The layout viewport, not innerHeight: on a phone innerHeight grows and
  // shrinks as the address bar slides away while scrolling, and a story
  // sized from it would resize under the reader's finger.
  const tall = document.documentElement.clientHeight || window.innerHeight || 800;
  return Math.round(tall * (window.innerWidth < 700 ? 0.78 : 0.72));
}

/**
 * A story that sizes to its content (a long list of cards, say) is shown up
 * to about this height, then faded out with a button to see the rest. The
 * frame inside stays full height, so nothing scrolls inside it.
 */
function storyClipHeight(): number {
  const tall = document.documentElement.clientHeight || window.innerHeight || 800;
  return Math.max(360, Math.round(tall * 0.7));
}

class ArtEmbed extends ArtElement {
  #frame: HTMLIFrameElement | null = null;
  #box: HTMLDivElement | null = null;
  #resize: ResizeObserver | null = null;
  /** A story drawn at a fixed width is scaled to fit a narrower column. */
  #width = 0;
  #height = 0;
  #reported = 0;

  #onMessage = (event: MessageEvent): void => {
    if (!this.#frame || event.source !== this.#frame.contentWindow) return;
    const data = event.data as { type?: string; px?: number } | null;
    if (!data || data.type !== "art:height") return;
    const px = Number(data.px);
    if (!Number.isFinite(px)) return;
    this.#reported = Math.min(Math.max(px, EMBED_MIN), EMBED_MAX);
    this.#layout();
  };

  // The address bar coming and going on a phone changes the height by a
  // little, and re-laying out then makes the frames jump as the page
  // scrolls. A change of width, or a real change of height (a desktop window
  // resized), still re-lays out.
  #lastWidth = 0;
  #lastHeight = 0;
  #onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === this.#lastWidth && Math.abs(height - this.#lastHeight) < 160) return;
    this.#lastWidth = width;
    this.#lastHeight = height;
    this.#layout();
  };

  /** A story follows the page's scheme through its globals, so it reloads. */
  #onScheme = (event: Event): void => {
    const scheme = (event as CustomEvent).detail === "dark" ? "dark" : "light";
    if (this.#frame && this.dataset.kind === "story") {
      const next = this.#src(scheme);
      if (this.#frame.dataset.src !== next) {
        this.#frame.dataset.src = next;
        this.classList.remove("is-loaded");
        this.#frame.src = next;
      }
    }
  };

  #src(scheme: string): string {
    const base = window.__ARTIFACT_EMBED_BASE ?? "";
    return `${base}/${this.dataset.embed}?scheme=${encodeURIComponent(scheme)}`;
  }

  #layout(): void {
    const frame = this.#frame;
    const box = this.#box;
    if (!frame) return;
    const height = this.#height || this.#reported || 120;
    if (!this.#width || !box) {
      frame.style.height = `${height}px`;
      this.#clip(height);
      return;
    }
    // The element's own side padding is the inset around a device, not room for it.
    const style = getComputedStyle(this);
    const inset = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = this.clientWidth ? this.clientWidth - inset : this.#width;
    const scale = Math.min(1, available / this.#width, this.#height ? storyMaxHeight() / this.#height : 1);
    frame.style.width = `${this.#width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = scale < 1 ? `scale(${scale})` : "";
    box.style.width = `${Math.round(this.#width * scale)}px`;
    box.style.height = `${Math.round(height * scale)}px`;
  }

  #expanded = false;
  #more: HTMLButtonElement | null = null;

  /** Clips a tall story that sizes itself, with a button to show all of it. */
  #clip(height: number): void {
    if (this.dataset.kind !== "story" || this.#height) return;
    const limit = storyClipHeight();
    // Not worth hiding a sliver: clip only what is well past the limit.
    const tall = height > limit + 120;
    if (!tall) {
      this.style.maxHeight = "";
      this.classList.remove("art-embed--clipped", "art-embed--open");
      this.#more?.remove();
      this.#more = null;
      return;
    }
    if (!this.#more) {
      const more = make("button", "art-embed__more") as HTMLButtonElement;
      more.type = "button";
      more.addEventListener("click", (event) => {
        // In a choice option, a click anywhere picks the option; this one does not.
        event.stopPropagation();
        this.#expanded = !this.#expanded;
        this.#layout();
        if (!this.#expanded) this.scrollIntoView({ block: "nearest" });
      });
      this.appendChild(more);
      this.#more = more;
    }
    this.#more.textContent = this.#expanded ? "Show less" : "Show all";
    this.#more.setAttribute("aria-expanded", String(this.#expanded));
    this.classList.add("art-embed--clipped");
    this.classList.toggle("art-embed--open", this.#expanded);
    this.style.maxHeight = this.#expanded ? "" : `${limit}px`;
  }

  protected render(): void {
    const id = this.dataset.embed;
    if (!id) return;
    this.classList.add("art-embed");

    const kind = this.dataset.kind || "embed";
    const scheme = document.documentElement.dataset.scheme || "light";
    this.#width = Number(this.dataset.width) || 0;
    this.#height = Number(this.dataset.height) || 0;

    const frame = make("iframe");
    frame.src = this.#src(scheme);
    frame.dataset.src = frame.src;
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("loading", "lazy");
    frame.title = kind === "story" ? `Story: ${this.dataset.title || id}` : kind;
    frame.style.width = "100%";
    frame.style.height = "120px";
    frame.style.border = "0";
    frame.style.display = "block";
    // The frame reports its height once and then only when it changes, so ask
    // again on load rather than trusting the first report to have found a
    // listener.
    frame.addEventListener("load", () => {
      frame.contentWindow?.postMessage({ type: "art:measure" }, "*");
      this.classList.add("is-loaded");
    });

    this.#frame = frame;
    if (this.#width) {
      // The box takes the scaled size; the frame inside keeps the story's own.
      const box = make("div", "art-embed__box");
      this.classList.add("art-embed--device");
      box.style.overflow = "hidden";
      box.style.margin = "0 auto";
      frame.style.transformOrigin = "0 0";
      box.appendChild(frame);
      this.#box = box;
      this.appendChild(box);
      if (window.ResizeObserver) this.#resize = new ResizeObserver(() => this.#layout());
    } else {
      this.#box = null;
      this.appendChild(frame);
    }
    if (kind === "story") {
      this.classList.add("art-embed--story");
      // Shown until the story's page has loaded; a story can take a moment.
      const note = make("div", "art-embed__loading", "Loading story…");
      note.setAttribute("aria-hidden", "true");
      this.appendChild(note);
    }
    this.#layout();
  }

  // Listeners go on each time the element is attached, not only the first:
  // the editor moves blocks by taking them out and putting them back.
  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.#onMessage);
    window.addEventListener("art:scheme", this.#onScheme);
    this.#lastWidth = window.innerWidth;
    this.#lastHeight = window.innerHeight;
    window.addEventListener("resize", this.#onResize);
    this.#resize?.observe(this);
  }

  disconnectedCallback(): void {
    window.removeEventListener("message", this.#onMessage);
    window.removeEventListener("art:scheme", this.#onScheme);
    window.removeEventListener("resize", this.#onResize);
    this.#resize?.disconnect();
  }
}

/* ------------------------------------------------------------------- error */

class ArtError extends ArtElement {
  protected render(): void {
    const message = (this.textContent ?? "").trim();
    this.textContent = "";
    const box = make("div", "art-error", `Block error: ${message}`);
    box.setAttribute("role", "note");
    this.appendChild(box);
  }
}

/* ---------------------------------------------------------------- registry */

const ELEMENTS: ReadonlyArray<readonly [string, CustomElementConstructor]> = [
  ["art-card", ArtCard],
  ["art-callout", ArtCallout],
  ["art-kpis", ArtKpis],
  ["art-kpi", ArtKpi],
  ["art-columns", ArtColumns],
  ["art-col", ArtCol],
  ["art-tabs", ArtTabs],
  ["art-tab", ArtTab],
  ["art-details", ArtDetails],
  ["art-timeline", ArtTimeline],
  ["art-event", ArtEvent],
  ["art-table", ArtTable],
  ["art-chart", ArtChart],
  ["art-embed", ArtEmbed],
  ["art-error", ArtError],
];

/** Register every art-* element. Safe to call repeatedly. */
export function defineArtifactPrimitives(): void {
  if (typeof customElements === "undefined") return;
  for (const [name, ctor] of ELEMENTS) {
    if (!customElements.get(name)) customElements.define(name, ctor);
  }
}

export const ART_ELEMENT_NAMES = ELEMENTS.map(([name]) => name);

if (typeof window !== "undefined" && typeof customElements !== "undefined") {
  defineArtifactPrimitives();
}
