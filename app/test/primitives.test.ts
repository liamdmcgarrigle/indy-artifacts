// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Importing the bundle registers every art-* element. Definitions have to exist
// before the markup is parsed: jsdom upgrades on insertion, and an element that
// is already in the tree when its class is defined is not upgraded here.
// @ts-ignore -- built artefact, present only after `npm run build:primitives`
import { defineArtifactPrimitives } from "../../packages/primitives/dist/primitives";

/** Let queued custom-element reactions and microtasks settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Parse server-style markup and return the upgraded host element. */
async function mount<T extends HTMLElement = HTMLElement>(html: string): Promise<T> {
  document.body.innerHTML = html;
  await tick();
  return document.body.firstElementChild as T;
}

beforeAll(() => {
  defineArtifactPrimitives();
});

describe("registration", () => {
  it("defines every art-* tag", () => {
    for (const tag of [
      "art-card",
      "art-callout",
      "art-kpis",
      "art-kpi",
      "art-columns",
      "art-col",
      "art-tabs",
      "art-tab",
      "art-details",
      "art-table",
      "art-chart",
      "art-embed",
      "art-error",
    ]) {
      expect(customElements.get(tag), `${tag} is not defined`).toBeTypeOf("function");
    }
  });

  it("survives a second call", () => {
    expect(() => {
      defineArtifactPrimitives();
      defineArtifactPrimitives();
    }).not.toThrow();
  });
});

