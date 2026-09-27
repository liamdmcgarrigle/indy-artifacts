import { describe, expect, it } from "vitest";
import { BlockError } from "@/lib/pipeline/parse";
import { parseChartBlock } from "@/lib/pipeline/chart";
import { renderMarkdown } from "@/lib/pipeline";
import { chartConfig, chartSummary, formatNumber, marksPlugin, trendLine, withUnit, type ChartTheme } from "../../packages/primitives/src/chart-config";

const theme: ChartTheme = {
  palette: ["#111111", "#222222", "#333333"],
  text: "#000000",
  muted: "#777777",
  border: "#dddddd",
  surface: "#ffffff",
  font: "sans-serif",
  tones: { good: "#00aa00", warn: "#aa8800", bad: "#aa0000", info: "#0000aa" },
};

const chart = (...lines: string[]) => parseChartBlock(lines.join("\n"));
const fails = (...lines: string[]) => {
  try {
    chart(...lines);
  } catch (err) {
    expect(err).toBeInstanceOf(BlockError);
    return (err as Error).message;
  }
  throw new Error("expected the chart to be refused");
};

const services = [
  "data:",
  "  - { service: checkout-api, errors: 0.31 }",
  "  - { service: search, errors: 0.12 }",
  "  - { service: notifications, errors: 0.05 }",
];

describe("horizontal bars", () => {
  it("reads horizontal: true, orientation: horizontal and type: barh alike", () => {
    for (const head of [["type: bar", "horizontal: true"], ["type: bar", "orientation: horizontal"], ["type: barh"], ["type: hbar"]]) {
      const spec = chart(...head, "x: service", "y: errors", ...services);
      expect(spec.type).toBe("bar");
      expect(spec.horizontal).toBe(true);
    }
  });

  it("leaves an upright chart without the key", () => {
    expect(chart("type: bar", "x: service", "y: errors", ...services).horizontal).toBeUndefined();
    expect(chart("type: bar", "orientation: vertical", "x: service", "y: errors", ...services).horizontal).toBeUndefined();
  });

  it("refuses horizontal on anything but bars", () => {
    expect(fails("type: line", "horizontal: true", "x: service", "y: errors", ...services)).toContain("horizontal applies to bar charts");
  });

  it("puts the categories on y and the values on x", () => {
    const cfg = chartConfig(chart("type: barh", "x: service", "y: errors", "unit: '%'", ...services), theme);
    expect(cfg.options.indexAxis).toBe("y");
    expect(cfg.options.scales.y.axis).toBe("y");
    expect(cfg.options.scales.y.ticks.autoSkip).toBe(false);
    expect(cfg.options.scales.x.type).toBe("linear");
    expect(cfg.options.scales.x.ticks.callback(0.25)).toBe("0.25%");
    expect(cfg.data.datasets[0].xAxisID).toBe("x");
    expect(cfg.data.datasets[0].borderRadius).toMatchObject({ topRight: 5, bottomRight: 5, topLeft: 0 });
  });
});

describe("reference lines and bands", () => {
  it("reads a value line, a category line and a band", () => {
    const spec = chart(
      "type: bar",
      "x: service",
      "y: errors",
      "marks:",
      "  - { y: 0.25, label: 0.25% error budget, tone: bad }",
      "  - { x: search, label: Migrated }",
      "  - { from: search, to: notifications, label: Frozen }",
      ...services,
    );
    expect(spec.marks).toEqual([
      { kind: "value", value: 0.25, axis: "left", label: "0.25% error budget", tone: "bad" },
      { kind: "at", at: "search", label: "Migrated" },
      { kind: "band", from: "search", to: "notifications", label: "Frozen" },
    ]);
  });

  it("names the x values that exist when a mark points at one that doesn't", () => {
    const message = fails("type: area", "x: service", "y: errors", "marks: [{ from: search, to: billing }]", ...services);
    expect(message).toContain('chart mark 1 to "billing" is not an x value in the data');
    expect(message).toContain('"checkout-api", "search", "notifications"');
  });

  it("says what a mark needs", () => {
    expect(fails("type: line", "x: service", "y: errors", "marks: [{ label: Budget }]", ...services)).toContain("needs y (a line at a value)");
    expect(fails("type: line", "x: service", "y: errors", "marks: [{ from: search }]", ...services)).toContain("needs both from and to");
    expect(fails("type: line", "x: service", "y: errors", "marks: [{ y: lots }]", ...services)).toContain("must be a number");
    expect(fails("type: pie", "x: service", "y: errors", "marks: [{ y: 1 }]", ...services)).toContain("marks do not apply to pie charts");
  });

  it("stretches the value axis to reach a line above the data", () => {
    const cfg = chartConfig(chart("type: bar", "x: service", "y: errors", "marks: [{ y: 0.5 }]", ...services), theme);
    expect(cfg.options.scales.y.suggestedMax).toBe(0.5);
    expect(cfg.plugins).toHaveLength(1);
  });

  it("takes numbers for marks on a scatter chart", () => {
    const spec = chart("type: scatter", "x: size", "y: time", "marks: [{ x: 10, label: Limit }]", "data: [{ size: 5, time: 2 }, { size: 12, time: 4 }]");
    expect(spec.marks).toEqual([{ kind: "at", at: 10, label: "Limit" }]);
  });
});

