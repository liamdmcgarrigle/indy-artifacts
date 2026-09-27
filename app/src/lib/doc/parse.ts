import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";
import { toString as mdToString } from "mdast-util-to-string";
import type { JSONContent } from "@tiptap/core";
import { normalizeContainers } from "@/lib/pipeline/normalize";
import { parseKpiLine } from "@/lib/pipeline/parse";
import { docSchema, type KpiItem } from "./schema";
import { fingerprint } from "./fingerprint";

// mdast nodes are read structurally; the directive and gfm node types are not
// all in one published union.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Md = any;

/** Raised inside a conversion when a block holds something the schema cannot model. */
class Unmodelled extends Error {}

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).use(remarkDirective);

/** Container directives the schema models, with the parent each must sit in. */
const CONTAINERS: Record<string, { node: string; parent?: string; children?: string }> = {
  callout: { node: "callout" },
  card: { node: "card" },
  details: { node: "details" },
  columns: { node: "columns", children: "col" },
  col: { node: "col", parent: "columns" },
  tabs: { node: "tabs", children: "tab" },
  tab: { node: "tab", parent: "tabs" },
  choice: { node: "choice", children: "option" },
  option: { node: "option", parent: "choice" },
};

const EMBED_LANGS = new Set(["html", "mermaid", "story"]);

interface Ctx {
  source: string;
}

// ------------------------------------------------------------------- inline

function marksOf(stack: JSONContent["marks"]) {
  return stack && stack.length ? stack.map((m) => ({ ...m })) : undefined;
}

function inline(nodes: Md[], ctx: Ctx, marks: NonNullable<JSONContent["marks"]> = []): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        // A soft line break is a space when read; the editor would show it as a break.
        if (node.value) out.push({ type: "text", text: node.value.replace(/[ \t]*\n[ \t]*/g, " "), marks: marksOf(marks) });
        break;
      case "strong":
        out.push(...inline(node.children, ctx, [...marks, { type: "bold" }]));
        break;
      case "emphasis":
        out.push(...inline(node.children, ctx, [...marks, { type: "italic" }]));
        break;
      case "delete":
        out.push(...inline(node.children, ctx, [...marks, { type: "strike" }]));
        break;
      case "inlineCode":
        if (node.value) out.push({ type: "text", text: node.value, marks: marksOf([...marks, { type: "code" }]) });
        break;
      case "link":
        out.push(...inline(node.children, ctx, [...marks, { type: "link", attrs: { href: node.url, title: node.title ?? null } }]));
        break;
      case "image":
        out.push({ type: "image", attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null }, marks: marksOf(marks) });
        break;
      case "break":
        out.push({ type: "hardBreak", marks: marksOf(marks) });
        break;
      case "textDirective": {
        // The pipeline shows an inline directive as the text that was typed.
        const text = ctx.source.slice(node.position.start.offset, node.position.end.offset);
        if (text) out.push({ type: "text", text, marks: marksOf(marks) });
        break;
      }
      default:
        throw new Unmodelled(node.type);
    }
  }
  return merge(out);
}

/** Join neighbouring text nodes with the same marks, the way ProseMirror would. */
function merge(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (last && last.type === "text" && node.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      last.text = (last.text ?? "") + (node.text ?? "");
    } else out.push(node);
  }
  return out;
}

