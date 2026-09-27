import { describe, expect, it } from "vitest";
import { BlockError, parseChartBlock } from "@/lib/pipeline/parse";
import { chartConfig, chartSummary, marksPlugin, withUnit, type ChartTheme } from "../../packages/primitives/src/chart-config";

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
    expect(label({ dataset: { label: "cfr" }, formattedValue: "5.6", datasetIndex: 1 })).toBe("cfr: 5.6%");
    expect(label({ dataset: { label: "deploys" }, formattedValue: "18", datasetIndex: 0 })).toBe("deploys: 18");
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
    expect(fails("type: bar", "x: week", "y: [deploys, cfr]", "series: { cfr: { as: pie } }", ...weeks)).toContain("as must be bar, line or area");
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
