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

/**
 * Is there a character under this point? The caret APIs snap to the nearest
 * text even from empty space, so check the character's own box.
 */
export function isOverText(x: number, y: number): boolean {
  const caret = caretAt(x, y);
  if (!caret || caret.offsetNode.nodeType !== 3) return false;
  const text = caret.offsetNode as Text;
  const range = document.createRange();
  for (const at of [caret.offset - 1, caret.offset]) {
    if (at < 0 || at >= text.data.length) continue;
    range.setStart(text, at);
    range.setEnd(text, at + 1);
    for (const r of Array.from(range.getClientRects())) {
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return true;
    }
  }
  return false;
}

const KIND_NAMES: Record<string, string> = {
  "ART-KPI": "tile",
  "ART-CHART": "chart",
  "ART-EMBED": "embed",
  IMG: "image",
  TR: "row",
  LI: "list item",
  P: "paragraph",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  PRE: "block",
  BLOCKQUOTE: "quote",
  "ART-CALLOUT": "callout",
  "ART-CARD": "card",
  "ART-COL": "column",
  "ART-DETAILS": "section",
};

/** A word for what was picked: "tile", "row", "chart". */
export function kindName(el: HTMLElement): string {
  if (el.matches("pre:has(> art-chart)")) return "chart";
  if (el.matches("pre:has(> art-table)")) return "table";
  if (el.tagName === "ART-KPIS") return "row of tiles";
  return KIND_NAMES[el.tagName] ?? "block";
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
  /** For an element anchor, the whole element, so it can be outlined. */
  box?: DOMRect;
}

/**
 * The smallest thing worth commenting on under the pointer: a counter tile, a
 * table row, a list item, an image, a paragraph. Innermost first, since
 * closest() walks outwards and stops at the first match.
 */
const PICKABLE = [
  "art-kpi",
  "art-chart",
  "art-embed",
  "img",
  "tr",
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "art-callout",
  "art-card",
  "art-col",
  "art-details",
  "art-event",
  "[data-block]",
].join(",");

/** Elements whose words are the point: a click in them marks a spot in the text. */
const TEXTUAL = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

export function pickTarget(root: HTMLElement, node: Element | null): HTMLElement | null {
  const el = node?.closest<HTMLElement>(PICKABLE) ?? null;
  return el && root.contains(el) && blockOf(el) ? el : null;
}

/** A path from a block down to one of its elements, to find it again later. */
export function pathWithin(block: HTMLElement, el: HTMLElement): string | undefined {
  if (el === block) return undefined;
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== block) {
    const tag = node.tagName.toLowerCase();
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return undefined;
    const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(`${tag}:nth-of-type(${same.indexOf(node) + 1})`);
    node = parent;
  }
  return node === block ? `:scope > ${parts.join(" > ")}` : undefined;
}

/**
 * A comment on a picked element. Inside running text it marks the exact spot;
 * on a tile, a chart, an image or a row it pins the element itself, with the
 * point clicked inside it and the words it holds as the quote.
 */
export function anchorFromPick(root: HTMLElement, el: HTMLElement, clientX: number, clientY: number): Anchor | null {
  const block = blockOf(el);
  if (!block || !root.contains(block)) return null;
  if (TEXTUAL.has(el.tagName)) {
    const point = anchorFromPoint(root, clientX, clientY);
    if (point?.type === "point") return point;
  }
  const rect = el.getBoundingClientRect();
  const text = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  return anchorForBlock(block, {
    selector: pathWithin(block, el),
    quote: text ? truncate(text, 200) : undefined,
    x: rect.width ? Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) : 0.5,
    y: rect.height ? Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1) : 0.5,
  });
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
    const caretAt = Math.min(CONTEXT_CHARS, anchor.context.length);
    for (const scope of block ? [block, root] : [root]) {
      const found = locateContext(blockText(scope), anchor.context, caretAt);
      if (!found) continue;
      const rect = rectOfRange(scope, Math.max(found.offset - 1, 0), found.offset);
      if (rect) return { rect, exact: found.exact && scope === block };
    }
  }

  if (anchor.type === "point" && block && typeof anchor.offset === "number") {
    const rect = rectOfRange(block, Math.max(anchor.offset - 1, 0), anchor.offset);
    if (rect) return { rect, exact: false };
  }

  if (block) {
    // A picked element inside the block; frame selectors (no :scope) point into
    // the frame's own document and are not ours to resolve.
    const inner = anchor.selector?.startsWith(":scope") ? block.querySelector<HTMLElement>(anchor.selector) : null;
    const target = inner ?? block;
    const rect = target.getBoundingClientRect();
    if (anchor.type === "element" && typeof anchor.x === "number" && typeof anchor.y === "number") {
      const point = new DOMRect(rect.left + rect.width * anchor.x, rect.top + rect.height * anchor.y, 0, 0);
      return { rect: point, exact: !anchor.selector || !!inner || !anchor.selector.startsWith(":scope"), box: rect };
    }
    return { rect, exact: anchor.type === "element", box: anchor.type === "element" ? rect : undefined };
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

  // The quoted words were edited. Keep the part that survived: the longest
  // prefix of the selection still on the page marks roughly the same spot.
  const trimmed = quote.trim();
  for (let length = trimmed.length - STEP; length >= MIN_MATCH; length -= STEP) {
    const index = text.indexOf(trimmed.slice(0, length));
    if (index !== -1) return { from: index, to: index + length };
  }
  return null;
}

