"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, ListTree } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { childrenIn, neighbours, type PageTree, type PageTreeNode } from "@/lib/page-tree";
import { cn } from "@/lib/utils";

/**
 * The way through a tree of pages: the contents list (a rail beside the page,
 * or a sheet on a narrow screen), the button that shows it, previous and next
 * at the foot, and the `::pages` block. Every piece reads the tree from
 * context, along with how to link to a page: the owner's /a/<slug>, or a
 * visitor's /s/<token>/<slug>.
 */

interface TreeContext {
  tree: PageTree;
  hrefFor: (slug: string) => string;
  /** Set by the owner's view: tools to change the structure from the contents list. */
  tools?: {
    row: (node: PageTreeNode) => React.ReactNode;
    drag: (node: PageTreeNode) => React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
    dragging: string | null;
    footer: React.ReactNode;
  };
}

const Ctx = createContext<TreeContext | null>(null);

export function PageTreeProvider({ value, children }: { value: TreeContext | null; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageTree(): TreeContext | null {
  return useContext(Ctx);
}

// ------------------------------------------------------------ open or closed

const RAIL_WIDE = "(min-width: 1024px)";

// Read with useSyncExternalStore rather than set in an effect, so moving to the
// next page in a tree paints with the rail already where it was.
const railListeners = new Set<() => void>();

function storedOpen(key: string): "open" | "closed" | null {
  try {
    const v = localStorage.getItem(key);
    return v === "open" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}

function subscribeWide(change: () => void) {
  const mq = window.matchMedia(RAIL_WIDE);
  mq.addEventListener("change", change);
  return () => mq.removeEventListener("change", change);
}

function subscribeRail(change: () => void) {
  railListeners.add(change);
  return () => void railListeners.delete(change);
}

/** The choice for this visit, for when localStorage refuses (a private window). */
const railThisVisit = new Map<string, "open" | "closed">();

/**
 * Whether the contents list shows. Wide screens show it as a rail, open by
 * default on a big tree and remembered per tree; narrow ones open it as a
 * sheet each time.
 */
export function useContents(tree: PageTree | null | undefined) {
  const key = tree ? `indy-contents:${tree.nodes[0].slug}` : "";
  const [sheet, setSheet] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(RAIL_WIDE).matches, () => false);
  const stored = useSyncExternalStore(
    subscribeRail,
    () => (key ? (railThisVisit.get(key) ?? storedOpen(key)) : null),
    () => null,
  );
  const rail = stored ? stored === "open" : Boolean(tree?.big);
  const toggle = () => {
    if (!wide) return setSheet((v) => !v);
    const next = rail ? "closed" : "open";
    railThisVisit.set(key, next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* private window: the choice lasts this visit */
    }
    railListeners.forEach((l) => l());
  };
  return { railOpen: Boolean(tree) && wide && rail, sheetOpen: sheet, setSheet, toggle, open: wide ? rail : sheet };
}

// ------------------------------------------------------------ the list

function Row({ node, current, hrefFor, depth, expanded, onToggle, hasKids, onGo }: {
  node: PageTreeNode;
  current: string;
  hrefFor: (slug: string) => string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  hasKids: boolean;
  onGo?: () => void;
}) {
  const here = node.slug === current;
  const tools = usePageTree()?.tools;
  return (
    <div
      className={cn(
        "group/row flex min-h-10 items-center rounded-[7px] pr-1 md:min-h-[30px]",
        here ? "bg-sand-soft text-sand-strong shadow-[inset_0_0_0_1px_var(--sand-line)]" : "text-fg-2 hover:bg-raised hover:text-foreground",
        tools?.dragging === node.slug && "opacity-40",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
      data-slug={node.slug}
      {...(tools ? tools.drag(node) : {})}
    >
      {hasKids ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `Fold ${node.title}` : `Unfold ${node.title}`}
          aria-expanded={expanded}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring md:size-5"
        >
          <ChevronRight className={cn("size-4 transition-transform md:size-3.5", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="w-8 shrink-0 md:w-5" />
      )}
      <Link
        href={hrefFor(node.slug)}
        onClick={onGo}
        aria-current={here ? "page" : undefined}
        className={cn("min-w-0 flex-1 py-2 pl-1 text-[15px] leading-snug md:py-1 md:text-[13px]", here && "font-medium")}
      >
        {node.title}
      </Link>
      {node.unseen && !here ? <span aria-label="new version" className="ml-1.5 size-1.5 shrink-0 rounded-full bg-sand" /> : null}
      {/* On a phone the list is for getting around; the current page keeps its menu. */}
      {tools ? <span className={cn("flex", !here && "max-md:hidden")}>{tools.row(node)}</span> : null}
    </div>
  );
}

/** The whole tree as a folding list. Open: the path to the current page, and everything in a small tree. */
export function ContentsList({ onGo, className }: { onGo?: () => void; className?: string }) {
  const ctx = usePageTree();
  const tree = ctx?.tree;
  const path = useMemo(() => new Set([...(tree?.ancestors.map((a) => a.slug) ?? []), tree?.current]), [tree]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The current page in view, without moving the page itself.
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = listRef.current?.closest<HTMLElement>("[data-contents-scroll]");
    if (el && box) box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 3);
  }, [tree?.current]);
  if (!ctx || !tree) return null;
  const root = tree.nodes[0];
  const isOpen = (slug: string) => (open.has(slug) ? true : open.has(`-${slug}`) ? false : !tree.big || path.has(slug));
  const toggle = (slug: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.delete(slug);
      next.delete(`-${slug}`);
      next.add(isOpen(slug) ? `-${slug}` : slug);
      return next;
    });

  const level = (parent: string, depth: number): React.ReactNode => {
    let lastGroup: string | null = null;
    return childrenIn(tree, parent).map((node) => {
      const kids = childrenIn(tree, node.slug).length > 0;
      const heading = node.group && node.group !== lastGroup ? node.group : null;
      lastGroup = node.group;
      return (
        <div key={node.slug}>
          {heading ? (
            <div
              className="mt-3 mb-1 border-t border-hairline pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-sand"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {heading}
            </div>
          ) : null}
          <Row
            node={node}
            current={tree.current}
            hrefFor={ctx.hrefFor}
            depth={depth}
            hasKids={kids}
            expanded={isOpen(node.slug)}
            onToggle={() => toggle(node.slug)}
            onGo={onGo}
          />
          {kids && isOpen(node.slug) ? level(node.slug, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div ref={listRef} className={cn("flex flex-col", className)}>
      <Link
        href={ctx.hrefFor(root.slug)}
        onClick={onGo}
        aria-current={root.slug === tree.current ? "page" : undefined}
        className={cn(
          "mb-1 rounded-[7px] px-2 py-2 text-[15px] font-semibold leading-snug md:py-1.5 md:text-[13px]",
          root.slug === tree.current ? "bg-sand-soft text-sand-strong shadow-[inset_0_0_0_1px_var(--sand-line)]" : "hover:bg-raised",
        )}
      >
        {root.title}
      </Link>
      {level(root.slug, 0)}
      {ctx.tools?.footer}
    </div>
  );
}

/** Beside the page on a wide screen: the contents, under the header, scrolling on its own. */
export function ContentsRail() {
  return (
    <aside aria-label="Pages" className="contents-rail" data-contents-scroll>
      <ContentsList />
    </aside>
  );
}

/** On a narrow screen: the contents in a sheet from the bottom, closing on a tap through. */
export function ContentsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[80dvh] gap-0 rounded-t-2xl border-hairline bg-raised p-0 pb-[env(safe-area-inset-bottom)]">
        <SheetTitle className="sr-only">Pages</SheetTitle>
        <div className="mx-auto mt-2.5 mb-1 h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden />
        <div className="overflow-y-auto px-3 pt-1 pb-4" data-contents-scroll>
          <ContentsList onGo={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** "Pages · 3 of 12": shows and hides the contents. */
export function PagesButton({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) {
  const ctx = usePageTree();
  if (!ctx) return null;
  const { index } = neighbours(ctx.tree);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? "Hide the pages" : "Show the pages"}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors md:h-8",
        open ? "border-sand-line bg-sand-soft text-sand-strong" : "border-border text-fg-2 hover:bg-raised hover:text-foreground",
        className,
      )}
    >
      <ListTree className="size-4 md:size-3.5" />
      <span>Pages</span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {index + 1} of {ctx.tree.nodes.length}
      </span>
    </button>
  );
}

/** Previous and next at the foot of the page, in reading order through the tree. */
export function Pager() {
  const ctx = usePageTree();
  if (!ctx) return null;
  const { prev, next } = neighbours(ctx.tree);
  if (!prev && !next) return null;
  const cell = "flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[10px] border border-border px-4 py-2.5 transition-colors hover:border-sand-line hover:bg-sand-soft/40";
  return (
    <nav aria-label="Previous and next page" className="pager">
      {prev ? (
        <Link href={ctx.hrefFor(prev.slug)} className={cell} rel="prev">
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <ArrowLeft className="size-3.5" /> Previous
          </span>
          <span className="truncate text-[14px] font-medium text-foreground">{prev.title}</span>
        </Link>
      ) : (
        <span className="flex-1 max-sm:hidden" />
      )}
      {next ? (
        <Link href={ctx.hrefFor(next.slug)} className={cn(cell, "items-end text-right")} rel="next">
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            Next <ArrowRight className="size-3.5" />
          </span>
          <span className="max-w-full truncate text-[14px] font-medium text-foreground">{next.title}</span>
        </Link>
      ) : (
        <span className="flex-1 max-sm:hidden" />
      )}
    </nav>
  );
}

/**
 * `::pages`: the pages under this one as cards, each with its description.
 * `depth=2` lists each card's own subpages inside it, like a course map.
 */
export function PagesBlock({ depth = 1 }: { depth?: number }) {
  const ctx = usePageTree();
  if (!ctx) return <div className="art-pages art-pages--empty">No subpages yet.</div>;
  const kids = childrenIn(ctx.tree, ctx.tree.current);
  if (!kids.length) return <div className="art-pages art-pages--empty">No subpages yet.</div>;
  let lastGroup: string | null = null;
  return (
    <div className="art-pages">
      {kids.map((node) => {
        const heading = node.group && node.group !== lastGroup ? node.group : null;
        lastGroup = node.group;
        const grand = depth > 1 ? childrenIn(ctx.tree, node.slug) : [];
        return (
          <div key={node.slug} className="contents">
            {heading ? <div className="art-pages__group">{heading}</div> : null}
            <div className="art-pages__card">
              <Link href={ctx.hrefFor(node.slug)} className="art-pages__title">
                {node.title}
                {node.unseen ? <span aria-label="new version" className="art-pages__dot" /> : null}
              </Link>
              {node.description ? <p className="art-pages__desc">{node.description}</p> : null}
              {grand.length ? (
                <ul className="art-pages__list">
                  {grand.map((g) => (
                    <li key={g.slug}>
                      <Link href={ctx.hrefFor(g.slug)}>{g.title}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
