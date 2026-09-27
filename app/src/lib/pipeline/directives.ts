import { visit } from "unist-util-visit";
import { toString as mdToString } from "mdast-util-to-string";
import { badgeClass, BlockError, isBadge, parseChartBlock, parseKpiLine, parseTableBlock } from "./parse";
import type { PipelineContext } from "./types";
import { parseStoryBlock, storyWarnings, StoryBlockError } from "../storybook/spec";

// mdast and hast nodes are manipulated structurally here: the published types
// are narrower than the hName/hProperties escape hatch this pipeline relies on.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

function setElement(node: AnyNode, hName: string, hProperties: Record<string, unknown> = {}, hChildren?: unknown[]) {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hProperties)) {
    if (v !== undefined && v !== null && v !== "") props[k] = v;
  }
  node.data = node.data || {};
  node.data.hName = hName;
  node.data.hProperties = { ...(node.data.hProperties || {}), ...props };
  if (hChildren) node.data.hChildren = hChildren;
}

function warn(ctx: PipelineContext, node: AnyNode, message: string) {
  ctx.warnings.push({ line: node.position?.start?.line ?? 0, message });
}

function errorElement(node: AnyNode, message: string) {
  setElement(node, "art-error", {}, [{ type: "text", value: message }]);
}

function kpiChildren(node: AnyNode) {
  const items: AnyNode[] = [];
  visit(node, "listItem", (item: AnyNode) => {
    const parsed = parseKpiLine(mdToString(item));
    if (!parsed) return;
    items.push({
      type: "element",
      tagName: "art-kpi",
      properties: {
        label: parsed.label,
        value: parsed.value,
        tone: parsed.tone,
        delta: parsed.delta,
        note: parsed.note,
      },
      children: [],
    });
  });
  return items;
}

/** A directive's switch: present (`{compact}`) or set to anything but "false". */
function flag(value: string | undefined): boolean {
  return value !== undefined && value !== "false";
}

/** Directives that only mean anything inside a particular parent. */
const REQUIRED_PARENT: Record<string, string> = { col: "columns", tab: "tabs", option: "choice", event: "timeline" };

function checkParent(node: AnyNode, parent: AnyNode, ctx: PipelineContext) {
  const required = REQUIRED_PARENT[node.name];
  if (!required) return;
  if (parent?.type === "containerDirective" && parent.name === required) return;
  warn(ctx, node, `":::${node.name}" is only rendered inside ":::${required}"`);
}

function handleDirective(node: AnyNode, ctx: PipelineContext) {
  const attrs: Record<string, string> = node.attributes || {};
  switch (node.name) {
    case "card":
      setElement(node, "art-card", { title: attrs.title, subtitle: attrs.subtitle });
      return;
    case "callout":
      setElement(node, "art-callout", { tone: attrs.tone || "info", title: attrs.title });
      return;
    case "kpis":
      setElement(node, "art-kpis", {}, kpiChildren(node));
      return;
    case "columns":
      setElement(node, "art-columns", {
        n: String(Math.min(Math.max(Number(attrs.n || 2) || 2, 2), 4)),
        compact: flag(attrs.compact) ? "true" : undefined,
        aside: flag(attrs.aside) ? "true" : undefined,
      });
      return;
    case "timeline":
      for (const child of node.children ?? []) {
        if (child.type !== "containerDirective" || child.name !== "event") {
          warn(ctx, child, '":::timeline" holds ":::event" blocks; put this inside one');
          break;
        }
      }
      setElement(node, "art-timeline", { legend: attrs.legend });
      return;
    case "event":
      setElement(node, "art-event", { date: attrs.date, title: attrs.title, kind: attrs.kind, source: attrs.source });
      return;
    case "col":
      setElement(node, "art-col", {});
      return;
    case "tabs":
      setElement(node, "art-tabs", {});
      return;
    case "tab":
      setElement(node, "art-tab", { label: attrs.label || "Tab" });
      return;
    case "details":
      setElement(node, "art-details", { summary: attrs.summary || "Details" });
      return;
    // Form questions. The viewer draws the real controls; this is what shows
    // before it loads, and in search.
    case "field":
      if (!attrs.name) warn(ctx, node, '"::field" needs a name, e.g. ::field{name=email type=email label="Email"}');
      setElement(node, "div", { className: "art-field" }, [
        { type: "element", tagName: "label", properties: {}, children: [{ type: "text", value: attrs.label || attrs.name || "Question" }] },
      ]);
      return;
    case "choice":
      if (!attrs.name) warn(ctx, node, '":::choice" needs a name, e.g. :::choice{name=pick label="Which one?"}');
      setElement(node, "div", { className: "art-choice" });
      return;
    case "option":
      setElement(node, "div", { className: "art-option" });
      return;
    default:
      warn(ctx, node, `unknown directive ":::${node.name}"`);
      errorElement(node, `Unknown block ":::${node.name}"`);
  }
}

