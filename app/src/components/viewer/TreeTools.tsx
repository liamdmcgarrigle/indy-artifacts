"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CornerDownRight, FolderInput, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { childrenIn, type PageTree, type PageTreeNode } from "@/lib/page-tree";
import { cn } from "@/lib/utils";

/**
 * Changing a tree from its contents list, for the owner: add a page under
 * any page, move a page up or down among its siblings (or drag it there),
 * and move it under another page or out of the tree. Each change is one
 * request; the page then reloads its tree.
 */

async function send(url: string, method: string, payload: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    toast.error((data.error as { message?: string } | undefined)?.message ?? "That did not save.");
    return null;
  }
  return data;
}

export function placeRequest(slug: string, place: { parent?: string | null; position?: number; group?: string | null }) {
  return send(`/api/artifacts/${encodeURIComponent(slug)}`, "PATCH", place);
}

/** The pages a page can move under: anywhere in its tree except itself and what is under it. */
function targetsFor(tree: PageTree, slug: string): PageTreeNode[] {
  const start = tree.nodes.findIndex((n) => n.slug === slug);
  const end = tree.nodes.findIndex((n, i) => i > start && n.depth <= tree.nodes[start].depth);
  const own = new Set(tree.nodes.slice(start, end === -1 ? undefined : end).map((n) => n.slug));
  // Three levels below the top at most: a page can go under one at depth 2 or above.
  return tree.nodes.filter((n) => !own.has(n.slug) && n.depth < 3);
}