const MIN_MATCH = 12;
const STEP = 3;

/**
 * Find the point an anchor marks inside `text`, given the words that were
 * around it when the comment was written and where in that run the caret sat.
 *
 * An exact hit is the normal case. When the sentence has been edited since,
 * the stored run no longer appears, so this gives up characters from whichever
 * side changed until what is left matches again. The pin lands beside the words
 * that survived rather than collapsing to the top of the block.
 */
export function locateContext(
  text: string,
  context: string,
  caretAt: number,
): { offset: number; exact: boolean } | null {
  if (!text || !context) return null;

  const at = text.indexOf(context);
  if (at !== -1) return { offset: at + caretAt, exact: true };

  const lower = text.toLowerCase();
  const needle = context.toLowerCase();
  const loose = lower.indexOf(needle);
  if (loose !== -1) return { offset: loose + caretAt, exact: false };

  // Drop from the tail first, which keeps the words leading up to the caret.
  for (let end = needle.length - STEP; end > caretAt && end >= MIN_MATCH; end -= STEP) {
    const index = lower.indexOf(needle.slice(0, end));
    if (index !== -1) return { offset: index + caretAt, exact: false };
  }

  // Then exactly the run up to the caret, in case the step above stepped over it.
  if (caretAt >= MIN_MATCH) {
    const index = lower.indexOf(needle.slice(0, caretAt));
    if (index !== -1) return { offset: index + caretAt, exact: false };
  }

  // Then from the head, which keeps the words just after it.
  for (let start = STEP; start < caretAt && needle.length - start >= MIN_MATCH; start += STEP) {
    const index = lower.indexOf(needle.slice(start));
    if (index !== -1) return { offset: index + (caretAt - start), exact: false };
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

const PIN_GUTTER = 42;
const POP_GAP = 14;

/**
 * Turn an anchor's viewport rect into overlay coordinates.
 *
 * Pins live in the margin beside the text rather than on top of it, the way a
 * document's margin notes do, because a pin dropped mid-sentence covers the
 * words it is about. The card is the opposite: it opens on the spot, beside
 * the words it belongs to, and floats over the page the way a comment does in
 * Figma. Only the window edges move it.
 */
export function spotFor(
  rect: { top: number; left: number; width: number; height: number },
  origin: { top: number; left: number },
  type: AnchorType,
  layout: SpotLayout,
): Spot {
  const popWidth = layout.popWidth ?? 312;
  const top = rect.top - origin.top + (type === "range" ? rect.height : 0);
  // The text column often fills its own container, so the gutter the pin wants
  // is outside it. Let the pin go negative and clamp against the window rather
  // than the column, which is what keeps it off the words.
  const left = Math.max(layout.contentLeft - origin.left - PIN_GUTTER, 8 - origin.left);

  // A selection gets its card underneath, lined up with where the words start,
  // the way a comment hangs off a highlight. A point gets it beside the caret.
  // Either way it lands on the spot; only the window edges move it.
  const range = type === "range";
  const wanted = range ? rect.left : rect.left + rect.width + POP_GAP;
  const rightmost = Math.max(layout.viewportWidth - 12 - popWidth, 12);
  const onScreen = Math.min(Math.max(wanted, 12), rightmost);

  return {
    top,
    left,
    popTop: range ? top + 8 : Math.max(top - 10, 4),
    popLeft: onScreen - origin.left,
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
