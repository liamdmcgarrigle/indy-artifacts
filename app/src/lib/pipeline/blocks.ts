import type { PipelineContext } from "./types";

// mdast and hast nodes are manipulated structurally here: the published types
// are narrower than the hName/hProperties escape hatch this pipeline relies on.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

/**
 * Rehype plugin: stamp every top-level element with data-block and data-lines,
 * and record the block map. Runs after remark-rehype, before sanitize.
 */
export function assignBlocks(ctx: PipelineContext) {
  return (tree: AnyNode) => {
    let index = 0;
    for (const child of tree.children ?? []) {
      if (child.type !== "element") continue;
      const id = `b${index++}`;
      const pos = child.position;
      const lines: [number, number] = pos
        ? [pos.start.line, pos.end.line]
        : [0, 0];
      child.properties = child.properties || {};
      child.properties.dataBlock = id;
      child.properties.dataLines = `${lines[0]}-${lines[1]}`;
      ctx.blocks.push({ id, lines, kind: child.tagName });
      stampEmbeds(child, id, ctx);
      if (ctx.assetBase) rewriteAssetUrls(child, ctx.assetBase);
    }
  };
}

function stampEmbeds(node: AnyNode, blockId: string, ctx: PipelineContext) {
  if (node.type === "element" && node.tagName === "art-embed") {
    const embedId = node.properties?.dataEmbed;
    const embed = ctx.embeds.find((e) => e.id === embedId);
    if (embed) embed.block = blockId;
  }
  for (const child of node.children ?? []) stampEmbeds(child, blockId, ctx);
}

const ASSET_PREFIX = "assets/";

/** Rewrite relative asset references so they resolve from any artifact URL. */
function rewriteAssetUrls(node: AnyNode, base: string) {
  if (node.type === "element" && node.properties) {
    for (const key of ["src", "href", "poster"]) {
      const value = node.properties[key];
      if (typeof value === "string" && value.startsWith(ASSET_PREFIX)) {
        node.properties[key] = base.replace(/\/$/, "") + "/" + value.slice(ASSET_PREFIX.length);
      }
    }
  }
  for (const child of node.children ?? []) rewriteAssetUrls(child, base);
}
