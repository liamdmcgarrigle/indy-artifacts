import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { chartSource, kindChoices, kindOf, KINDS, parsePasted, suggestKinds, transposed, tryChart, withPasted, type Raw } from "@/lib/charts/builder";

const weeks: Raw = {
  type: "bar",
  title: "Deploys",
  x: "week",
  y: ["deploys", "cfr"],
  series: { cfr: { as: "line", axis: "right" } },
  marks: [{ y: 20, label: "Target" }],
  data: [
    { week: "W1", deploys: 14, cfr: 7.1 },
    { week: "W2", deploys: 18, cfr: 5.6 },
    { week: "W3", deploys: 11, cfr: 9.1 },
  ],
};

const kind = (id: string) => KINDS.find((k) => k.id === id)!;
const spec = (raw: Raw) => {
  const r = tryChart(raw);
  if ("error" in r) throw new Error(r.error);
  return r.spec;
};

describe("writing a block back", () => {
  it("keeps a steady key order with rows on one line each", () => {
    const text = chartSource({ data: weeks.data, y: weeks.y, x: "week", type: "bar", title: "Deploys" });
    expect(text).toBe(
      ["type: bar", "title: Deploys", "x: week", "y: [ deploys, cfr ]", "data:", "  - { week: W1, deploys: 14, cfr: 7.1 }", "  - { week: W2, deploys: 18, cfr: 5.6 }", "  - { week: W3, deploys: 11, cfr: 9.1 }"].join("\n"),
    );
    expect(parseYaml(chartSource(weeks))).toEqual(weeks);
  });

  it("keeps keys it does not know, and drops empty ones", () => {
    const text = chartSource({ ...weeks, note: "kept", unit: "" });
    expect(parseYaml(text).note).toBe("kept");
    expect(text).not.toContain("unit");
  });
});

describe("switching kinds", () => {
  it("marks the current kind", () => {
    expect(kindOf(spec(weeks))?.id).toBe("combo");
    expect(kindOf(spec({ ...weeks, series: undefined }))?.id).toBe("bar");
  });

  it("keeps the data and the author's options through a switch and back", () => {
    const line = kind("line").apply(weeks);
    expect(spec(line).type).toBe("line");
    expect(line.marks).toEqual(weeks.marks);
    const back = kind("combo").apply(line);
    expect(spec(back).series?.cfr).toMatchObject({ as: "line", axis: "right" });
  });

  it("drops what the new kind cannot draw", () => {
    const pie = kind("pie").apply(weeks);
    expect(pie).toMatchObject({ type: "pie", y: "deploys" });
    expect(pie.series).toBeUndefined();
    expect(pie.marks).toBeUndefined();
    const sideways = kind("barh").apply(weeks);
    expect(spec(sideways)).toMatchObject({ horizontal: true });
    expect(sideways.series).toEqual({ cfr: { axis: "right" } });
  });

  it("says which kinds cannot draw this data, and why", () => {
    const choices = kindChoices(weeks);
    expect(choices.find((c) => c.kind.id === "bar")?.error).toBeUndefined();
    expect(choices.find((c) => c.kind.id === "sankey")?.error).toMatch(/sankey/);
    expect(choices.find((c) => c.kind.id === "scatter")?.error).toBeUndefined();
    const one = kindChoices({ ...weeks, y: "deploys", series: undefined });
    expect(one.find((c) => c.kind.id === "stacked")?.error).toBe("needs two or more y keys to compare");
  });

  it("turns a names-and-amount table into a sankey", () => {
    const flows: Raw = { type: "bar", x: "source", data: [{ source: "Visit", target: "Signup", users: 30 }, { source: "Signup", target: "Paid", users: 5 }] };
    expect(spec(kind("sankey").apply(flows))).toMatchObject({ type: "sankey", x: "source", y: ["target"], value: "users" });
  });
});

