import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { directiveToMarkdown } from "mdast-util-directive";
import type { JSONContent } from "@tiptap/core";
import { docSchema, type KpiItem } from "./schema";
import { fingerprint } from "./fingerprint";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Md = any;
type Mark = NonNullable<JSONContent["marks"]>[number];

// ------------------------------------------------------------------- inline

/** Marks from the outside in: a link wraps emphasis, never the other way round. */
const MARK_ORDER = ["link", "bold", "italic", "strike"] as const;
const MD_MARK: Record<string, string> = { bold: "strong", italic: "emphasis", strike: "delete" };

const sameMark = (a: Mark, b: Mark) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

function leaf(node: JSONContent): Md {
  if (node.type === "hardBreak") return { type: "break" };
  if (node.type === "image") return { type: "image", url: node.attrs?.src ?? "", alt: node.attrs?.alt ?? "", title: node.attrs?.title ?? null };
  const code = (node.marks ?? []).some((m) => m.type === "code");
  return code ? { type: "inlineCode", value: node.text ?? "" } : { type: "text", value: node.text ?? "" };
}

/**
 * Rebuild mdast's nested phrasing from ProseMirror's flat marked text: take
 * the outermost mark of the first node, wrap the longest run that shares it,
 * and recurse inside with that mark done.
 */
function phrasing(nodes: JSONContent[], done: Mark[] = []): Md[] {
  const out: Md[] = [];
  let i = 0;
  while (i < nodes.length) {
    const marks = (nodes[i].marks ?? []).filter((m) => m.type !== "code" && !done.some((d) => sameMark(d, m)));
    const outer = MARK_ORDER.map((t) => marks.find((m) => m.type === t)).find(Boolean);
    if (!outer) {
      out.push(leaf(nodes[i]));
      i++;
      continue;
    }
    let j = i + 1;
    while (j < nodes.length && (nodes[j].marks ?? []).some((m) => sameMark(m, outer))) j++;
    const children = phrasing(nodes.slice(i, j), [...done, outer]);
    out.push(
      outer.type === "link"
        ? { type: "link", url: outer.attrs?.href ?? "", title: outer.attrs?.title ?? null, children }
        : { type: MD_MARK[outer.type], children },
    );
    i = j;
  }
  return out;
}

// -------------------------------------------------------------------- block

function kpiLine(k: KpiItem): string {
  let line = k.value ? `${k.label}: ${k.value}` : k.label;
  if (k.delta) line += ` (${k.delta})`;
  if (k.tone) line += ` {tone=${k.tone}}`;
  return line;
}

function blocks(nodes: JSONContent[] | undefined): Md[] {
  return (nodes ?? []).map(block);
}

function cellPhrasing(cell: JSONContent): Md[] {
  const out: Md[] = [];
  for (const [i, para] of (cell.content ?? []).entries()) {
    if (i) out.push({ type: "break" });
    out.push(...phrasing(para.content ?? []));
  }
  return out;
}

function block(node: JSONContent): Md {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: phrasing(node.content ?? []) };
    case "heading":
      return { type: "heading", depth: a.level ?? 1, children: phrasing(node.content ?? []) };
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "blockquote":
      return { type: "blockquote", children: blocks(node.content) };
    case "bulletList":
    case "orderedList":
    case "taskList":
      return {
        type: "list",
        ordered: node.type === "orderedList",
        start: node.type === "orderedList" ? (a.start ?? 1) : null,
        spread: !!a.spread,
        children: (node.content ?? []).map((item) => ({
          type: "listItem",
          spread: !!item.attrs?.spread,
          checked: node.type === "taskList" ? !!item.attrs?.checked : null,
          children: blocks(item.content),
        })),
      };
    case "codeBlock":
      return { type: "code", lang: a.language ?? null, meta: a.meta ?? null, value: (node.content ?? []).map((t) => t.text ?? "").join("") };
    case "chart":
    case "dataTable":
    case "embed":
      return {
        type: "code",
        lang: node.type === "chart" ? "chart" : node.type === "dataTable" ? "table" : (a.kind ?? "html"),
        meta: a.meta ?? null,
        value: a.code ?? "",
      };
    case "table": {
      const rows = node.content ?? [];
      return {
        type: "table",
        align: (rows[0]?.content ?? []).map((c) => c.attrs?.align ?? null),
        children: rows.map((row) => ({
          type: "tableRow",
          children: (row.content ?? []).map((cell) => ({ type: "tableCell", children: cellPhrasing(cell) })),
        })),
      };
    }
    case "kpis":
      return {
        type: "containerDirective",
        name: "kpis",
        attributes: {},
        children: [
          {
            type: "list",
            ordered: false,
            spread: false,
            children: ((a.items ?? []) as KpiItem[]).map((k) => ({
              type: "listItem",
              spread: false,
              children: [{ type: "paragraph", children: [{ type: "text", value: kpiLine(k) }] }],
            })),
          },
        ],
      };
    case "field":
      return { type: "leafDirective", name: "field", attributes: { ...(a.attributes ?? {}) }, children: [] };
    case "choice":
    case "option":
    case "callout":
    case "card":
    case "details":
    case "columns":
    case "col":
    case "tabs":
    case "tab":
      return { type: "containerDirective", name: node.type, attributes: { ...(a.attributes ?? {}) }, children: blocks(node.content) };
    case "rawBlock":
      return { type: "html", value: a.src ?? "" };
    default:
      throw new Error(`cannot write a ${node.type} block as markdown`);
  }
}

const OPTIONS = {
  bullet: "-" as const,
  listItemIndent: "one" as const,
  fences: true,
  rule: "-" as const,
  emphasis: "_" as const,
  strong: "*" as const,
  extensions: [gfmToMarkdown(), directiveToMarkdown()],
};

/** One block as markdown, without a trailing newline. */
export function blockToMarkdown(node: JSONContent): string {
  return toMarkdown({ type: "root", children: [block(node)] } as never, OPTIONS).replace(/\n$/, "");
}

// ----------------------------------------------------------------- document

export interface SerializeOptions {
  /** Write every block afresh, ignoring the source it came from. For tests. */
  fresh?: boolean;
}

/**
 * A document back to markdown. A block whose content still matches the
 * fingerprint taken at parse time is written as its original source, byte for
 * byte, with the lines that separated it from its neighbour; only edited or new
 * blocks go through the serialiser.
 */
export function docToMarkdown(input: JSONContent, options: SerializeOptions = {}): string {
  const doc = docSchema().nodeFromJSON(input).toJSON() as JSONContent;
  const attrs = doc.attrs ?? {};
  const out: string[] = [...((attrs.front as string[] | null) ?? [])];

  for (const node of doc.content ?? []) {
    const a = node.attrs ?? {};
    if (node.type === "rawBlock" && a.src === null) continue;
    // An empty line typed while editing is spacing, not content.
    if (node.type === "paragraph" && !node.content?.length && typeof a.src !== "string") continue;
    const kept = !options.fresh && typeof a.src === "string" && a.fp === fingerprint(node);
    const gap = (a.gap as string[] | null) ?? (out.length ? [""] : []);
    out.push(...gap, ...(kept || node.type === "rawBlock" ? String(a.src) : blockToMarkdown(node)).split("\n"));
  }
  out.push(...((attrs.tail as string[] | null) ?? [""]));
  return out.join("\n");
}
