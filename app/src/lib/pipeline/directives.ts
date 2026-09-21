import { visit } from "unist-util-visit";
import { toString as mdToString } from "mdast-util-to-string";
import { BlockError, parseChartBlock, parseKpiLine, parseTableBlock } from "./parse";
import type { PipelineContext } from "./types";

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
      },
      children: [],
    });
  });
  return items;
}

/** Directives that only mean anything inside a particular parent. */
const REQUIRED_PARENT: Record<string, string> = { col: "columns", tab: "tabs" };

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
      setElement(node, "art-columns", { n: String(Math.min(Math.max(Number(attrs.n || 2) || 2, 2), 4)) });
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
    default:
      warn(ctx, node, `unknown directive ":::${node.name}"`);
      errorElement(node, `Unknown block ":::${node.name}"`);
  }
}

function handleCode(node: AnyNode, ctx: PipelineContext, blockHint: string | null) {
  const lang = (node.lang || "").toLowerCase();
  if (lang !== "chart" && lang !== "table" && lang !== "mermaid" && lang !== "html") return;

  if (lang === "mermaid" || lang === "html") {
    const id = `e${ctx.embedCounter++}`;
    ctx.embeds.push({ id, kind: lang, content: node.value ?? "", block: blockHint });
    setElement(node, "art-embed", { dataEmbed: id, dataKind: lang }, []);
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

export function artifactsDirectives(ctx: PipelineContext) {
  return (tree: AnyNode) => {
    visit(tree, (node: AnyNode, _index: number | undefined, parent: AnyNode) => {
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective" ||
        node.type === "textDirective"
      ) {
        checkParent(node, parent, ctx);
        handleDirective(node, ctx);
      } else if (node.type === "code") {
        handleCode(node, ctx, null);
      }
    });
  };
}
