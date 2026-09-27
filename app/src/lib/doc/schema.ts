import { Extension, getSchema, mergeAttributes, Node, type AnyExtension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Blockquote from "@tiptap/extension-blockquote";
import HardBreak from "@tiptap/extension-hard-break";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { badgeClass, BlockError, parseTableBlock } from "@/lib/pipeline/parse";
import { parseChartBlock } from "@/lib/pipeline/chart";
import { parseStoryBlock, StoryBlockError } from "@/lib/storybook/spec";

/**
 * The document schema, shared by the server (markdown in and out) and the
 * browser (viewing and editing). Every node renders the same tags the markdown
 * pipeline emits, so theme CSS and the <art-*> primitives apply unchanged.
 *
 * Nothing here touches the DOM at import time; node views live in ./views.
 */

/** Top-level blocks carry where they came from, so an untouched block is written back as it was. */
export const TOP_LEVEL = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "callout",
  "card",
  "details",
  "columns",
  "tabs",
  "timeline",
  "kpis",
  "chart",
  "dataTable",
  "embed",
  "field",
  "choice",
  "rawBlock",
] as const;

/** Attributes that describe a block's origin rather than its content. */
export const ORIGIN_ATTRS = ["src", "fp", "lines", "gap"] as const;

const Origin = Extension.create({
  name: "origin",
  addGlobalAttributes() {
    const origin = { default: null, rendered: false, keepOnSplit: false };
    return [
      {
        types: [...TOP_LEVEL],
        attributes: { src: origin, fp: origin, lines: origin, gap: origin },
      },
    ];
  },
});

export interface OriginAttrs {
  /** The block's markdown exactly as written, or null for a block made in the editor. */
  src: string | null;
  /** Fingerprint of the content `src` parsed to. A mismatch means the block was edited. */
  fp: string | null;
  /** First and last source line, 1-based. */
  lines: [number, number] | null;
  /** The lines between the previous block and this one; null means one blank line. */
  gap: string[] | null;
}

// ---------------------------------------------------------------- containers

/** A directive block with free content, rendered as its <art-*> element. */
function container(name: string, tag: string, content = "block+", keys: string[] = [], flags: string[] = []) {
  return Node.create({
    name,
    group: name === "col" || name === "tab" || name === "option" || name === "event" ? undefined : "block",
    content,
    defining: true,
    addAttributes() {
      return { attributes: { default: {}, rendered: false } };
    },
    parseHTML() {
      return [{ tag }];
    },
    renderHTML({ node }) {
      const a = (node.attrs.attributes ?? {}) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const key of keys) if (a[key] !== undefined && a[key] !== "") out[key] = String(a[key]);
      // A switch is written bare ({compact}), which reads as an empty value.
      for (const key of flags) if (a[key] !== undefined && a[key] !== "false") out[key] = "true";
      return [tag, out, 0];
    },
  });
}

export const Callout = container("callout", "art-callout", "block+", ["tone", "title"]);
export const Card = container("card", "art-card", "block+", ["title", "subtitle"]);
export const Details = container("details", "art-details", "block+", ["summary", "open"]);
export const Columns = container("columns", "art-columns", "col+", ["n"], ["compact", "aside"]);
export const Col = container("col", "art-col", "block+");
export const Tabs = container("tabs", "art-tabs", "tab+");
export const Tab = container("tab", "art-tab", "block+", ["label"]);
/** A dated list of events: `:::timeline{legend="good:Shipped, bad:Outage"}` holding `:::event`s. */
export const Timeline = container("timeline", "art-timeline", "event+", ["legend"]);
/** One entry: `:::event{date="Mar 2024" title="..." kind=good source="..."}`, its body any blocks. */
export const TimelineEvent = container("event", "art-event", "block+", ["date", "title", "kind", "source"]);

// -------------------------------------------------------------------- inline

/** `:badge[Recommended]{tone=good}`: a short label, drawn like a stamp. */
export const Badge = Node.create({
  name: "badge",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { label: { default: "", rendered: false }, attributes: { default: {}, rendered: false } };
  },
  parseHTML() {
    return [{ tag: "span.art-badge" }];
  },
  renderHTML({ node }) {
    const a = (node.attrs.attributes ?? {}) as Record<string, string>;
    return ["span", { class: badgeClass(a.tone) }, String(node.attrs.label ?? "")];
  },
  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },
});

// --------------------------------------------------------------------- forms

