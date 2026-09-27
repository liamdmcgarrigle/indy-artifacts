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

import { chartConfig, chartSummary, type ChartSpec, type ChartTheme } from "./chart-config";

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

class ArtChart extends ArtElement {
  #spec: ChartSpec | null = null;
  #chart: { destroy?: () => void } | null = null;
  #drawing = false;

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
    });
  }

  protected render(): void {
    const spec = parseJson<ChartSpec>(this.dataset.chart);
    if (!spec || !Array.isArray(spec.data) || !Array.isArray(spec.y)) return;
    this.#spec = spec;
    this.classList.add("art-chart");

    if (spec.title) this.appendChild(make("div", "art-chart__title", spec.title));

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

  /** The numbers behind the drawing, for screen readers. A table grows to fit its rows whatever its height, so it sits in a box that is clipped. */
  #table(spec: ChartSpec): HTMLElement {
    const box = make("div", "art-sr-only");
    const table = box.appendChild(make("table"));
    if (spec.title) table.appendChild(make("caption", undefined, spec.title));
    const head = make("tr");
    for (const key of [spec.x, ...spec.y]) head.appendChild(make("th", undefined, key));
    table.appendChild(make("thead")).appendChild(head);
    const body = make("tbody");
    for (const row of spec.data.slice(0, 500)) {
      const tr = make("tr");
      tr.appendChild(make("th", undefined, String(row[spec.x] ?? "")));
      for (const key of spec.y) tr.appendChild(make("td", undefined, String(row[key] ?? "")));
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
      const config = chartConfig(spec, theme, layouts);
      if (!canvas.isConnected) return;
      this.#chart = new Chart(canvas, config as never) as unknown as { destroy?: () => void };
    } catch (err) {
      // A chart that cannot be drawn (bad spec, no canvas, no chart.js) leaves
      // the empty frame in place rather than taking the page down with it.
      console.warn("art-chart: could not draw", err);
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