/** A 2d context that records what was drawn. */
function recorder() {
  const calls: { op: string; args: unknown[]; style?: string; alpha?: number }[] = [];
  const ctx: Record<string, unknown> = { fillStyle: "", strokeStyle: "", globalAlpha: 1, font: "", lineWidth: 1, textAlign: "left", textBaseline: "top" };
  for (const op of ["save", "restore", "beginPath", "moveTo", "lineTo", "stroke", "setLineDash", "fillText"])
    ctx[op] = (...args: unknown[]) => calls.push({ op, args, style: String(ctx.strokeStyle) });
  ctx.fillRect = (...args: unknown[]) => calls.push({ op: "fillRect", args, style: String(ctx.fillStyle), alpha: Number(ctx.globalAlpha) });
  ctx.measureText = (text: string) => ({ width: text.length * 6 });
  return { ctx, calls };
}

describe("drawing marks", () => {
  const scale = (offset: boolean) => ({ options: { offset }, getPixelForValue: (v: number) => 100 + v * 50 });
  const value = { getPixelForValue: (v: number) => 400 - v * 100 };

  it("shades a whole bar slot either side of a band", () => {
    const spec = chart("type: bar", "x: service", "y: errors", "marks: [{ from: search, to: notifications, label: Frozen }]", ...services);
    const { ctx, calls } = recorder();
    const plugin = marksPlugin(spec, theme, ["checkout-api", "search", "notifications"]);
    const fake = { ctx, chartArea: { left: 50, right: 300, top: 10, bottom: 400 }, scales: { x: scale(true), y: value } };
    plugin.beforeDatasetsDraw(fake);
    plugin.afterDatasetsDraw(fake);
    const band = calls.find((c) => c.op === "fillRect" && c.alpha === 0.12);
    // search sits at 150, notifications at 200, and a slot is 50 wide.
    expect(band?.args).toEqual([125, 10, 100, 390]);
    expect(calls.some((c) => c.op === "fillText" && c.args[0] === "Frozen")).toBe(true);
  });

  it("draws a value line across an upright chart and down a sideways one", () => {
    const upright = chart("type: bar", "x: service", "y: errors", "marks: [{ y: 1, label: Budget }]", ...services);
    const a = recorder();
    marksPlugin(upright, theme, []).afterDatasetsDraw({ ctx: a.ctx, chartArea: { left: 50, right: 300, top: 10, bottom: 400 }, scales: { x: scale(true), y: value } });
    expect(a.calls.filter((c) => c.op === "moveTo" || c.op === "lineTo").map((c) => c.args)).toEqual([
      [50, 300],
      [300, 300],
    ]);

    const sideways = chart("type: barh", "x: service", "y: errors", "marks: [{ y: 1, label: Budget }]", ...services);
    const b = recorder();
    marksPlugin(sideways, theme, []).afterDatasetsDraw({ ctx: b.ctx, chartArea: { left: 50, right: 500, top: 10, bottom: 400 }, scales: { y: scale(true), x: value } });
    expect(b.calls.filter((c) => c.op === "moveTo" || c.op === "lineTo").map((c) => c.args)).toEqual([
      [300, 10],
      [300, 400],
    ]);
  });
});

