"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { PagesBlock } from "./PageNav";

/** `::pages` in the document: the pages under this one, drawn from the tree the page is in. */
export function PagesView({ node }: ReactNodeViewProps) {
  const attrs = (node.attrs.attributes ?? {}) as Record<string, string>;
  const depth = Number(attrs.depth) > 1 ? 2 : 1;
  return (
    <NodeViewWrapper contentEditable={false}>
      <PagesBlock depth={depth} />
    </NodeViewWrapper>
  );
}