/** A question: `::field{name=why type=textarea label="Why?" required}`. */
export const Field = Node.create({
  name: "field",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { attributes: { default: {}, rendered: false } };
  },
  renderHTML({ node }) {
    const a = (node.attrs.attributes ?? {}) as Record<string, string>;
    return ["div", { class: "art-field", "data-name": a.name ?? "" }, ["label", {}, a.label ?? a.name ?? ""]];
  },
});

/** A question answered by picking rich options: `:::choice{name=… label=…}`. */
export const Choice = container("choice", "art-choice", "option+", ["name", "label"]);
/** One pickable option; its content is any blocks, so it can hold images and frames. */
export const ChoiceOption = container("option", "art-option", "block+", ["value", "label"]);

// --------------------------------------------------------------------- atoms

export interface KpiItem {
  label: string;
  value: string;
  tone?: string | null;
  delta?: string | null;
  note?: string | null;
  trend?: string | null;
}

export const Kpis = Node.create({
  name: "kpis",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { items: { default: [], rendered: false } };
  },
  parseHTML() {
    return [{ tag: "art-kpis" }];
  },
  renderHTML({ node }) {
    const items = (node.attrs.items ?? []) as KpiItem[];
    return [
      "art-kpis",
      {},
      ...items.map((k) => {
        const attrs: Record<string, string> = { label: k.label, value: k.value };
        if (k.tone) attrs.tone = k.tone;
        if (k.delta) attrs.delta = k.delta;
        if (k.note) attrs.note = k.note;
        if (k.trend) attrs.trend = k.trend;
        return ["art-kpi", attrs] as [string, Record<string, string>];
      }),
    ];
  },
});

/** A fenced block that renders from its text: chart, table or an embed. */
function fenced(name: string, render: (code: string, attrs: Record<string, unknown>) => [string, Record<string, string>, ...unknown[]]) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        code: { default: "", rendered: false },
        meta: { default: null, rendered: false },
        kind: { default: null, rendered: false },
        embedId: { default: null, rendered: false },
      };
    },
    renderHTML({ node }) {
      // Inside a <pre>, like the pipeline's output for the fence it was written as.
      return ["pre", {}, render(String(node.attrs.code ?? ""), node.attrs)] as never;
    },
  });
}

function errorOf(err: unknown, lang: string): [string, Record<string, string>, string] {
  const message = err instanceof BlockError ? err.message : `${lang} block failed: ${(err as Error).message}`;
  return ["art-error", {}, message];
}

export const Chart = fenced("chart", (code) => {
  try {
    return ["art-chart", { "data-chart": JSON.stringify(parseChartBlock(code)) }];
  } catch (err) {
    return errorOf(err, "chart");
  }
});

export const DataTable = fenced("dataTable", (code) => {
  try {
    return ["art-table", { "data-table": JSON.stringify(parseTableBlock(code)) }];
  } catch (err) {
    return errorOf(err, "table");
  }
});

export const Embed = fenced("embed", (code, attrs) => {
  const base = { "data-embed": String(attrs.embedId ?? ""), "data-kind": String(attrs.kind ?? "html") };
  if (attrs.kind !== "story") return ["art-embed", base];
  try {
    const spec = parseStoryBlock(code);
    const out: Record<string, string> = { ...base, "data-title": spec.title ?? spec.id };
    if (spec.width) out["data-width"] = String(spec.width);
    if (spec.height) out["data-height"] = String(spec.height);
    return ["art-embed", out];
  } catch (err) {
    return ["art-error", {}, err instanceof StoryBlockError ? err.message : `story block failed: ${(err as Error).message}`];
  }
});

/**
 * Markdown the schema does not model: kept as written, shown as the pipeline
 * renders it. Opening a document never changes a block it cannot represent.
 */
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: "", rendered: false } };
  },
  renderHTML() {
    // The view fills this from the pipeline's HTML; see ./views.
    return ["div", { "data-raw": "" }];
  },
});

// ------------------------------------------------------------ inline, lists

/** Markdown images sit inside text, so the node is inline. */
export const Image = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addOptions() {
    return { assetBase: null as string | null };
  },
  addAttributes() {
    return { src: { default: "" }, alt: { default: null }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ node }) {
    return ["img", { src: resolveUrl(String(node.attrs.src), this.options.assetBase, "src"), alt: node.attrs.alt ?? "", title: node.attrs.title ?? undefined, loading: "lazy" }];
  },
});