describe("labels of lines that run top to bottom", () => {
  it("get a strip above the plot, and stay on the chart", () => {
    const spec = chart("type: barh", "x: service", "y: errors", "marks: [{ y: 0.4, label: A long budget label }]", ...services);
    const boxes: { position: string; height: number; update: (w: number) => void }[] = [];
    const plugin = marksPlugin(spec, theme, [], { addBox: (_chart, box) => boxes.push(box) });
    plugin.beforeInit({});
    expect(boxes).toHaveLength(1);
    boxes[0].update(300);
    expect(boxes[0]).toMatchObject({ position: "top", height: 17 });

    const { ctx, calls } = recorder();
    // The line sits near the right edge, so the label slides back in.
    plugin.afterDatasetsDraw({ ctx, width: 320, chartArea: { left: 50, right: 300, top: 40, bottom: 400 }, scales: { x: { getPixelForValue: () => 290 } } });
    const text = calls.find((c) => c.op === "fillText");
    // 19 characters at 6px is 114 wide; it ends 4px inside the chart's edge, above the plot.
    expect(text?.args).toEqual(["A long budget label", 202, 25]);
  });

  it("leave the layout alone when there are none", () => {
    const spec = chart("type: bar", "x: service", "y: errors", "marks: [{ y: 0.4, label: Budget }]", ...services);
    const boxes: unknown[] = [];
    marksPlugin(spec, theme, [], { addBox: (_chart, box) => boxes.push(box) }).beforeInit({});
    expect(boxes).toEqual([]);
  });
});

describe("bars and a line on two axes", () => {
  const weeks = ["data:", "  - { week: W1, deploys: 14, cfr: 7.1 }", "  - { week: W2, deploys: 18, cfr: 5.6 }"];
  const combo = [
    "type: bar",
    "x: week",
    "y: [deploys, cfr]",
    "series:",
    "  cfr: { as: line, axis: right }",
    "axes:",
    "  left: { title: Deploys }",
    "  right: { title: Change failure rate, unit: '%', max: 20 }",
    ...weeks,
  ];

  it("reads which series goes where", () => {
    const spec = chart(...combo);
    expect(spec.series).toEqual({ cfr: { as: "line", axis: "right" } });
    expect(spec.axes).toEqual({ left: { title: "Deploys" }, right: { title: "Change failure rate", unit: "%", max: 20 } });
  });

  it("gives the line its own axis, unit and tooltip", () => {
    const cfg = chartConfig(chart(...combo), theme);
    const [deploys, cfr] = cfg.data.datasets;
    expect(deploys.yAxisID).toBe("y");
    expect(deploys.type).toBeUndefined();
    expect(cfr).toMatchObject({ type: "line", yAxisID: "y2", fill: false });
    expect(cfg.options.scales.y2).toMatchObject({ position: "right", max: 20, title: { text: "Change failure rate" } });
    expect(cfg.options.scales.y2.ticks.callback(5)).toBe("5%");
    expect(cfg.options.scales.y.ticks.callback(5)).toBe("5");
    const label = cfg.options.plugins.tooltip.callbacks.label;
    expect(label({ dataset: { label: "cfr" }, raw: 5.6, datasetIndex: 1, dataIndex: 1 })).toBe("cfr: 5.6%");
    expect(label({ dataset: { label: "deploys" }, raw: 18, datasetIndex: 0, dataIndex: 1 })).toBe("deploys: 18");
  });

  it("lists the legend in the order the keys were written", () => {
    const sort = chartConfig(chart(...combo), theme).options.plugins.legend.labels.sort;
    expect([{ datasetIndex: 1 }, { datasetIndex: 0 }].sort(sort)).toEqual([{ datasetIndex: 0 }, { datasetIndex: 1 }]);
  });

  it("keeps a line out of a stack of bars", () => {
    const cfg = chartConfig(chart("type: bar", "stacked: true", "x: week", "y: [deploys, cfr]", "series: { cfr: { as: line } }", ...weeks), theme);
    expect(cfg.data.datasets.map((d: { stack: string }) => d.stack)).toEqual(["stack", "own-1"]);
  });

  it("has no right axis when nothing uses it", () => {
    expect(chartConfig(chart("type: bar", "x: week", "y: [deploys, cfr]", ...weeks), theme).options.scales.y2).toBeUndefined();
  });

  it("refuses series options that cannot apply", () => {
    expect(fails("type: bar", "x: week", "y: deploys", "series: { cfr: { as: line } }", ...weeks)).toContain('"cfr" is not one of the y keys');
    expect(fails("type: bar", "x: week", "y: [deploys, cfr]", "series: { cfr: { as: pie } }", ...weeks)).toContain("as must be bar, line, area");
    expect(fails("type: bar", "x: week", "y: [deploys, cfr]", "series: { cfr: { axis: top } }", ...weeks)).toContain("axis must be left or right");
    expect(fails("type: barh", "x: week", "y: [deploys, cfr]", "series: { cfr: { as: line } }", ...weeks)).toContain("cannot mix in lines");
    expect(fails("type: bar", "x: week", "y: deploys", "axes: { top: {} }", ...weeks)).toContain("chart axes are x, left and right");
  });
});

