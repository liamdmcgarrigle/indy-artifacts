"use client";

import { Ago } from "@/components/indy/Ago";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Copy, ExternalLink, FolderInput, Layers3, MoreHorizontal, Pin, PinOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { projectColour } from "@/lib/colors";
import type { LibraryRow, NeedsYouRow, Reason } from "@/lib/service/library";
import { cn } from "@/lib/utils";
import { ShapeThumb } from "./ShapeThumb";
import { saveNavList } from "./nav-list";
import { OrganiseDialog } from "./OrganiseDialog";
import { copyText } from "@/lib/clipboard";

export interface BoardSection {
  id: string;
  title?: string;
  subtitle?: string;
  layout: "inbox" | "table";
  rows: (LibraryRow | NeedsYouRow)[];
  empty?: React.ReactNode;
}

const KIND_LABEL: Record<string, string> = { markdown: "page", react: "react app", svelte: "svelte app", html: "html" };

function reasonText(r: Reason, row: LibraryRow): string {
  if (r.kind === "new" && row.series && row.seriesCount > 1)
    return `${row.seriesCount} new in ${row.series}; ${r.who} published the latest`;
  switch (r.kind) {
    case "reply":
      return `${r.who} replied: “${r.excerpt}”`;
    case "live":
      return `${r.who} is writing this page now`;
    case "unsent":
      return `${r.count} comment${r.count === 1 ? "" : "s"} you have not sent yet`;
    case "visitors":
      return `${r.count} from visitors for you to look at`;
    case "new":
      return r.message ? `${r.who} published v${r.version}: ${r.message}` : `${r.who} published v${r.version}`;
  }
}

function ReasonGlyph({ reason }: { reason: Reason }) {
  const map = {
    reply: { cls: "bg-[rgb(127_140_255/0.16)] text-[#AEB6FF]", text: "↩" },
    live: { cls: "bg-[rgb(61_220_132/0.14)] text-good", text: "●" },
    unsent: { cls: "bg-[rgb(240_180_90/0.14)] text-warn", text: String((reason as { count?: number }).count ?? "") },
    visitors: { cls: "bg-[rgb(240_180_90/0.14)] text-warn", text: "@" },
    new: { cls: "bg-sand-soft text-sand-strong", text: "+" },
  }[reason.kind];
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold", map.cls)}>
      {map.text}
    </span>
  );
}

async function patch(slug: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "That did not save.");
}

