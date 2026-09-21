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
  }
}

/* --------------------------------------------------------- columns, column */

class ArtColumns extends ArtElement {
  protected render(): void {
    this.classList.add("art-columns");
    const n = Math.min(Math.max(Math.trunc(Number(attr(this, "n"))) || 2, 2), 4);
    this.style.setProperty("--art-cols", String(n));
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

interface ChartSpec {
  type: string;
  title?: string;
  x: string;
  y: string[];
  data: Record<string, unknown>[];
  stacked?: boolean;
  unit?: string;
  height?: number;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** A translucent twin of a palette colour, for area and bar fills. */
function translucent(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? `${color.trim()}40` : color;
}

class ArtChart extends ArtElement {
  #spec: ChartSpec | null = null;
  #chart: { destroy?: () => void } | null = null;
  #drawing = false;

  connectedCallback(): void {
    super.connectedCallback();
    // Drawing lives here rather than in render() so a chart destroyed on
    // disconnect comes back when the element is re-attached.
    if (this.#chart || this.#drawing || !this.#spec) return;
    const canvas = this.querySelector("canvas");
    if (!canvas) return;
    this.#drawing = true;
    void this.#draw(canvas, this.#spec).finally(() => {
      this.#drawing = false;
    });
  }

  disconnectedCallback(): void {
    try {
      this.#chart?.destroy?.();
    } catch {
      /* a half-built chart is nothing to complain about */
    }
    this.#chart = null;
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
    frame.appendChild(make("canvas"));
    this.appendChild(frame);
  }

  async #draw(canvas: HTMLCanvasElement, spec: ChartSpec): Promise<void> {
    try {
      const style = getComputedStyle(this);
      const token = (name: string, fallback: string) =>
        (style.getPropertyValue(name) || "").trim() || fallback;

      const palette = CHART_FALLBACK.map((fallback, i) => token(`--art-chart-${i + 1}`, fallback));
      const text = token("--art-text", "#1B1B1A");
      const muted = token("--art-text-muted", "#5F5F5B");
      const border = token("--art-border", "#E3E3E0");
      const surface = token("--art-surface", "#FFFFFF");
      const font = token("--art-font-sans", "system-ui, sans-serif");
      const unit = spec.unit ? ` ${spec.unit}` : "";

      const isRound = spec.type === "pie" || spec.type === "doughnut";
      const isArea = spec.type === "area";
      const type = isArea ? "line" : spec.type;
      const labels = spec.data.map((row) => String(row[spec.x] ?? ""));

      const datasets = isRound
        ? [
            {
              label: spec.y[0] ?? "",
              data: spec.data.map((row) => toNumber(row[spec.y[0]])),
              backgroundColor: spec.data.map((_, i) => palette[i % palette.length]),
              borderColor: surface,
              borderWidth: 1,
            },
          ]
        : spec.y.map((key, i) => {
            const color = palette[i % palette.length];
            const bar = type === "bar";
            // In a stack only the segment on top gets the rounded cap,
            // otherwise every joint in the column shows a notch.
            const stacked = bar && spec.stacked === true;
            const capped = !stacked || i === spec.y.length - 1;
            return {
              label: key,
              data:
                spec.type === "scatter"
                  ? spec.data.map((row) => ({ x: toNumber(row[spec.x]), y: toNumber(row[key]) }))
                  : spec.data.map((row) => toNumber(row[key])),
              borderColor: bar ? "transparent" : color,
              // A solid bar reads as one shape; an outlined wash reads as a box
              // with something in it.
              backgroundColor: bar ? color : isArea ? translucent(color) : color,
              borderWidth: bar ? 0 : 2,
              borderRadius: bar && capped ? { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 } : 0,
              borderSkipped: false,
              maxBarThickness: 52,
              categoryPercentage: 0.74,
              barPercentage: 0.86,
              fill: isArea,
              tension: isArea || type === "line" ? 0.32 : 0,
              pointRadius: type === "line" || isArea ? 0 : 3,
              pointHoverRadius: 4,
              hoverBackgroundColor: bar ? color : undefined,
              hoverBorderColor: color,
            };
          });

      // Grid lines are scaffolding, not content: keep the horizontal ones as
      // hairlines, drop the vertical ones and the axis frame entirely.
      const tickFont = { family: font, size: 11, weight: 500 as const };
      const scales = {
        x: {
          stacked: spec.stacked === true,
          ticks: { color: muted, font: tickFont, padding: 6, autoSkipPadding: 12 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          stacked: spec.stacked === true,
          beginAtZero: true,
          ticks: {
            color: muted,
            font: tickFont,
            padding: 8,
            maxTicksLimit: 6,
            callback: (value: unknown) => `${value}${unit}`,
          },
          grid: { color: border, lineWidth: 1, drawTicks: false },
          border: { display: false, dash: [3, 4] },
        },
      };

      const { default: Chart } = await import("chart.js/auto");

      this.#chart = new Chart(canvas, {
        type: type as never,
        data: { labels, datasets: datasets as never },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { top: 4, right: 4 } },
          interaction: { mode: "index" as const, intersect: false },
          plugins: {
            legend: {
              display: isRound || spec.y.length > 1,
              position: "top" as const,
              align: "start" as const,
              labels: {
                color: muted,
                font: { family: font, size: 11.5 },
                boxWidth: 7,
                boxHeight: 7,
                padding: 14,
                usePointStyle: true,
                pointStyle: "circle" as const,
              },
            },
            tooltip: {
              backgroundColor: surface,
              titleColor: text,
              bodyColor: muted,
              borderColor: border,
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              titleFont: { family: font, size: 12, weight: 600 as const },
              bodyFont: { family: font, size: 12 },
              bodySpacing: 5,
              boxWidth: 7,
              boxHeight: 7,
              usePointStyle: true,
              callbacks: {
                label: (item: { dataset?: { label?: string }; label?: string; formattedValue: string }) => {
                  const name = isRound ? item.label : item.dataset?.label;
                  return `${name ? `${name}: ` : ""}${item.formattedValue}${unit}`;
                },
              },
            },
          },
          scales: isRound ? undefined : scales,
        } as never,
      }) as unknown as { destroy?: () => void };
    } catch {
      // A chart that cannot be drawn (bad spec, no canvas, no chart.js) leaves
      // the empty frame in place rather than taking the page down with it.
    }
  }
}