describe("units and summaries", () => {
  it("puts a sign against its number and a word after a space", () => {
    expect(withUnit(12, "%")).toBe("12%");
    expect(withUnit(41, "min")).toBe("41 min");
    expect(withUnit(3, undefined)).toBe("3");
  });

  it("describes the chart for screen readers", () => {
    expect(chartSummary(chart("type: barh", "title: Errors", "x: service", "y: errors", ...services))).toBe(
      "Errors. Horizontal bar chart of errors by service, 3 points. The data follows as a table.",
    );
  });

  it("draws an old spec exactly as before", () => {
    const cfg = chartConfig(chart("type: bar", "x: service", "y: errors", ...services), theme);
    expect(cfg.options.indexAxis).toBe("x");
    expect(cfg.plugins).toEqual([]);
    expect(Object.keys(cfg.options.scales)).toEqual(["x", "y"]);
  });
});

describe("number formats", () => {
  it("reads values the way the chart says", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatNumber(1234567, { format: "compact" })).toBe("1.2M");
    expect(formatNumber(0.125, { format: "percent" })).toBe("12.5%");
    expect(formatNumber(1234, { format: "currency" })).toBe("$1,234");
    expect(formatNumber(0.82, { format: "currency", currency: "EUR" })).toBe("€0.82");
    expect(formatNumber(3, { decimals: 1, unit: "ms" })).toBe("3.0 ms");
  });

  it("reads currency:EUR and checks the code", () => {
    expect(chart("type: bar", "format: currency:eur", ...services, "x: service", "y: errors").currency).toBe("EUR");
    expect(fails("type: bar", "format: currency", "currency: dollars", ...services)).toContain("three-letter code");
    expect(fails("type: bar", "format: money", ...services)).toContain("format must be number, compact, percent, currency");
  });

  it("refuses a percent format over values that are percentages already", () => {
    const message = fails("type: bar", "format: percent", "x: team", "y: rate", "data: [{ team: A, rate: 45 }]");
    expect(message).toContain('use unit: "%" instead');
    expect(chart("type: bar", "format: percent", "x: team", "y: rate", "data: [{ team: A, rate: 0.45 }]").format).toBe("percent");
  });

  it("formats ticks and tooltips with each axis's own style", () => {
    const cfg = chartConfig(
      chart("type: bar", "x: week", "y: [revenue, margin]", "format: compact", "series: { margin: { as: line, axis: right } }", "axes: { right: { format: percent } }", "data: [{ week: W1, revenue: 125000, margin: 0.31 }]"),
      theme,
    );
    expect(cfg.options.scales.y.ticks.callback(125000)).toBe("125K");
    expect(cfg.options.scales.y2.ticks.callback(0.3)).toBe("30%");
    const label = cfg.options.plugins.tooltip.callbacks.label;
    expect(label({ dataset: { label: "margin" }, raw: 0.31, datasetIndex: 1, dataIndex: 0 })).toBe("margin: 31%");
  });
});

describe("keys a chart does not read", () => {
  const warned = (...lines: string[]) => {
    const out: string[] = [];
    parseChartBlock(lines.join("\n"), (m) => out.push(m));
    return out;
  };

  it("names the key it meant", () => {
    expect(warned("type: bar", "stack: true", ...services)).toEqual(['chart does not read "stack"; did you mean stacked: true?']);
    expect(warned("type: bar", "titel: Errors", ...services)).toEqual(['chart does not read "titel"; did you mean title?']);
    expect(warned("type: bar", "ylabel: Errors", ...services)[0]).toContain("axes: { left: { title: ... } }");
    expect(warned("type: bar", "series: { errors: { colour: good } }", ...services)[0]).toContain('did you mean color?');
  });

  it("lists what it reads when nothing is close", () => {
    expect(warned("type: bar", "zzzzzz: 1", ...services)[0]).toContain("It reads type, title");
  });

  it("comes back from the page with the block's line", () => {
    const r = renderMarkdown(["intro", "", "```chart", "type: bar", "stack: true", ...services, "```"].join("\n"));
    expect(r.warnings).toEqual([{ line: 3, message: 'chart does not read "stack"; did you mean stacked: true?' }]);
  });
});