describe("art-card", () => {
  it("wraps the server-rendered children instead of replacing them", async () => {
    const card = await mount('<art-card title="T" subtitle="S"><p>body</p></art-card>');

    expect(card.querySelector(".art-card__title")?.textContent).toBe("T");
    expect(card.querySelector(".art-card__subtitle")?.textContent).toBe("S");

    const body = card.querySelector(".art-card__body");
    expect(body?.children).toHaveLength(1);
    expect(body?.firstElementChild?.tagName).toBe("P");
    expect(body?.firstElementChild?.textContent).toBe("body");
    // The head comes before the body in document order.
    expect(card.firstElementChild?.className).toBe("art-card__head");
  });

  it("drops the head entirely when there is no title", async () => {
    const card = await mount("<art-card><p>body</p></art-card>");
    expect(card.querySelector(".art-card__head")).toBeNull();
    expect(card.querySelector(".art-card__title")).toBeNull();
    expect(card.querySelector(".art-card__body p")?.textContent).toBe("body");
  });

  it("renders once, however often it is connected", async () => {
    const card = await mount('<art-card title="T"><p>body</p></art-card>');
    card.remove();
    document.body.appendChild(card);
    await tick();

    expect(card.querySelectorAll(".art-card__head")).toHaveLength(1);
    expect(card.querySelectorAll(".art-card__body")).toHaveLength(1);
    expect(card.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("art-callout", () => {
  it("adds the tone class, an icon and a title, keeping the body", async () => {
    const callout = await mount('<art-callout tone="warn" title="Careful"><p>text</p></art-callout>');

    expect(callout.classList.contains("art-callout")).toBe(true);
    expect(callout.classList.contains("art-callout--warn")).toBe(true);
    expect(callout.querySelector(".art-callout__icon")?.textContent).toBe("▲");
    expect(callout.querySelector(".art-callout__title")?.textContent).toBe("Careful");
    expect(callout.querySelector(".art-callout__body p")?.textContent).toBe("text");
  });

  it("falls back to info for a missing or unknown tone", async () => {
    const plain = await mount("<art-callout><p>text</p></art-callout>");
    expect(plain.classList.contains("art-callout--info")).toBe(true);
    expect(plain.querySelector(".art-callout__icon")?.textContent).toBe("ℹ");
    expect(plain.querySelector(".art-callout__title")).toBeNull();

    const odd = await mount('<art-callout tone="sideways"><p>text</p></art-callout>');
    expect(odd.classList.contains("art-callout--info")).toBe(true);
  });
});

describe("art-kpis / art-kpi", () => {
  it("renders value, delta and label", async () => {
    const kpis = await mount(
      '<art-kpis><art-kpi label="Revenue" value="$1.2M" tone="good" delta="+8%"></art-kpi>' +
        '<art-kpi label="Churn" value="2.1%"></art-kpi></art-kpis>',
    );

    expect(kpis.classList.contains("art-kpis")).toBe(true);
    const [first, second] = Array.from(kpis.querySelectorAll("art-kpi"));

    expect(first.classList.contains("art-kpi")).toBe(true);
    expect(first.classList.contains("art-kpi--good")).toBe(true);
    expect(first.querySelector(".art-kpi__value")?.textContent).toBe("$1.2M+8%");
    expect(first.querySelector(".art-kpi__delta")?.textContent).toBe("+8%");
    expect(first.querySelector(".art-kpi__label")?.textContent).toBe("Revenue");

    expect(second.querySelector(".art-kpi__delta")).toBeNull();
    expect(second.className).toBe("art-kpi");
  });
});

describe("art-columns / art-col", () => {
  it("sets the column count as a custom property", async () => {
    const columns = await mount("<art-columns n=\"3\"><art-col><p>a</p></art-col><art-col><p>b</p></art-col></art-columns>");
    expect(columns.classList.contains("art-columns")).toBe(true);
    expect(columns.style.getPropertyValue("--art-cols")).toBe("3");
    expect(columns.querySelectorAll("art-col.art-col")).toHaveLength(2);
  });

  it("clamps a silly n into 2-4", async () => {
    expect((await mount('<art-columns n="9"></art-columns>')).style.getPropertyValue("--art-cols")).toBe("4");
    expect((await mount("<art-columns></art-columns>")).style.getPropertyValue("--art-cols")).toBe("2");
  });
});

describe("art-tabs", () => {
  const markup =
    '<art-tabs><art-tab label="One"><p>first</p></art-tab>' +
    '<art-tab label="Two"><p>second</p></art-tab></art-tabs>';

  it("builds a tablist and shows only the first panel", async () => {
    const tabs = await mount(markup);
    const bar = tabs.querySelector(".art-tabs__bar");
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>("art-tab"));

    expect(bar?.getAttribute("role")).toBe("tablist");
    expect(tabs.firstElementChild).toBe(bar);
    expect(buttons.map((b) => b.textContent)).toEqual(["One", "Two"]);

    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);
    expect(buttons[0].getAttribute("aria-selected")).toBe("true");
    expect(buttons[1].getAttribute("aria-selected")).toBe("false");
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
    expect(panels[0].getAttribute("role")).toBe("tabpanel");
    expect(buttons[0].getAttribute("aria-controls")).toBe(panels[0].id);
  });

  it("switches on click", async () => {
    const tabs = await mount(markup);
    const buttons = tabs.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const panels = tabs.querySelectorAll<HTMLElement>("art-tab");

    buttons[1].click();

    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);
  });

  it("walks with the arrow keys and wraps around", async () => {
    const tabs = await mount(markup);
    const bar = tabs.querySelector(".art-tabs__bar")!;
    const buttons = tabs.querySelectorAll<HTMLButtonElement>('button[role="tab"]');

    const press = (key: string) =>
      bar.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    press("ArrowRight");
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");

    press("ArrowRight");
    expect(buttons[0].getAttribute("aria-selected")).toBe("true");

    press("ArrowLeft");
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");
  });
});

describe("art-details", () => {
  it("wraps the children in a native details/summary", async () => {
    const host = await mount('<art-details summary="More"><p>hidden</p></art-details>');
    const details = host.querySelector("details");

    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("More");
    expect(details?.querySelector(".art-details__body p")?.textContent).toBe("hidden");
  });

  it("honours the open attribute and defaults the summary", async () => {
    const host = await mount("<art-details open><p>x</p></art-details>");
    expect(host.querySelector("details")?.open).toBe(true);
    expect(host.querySelector("summary")?.textContent).toBe("Details");
  });
});

describe("art-table", () => {
  const spec = {
    columns: ["Name", "Count"],
    rows: [
      ["beta", 2],
      ["alpha", 10],
    ],
    sortable: false,
  };

  const markup = (over: Record<string, unknown> = {}) =>
    `<art-table data-table='${JSON.stringify({ ...spec, ...over })}'></art-table>`;

  it("renders a real table with the right shape", async () => {
    const host = await mount(markup());
    const table = host.querySelector("table");

    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("thead th")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody td")).toHaveLength(4);
    expect(Array.from(table!.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Name",
      "Count",
    ]);
    expect(Array.from(table!.querySelectorAll("tbody tr")).map((tr) => tr.textContent)).toEqual([
      "beta2",
      "alpha10",
    ]);
  });

  it("right-aligns numeric cells only", async () => {
    const host = await mount(markup());
    const cells = Array.from(host.querySelectorAll("tbody td"));
    expect(cells.map((td) => td.className)).toEqual(["", "num", "", "num"]);
    expect(host.querySelector("thead th:nth-child(2)")?.className).toBe("num");
  });

  it("sorts numbers numerically and strings with localeCompare", async () => {
    const host = await mount(markup({ sortable: true }));
    const buttons = host.querySelectorAll<HTMLButtonElement>("thead button");
    const order = () => Array.from(host.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent);
    const sortState = () =>
      Array.from(host.querySelectorAll("thead th")).map((th) => th.getAttribute("aria-sort"));

    expect(buttons).toHaveLength(2);
    expect(sortState()).toEqual(["none", "none"]);

    // 2 before 10: lexicographic order would put "10" first.
    buttons[1].click();
    expect(order()).toEqual(["beta", "alpha"]);
    expect(sortState()).toEqual(["none", "ascending"]);

    buttons[1].click();
    expect(order()).toEqual(["alpha", "beta"]);
    expect(sortState()).toEqual(["none", "descending"]);

    buttons[0].click();
    expect(order()).toEqual(["alpha", "beta"]);
    expect(sortState()).toEqual(["ascending", "none"]);
  });

  it("renders nothing at all for missing or broken data", async () => {
    expect((await mount("<art-table></art-table>")).innerHTML).toBe("");
    expect((await mount("<art-table data-table='{oops'></art-table>")).innerHTML).toBe("");
    expect((await mount("<art-table data-table='{\"columns\":1}'></art-table>")).innerHTML).toBe("");
  });
});

describe("art-chart", () => {
  const spec = {
    type: "bar",
    title: "Signups",
    x: "month",
    y: ["count"],
    data: [
      { month: "Jan", count: 3 },
      { month: "Feb", count: 5 },
    ],
    stacked: false,
    height: 240,
  };

  // Chart.js needs a 2d context, which jsdom has none of. The element has to
  // put its frame on the page and swallow the failure rather than throw. The
  // stubs below only keep the expected failure out of the test output.
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    vi.restoreAllMocks();
  });

  it("renders the title and canvas without throwing", async () => {
    const host = await mount(`<art-chart data-chart='${JSON.stringify(spec)}'></art-chart>`);
    await tick();

    expect(host.querySelector(".art-chart__title")?.textContent).toBe("Signups");
    const frame = host.querySelector<HTMLElement>(".art-chart__canvas");
    expect(frame).not.toBeNull();
    expect(frame?.style.height).toBe("240px");
    expect(frame?.querySelector("canvas")).not.toBeNull();
  });

  it("renders nothing for a broken spec", async () => {
    const host = await mount("<art-chart data-chart='not json'></art-chart>");
    await tick();
    expect(host.innerHTML).toBe("");
  });
});