function handleCode(node: AnyNode, ctx: PipelineContext, blockHint: string | null) {
  const lang = (node.lang || "").toLowerCase();
  if (lang !== "chart" && lang !== "table" && lang !== "mermaid" && lang !== "html" && lang !== "story") return;

  if (lang === "mermaid" || lang === "html") {
    const id = `e${ctx.embedCounter++}`;
    ctx.embeds.push({ id, kind: lang, content: node.value ?? "", block: blockHint, line: node.position?.start?.line });
    setElement(node, "art-embed", { dataEmbed: id, dataKind: lang }, []);
    return;
  }

  if (lang === "story") {
    // Numbered even when it does not parse, so the frame numbers stay the
    // same as the editor's, which cannot tell.
    const id = `e${ctx.embedCounter++}`;
    try {
      const spec = parseStoryBlock(node.value ?? "");
      ctx.embeds.push({ id, kind: "story", content: node.value ?? "", block: blockHint, line: node.position?.start?.line });
      for (const message of storyWarnings(spec)) warn(ctx, node, message);
      setElement(node, "art-embed", storyAttributes(id, spec), []);
    } catch (err) {
      const message = err instanceof StoryBlockError ? err.message : `story block failed: ${(err as Error).message}`;
      warn(ctx, node, message);
      errorElement(node, message);
    }
    return;
  }

  try {
    if (lang === "chart") {
      const spec = parseChartBlock(node.value ?? "");
      setElement(node, "art-chart", { dataChart: JSON.stringify(spec) }, []);
    } else {
      const spec = parseTableBlock(node.value ?? "");
      setElement(node, "art-table", { dataTable: JSON.stringify(spec) }, []);
    }
  } catch (err) {
    const message = err instanceof BlockError ? err.message : `${lang} block failed: ${(err as Error).message}`;
    warn(ctx, node, message);
    errorElement(node, message);
  }
}

/** The <art-embed> attributes for a story; shared with the editor's schema. */
export function storyAttributes(id: string, spec: { width?: number; height?: number; title?: string; id: string }) {
  return {
    dataEmbed: id,
    dataKind: "story",
    dataWidth: spec.width ? String(spec.width) : undefined,
    dataHeight: spec.height ? String(spec.height) : undefined,
    dataTitle: spec.title ?? spec.id,
  };
}

/**
 * Put an inline directive back the way it was written.
 *
 * A colon in prose is nearly always a colon: a time, a ratio, a namespace. The
 * directive syntax claims `:name` anyway, so an unrecognised one is returned to
 * the page as the text the author typed rather than warned about.
 */
function literal(node: AnyNode, ctx: PipelineContext) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  const text =
    ctx.source !== undefined && typeof start === "number" && typeof end === "number"
      ? ctx.source.slice(start, end)
      : `:${node.name}`;
  node.type = "text";
  node.value = text;
  delete node.children;
  delete node.attributes;
  delete node.name;
  delete node.data;
}

function badge(node: AnyNode) {
  const text = mdToString(node).trim();
  setElement(node, "span", { className: badgeClass(node.attributes?.tone).split(" ") }, [{ type: "text", value: text }]);
}

export function artifactsDirectives(ctx: PipelineContext) {
  return (tree: AnyNode) => {
    visit(tree, (node: AnyNode, _index: number | undefined, parent: AnyNode) => {
      if (node.type === "textDirective") {
        if (isBadge(node)) badge(node);
        else literal(node, ctx);
        return;
      }
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective"
      ) {
        checkParent(node, parent, ctx);
        handleDirective(node, ctx);
      } else if (node.type === "code") {
        handleCode(node, ctx, null);
      }
    });
  };
}