describe("stacks, curves and series styles", () => {
  const weeks = "data: [{ week: W1, a: 30, b: 10 }, { week: W2, a: 5, b: 15 }]";

  it("stacks to 100% as shares, and keeps the counts for the tooltip", () => {
    const spec = chart("type: bar", "stacked: percent", "x: week", "y: [a, b]", weeks);
    expect(spec).toMatchObject({ stacked: true, percent: true });
    const cfg = chartConfig(spec, theme);
    expect(cfg.data.datasets[0].data).toEqual([0.75, 0.25]);
    expect(cfg.options.scales.y.max).toBe(1);
    expect(cfg.options.scales.y.ticks.callback(0.5)).toBe("50%");
    expect(cfg.options.plugins.tooltip.callbacks.label({ dataset: { label: "a" }, raw: 0.75, datasetIndex: 0, dataIndex: 0 })).toBe("a: 75% (30)");
  });

  it("stacks areas on each other", () => {
    const cfg = chartConfig(chart("type: area", "stacked: true", "x: week", "y: [a, b]", weeks), theme);
    expect(cfg.data.datasets.map((d: { fill: unknown }) => d.fill)).toEqual(["origin", "-1"]);
  });

  it("draws curves smooth, straight or stepped", () => {
    const at = (curve: string) => chartConfig(chart("type: line", `curve: ${curve}`, "x: week", "y: a", weeks), theme).data.datasets[0];
    expect(at("smooth")).toMatchObject({ tension: 0.32, stepped: false });
    expect(at("straight")).toMatchObject({ tension: 0, stepped: false });
    expect(at("step")).toMatchObject({ tension: 0, stepped: "middle" });
    expect(fails("type: bar", "curve: smooth", "x: week", "y: a", weeks)).toContain("curve applies to line and area charts");
  });

  it("colors, dashes and hides series", () => {
    const cfg = chartConfig(
      chart("type: bar", "x: week", "y: [a, b]", "series: { a: { color: 3, dash: true }, b: { color: bad, hidden: true } }", weeks),
      theme,
    );
    const [a, b] = cfg.data.datasets;
    expect(a).toMatchObject({ borderColor: "#333333", borderDash: [6, 4], borderWidth: 1.5 });
    expect(a.backgroundColor).toBe("#33333347");
    expect(b).toMatchObject({ backgroundColor: "#aa0000", hidden: true });
    expect(fails("type: bar", "x: week", "y: a", "series: { a: { color: pink } }", weeks)).toContain("palette slot from 1 to 6");
  });

  it("leaves a missing value out instead of drawing a zero", () => {
    const cfg = chartConfig(chart("type: bar", "x: week", "y: [a, b]", "data: [{ week: W1, a: 3 }, { week: W2, a: 4, b: 5 }, { week: W3, a: 1, b: '' }]"), theme);
    expect(cfg.data.datasets[1].data).toEqual([null, 5, null]);
    expect(cfg.data.datasets[1].skipNull).toBe(true);
  });

  it("sorts rows by their total", () => {
    const spec = chart("type: bar", "sort: desc", "x: week", "y: [a, b]", weeks);
    expect(spec.data.map((r) => r.week)).toEqual(["W1", "W2"]);
    expect(chart("type: bar", "sort: asc", "x: week", "y: [a, b]", weeks).data.map((r) => r.week)).toEqual(["W2", "W1"]);
  });

  it("writes values on the data, with room above the bars", () => {
    const cfg = chartConfig(chart("type: bar", "labels: true", "x: week", "y: a", weeks), theme);
    expect(cfg.plugins.map((p: { id: string }) => p.id)).toEqual(["artValueLabels"]);
    expect(cfg.options.scales.y.grace).toBe("8%");
  });

  it("moves or hides the legend", () => {
    expect(chartConfig(chart("type: bar", "legend: bottom", "x: week", "y: [a, b]", weeks), theme).options.plugins.legend.position).toBe("bottom");
    expect(chartConfig(chart("type: bar", "legend: none", "x: week", "y: [a, b]", weeks), theme).options.plugins.legend.display).toBe(false);
  });

  it("draws a log axis without a zero", () => {
    const cfg = chartConfig(chart("type: line", "x: week", "y: a", "axes: { left: { log: true } }", weeks), theme);
    expect(cfg.options.scales.y).toMatchObject({ type: "logarithmic", beginAtZero: false });
  });
});