const SAFE = { src: /^(https?:|\/)/i, href: /^(https?:|mailto:|#|\/)/i };

/** The pipeline's asset rewrite and protocol allow-list, for URLs the schema renders. */
export function resolveUrl(url: string, assetBase: string | null, kind: "src" | "href"): string {
  if (url.startsWith("assets/") && assetBase) return `${assetBase.replace(/\/$/, "")}/${url.slice(7)}`;
  return SAFE[kind].test(url) ? url : "";
}

const Spread = { spread: { default: false, rendered: false } };

const Bullet = BulletList.extend({
  addAttributes() {
    return { ...Spread, tight: { default: null, renderHTML: (a: { spread?: boolean }) => (a.spread ? {} : { "data-tight": "" }) } };
  },
});
const Ordered = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...Spread, tight: { default: null, renderHTML: (a: { spread?: boolean }) => (a.spread ? {} : { "data-tight": "" }) } };
  },
});
const Item = ListItem.extend({ addAttributes: () => ({ ...Spread }) });
const Tasks = TaskList.extend({ addAttributes: () => ({ ...Spread }) });
/** taskKey is where people's ticks are stored; it is worked out from the words, never written. */
const TaskKey = { taskKey: { default: null, rendered: false, keepOnSplit: false } };
export const TaskEntry = TaskItem.extend({ addAttributes() { return { ...this.parent?.(), ...Spread, ...TaskKey }; } }).configure({ nested: true });

const Align = {
  align: {
    default: null,
    renderHTML: (a: { align?: string | null }) => (a.align ? { style: `text-align: ${a.align}` } : {}),
  },
};
const Cell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...Align }; } });
const HeaderCell = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...Align }; } });

/** Code in markdown can sit inside a link or emphasis; the default excludes every other mark. */
const InlineCode = Code.extend({ excludes: "" });

const Fence = CodeBlock.extend({
  addAttributes() {
    return { ...this.parent?.(), meta: { default: null, rendered: false } };
  },
});

const Anchor = Link.extend({
  addAttributes() {
    return { ...this.parent?.(), title: { default: null } };
  },
}).configure({ openOnClick: false, autolink: false, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: null } });

// ------------------------------------------------------------ block numbers

/**
 * Stamp data-block and data-lines on every top-level block, numbered the way
 * the pipeline numbers them, so comment anchors resolve against either.
 */
export const BlockIds = Extension.create({
  name: "blockIds",
  addProseMirrorPlugins() {
    const key = new PluginKey("blockIds");
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => blockDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? blockDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

function blockDecorations(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  let index = 0;
  doc.forEach((node, offset) => {
    if (node.type.name === "rawBlock" && !node.attrs.html) return;
    const lines = node.attrs.lines as [number, number] | null;
    const attrs: Record<string, string> = { "data-block": `b${index++}` };
    if (lines) attrs["data-lines"] = `${lines[0]}-${lines[1]}`;
    out.push(Decoration.node(offset, offset + node.nodeSize, attrs));
  });
  return DecorationSet.create(doc, out);
}

// -------------------------------------------------------------------- schema

export interface DocOptions {
  assetBase?: string | null;
}

export function docExtensions(options: DocOptions = {}): AnyExtension[] {
  return [
    Document.extend({
      addAttributes: () => ({
        front: { default: null, rendered: false },
        tail: { default: null, rendered: false },
      }),
    }),
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Bold,
    Italic,
    Strike,
    InlineCode,
    Fence.configure({ HTMLAttributes: {} }),
    Blockquote,
    HardBreak,
    HorizontalRule,
    Anchor.configure({
      isAllowedUri: (url: string) => SAFE.href.test(url) || url.startsWith("assets/"),
    }),
    Bullet,
    Ordered,
    Item,
    Tasks,
    TaskEntry,
    Table.configure({ resizable: false, renderWrapper: false }),
    TableRow,
    Cell,
    HeaderCell,
    Image.configure({ assetBase: options.assetBase ?? null }),
    Callout,
    Card,
    Details,
    Columns,
    Col,
    Tabs,
    Tab,
    Timeline,
    TimelineEvent,
    Badge,
    Field,
    Choice,
    ChoiceOption,
    Kpis,
    Chart,
    DataTable,
    Embed,
    RawBlock,
    Origin,
    BlockIds,
  ];
}

let cached: Schema | null = null;

/** The schema, for parsing and serialising outside an editor. */
export function docSchema(): Schema {
  cached ??= getSchema(docExtensions());
  return cached;
}

export { mergeAttributes };
