import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { parse as parseYaml } from "yaml";
import { visit } from "unist-util-visit";

import { artifactsDirectives } from "./directives";
import { assignBlocks } from "./blocks";
import { normalizeContainers } from "./normalize";
import { schema } from "./sanitize";
import { DEFAULT_THEME, THEMES, type Frontmatter, type PipelineContext, type RenderOptions, type RenderResult } from "./types";

// mdast and hast nodes are manipulated structurally here: the published types
// are narrower than the hName/hProperties escape hatch this pipeline relies on.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

function extractFrontmatter(ctx: PipelineContext) {
  return (tree: AnyNode) => {
    const keep: AnyNode[] = [];
    for (const child of tree.children ?? []) {
      if (child.type === "yaml" && ctx.frontmatter === null) {
        try {
          const parsed = parseYaml(child.value ?? "");
          ctx.frontmatter = parsed && typeof parsed === "object" ? parsed : {};
        } catch (err) {
          ctx.frontmatter = {};
          ctx.warnings.push({
            line: child.position?.start?.line ?? 1,
            message: `frontmatter YAML is invalid: ${(err as Error).message}`,
          });
        }
        continue;
      }
      keep.push(child);
    }
    tree.children = keep;
  };
}

/** Drop any raw HTML that slipped into the mdast (defence in depth; rehype also drops it). */
function stripRawHtml() {
  return (tree: AnyNode) => {
    visit(tree, "html", (node: AnyNode) => {
      node.type = "text";
      node.value = "";
    });
  };
}

export function normalizeFrontmatter(raw: Record<string, unknown> | null, fallbackTitle = "Untitled"): Frontmatter {
  const o = raw ?? {};
  const themeRaw = typeof o.theme === "string" ? o.theme : DEFAULT_THEME;
  const theme = (THEMES as readonly string[]).includes(themeRaw) ? themeRaw : DEFAULT_THEME;
  const tags = Array.isArray(o.tags) ? o.tags.map(String).slice(0, 20) : [];
  return {
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : fallbackTitle,
    theme,
    project: typeof o.project === "string" && o.project.trim() ? o.project.trim() : undefined,
    description: typeof o.description === "string" && o.description.trim() ? o.description.trim() : undefined,
    tags,
  };
}

export function renderMarkdown(source: string, fallbackTitle = "Untitled", options: RenderOptions = {}): RenderResult {
  const ctx: PipelineContext = {
    warnings: [],
    embeds: [],
    blocks: [],
    frontmatter: null,
    embedCounter: 0,
    assetBase: options.assetBase,
  };

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(extractFrontmatter, ctx)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(stripRawHtml)
    .use(artifactsDirectives, ctx)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(assignBlocks, ctx)
    .use(rehypeSanitize, schema as never)
    .use(rehypeStringify);

  // Widen nested container fences before remark sees them. Line numbers survive,
  // so blocks and comment anchors still point at the source the author sent.
  const normalized = normalizeContainers(source);
  ctx.warnings.push(...normalized.warnings);
  ctx.source = normalized.source;

  const html = String(processor.processSync(normalized.source));

  return {
    frontmatter: normalizeFrontmatter(ctx.frontmatter, fallbackTitle),
    html,
    blocks: ctx.blocks,
    embeds: ctx.embeds,
    warnings: ctx.warnings,
  };
}

export function readFrontmatter(source: string): Record<string, unknown> | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export * from "./types";