describe("scatter and bubble", () => {
  const points = [
    "data:",
    "  - { model: A1, brand: Acme, price: 10, rating: 3, sales: 100 }",
    "  - { model: A2, brand: Acme, price: 30, rating: 4, sales: 400 }",
    "  - { model: B1, brand: Bolt, price: 20, rating: 2, sales: 25 }",
  ];

  it("splits points into groups and names each one", () => {
    const cfg = chartConfig(chart("type: scatter", "x: price", "y: rating", "group: brand", "label: model", ...points), theme);
    expect(cfg.data.datasets.map((d: { label: string }) => d.label)).toEqual(["Acme", "Bolt"]);
    expect(cfg.data.datasets[0].data[1]).toEqual({ x: 30, y: 4, name: "A2" });
    expect(cfg.options.interaction).toEqual({ mode: "nearest", intersect: true });
    const { label, title } = cfg.options.plugins.tooltip.callbacks;
    expect(title([{ raw: { name: "A2" } }])).toBe("A2");
    expect(label({ raw: { x: 30, y: 4 }, dataset: { label: "Acme" } })).toBe("Acme: price 30, rating 4");
  });

  it("sizes bubbles by area, so twice the value is not twice as wide", () => {
    const spec = chart("type: bubble", "x: price", "y: rating", "size: sales", ...points);
    expect(spec).toMatchObject({ type: "scatter", size: "sales" });
    const cfg = chartConfig(spec, theme);
    expect(cfg.type).toBe("bubble");
    const radii = cfg.data.datasets[0].data.map((p: { r: number }) => p.r);
    // 400 is the largest; 100 is a quarter of it, so half the radius.
    expect(radii).toEqual([11, 22, 5.5]);
    expect(fails("type: bubble", "x: price", "y: rating", ...points)).toContain("a bubble chart needs size");
  });

  it("joins points in x order and fits a trend line per group", () => {
    const cfg = chartConfig(chart("type: scatter", "x: price", "y: rating", "group: brand", "line: true", "trend: linear", ...points), theme);
    const [acme, acmeTrend] = cfg.data.datasets;
    expect(acme.showLine).toBe(true);
    expect(acmeTrend).toMatchObject({ type: "line", label: "Acme trend", artTrend: true, data: [{ x: 10, y: 3 }, { x: 30, y: 4 }] });
    expect(cfg.options.plugins.legend.labels.filter({ datasetIndex: 1 })).toBe(false);
    expect(trendLine([{ x: 1, y: 1 }])).toBeNull();
  });

  it("keeps scatter options off other charts", () => {
    expect(fails("type: bar", "x: price", "y: rating", "group: brand", ...points)).toContain("group applies to scatter and bubble charts");
    expect(fails("type: scatter", "x: price", "y: [rating, sales]", "group: brand", ...points)).toContain("give a single y key with group");
  });
});

