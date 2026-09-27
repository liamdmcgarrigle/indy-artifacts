import type { JSONContent } from "@tiptap/core";
import type { RenderResult } from "@/lib/pipeline/types";
import { markdownToDoc } from "./parse";

export { markdownToDoc } from "./parse";
export { docToMarkdown, blockToMarkdown } from "./serialize";
export { fingerprint } from "./fingerprint";

/**
 * The document the viewer mounts: the parsed markdown, with each raw block
 * given the HTML the pipeline rendered for it, so it looks exactly as before.
 */
export function docForView(source: string, rendered: Pick<RenderResult, "blockHtml">): JSONContent {
  const doc = markdownToDoc(source);
  for (const node of doc.content ?? []) {
    if (node.type !== "rawBlock") continue;
    const lines = node.attrs?.lines as [number, number] | null;
    node.attrs = { ...node.attrs, html: lines ? (rendered.blockHtml[lines[0]] ?? "") : "" };
  }
  return doc;
}