/* ------------------------------------------------------------------- embed */

// The frame reports the height of its content, so the floor only has to keep a
// frame that reported nothing from collapsing out of sight.
const EMBED_MIN = 24;
const EMBED_MAX = 4000;

class ArtEmbed extends ArtElement {
  #frame: HTMLIFrameElement | null = null;
  #onMessage = (event: MessageEvent): void => {
    if (!this.#frame || event.source !== this.#frame.contentWindow) return;
    const data = event.data as { type?: string; px?: number } | null;
    if (!data || data.type !== "art:height") return;
    const px = Number(data.px);
    if (!Number.isFinite(px)) return;
    this.#frame.style.height = `${Math.min(Math.max(px, EMBED_MIN), EMBED_MAX)}px`;
  };

  protected render(): void {
    const id = this.dataset.embed;
    if (!id) return;
    this.classList.add("art-embed");

    const kind = this.dataset.kind || "embed";
    const scheme = document.documentElement.dataset.scheme || "light";
    const base = window.__ARTIFACT_EMBED_BASE ?? "";

    const frame = make("iframe");
    frame.src = `${base}/${id}?scheme=${encodeURIComponent(scheme)}`;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("loading", "lazy");
    frame.title = kind;
    frame.style.width = "100%";
    frame.style.height = "120px";
    frame.style.border = "0";
    frame.style.display = "block";
    // The frame reports its height once and then only when it changes, so ask
    // again on load rather than trusting the first report to have found a
    // listener.
    frame.addEventListener("load", () => {
      frame.contentWindow?.postMessage({ type: "art:measure" }, "*");
    });

    this.#frame = frame;
    this.appendChild(frame);
    window.addEventListener("message", this.#onMessage);
  }

  disconnectedCallback(): void {
    window.removeEventListener("message", this.#onMessage);
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