export function useTreeTools(tree: PageTree | null | undefined) {
  const router = useRouter();
  const [adding, setAdding] = useState<Pick<PageTreeNode, "slug" | "title"> | null>(null);
  const [moving, setMoving] = useState<PageTreeNode | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const siblingsOf = (node: PageTreeNode) => (tree && node.parent ? childrenIn(tree, node.parent) : []);
  const shift = async (node: PageTreeNode, by: number) => {
    const sibs = siblingsOf(node);
    const index = sibs.findIndex((s) => s.slug === node.slug);
    const next = sibs[index + by];
    if (index < 0 || !next) return;
    // Next to a page in another group, a step joins that group (or leaves this one) and stays put.
    const crossing = (next.group ?? null) !== (node.group ?? null);
    const place = crossing ? { position: index, group: next.group ?? null } : { position: index + by };
    if (await placeRequest(node.slug, place)) router.refresh();
  };

  /** The menu at the end of a row in the contents list. */
  const rowTools = (node: PageTreeNode) => {
    const sibs = siblingsOf(node);
    const index = sibs.findIndex((s) => s.slug === node.slug);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Change ${node.title}`}
            className="ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground md:size-6 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4 md:size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          {node.depth < 3 ? (
            <DropdownMenuItem onSelect={() => setAdding(node)}>
              <Plus /> Add a page under this
            </DropdownMenuItem>
          ) : null}
          {node.parent ? (
            <>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => void shift(node, -1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index < 0 || index >= sibs.length - 1} onSelect={() => void shift(node, 1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setMoving(node)}>
                <FolderInput /> Move to…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /** Rows drag among their siblings on a wide screen. */
  const drag = (node: PageTreeNode) =>
    node.parent
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.slug);
            setDragging(node.slug);
          },
          onDragEnd: () => setDragging(null),
          onDragOver: (e: React.DragEvent) => {
            const from = tree?.nodes.find((n) => n.slug === dragging);
            if (from && from.parent === node.parent && from.slug !== node.slug) e.preventDefault();
          },
          onDrop: async (e: React.DragEvent) => {
            e.preventDefault();
            const from = tree?.nodes.find((n) => n.slug === dragging);
            setDragging(null);
            if (!from || from.parent !== node.parent) return;
            // Dropped on a page in another group, it joins that group.
            const at = siblingsOf(node).findIndex((s) => s.slug === node.slug);
            if (await placeRequest(from.slug, { position: at, ...(from.group !== node.group ? { group: node.group } : {}) })) router.refresh();
          },
        }
      : {};

  const dialogs = (
    <>
      <AddPageDialog parent={adding} onClose={() => setAdding(null)} />
      {tree ? <MoveDialog tree={tree} node={moving} onClose={() => setMoving(null)} onMoved={() => router.refresh()} /> : null}
    </>
  );

  return { rowTools, drag, dragging, dialogs, addUnder: setAdding };
}

/** A title, then the new page opens for writing. */
function AddPageDialog({ parent, onClose }: { parent: Pick<PageTreeNode, "slug" | "title"> | null; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setTitle(""), [parent]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parent || !title.trim()) return;
    setBusy(true);
    const made = await send(`/api/artifacts/${encodeURIComponent(parent.slug)}/subpages`, "POST", { title: title.trim() });
    setBusy(false);
    if (!made) return;
    onClose();
    router.push(`/a/${made.slug}?edit=1`);
  };
  return (
    <Dialog open={Boolean(parent)} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>Under “{parent?.title}”. It opens for writing once it has a title.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={200} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              Add page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pick the page to move it under, or take it out of the tree. */
function MoveDialog({ tree, node, onClose, onMoved }: { tree: PageTree; node: PageTreeNode | null; onClose: () => void; onMoved: () => void }) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [node]);
  const targets = useMemo(() => (node ? targetsFor(tree, node.slug) : []), [tree, node]);
  const shown = targets.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()));
  const move = async (parent: string | null) => {
    if (!node) return;
    if (await placeRequest(node.slug, { parent })) {
      onClose();
      onMoved();
    }
  };
  return (
    <Dialog open={Boolean(node)} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Move “{node?.title}”</DialogTitle>
          <DialogDescription>Pick the page it goes under. The pages under it move with it.</DialogDescription>
        </DialogHeader>
        {targets.length > 8 ? <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page" /> : null}
        <div className="-mx-2 flex max-h-[50dvh] flex-col overflow-y-auto">
          {shown.map((t) => (
            <button
              key={t.slug}
              type="button"
              disabled={t.slug === node?.parent}
              onClick={() => void move(t.slug)}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-raised disabled:opacity-50 md:min-h-8 md:text-[13px]",
              )}
              style={{ paddingLeft: 8 + t.depth * 14 }}
            >
              {t.depth ? <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              <span className="truncate">{t.title}</span>
              {t.slug === node?.parent ? <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">here now</span> : null}
            </button>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => void move(null)}>
            Make it a page of its own
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * From the library: put a page under any other page, or take it out of its
 * tree. The server refuses loops and trees too deep, and says why.
 */
export function MoveIntoDialog({ page, onClose, onMoved }: { page: { slug: string; title: string } | null; onClose: () => void; onMoved: () => void }) {
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<{ slug: string; title: string; project: string | null }[]>([]);
  useEffect(() => {
    setQuery("");
    setPages([]);
    if (!page) return;
    let current = true;
    fetch("/api/artifacts?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { artifacts?: { slug: string; title: string; project: string | null; archivedAt: string | null }[] }) => {
        if (current) setPages((d.artifacts ?? []).filter((a) => a.slug !== page.slug && !a.archivedAt));
      })
      .catch(() => {
        if (current) toast.error("Could not load your pages.");
      });
    return () => {
      current = false;
    };
  }, [page]);
  const q = query.trim().toLowerCase();
  const shown = pages.filter((p) => !q || p.title.toLowerCase().includes(q) || (p.project ?? "").toLowerCase().includes(q)).slice(0, 60);
  const move = async (parent: string | null) => {
    if (!page) return;
    if (await placeRequest(page.slug, { parent })) {
      toast(parent ? "Moved" : "It is a page of its own now");
      onClose();
      onMoved();
    }
  };
  return (
    <Dialog open={Boolean(page)} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Move “{page?.title}” into…</DialogTitle>
          <DialogDescription>Pick the page it goes under. It shows in that page&rsquo;s contents, and the pages under it move with it.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page" />
        <div className="-mx-2 flex max-h-[50dvh] flex-col overflow-y-auto">
          {shown.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => void move(p.slug)}
              className="flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-raised md:min-h-8 md:text-[13px]"
            >
              <span className="truncate">{p.title}</span>
              {p.project ? <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{p.project}</span> : null}
            </button>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => void move(null)}>
            Make it a page of its own
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