function paragraph(children: Md[], ctx: Ctx): JSONContent {
  const content = inline(children, ctx);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

// -------------------------------------------------------------------- block

function blocks(nodes: Md[], ctx: Ctx, parent?: string): JSONContent[] {
  const out = nodes.map((n) => block(n, ctx, parent));
  return out.length ? out : [{ type: "paragraph" }];
}

function block(node: Md, ctx: Ctx, parent?: string): JSONContent {
  switch (node.type) {
    case "paragraph":
      return paragraph(node.children, ctx);
    case "heading":
      return { type: "heading", attrs: { level: node.depth }, content: inline(node.children, ctx) };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "blockquote":
      return { type: "blockquote", content: blocks(node.children, ctx) };
    case "list":
      return list(node, ctx);
    case "code":
      return code(node);
    case "table":
      return table(node, ctx);
    case "containerDirective":
      return directive(node, ctx, parent);
    case "leafDirective":
      if (node.name === "field" && !node.children?.length) return { type: "field", attrs: { attributes: { ...(node.attributes ?? {}) } } };
      throw new Unmodelled(`leaf directive ${node.name}`);
    default:
      throw new Unmodelled(node.type);
  }
}

function list(node: Md, ctx: Ctx): JSONContent {
  const items: Md[] = node.children;
  const tasks = items.filter((i) => typeof i.checked === "boolean").length;
  if (tasks && tasks !== items.length) throw new Unmodelled("mixed task list");
  const content = items.map((i) => ({
    type: tasks ? "taskItem" : "listItem",
    attrs: tasks ? { checked: i.checked, spread: !!i.spread } : { spread: !!i.spread },
    content: blocks(i.children, ctx),
  }));
  // A list item must open with a paragraph in the editor's schema.
  for (const item of content) if (item.content[0].type !== "paragraph") throw new Unmodelled("list item without a paragraph");
  if (tasks) return { type: "taskList", attrs: { spread: !!node.spread }, content };
  return node.ordered
    ? { type: "orderedList", attrs: { start: node.start ?? 1, spread: !!node.spread }, content }
    : { type: "bulletList", attrs: { spread: !!node.spread }, content };
}

let embedCounter = 0;

function code(node: Md): JSONContent {
  const lang = String(node.lang ?? "").toLowerCase();
  const attrs = { code: node.value ?? "", meta: node.meta ?? null };
  if (lang === "chart") return { type: "chart", attrs };
  if (lang === "table") return { type: "dataTable", attrs };
  if (EMBED_LANGS.has(lang)) return { type: "embed", attrs: { ...attrs, kind: lang, embedId: node.data?.embedId ?? null } };
  const text = node.value ?? "";
  return {
    type: "codeBlock",
    attrs: { language: node.lang ?? null, meta: node.meta ?? null },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
}

function table(node: Md, ctx: Ctx): JSONContent {
  const align: (string | null)[] = node.align ?? [];
  return {
    type: "table",
    content: node.children.map((row: Md, r: number) => ({
      type: "tableRow",
      content: row.children.map((cell: Md, c: number) => ({
        type: r === 0 ? "tableHeader" : "tableCell",
        attrs: { align: align[c] ?? null },
        content: [paragraph(cell.children, ctx)],
      })),
    })),
  };
}

function directive(node: Md, ctx: Ctx, parent?: string): JSONContent {
  if (node.name === "kpis") return kpis(node);
  const spec = CONTAINERS[node.name];
  if (!spec) throw new Unmodelled(`directive ${node.name}`);
  if (spec.parent && parent !== spec.parent) throw new Unmodelled(`${node.name} inside ${parent ?? "the page"}`);
  // A [label] becomes the first child paragraph; the schema has nowhere to keep it.
  if (node.children.some((c: Md) => c.data?.directiveLabel)) throw new Unmodelled("directive label");
  const children: Md[] = node.children;
  if (spec.children && !children.every((c) => c.type === "containerDirective" && c.name === spec.children))
    throw new Unmodelled(`${node.name} holding something other than ${spec.children}`);
  if (spec.children && !children.length) throw new Unmodelled(`empty ${node.name}`);
  return {
    type: spec.node,
    attrs: { attributes: { ...(node.attributes ?? {}) } },
    content: spec.children ? children.map((c) => directive(c, ctx, node.name)) : blocks(children, ctx, node.name),
  };
}

function kpis(node: Md): JSONContent {
  const items: KpiItem[] = [];
  visit(node, "listItem", (item: Md) => {
    const parsed = parseKpiLine(mdToString(item));
    if (parsed) items.push({ label: parsed.label, value: parsed.value, tone: parsed.tone ?? null, delta: parsed.delta ?? null });
  });
  return { type: "kpis", attrs: { items } };
}

// ----------------------------------------------------------------- document

/**
 * Markdown to a document. Each top-level block keeps its lines, its exact
 * source and a fingerprint of what that source parsed to, so serialising an
 * unedited document gives back the same bytes.
 */
export function markdownToDoc(markdown: string): JSONContent {
  const lines = markdown.split("\n");
  const normalized = normalizeContainers(markdown).source;
  const tree = parser.parse(normalized) as Md;
  const ctx: Ctx = { source: normalized };

  // Number embeds in the order the pipeline does, so the frame URLs match.
  embedCounter = 0;
  visit(tree, "code", (node: Md) => {
    if (EMBED_LANGS.has(String(node.lang ?? "").toLowerCase())) {
      node.data = { ...(node.data ?? {}), embedId: `e${embedCounter++}` };
    }
  });

  let front: string[] | null = null;
  let cursor = 0; // lines consumed so far
  const content: JSONContent[] = [];

  for (const child of tree.children as Md[]) {
    const start = child.position.start.line; // 1-based
    const end = child.position.end.line;
    if (child.type === "yaml" && front === null && content.length === 0) {
      front = lines.slice(0, end);
      cursor = end;
      continue;
    }
    // Two blocks can end and start on one line only in malformed input; keep
    // them together as one raw block rather than duplicating the line.
    if (start <= cursor) {
      const prev = content[content.length - 1];
      if (prev) {
        const prevLines = prev.attrs!.lines as [number, number];
        const src = lines.slice(prevLines[0] - 1, end).join("\n");
        content[content.length - 1] = { type: "rawBlock", attrs: { ...prev.attrs, src, lines: [prevLines[0], end] } };
        cursor = end;
        continue;
      }
    }
    const src = lines.slice(start - 1, end).join("\n");
    const gap = lines.slice(cursor, start - 1);
    let node: JSONContent;
    try {
      node = child.type === "yaml" ? { type: "rawBlock" } : block(child, ctx);
    } catch (err) {
      if (!(err instanceof Unmodelled)) throw err;
      node = { type: "rawBlock" };
    }
    // null stands for the usual one blank line between blocks. The first
    // block has no block before it, so its gap is always kept as it is.
    const usual = content.length > 0 && gap.length === 1 && gap[0] === "";
    node.attrs = { ...(node.attrs ?? {}), src, lines: [start, end], gap: usual ? null : gap };
    content.push(node);
    cursor = end;
  }

  const tail = lines.slice(cursor);
  const doc: JSONContent = {
    type: "doc",
    attrs: { front, tail: tail.length === 1 && tail[0] === "" ? null : tail },
    content: content.length ? content : [{ type: "rawBlock", attrs: { src: null, lines: null, gap: [] } }],
  };

  // Normalise through the schema, then fingerprint what each block became.
  // ProseMirror builds attrs on null-prototype objects; hand back plain JSON.
  const normal = JSON.parse(JSON.stringify(docSchema().nodeFromJSON(doc).toJSON())) as JSONContent;
  for (const node of normal.content ?? []) {
    if (node.attrs?.src !== null) node.attrs!.fp = fingerprint(node);
  }
  return normal;
}
