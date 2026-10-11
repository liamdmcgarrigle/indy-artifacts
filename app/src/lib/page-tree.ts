/**
 * The tree a page is in, as the viewer gets it: enough to draw breadcrumbs,
 * the contents list, previous and next, and `::pages` blocks. Built on the
 * server (lib/view.ts); this file only holds the shapes and the reading-order
 * helpers, so client components can use it.
 */

export interface PageTreeNode {
  slug: string;
  title: string;
  description: string | null;
  /** 0 for the top page of what the reader can see. */
  depth: number;
  parent: string | null;
  group: string | null;
  /** A version the owner has not seen; always false for visitors. */
  unseen: boolean;
}

export interface PageTree {
  /** Every page the reader can reach, the top page first, in reading order. */
  nodes: PageTreeNode[];
  /** The page on screen. */
  current: string;
  /** Pages above the current one, the top page first. */
  ancestors: { slug: string; title: string }[];
  /** A deep or long tree: its contents start open beside the page. */
  big: boolean;
}

/** Above this many pages, or any page two levels down, the contents start open. */
export const SMALL_TREE_PAGES = 7;

export function isBig(nodes: Pick<PageTreeNode, "depth">[]): boolean {
  return nodes.length > SMALL_TREE_PAGES || nodes.some((n) => n.depth >= 2);
}

/** The pages directly under one, in order. */
export function childrenIn(tree: Pick<PageTree, "nodes">, slug: string): PageTreeNode[] {
  return tree.nodes.filter((n) => n.parent === slug);
}

/** The pages before and after the current one in reading order. */
export function neighbours(tree: PageTree): { prev: PageTreeNode | null; next: PageTreeNode | null; index: number } {
  const index = tree.nodes.findIndex((n) => n.slug === tree.current);
  return {
    prev: index > 0 ? tree.nodes[index - 1] : null,
    next: index >= 0 && index < tree.nodes.length - 1 ? tree.nodes[index + 1] : null,
    index,
  };
}