describe("suggestions", () => {
  it("offers a line for time along x", () => {
    expect(suggestKinds({ data: [{ month: "Jan", n: 1 }, { month: "Feb", n: 2 }, { month: "Mar", n: 3 }, { month: "Apr", n: 2 }] })).toContain("line");
  });

  it("offers sideways bars for long names and a doughnut for a few parts", () => {
    const s = suggestKinds({ data: [{ service: "notifications-worker", n: 3 }, { service: "checkout-api", n: 2 }] });
    expect(s).toEqual(["barh", "doughnut"]);
  });

  it("offers a sankey for flows and a scatter for numbers against numbers", () => {
    expect(suggestKinds({ data: [{ from: "A", to: "B", value: 1 }] })[0]).toBe("sankey");
    expect(suggestKinds({ data: [{ kb: 10, ms: 100 }, { kb: 20, ms: 180 }] })).toContain("scatter");
  });
});

describe("pasting and turning", () => {
  it("reads cells from a spreadsheet, with the header", () => {
    expect(parsePasted("Month\tRevenue\tCost\nJan\t1,200\t800\nFeb\t1,500\t900")).toEqual({
      columns: ["Month", "Revenue", "Cost"],
      rows: [
        ["Jan", 1200, 800],
        ["Feb", 1500, 900],
      ],
    });
  });

  it("reads CSV with quotes, and names columns when there is no header", () => {
    expect(parsePasted('"Paris, FR",3\nLyon,4')).toEqual({ columns: ["label", "series 1"], rows: [["Paris, FR", 3], ["Lyon", 4]] });
    expect(parsePasted("just words")).toBeNull();
  });

  it("puts pasted cells in as the chart's data", () => {
    const next = withPasted(weeks, parsePasted("Month\tRevenue\tCost\nJan\t1200\t800\nFeb\t1500\t900")!);
    expect(next).toMatchObject({ x: "Month", y: ["Revenue", "Cost"], data: [{ Month: "Jan", Revenue: 1200, Cost: 800 }, { Month: "Feb", Revenue: 1500, Cost: 900 }] });
    expect(next.series).toBeUndefined();
    expect(spec(next).type).toBe("bar");
  });

  it("turns the table sideways", () => {
    const t = transposed({ type: "bar", x: "week", y: ["a", "b"], data: [{ week: "W1", a: 1, b: 2 }, { week: "W2", a: 3, b: 4 }] })!;
    expect(t).toMatchObject({ x: "series", y: ["W1", "W2"], data: [{ series: "a", W1: 1, W2: 3 }, { series: "b", W1: 2, W2: 4 }] });
    expect(transposed({ x: "w", y: "a", data: [{ w: "same", a: 1 }, { w: "same", a: 2 }] })).toBeNull();
    // A row named "series" does not collide with the new x key.
    const s = transposed({ x: "w", y: "a", data: [{ w: "series", a: 1 }, { w: "other", a: 2 }] })!;
    expect(s.x).toBe("series 2");
    expect(s.data).toEqual([{ "series 2": "a", series: 1, other: 2 }]);
  });

  it("keeps repeated headers and leading zeros, and never reads true as a number", () => {
    expect(parsePasted("m\ta\ta\nJan\t1\t2")!.columns).toEqual(["m", "a", "a 2"]);
    expect(parsePasted("zip,n\n02134,5")!.rows).toEqual([["02134", 5]]);
    const next = withPasted({ type: "waterfall", x: "s", y: "v", data: [] }, { columns: ["s", "total", "v"], rows: [["Start", true, 10], ["End", true, 0]] });
    expect(next.y).toBe("v");
  });

  it("pastes into the charts that read their own keys", () => {
    const flows = withPasted({ type: "sankey", data: [] }, parsePasted("source\ttarget\tn\nA\tB\t3\nA\tC\t2")!);
    expect(flows).toMatchObject({ from: "source", to: "target", value: "n" });
    expect("error" in tryChart(flows)).toBe(false);
    const grid = withPasted({ type: "heatmap", data: [] }, parsePasted("hour\tday\tpages\n08\tMon\t3\n09\tMon\t4")!);
    expect(grid).toMatchObject({ x: "hour", y: "day", value: "pages" });
    expect("error" in tryChart(grid)).toBe(false);
    const stages = withPasted({ type: "funnel", data: [] }, parsePasted("stage\tusers\tshare\nVisit\t100\t1\nBuy\t10\t0.1")!);
    expect("error" in tryChart(stages)).toBe(false);
  });
});