describe("art-embed", () => {
  it("builds a sandboxed iframe pointed at the embed id", async () => {
    document.documentElement.dataset.scheme = "dark";
    const host = await mount('<art-embed data-embed="e0" data-kind="mermaid"></art-embed>');
    const frame = host.querySelector("iframe")!;

    expect(frame.getAttribute("src")).toBe("/e0?scheme=dark");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.title).toBe("mermaid");
    expect(frame.style.width).toBe("100%");
    expect(frame.style.height).toBe("120px");
    expect(frame.style.border).toMatch(/^0(px)?$/);
    delete document.documentElement.dataset.scheme;
  });

  it("resizes on an art:height message from its own frame, clamped", async () => {
    const host = await mount('<art-embed data-embed="e1" data-kind="html"></art-embed>');
    const frame = host.querySelector("iframe")!;

    const post = (data: unknown, source: unknown = frame.contentWindow) => {
      const event = new MessageEvent("message", { data });
      Object.defineProperty(event, "source", { value: source });
      window.dispatchEvent(event);
    };

    post({ type: "art:height", px: 320 });
    expect(frame.style.height).toBe("320px");

    post({ type: "art:height", px: 10 });
    expect(frame.style.height).toBe("60px");

    post({ type: "art:height", px: 99999 });
    expect(frame.style.height).toBe("4000px");

    // Another frame, or another kind of message, changes nothing.
    post({ type: "art:height", px: 200 }, window);
    post({ type: "something-else", px: 200 });
    expect(frame.style.height).toBe("4000px");
  });

  it("stops listening once removed", async () => {
    const host = await mount('<art-embed data-embed="e2" data-kind="html"></art-embed>');
    const frame = host.querySelector("iframe")!;
    host.remove();
    await tick();

    const event = new MessageEvent("message", { data: { type: "art:height", px: 500 } });
    Object.defineProperty(event, "source", { value: frame.contentWindow });
    window.dispatchEvent(event);

    expect(frame.style.height).toBe("120px");
  });
});

describe("art-error", () => {
  it("wraps its message in an error box", async () => {
    const host = await mount("<art-error>table row 2 has 3 cells, expected 2</art-error>");
    const box = host.querySelector(".art-error");

    expect(box).not.toBeNull();
    expect(box?.textContent).toBe("Block error: table row 2 has 3 cells, expected 2");
    expect(host.children).toHaveLength(1);
  });
});
