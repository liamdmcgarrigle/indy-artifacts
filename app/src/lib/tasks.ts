/**
 * Task-list items (`- [ ] text`) and the keys people's ticks are stored under.
 *
 * A tick belongs to an item's words, not to a line number, so a new version
 * that keeps the words keeps the tick. The key is the item's own text,
 * normalised, with a count for the second and later items that read the same.
 *
 * The same mdast walk stamps the key on the editor document and on the
 * pipeline's HTML, and the service reads the list from here, so all three
 * agree without matching anything up by position.
 */

// mdast is walked structurally; directive and gfm nodes are not all in one union.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Md = any;

/** Keys stop growing past this; items that share their first words are told apart by count. */
const KEY_CHARS = 400;

/** Directive containers whose content the page shows. Anything else drops or replaces its children. */
const SHOWN = new Set(["callout", "card", "details", "columns", "col", "tabs", "tab", "choice", "option", "timeline", "event"]);

export interface TaskItem {
  key: string;
  /** The item's words as written, plain text, for people and agents to read. */
  text: string;
  /** Ticked in the source (`- [x]`): the author's default. */
  checked: boolean;
  /** First source line of the item, 1-based. */
  line: number;
}

export function normaliseTaskText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The plain words of inline markdown, as the page shows them. */
function inlineText(nodes: Md[], source: string): string {
  let out = "";
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
      case "inlineCode":
        out += node.value ?? "";
        break;
      case "break":
        out += " ";
        break;
      case "textDirective": {
        // Shown as typed, so read as typed.
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (typeof start === "number" && typeof end === "number") out += source.slice(start, end);
        break;
      }
      case "html":
      case "image":
      case "imageReference":
      case "footnoteReference":
        break;
      default:
        if (Array.isArray(node.children)) out += inlineText(node.children, source);
    }
  }
  return out;
}

/** An item's own words: its blocks, but not the lists nested under it. */
function itemText(item: Md, source: string): string {
  const parts: string[] = [];
  for (const child of item.children ?? []) {
    if (child.type === "list") continue;
    if (child.type === "paragraph" || child.type === "heading") parts.push(inlineText(child.children, source));
    else if (child.type === "code") parts.push(child.value ?? "");
    else if (Array.isArray(child.children)) parts.push(inlineText(child.children, source));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Every task item the page shows, in document order, each with its key.
 * `source` is the text the tree was parsed from (after container
 * normalisation), used for inline directives, which show as typed.
 */
export function collectTasks(tree: Md, source: string): { node: Md; item: TaskItem }[] {
  const out: { node: Md; item: TaskItem }[] = [];
  const seen = new Map<string, number>();
  const walk = (node: Md) => {
    if (node.type === "containerDirective" && !SHOWN.has(node.name)) return;
    if (node.type === "leafDirective" || node.type === "code" || node.type === "html") return;
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const text = itemText(node, source);
      const base = normaliseTaskText(text).slice(0, KEY_CHARS);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({
        node,
        // A no-break space never survives normalisation, so a count cannot collide with words.
        item: { key: n === 0 ? base : `${base}\u00a0#${n + 1}`, text, checked: node.checked, line: node.position?.start?.line ?? 0 },
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

/** Whoever ticked or unticked an item. */
export interface TickView {
  key: string;
  checked: boolean;
  byKind: "owner" | "visitor" | "agent";
  byName: string;
  at: string;
  /** Visitors only: whether the email behind the name was confirmed by code. */
  verified?: boolean;
}

export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return first.toUpperCase();
}

/** "2m ago", "3h ago", "27 Sep": short enough to sit beside an item. */
export function tickAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
