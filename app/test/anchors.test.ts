// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  anchorForBlock,
  blockElement,
  blockOf,
  blockText,
  describeAnchor,
  linesOf,
  resolveAnchor,
  spotFor,
  truncate,
  type Anchor,
} from "@/lib/anchors";

let root: HTMLElement;

const HTML = `
<h1 data-block="b0" data-lines="1-1">Backup run</h1>
<p data-block="b1" data-lines="3-3">Three files hit <em>permission</em> errors under /var/lib.</p>
<art-chart data-block="b2" data-lines="5-9"></art-chart>
<p data-block="b3" data-lines="11-11">Second paragraph with the word marker in it.</p>
`;

beforeEach(() => {
  document.body.innerHTML = `<div id="content">${HTML}</div>`;
  root = document.getElementById("content")!;
});

describe("block helpers", () => {
  it("finds blocks by id and reads their source lines", () => {
    expect(blockElement(root, "b1")!.tagName).toBe("P");
    expect(linesOf(blockElement(root, "b2"))).toEqual([5, 9]);
    expect(linesOf(null)).toBeUndefined();
  });

  it("walks up from any node to its block", () => {
    const em = root.querySelector("em")!;
    expect(blockOf(em)!.getAttribute("data-block")).toBe("b1");
    expect(blockOf(em.firstChild)!.getAttribute("data-block")).toBe("b1");
    expect(blockOf(null)).toBeNull();
  });

  it("reads a block's text across child elements", () => {
    expect(blockText(blockElement(root, "b1")!)).toBe("Three files hit permission errors under /var/lib.");
  });

  it("builds an element anchor for a whole block", () => {
    const anchor = anchorForBlock(blockElement(root, "b2")!);
    expect(anchor).toMatchObject({ type: "element", block: "b2", lines: [5, 9], x: 0.5, y: 0.5 });
  });
});

describe("resolveAnchor", () => {
  it("finds a range anchor by its quote inside the right block", () => {
    const anchor: Anchor = { type: "range", block: "b1", lines: [3, 3], quote: "permission", start: 16, end: 26 };
    const resolved = resolveAnchor(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.exact).toBe(true);
  });

  it("re-anchors a quote that moved to a different block, marked inexact", () => {
    const anchor: Anchor = { type: "range", block: "b1", quote: "marker", start: 0, end: 6 };
    const resolved = resolveAnchor(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.exact).toBe(false);
  });

  it("falls back to the block box when the quote is gone", () => {
    const anchor: Anchor = { type: "range", block: "b1", quote: "text that is not there", start: 0, end: 4 };
    const resolved = resolveAnchor(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.exact).toBe(false);
  });

  it("returns null when the block is gone entirely", () => {
    expect(resolveAnchor(root, { type: "element", block: "b99" })).toBeNull();
  });

  it("locates a point anchor by its surrounding context", () => {
    const anchor: Anchor = { type: "point", block: "b1", offset: 16, context: "files hit permission" };
    const resolved = resolveAnchor(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.exact).toBe(true);
  });

  it("places an element anchor at its stored fraction of the block box", () => {
    const block = blockElement(root, "b2")!;
    block.getBoundingClientRect = () => new DOMRect(10, 20, 200, 100);
    const resolved = resolveAnchor(root, { type: "element", block: "b2", x: 0.5, y: 0.25 })!;
    expect(resolved.rect.left).toBe(110);
    expect(resolved.rect.top).toBe(45);
    expect(resolved.exact).toBe(true);
  });
});

describe("describeAnchor", () => {
  it("summarises each anchor shape for the sidebar and the agent", () => {
    expect(describeAnchor(null)).toBe("whole page");
    expect(describeAnchor({ type: "range", block: "b1", lines: [3, 3], quote: "permission errors" })).toBe(
      'lines 3-3 "permission errors"',
    );
    expect(describeAnchor({ type: "point", block: "b1", lines: [3, 3], context: "files hit" })).toBe(
      'lines 3-3 near "files hit"',
    );
    expect(describeAnchor({ type: "element", block: "b2", lines: [5, 9] })).toBe("lines 5-9 (b2)");
  });

  it("truncates long quotes", () => {
    expect(truncate("a".repeat(80), 10)).toHaveLength(10);
    expect(truncate("  spaced   out  ", 40)).toBe("spaced out");
  });
});

describe("spotFor", () => {
  const origin = { top: 100, left: 300 };
  const rect = { top: 140, left: 340, width: 60, height: 20 };

  it("puts a range pin at the end of the selection", () => {
    const spot = spotFor(rect, origin, "range", 1400);
    expect(spot.top).toBe(60);
    expect(spot.left).toBe(100);
  });

  it("puts an element pin at the top left of the block", () => {
    const spot = spotFor(rect, origin, "element", 1400);
    expect(spot.left).toBe(40);
  });

  it("opens the card to the right when the window has room", () => {
    const spot = spotFor(rect, origin, "point", 1400);
    expect(spot.flipped).toBe(false);
    expect(spot.popLeft).toBe(spot.left + 20);
  });

  it("flips the card to the left near the right edge", () => {
    const spot = spotFor(rect, origin, "point", 700);
    expect(spot.flipped).toBe(true);
    expect(spot.popLeft).toBe(spot.left - 312 - 18);
  });

  it("never pushes the card off the left of the window", () => {
    const narrow = { top: 100, left: 40 };
    const spot = spotFor({ top: 140, left: 60, width: 0, height: 20 }, narrow, "point", 400);
    expect(spot.flipped).toBe(true);
    expect(narrow.left + spot.popLeft).toBeGreaterThanOrEqual(8);
  });
});
