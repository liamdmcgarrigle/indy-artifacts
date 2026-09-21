// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  anchorForBlock,
  blockElement,
  blockOf,
  blockText,
  describeAnchor,
  linesOf,
  locateContext,
  resolveAnchor,
  spotFor,
  spreadPins,
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
  const origin = { top: 100, left: 100 };
  const rect = { top: 140, left: 340, width: 60, height: 20 };
  // A 660px text column centred in a 1440px window.
  const wide = { viewportWidth: 1440, contentLeft: 390, contentRight: 1050, popWidth: 312 };

  it("puts the pin in the margin beside the text, not on it", () => {
    const spot = spotFor(rect, origin, "point", wide);
    expect(spot.left).toBe(390 - 100 - 42);
  });

  it("hangs a range pin at the end of the selection", () => {
    const spot = spotFor(rect, origin, "range", wide);
    expect(spot.top).toBe(60);
  });

  it("keeps the pin on screen when there is no margin", () => {
    const narrow = { viewportWidth: 420, contentLeft: 16, contentRight: 400, popWidth: 312 };
    const origin = { top: 100, left: 16 };
    const spot = spotFor(rect, origin, "point", narrow);
    expect(origin.left + spot.left).toBeGreaterThanOrEqual(8);
  });

  it("puts the pin outside a column that fills its own container", () => {
    // .art-content fills .stage__inner, so the gutter is off the left of it.
    const full = { viewportWidth: 1440, contentLeft: 270, contentRight: 1170, popWidth: 312 };
    const spot = spotFor(rect, { top: 0, left: 270 }, "point", full);
    expect(spot.left).toBe(-42);
    expect(270 + spot.left).toBe(228);
  });

  it("opens the card beside the caret it was left on", () => {
    const spot = spotFor(rect, origin, "point", wide);
    // The caret rect ends at 400, so the card opens a gap past it.
    expect(origin.left + spot.popLeft).toBe(400 + 14);
  });

  it("hangs the card under a selection, lined up with its first word", () => {
    const spot = spotFor(rect, origin, "range", wide);
    expect(origin.left + spot.popLeft).toBe(340);
    expect(spot.popTop).toBe(140 - 100 + 20 + 8);
  });

  it("opens to the left of a spot near the right edge", () => {
    const edge = { top: 140, left: 1300, width: 40, height: 20 };
    const spot = spotFor(edge, origin, "point", wide);
    expect(origin.left + spot.popLeft).toBe(1440 - 12 - 312);
  });

  it("keeps the card inside a narrow window", () => {
    const tight = { viewportWidth: 900, contentLeft: 120, contentRight: 780, popWidth: 312 };
    const spot = spotFor(rect, { top: 100, left: 0 }, "point", tight);
    expect(spot.popLeft).toBeGreaterThanOrEqual(12);
    expect(spot.popLeft + 312).toBeLessThanOrEqual(900 - 12);
  });

  it("never pushes the card off the left of the window", () => {
    const tiny = { viewportWidth: 380, contentLeft: 10, contentRight: 370, popWidth: 312 };
    const spot = spotFor(rect, { top: 0, left: 0 }, "point", tiny);
    expect(spot.popLeft).toBeGreaterThanOrEqual(12);
  });
});

describe("locateContext", () => {
  const line = "The container serves on port 5174, reachable from the Mac at agentbox.";
  // The comment was left after "5174, ", 24 characters into the stored run.
  const context = "on port 5174, reachable from the Mac";
  const caret = 13;

  it("finds the spot it was left on", () => {
    const found = locateContext(line, context, caret);
    expect(found).toEqual({ offset: line.indexOf(context) + caret, exact: true });
  });

  it("holds its place when the words after it change", () => {
    const edited = "The container serves on port 5174, published to the tailnet.";
    const found = locateContext(edited, context, caret);
    expect(found?.exact).toBe(false);
    expect(edited.slice(0, found!.offset)).toBe("The container serves on port 5174,");
  });

  it("holds its place when the words before it change", () => {
    const edited = "Production listens on port 9000, reachable from the Mac at agentbox.";
    const found = locateContext(edited, context, caret);
    expect(found?.exact).toBe(false);
    expect(edited.slice(found!.offset, found!.offset + 10)).toBe(" reachable");
  });

  it("gives up rather than guessing when the sentence is gone", () => {
    expect(locateContext("Nothing here resembles the original line at all.", context, caret)).toBeNull();
  });
});

describe("spreadPins", () => {
  it("nudges pins apart when they land on the same line", () => {
    const out = spreadPins([{ top: 100 }, { top: 108 }, { top: 112 }], 30);
    expect(out.map((p) => p.top)).toEqual([100, 130, 160]);
  });

  it("leaves pins alone when they already clear each other", () => {
    const out = spreadPins([{ top: 100 }, { top: 200 }], 30);
    expect(out.map((p) => p.top)).toEqual([100, 200]);
  });
});

describe("anchors that outlive an edit", () => {
  it("finds a point anchor whose block was renumbered", () => {
    // The comment was left on b1, but a later edit made that same sentence b3.
    const anchor: Anchor = {
      type: "point",
      block: "b1",
      context: "Second paragraph with the word marker",
      offset: 10,
    };
    const resolved = resolveAnchor(root, anchor);
    expect(resolved).not.toBeNull();
    // Found by its surrounding text, so it is flagged as a moved anchor.
    expect(resolved?.exact).toBe(false);
  });

  it("keeps a point anchor exact when its own block still holds the text", () => {
    const anchor: Anchor = {
      type: "point",
      block: "b3",
      context: "Second paragraph with the word marker",
      offset: 10,
    };
    expect(resolveAnchor(root, anchor)?.exact).toBe(true);
  });
});