describe("pie and doughnut", () => {
  const many = ["data:", ...["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => `  - { part: ${k}, n: ${80 - i * 10} }`)];

  it("folds the smallest slices into Other past six", () => {
    const cfg = chartConfig(chart("type: pie", "x: part", "y: n", ...many), theme);
    expect(cfg.data.labels).toEqual(["a", "b", "c", "d", "e", "Other"]);
    expect(cfg.data.datasets[0].data).toEqual([80, 70, 60, 50, 40, 60]);
  });

  it("puts the total in a doughnut and shares in the tooltip", () => {
    const cfg = chartConfig(chart("type: doughnut", "center: requests", "x: part", "y: n", "data: [{ part: a, n: 300 }, { part: b, n: 100 }]"), theme);
    expect(cfg.plugins.map((p: { id: string }) => p.id)).toEqual(["artCenter"]);
    expect(cfg.options.plugins.tooltip.callbacks.label({ label: "a", raw: 300 })).toBe("a: 300 (75%)");
    expect(fails("type: pie", "center: total", "x: part", "y: n", ...many)).toContain("center applies to doughnut charts");
  });
});

describe("radar, histogram, waterfall and range bars", () => {
  it("draws a radar with a ring per series", () => {
    const cfg = chartConfig(chart("type: radar", "x: skill", "y: [ana, ben]", "data: [{ skill: SQL, ana: 4, ben: 2 }, { skill: Go, ana: 3, ben: 5 }, { skill: UX, ana: 2, ben: 4 }]"), theme);
    expect(cfg.type).toBe("radar");
    expect(cfg.data.labels).toEqual(["SQL", "Go", "UX"]);
    expect(cfg.data.datasets.map((d: { fill: boolean }) => d.fill)).toEqual([true, true]);
    expect(cfg.options.scales.r.beginAtZero).toBe(true);
    expect(fails("type: radar", "x: skill", "y: ana", "marks: [{ y: 3 }]", "data: [{ skill: SQL, ana: 4 }]")).toContain("radar charts take no marks");
  });

  it("counts values into touching ranges, from rows or a plain list", () => {
    const spec = chart("type: histogram", "bins: 4", "unit: ms", "data: [10, 12, 18, 25, 26, 27, 40]");
    expect(spec).toMatchObject({ type: "histogram", x: "value", y: [], bins: 4 });
    const cfg = chartConfig(spec, theme);
    expect(cfg.type).toBe("bar");
    // 10 to 40 in about four ranges rounds to 10 wide: 10–20, 20–30 and 30–40, the top value in the last.
    expect(cfg.data.datasets[0].data).toEqual([3, 3, 1]);
    expect(cfg.data.labels[0]).toBe("10–20 ms");
    expect(cfg.data.datasets[0].categoryPercentage).toBe(1);
    expect(cfg.options.plugins.tooltip.callbacks.label({ raw: 1 })).toBe("1 value");
    expect(fails("type: histogram", "x: ms", "y: n", "data: [{ ms: 1, n: 2 }]")).toContain("leave out y");
    expect(fails("type: histogram", "x: ms", "data: [{ ms: fast }]")).toContain("needs numbers in ms");
    expect(chartSummary(spec)).toBe("Histogram of value, 7 values. The values follow as a table.");
  });

  it("lets a waterfall start from a total with a value", () => {
    const cfg = chartConfig(chart("type: waterfall", "x: step", "y: amount", "data: [{ step: June, amount: 100, total: true }, { step: New, amount: 20 }, { step: July, total: true }]"), theme);
    expect(cfg.data.datasets[0].data).toEqual([[0, 100], [100, 120], [0, 120]]);
  });

  it("floats waterfall steps from the running total, with totals on zero", () => {
    const spec = chart("type: waterfall", "x: step", "y: amount", "format: compact", "data: [{ step: Start, amount: 100 }, { step: Price, amount: 30 }, { step: Churn, amount: -45 }, { step: End, total: true }]");
    const cfg = chartConfig(spec, theme);
    expect(cfg.data.datasets[0].data).toEqual([[0, 100], [100, 130], [130, 85], [0, 85]]);
    expect(cfg.data.datasets[0].backgroundColor).toEqual(["#00aa00", "#00aa00", "#aa0000", "#111111"]);
    const label = cfg.options.plugins.tooltip.callbacks.label;
    expect(label({ dataIndex: 2 })).toBe("−45, now 85");
    expect(label({ dataIndex: 3 })).toBe("Total: 85");
    expect(cfg.options.plugins.legend.display).toBe(false);
    expect(fails("type: waterfall", "x: step", "y: [a, b]", "data: [{ step: A, a: 1, b: 2 }]")).toContain("takes one y key");
  });

  it("spans range bars from one key to the other, off zero", () => {
    const spec = chart("type: barh", "range: true", "x: task", "y: [start, end]", "data: [{ task: Design, start: 1, end: 4 }, { task: Build, start: 3, end: 9 }]");
    const cfg = chartConfig(spec, theme);
    expect(cfg.data.datasets[0].data).toEqual([[1, 4], [3, 9]]);
    expect(cfg.options.scales.x.beginAtZero).toBe(false);
    expect(cfg.options.plugins.tooltip.callbacks.label({ dataIndex: 1 })).toBe("3 to 9");
    expect(fails("type: bar", "range: true", "x: task", "y: start", "data: [{ task: A, start: 1 }]")).toContain("takes two y keys");
  });
});

describe("counter sparklines", () => {
  it("reads trend values onto the counter", () => {
    const r = renderMarkdown(':::kpis\n- Signups: 412 {tone=good trend="3, 5, 4, 8"}\n- Churn: 2% {trend="1,x"}\n:::');
    expect(r.html).toContain('<art-kpi label="Signups" value="412" tone="good" trend="3,5,4,8">');
    expect(r.html).toContain('<art-kpi label="Churn" value="2%">');
  });
});

describe("heatmap, box plot, funnel and sankey", () => {
  it("lays a heatmap out as cells, darker for bigger numbers", () => {
    const spec = chart("type: heatmap", "x: hour", "y: day", "value: jobs", "labels: true", "data: [{ hour: 9, day: Mon, jobs: 10 }, { hour: 10, day: Mon, jobs: 30 }, { hour: 9, day: Tue, jobs: 20 }]");
    expect(spec).toMatchObject({ type: "heatmap", x: "hour", y: ["day"], value: "jobs", labels: true, height: 160 });
    const cfg = chartConfig(spec, theme);
    expect(cfg.type).toBe("matrix");
    expect(cfg.data.datasets[0].data[1]).toEqual({ x: "10", y: "Mon", v: 30 });
    expect(cfg.data.datasets[0].artShare).toEqual([0, 1, 0.5]);
    expect(cfg.options.scales.x.labels).toEqual(["9", "10"]);
    expect(cfg.options.scales.y.labels).toEqual(["Mon", "Tue"]);
    expect(cfg.options.plugins.tooltip.callbacks.title([{ raw: { x: "10", y: "Mon" } }])).toBe("Mon · 10");
    expect(fails("type: heatmap", "x: hour", "y: day", "value: jobs", "data: [{ hour: 9, day: Mon, jobs: lots }]")).toContain("needs numbers in jobs");
    expect(fails("type: heatmap", "x: hour", "y: day", "marks: [{ y: 1 }]", "data: [{ hour: 9, day: Mon, jobs: 1 }]")).toContain("marks does not apply to heatmap charts");
  });

  it("draws a box plot from raw values or from the five numbers", () => {
    const raw = chartConfig(chart("type: boxplot", "x: region", "y: ms", "data: [{ region: us, ms: 10 }, { region: us, ms: 14 }, { region: eu, ms: 22 }]"), theme);
    expect(raw.type).toBe("boxplot");
    expect(raw.data.labels).toEqual(["us", "eu"]);
    expect(raw.data.datasets[0].data).toEqual([[10, 14], [22]]);
    expect(raw.options.plugins.tooltip.callbacks.label).toBeUndefined();

    const five = chart("type: box", "horizontal: true", "x: service", "data: [{ service: api, min: 20, q1: 40, median: 55, q3: 80, max: 190 }]");
    expect(five).toMatchObject({ stats: true, horizontal: true, y: ["min", "q1", "median", "q3", "max"] });
    const cfg = chartConfig(five, theme);
    expect(cfg.data.datasets[0].data).toEqual([{ min: 20, q1: 40, median: 55, q3: 80, max: 190 }]);
    expect(cfg.options.indexAxis).toBe("y");
  });

  it("centers funnel stages and gives each its share of the first", () => {
    const spec = chart("type: funnel", "x: stage", "y: people", "data: [{ stage: Visit, people: 1000 }, { stage: Signup, people: 400 }, { stage: Paid, people: 100 }]");
    expect(spec.labels).toBe(true);
    const cfg = chartConfig(spec, theme);
    expect(cfg.data.datasets[0].data).toEqual([[-500, 500], [-200, 200], [-50, 50]]);
    expect(cfg.options.indexAxis).toBe("y");
    expect(cfg.options.plugins.tooltip.callbacks.label({ dataIndex: 2 })).toBe("100, 10% of the first stage, 25% of the one before");
    expect(fails("type: funnel", "x: stage", "y: [a, b]", "data: [{ stage: A, a: 1, b: 2 }]")).toContain("one y key");
  });

  it("draws sankey flows and refuses ones that loop", () => {
    const spec = chart("type: sankey", "data: [{ from: Visit, to: Signup, value: 120 }, { from: Signup, to: Paid, value: 30 }, { from: Visit, to: Left, value: 880 }]");
    expect(spec).toMatchObject({ type: "sankey", x: "from", y: ["to"], value: "value", height: 360 });
    const cfg = chartConfig(spec, theme);
    expect(cfg.type).toBe("sankey");
    expect(cfg.data.datasets[0].data[0]).toEqual({ from: "Visit", to: "Signup", flow: 120 });
    expect(cfg.options.plugins.tooltip.callbacks.label({ raw: { from: "Visit", to: "Left", flow: 880 } })).toBe("Visit → Left: 880");
    expect(cfg.options.plugins.legend.display).toBe(false);
    expect(chart("type: sankey", "from: source", "to: target", "value: users", "data: [{ source: A, target: B, users: 3 }]")).toMatchObject({ x: "source", y: ["target"], value: "users" });
    expect(fails("type: sankey", "data: [{ from: A, to: B, value: 1 }, { from: B, to: C, value: 1 }, { from: C, to: A, value: 1 }]")).toContain("loop back: A → B → C → A");
    expect(fails("type: sankey", "data: [{ from: A, to: A, value: 1 }]")).toContain("to itself");
    expect(fails("type: sankey", "stacked: true", "data: [{ from: A, to: B, value: 1 }]")).toContain("stacked does not apply to sankey");
  });
});