function RowMenu({
  row,
  onChanged,
  onOrganise,
}: {
  row: LibraryRow;
  onChanged: () => void;
  onOrganise: (row: LibraryRow, what: "project" | "series") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More for ${row.title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex size-9 md:size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-raised hover:text-foreground data-[state=open]:bg-raised"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await patch(row.slug, { pinned: !row.pinned });
              onChanged();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          {row.pinned ? <PinOff /> : <Pin />} {row.pinned ? "Unpin" : "Pin"}
          <kbd className="kbd ml-auto">p</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await patch(row.slug, { archived: !row.archived });
              onChanged();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        >
          {row.archived ? <ArchiveRestore /> : <Archive />} {row.archived ? "Restore" : "Archive"}
          <kbd className="kbd ml-auto">e</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOrganise(row, "project")}>
          <FolderInput /> Move to project…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOrganise(row, "series")}>
          <Layers3 /> Add to series…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            if (await copyText(`${window.location.origin}/a/${row.slug}`)) toast("Link copied");
            else toast.error("Your browser would not copy the link.");
          }}
        >
          <Copy /> Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open(`/a/${row.slug}`, "_blank")}>
          <ExternalLink /> Open in a new tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LibraryBoard({ sections, listLabel }: { sections: BoardSection[]; listLabel: string }) {
  const router = useRouter();
  const flat = useMemo(() => sections.flatMap((s) => s.rows.map((row) => ({ row, section: s.id }))), [sections]);
  const [focus, setFocus] = useState(-1);
  const [organise, setOrganise] = useState<{ row: LibraryRow; what: "project" | "series" } | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (focus >= flat.length) setFocus(flat.length - 1);
  }, [flat.length, focus]);

  useEffect(() => {
    if (focus >= 0) refs.current[focus]?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const open = (index: number, newTab = false) => {
    const item = flat[index];
    if (!item) return;
    saveNavList(listLabel, flat.map((f) => f.row.slug));
    if (newTab) window.open(`/a/${item.row.slug}`, "_blank");
    else router.push(`/a/${item.row.slug}`);
  };

  const refresh = () => router.refresh();

  const toggle = async (key: "pinned" | "archived") => {
    const item = flat[focus];
    if (!item) return;
    const next = !item.row[key];
    try {
      await patch(item.row.slug, { [key]: next });
      refresh();
      if (key === "archived")
        toast(next ? "Archived" : "Restored", {
          description: item.row.title,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await patch(item.row.slug, { archived: !next });
                refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            },
          },
        });
      else toast(next ? "Pinned" : "Unpinned", { description: item.row.title });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  useHotkeys({
    j: () => setFocus((f) => Math.min(f + 1, flat.length - 1)),
    k: () => setFocus((f) => Math.max(f - 1, 0)),
    arrowdown: () => setFocus((f) => Math.min(f + 1, flat.length - 1)),
    arrowup: () => setFocus((f) => Math.max(f - 1, 0)),
    enter: () => open(focus),
    o: () => open(focus),
    "mod+enter": () => open(focus, true),
    p: () => void toggle("pinned"),
    e: () => void toggle("archived"),
    escape: () => setFocus(-1),
  });

  let index = -1;

  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="flex flex-col">
          {section.title ? (
            <div className="flex items-baseline gap-3 px-4 pb-2.5 pt-7 md:px-7">
              <h2 className="text-[13px] font-semibold">{section.title}</h2>
              {section.subtitle ? <span className="text-xs text-muted-foreground max-md:hidden">{section.subtitle}</span> : null}
            </div>
          ) : null}

          {section.rows.length === 0 ? (
            section.empty ?? null
          ) : section.layout === "inbox" ? (
            <div className="flex flex-col gap-2 px-3 md:px-7">
              {section.rows.map((row) => {
                const i = ++index;
                const r = row as NeedsYouRow;
                return (
                  <Link
                    key={row.slug}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    href={`/a/${row.slug}`}
                    onClick={() => saveNavList(listLabel, flat.map((f) => f.row.slug))}
                    onMouseEnter={() => setFocus(i)}
                    className={cn(
                      "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] md:grid-cols-[28px_minmax(0,1fr)_minmax(0,220px)_64px] md:gap-3.5 border border-border bg-card px-4 py-3 transition-colors",
                      focus === i && "border-sand-line bg-[color-mix(in_oklab,var(--card),var(--sand)_5%)]",
                    )}
                  >
                    <ReasonGlyph reason={r.reason} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{row.title}</span>
                      <span className="truncate text-[13px] text-fg-3">{reasonText(r.reason, row)}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground max-md:hidden">
                      {row.project ? (
                        <>
                          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: projectColour(row.project) }} />
                          <span className="truncate">{row.project}</span>
                        </>
                      ) : null}
                      {row.agentName ? <span className="truncate">· {row.agentName}</span> : null}
                    </span>
                    <span className="text-right font-mono text-xs text-muted-foreground">
                      {r.reason.kind === "live" ? <span className="text-good">live</span> : <Ago iso={r.at} />}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div role="table" aria-label={section.title ?? listLabel} className="mx-3 overflow-hidden rounded-[10px] border border-hairline bg-well md:mx-7">
              <div
                role="row"
                className="grid h-[34px] grid-cols-[56px_minmax(0,1fr)_150px_100px_64px_64px_84px_28px] items-center max-md:hidden gap-3.5 border-b border-hairline px-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
              >
                <span role="columnheader" />
                <span role="columnheader">Title</span>
                <span role="columnheader">Project</span>
                <span role="columnheader">Agent</span>
                <span role="columnheader">Version</span>
                <span role="columnheader">Threads</span>
                <span role="columnheader" className="text-right">
                  Changed
                </span>
                <span role="columnheader" />
              </div>
              {section.rows.map((row) => {
                const i = ++index;
                return (
                  <div
                    key={row.slug}
                    role="row"
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    onMouseEnter={() => setFocus(i)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a,button,[role=menu]")) return;
                      open(i, e.metaKey || e.ctrlKey);
                    }}
                    className={cn(
                      "group grid h-16 cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto_32px] items-center gap-3 border-b md:h-14 md:grid-cols-[56px_minmax(0,1fr)_150px_100px_64px_64px_84px_28px] md:gap-3.5 border-[color-mix(in_oklab,var(--hairline),transparent_30%)] px-4 text-[13px] last:border-b-0",
                      focus === i && "bg-sand-soft/50 shadow-[inset_0_0_0_1.5px_var(--sand)]",
                    )}
                  >
                    <ShapeThumb shape={row.shape} colour={projectColour(row.project)} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Link
                          href={`/a/${row.slug}`}
                          onClick={() => saveNavList(listLabel, flat.map((f) => f.row.slug))}
                          className="truncate font-medium hover:text-sand-strong"
                        >
                          {row.title}
                        </Link>
                        {row.unseen ? <span aria-label="new" className="size-1.5 shrink-0 rounded-full bg-sand" /> : null}
                        {row.pinned ? <Pin aria-label="pinned" className="size-3 shrink-0 text-muted-foreground" /> : null}
                        {row.live ? <span className="shrink-0 text-[11px] text-good">● {row.live} is writing</span> : null}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {row.project ? <span className="md:hidden">{row.project} · </span> : null}
                        {KIND_LABEL[row.kind] ?? row.kind}
                        {row.branch ? ` · ⎇ ${row.branch}` : ""}
                        {row.series ? ` · ${row.series}${row.seriesCount > 1 ? `, ${row.seriesCount} runs` : ""}` : ""}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-fg-2 max-md:hidden">
                      {row.project ? (
                        <>
                          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: projectColour(row.project) }} />
                          <span className="truncate">{row.project}</span>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </span>
                    <span className="truncate text-fg-2 max-md:hidden">{row.agentName ?? <span className="text-faint">—</span>}</span>
                    <span className="font-mono text-fg-2 max-md:hidden">v{row.currentVersion}</span>
                    <span className={cn("font-mono max-md:hidden", row.unsent ? "text-warn" : "text-fg-2")}>
                      {row.openThreads || <span className="text-faint">—</span>}
                    </span>
                    <span className="text-right font-mono text-muted-foreground"><Ago iso={row.updatedAt} /></span>
                    <span className={cn("transition-opacity md:opacity-0 md:group-hover:opacity-100", focus === i && "md:opacity-100")}>
                      <RowMenu row={row} onChanged={refresh} onOrganise={(r, what) => setOrganise({ row: r, what })} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}

      <div
        aria-label="Keyboard shortcuts"
        className="pointer-events-none fixed bottom-5 right-7 hidden items-center gap-3.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-pop lg:flex"
      >
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">j</kbd>
          <kbd className="kbd">k</kbd> move
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">↵</kbd> open
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">p</kbd> pin
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">e</kbd> archive
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="kbd">⌘K</kbd> search
        </span>
      </div>

      <OrganiseDialog
        target={organise}
        onClose={() => setOrganise(null)}
        onSaved={() => {
          setOrganise(null);
          refresh();
        }}
      />
    </>
  );
}
