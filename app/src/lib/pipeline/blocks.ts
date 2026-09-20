import type { PipelineContext } from "./types.js";

type AnyNode = Record<string, any>;

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
