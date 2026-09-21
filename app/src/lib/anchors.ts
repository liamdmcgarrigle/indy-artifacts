/**
 * Turning a place in the rendered artifact into a stored anchor, and back again.
 *
 * Three anchor shapes, all carrying the block id and the source lines the block
 * came from, because the source lines are what the agent acts on:
 *   point    a caret position inside a block's text
 *   range    a text selection
 *   element  a whole block, or an element inside a sandbox frame
 *
 * Re-anchoring on a later version is text-first: look for the quote or the
 * surrounding context inside the same block, then anywhere in the document.
 * A stored offset is only a hint.
 */

export type AnchorType = "point" | "range" | "element";

export interface Anchor {
  type: AnchorType;
  block: string;
  lines?: [number, number];
  quote?: string;
  context?: string;
  offset?: number;
  start?: number;
  end?: number;
  selector?: string;
  x?: number;
  y?: number;
}

export const CONTEXT_CHARS = 24;

export function blockElement(root: ParentNode, blockId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`);
}

export function blockOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== 1) el = el.parentNode;
  return (el as HTMLElement | null)?.closest<HTMLElement>("[data-block]") ?? null;
}

export function linesOf(el: HTMLElement | null): [number, number] | undefined {
  const raw = el?.getAttribute("data-lines");
  if (!raw) return undefined;
  const [a, b] = raw.split("-").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined;
}

/** Text nodes of a block, skipping anything inside a nested sandbox frame. */
function textNodes(block: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("iframe, script, style")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    out.push(node as Text);
    node = walker.nextNode();
  }
  return out;
}

export function blockText(block: HTMLElement): string {
  return textNodes(block)
    .map((n) => n.data)
    .join("");
}

/** Absolute character offset of (node, offset) within its block. */
function offsetIn(block: HTMLElement, node: Node, nodeOffset: number): number | null {
  let total = 0;
  for (const text of textNodes(block)) {
    if (text === node) return total + nodeOffset;
    total += text.data.length;
  }
  return null;
}

/** Inverse of offsetIn: a (node, offset) pair for an absolute offset. */
function positionAt(block: HTMLElement, offset: number): { node: Text; offset: number } | null {
  let remaining = Math.max(offset, 0);
  const nodes = textNodes(block);
  for (const text of nodes) {
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.data.length } : null;
}

export function anchorFromSelection(root: HTMLElement): Anchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = blockOf(range.startContainer);
  if (!block || !root.contains(block)) return null;

  const start = offsetIn(block, range.startContainer, range.startOffset);
  const end = offsetIn(block, range.endContainer, range.endOffset);
  const quote = selection.toString().trim();
  if (start === null || end === null || !quote) return null;

  return {
    type: "range",
    block: block.getAttribute("data-block")!,
    lines: linesOf(block),
    quote: quote.slice(0, 2000),
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

interface CaretPosition {
  offsetNode: Node;
  offset: number;
}

function caretAt(x: number, y: number): CaretPosition | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") return doc.caretPositionFromPoint(x, y);
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}

/** A click with the comment tool on: a caret in text, or the element itself. */
export function anchorFromPoint(root: HTMLElement, clientX: number, clientY: number): Anchor | null {
  const target = document.elementFromPoint(clientX, clientY);
  const block = blockOf(target);
  if (!block || !root.contains(block)) return null;
  const blockId = block.getAttribute("data-block")!;
  const lines = linesOf(block);

  const caret = caretAt(clientX, clientY);
  if (caret && caret.offsetNode.nodeType === 3 && block.contains(caret.offsetNode)) {
    const offset = offsetIn(block, caret.offsetNode, caret.offset);
    if (offset !== null) {
      const text = blockText(block);
      return {
        type: "point",
        block: blockId,
        lines,
        offset,
        context: text.slice(Math.max(0, offset - CONTEXT_CHARS), offset + CONTEXT_CHARS),
      };
    }
  }

  const rect = block.getBoundingClientRect();
  return {
    type: "element",
    block: blockId,
    lines,
    x: rect.width ? (clientX - rect.left) / rect.width : 0.5,
    y: rect.height ? (clientY - rect.top) / rect.height : 0.5,
  };
}

/** A whole block, used by the gutter button and by element picks inside frames. */
export function anchorForBlock(block: HTMLElement, extra: Partial<Anchor> = {}): Anchor {
  return {
    type: "element",
    block: block.getAttribute("data-block") ?? "",
    lines: linesOf(block),
    x: 0.5,
    y: 0.5,
    ...extra,
  };
}

export interface Resolved {
  rect: DOMRect;
  exact: boolean;
}

/** A live DOM Range over a character span of a block, or null if it cannot be built. */
function makeRange(block: HTMLElement, from: number, to: number): Range | null {
  const start = positionAt(block, from);
  const end = positionAt(block, to);
  if (!start || !end) return null;
  try {
    const range = document.createRange();
    range.setStart(start.node, Math.min(start.offset, start.node.data.length));
    range.setEnd(end.node, Math.min(end.offset, end.node.data.length));
    return range;
  } catch {
    return null;
  }
}

function rectOfRange(block: HTMLElement, from: number, to: number): DOMRect | null {
  const range = makeRange(block, from, to);
  if (!range) return null;
  const end = positionAt(block, to) ?? positionAt(block, from);
  const start = positionAt(block, from);

  // jsdom and other non-layout engines have no Range geometry; fall back to the
  // element that holds the text, which is close enough to hang a pin on.
  const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
  if (rects && rects.length) return rects[rects.length - 1] as DOMRect;
  if (typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height || rect.top || rect.left)) return rect as DOMRect;
  }
  const holder = end?.node.parentElement ?? start?.node.parentElement ?? block;
  return holder.getBoundingClientRect();
}

/**
 * Where does this anchor sit right now? `exact` is false when the stored text
 * could not be found and the position is a fallback.
 */
export function resolveAnchor(root: HTMLElement, anchor: Anchor): Resolved | null {
  const block = anchor.block ? blockElement(root, anchor.block) : null;

  if (anchor.type === "range" && anchor.quote) {
    const search = block ?? root;
    const found = findQuote(search, anchor.quote, anchor.start);
    if (found) return { rect: found, exact: true };
    if (search !== root) {
      const anywhere = findQuote(root, anchor.quote);
      if (anywhere) return { rect: anywhere, exact: false };
    }
  }

  if (anchor.type === "point" && anchor.context) {
    // The stored block first, then the whole page. Block ids are positional, so
    // editing anything above a comment renumbers its block and the id alone
    // would drop the pin in the wrong place. The surrounding text still finds it.
    for (const scope of block ? [block, root] : [root]) {
      const text = blockText(scope);
      const index = text.indexOf(anchor.context);
      if (index === -1) continue;
      const offset = index + Math.min(CONTEXT_CHARS, anchor.context.length);
      const rect = rectOfRange(scope, Math.max(offset - 1, 0), offset);
      if (rect) return { rect, exact: scope === block };
    }
  }

  if (anchor.type === "point" && block && typeof anchor.offset === "number") {
    const rect = rectOfRange(block, Math.max(anchor.offset - 1, 0), anchor.offset);
    if (rect) return { rect, exact: false };
  }

  if (block) {
    const rect = block.getBoundingClientRect();
    if (anchor.type === "element" && typeof anchor.x === "number" && typeof anchor.y === "number") {
      const point = new DOMRect(rect.left + rect.width * anchor.x, rect.top + rect.height * anchor.y, 0, 0);
      return { rect: point, exact: true };
    }
    return { rect, exact: anchor.type === "element" };
  }

  return null;
}

/** Where the stored quote sits in a block's text, as character offsets. */
function locateQuote(scope: HTMLElement, quote: string, near?: number): { from: number; to: number } | null {
  const text = blockText(scope);
  if (!text) return null;

  const candidates = [quote, quote.trim(), quote.replace(/\s+/g, " ").trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    let index = typeof near === "number" ? text.indexOf(candidate, Math.max(near - 40, 0)) : -1;
    if (index === -1) index = text.indexOf(candidate);
    if (index === -1) continue;
    return { from: index, to: index + candidate.length };
  }
  return null;
}

function findQuote(scope: HTMLElement, quote: string, near?: number): DOMRect | null {
  const at = locateQuote(scope, quote, near);
  return at ? rectOfRange(scope, at.from, at.to) : null;
}

/**
 * A live Range over the text a comment points at, for the CSS Custom Highlight
 * API. Only range anchors light up; a point anchor has nothing to paint.
 */
export function rangeForAnchor(root: HTMLElement, anchor: Anchor): Range | null {
  if (anchor.type !== "range" || !anchor.quote) return null;
  const block = anchor.block ? blockElement(root, anchor.block) : null;
  for (const scope of [block, root]) {
    if (!scope) continue;
    const at = locateQuote(scope, anchor.quote, scope === block ? anchor.start : undefined);
    if (at) return makeRange(scope, at.from, at.to);
  }
  return null;
}

/** One-line description of an anchor, for the comment card and for the agent. */
export function describeAnchor(anchor: Anchor | null): string {
  if (!anchor) return "whole page";
  const lines = anchor.lines ? `lines ${anchor.lines[0]}-${anchor.lines[1]}` : anchor.block;
  if (anchor.type === "range" && anchor.quote) return `${lines} "${truncate(anchor.quote, 60)}"`;
  if (anchor.type === "point" && anchor.context) return `${lines} near "${truncate(anchor.context, 40)}"`;
  return `${lines} (${anchor.block})`;
}

export function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Where a pin sits in the overlay, and where its card opens. */
export interface Spot {
  top: number;
  left: number;
  popTop: number;
  popLeft: number;
  flipped: boolean;
}

export interface SpotLayout {
  /** Viewport width, for keeping the card on screen. */
  viewportWidth: number;
  /** Left edge of the text column in viewport coordinates. */
  contentLeft: number;
  /** Right edge of the text column in viewport coordinates. */
  contentRight: number;
  popWidth?: number;
}

const PIN_GUTTER = 34;

/**
 * Turn an anchor's viewport rect into overlay coordinates.
 *
 * Pins live in the margin beside the text rather than on top of it, the way a
 * document's margin notes do, because a pin dropped mid-sentence covers the
 * words it is about. The card prefers the empty margin on the right, and only
 * falls back to floating over the text when the window is too narrow for that.
 */
export function spotFor(
  rect: { top: number; left: number; width: number; height: number },
  origin: { top: number; left: number },
  type: AnchorType,
  layout: SpotLayout,
): Spot {
  const popWidth = layout.popWidth ?? 312;
  const top = rect.top - origin.top + (type === "range" ? rect.height : 0);
  const left = Math.max(layout.contentLeft - origin.left - PIN_GUTTER, 2);

  const inRightMargin = layout.contentRight + 16;
  const fitsRight = inRightMargin + popWidth <= layout.viewportWidth - 12;
  const overText = origin.left + left + PIN_GUTTER;
  const clampedOverText = Math.min(overText, layout.viewportWidth - 12 - popWidth);

  const popLeftViewport = fitsRight ? inRightMargin : Math.max(clampedOverText, 12);
  return {
    top,
    left,
    flipped: !fitsRight,
    popTop: Math.max(top - 14, 4),
    popLeft: popLeftViewport - origin.left,
  };
}

/**
 * Nudge pins apart when two anchors land on the same line, so a stack of
 * comments in one paragraph stays clickable.
 */
export function spreadPins<T extends { top: number }>(pins: T[], minGap = 30): T[] {
  const sorted = [...pins].sort((a, b) => a.top - b.top);
  let last = -Infinity;
  for (const pin of sorted) {
    if (pin.top - last < minGap) pin.top = last + minGap;
    last = pin.top;
  }
  return sorted;
}
