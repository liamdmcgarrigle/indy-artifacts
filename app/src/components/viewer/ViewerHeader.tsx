"use client";

import Link from "next/link";
import { ArrowLeft, Check, GitBranch, History, ListChecks, ChevronDown, ChevronUp, Columns2, MessageSquare, MoreHorizontal, Pencil, Send, Share2, Globe, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { projectColour } from "@/lib/colors";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface VersionStep {
  number: number;
  authorName: string;
  createdAt: string;
}

function Tip({ label, keys, children }: { label: string; keys?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys ? <kbd className="kbd ml-2">{keys}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

const iconButton = "size-7 rounded-md text-fg-2 hover:bg-raised hover:text-foreground disabled:opacity-35";

export function ViewerHeader({
  slug,
  title,
  project,
  series,
  branch,
  version,
  latest,
  versions,
  nav,
  threads,
  unsent,
  panel,
  canEdit,
  canCompare,
  responses,
  onVersion,
  onNav,
  onThreads,
  onSend,
  onEdit,
  onShare,
  sharing = "private",
  editing,
  menu,
}: {
  slug: string;
  title: string;
  project: string | null;
  series: string | null;
  branch?: string | null;
  version: VersionStep;
  latest: number;
  versions: VersionStep[];
  nav: { label: string; index: number; count: number } | null;
  threads: number;
  unsent: number;
  /** Kept for callers; the button always says "agent". */
  agentName?: string | null;
  panel: "none" | "list" | "send";
  canEdit: boolean;
  canCompare: boolean;
  /** Response count, on a form page. */
  responses?: number | null;
  onVersion: (n: number) => void;
  onNav: (step: 1 | -1) => void;
  onThreads: () => void;
  onSend: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  /** Who can open the page, so the Share button can say so. */
  sharing?: "private" | "link" | "email";
  /** Set while the page is being edited: the bar becomes Cancel and Done. */
  editing?: { dirty: boolean; saving: boolean; onCancel: () => void; onDone: () => void } | null;
  menu?: React.ReactNode;
}) {
  if (editing) {
    return (
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-background px-3 md:h-[52px] md:bg-background/92 md:px-4 md:backdrop-blur">
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="edit-dot" aria-hidden />
          <span className="shrink-0 font-medium text-foreground">Editing</span>
          <span className="truncate text-muted-foreground max-sm:hidden">{title}</span>
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground max-sm:hidden">
          {editing.dirty ? "Not saved yet" : "No changes"}
        </span>
        <Button variant="ghost" size="sm" className="h-10 px-3 text-fg-2 max-sm:ml-auto md:h-8" onClick={editing.onCancel} disabled={editing.saving}>
          Cancel
        </Button>
        <Tip label="Save as a new version" keys="⌘S">
          <Button size="sm" className="btn--primary h-10 gap-1.5 px-4 md:h-8" onClick={editing.onDone} disabled={editing.saving}>
            <Check className="size-4 md:size-3.5" /> {editing.saving ? "Saving" : "Done"}
          </Button>
        </Tip>
      </header>
    );
  }
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-hairline bg-background px-2 md:h-[52px] md:gap-3 md:bg-background/92 md:px-4 md:backdrop-blur">
      <Tip label="Back to the library" keys="esc">
        <Link href="/" aria-label="Back to the library" className={cn(iconButton, "flex size-10 items-center justify-center md:size-7")}>
          <ArrowLeft className="size-5 md:size-4" />
        </Link>
      </Tip>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {project ? (
          <>
            <Link href={`/project/${encodeURIComponent(project)}`} className="flex shrink-0 items-center gap-1.5 text-fg-2 hover:text-foreground max-md:hidden">
              <span className="size-2 rounded-[2px]" style={{ background: projectColour(project) }} />
              {project}
            </Link>
            <span className="text-faint max-md:hidden">/</span>
            {branch ? (
              <>
                <Link
                  href={`/project/${encodeURIComponent(project)}?branch=${encodeURIComponent(branch)}`}
                  className="flex shrink-0 items-center gap-1 font-mono text-[12px] text-muted-foreground hover:text-foreground max-lg:hidden"
                >
                  <GitBranch className="size-3" />
                  {branch}
                </Link>
                <span className="text-faint max-lg:hidden">/</span>
              </>
            ) : null}
          </>
        ) : null}
        {series ? (
          <>
            <Link href={`/series/${encodeURIComponent(series)}`} className="shrink-0 text-fg-2 hover:text-foreground max-md:hidden">
              {series}
            </Link>
            <span className="text-faint max-md:hidden">/</span>
          </>
        ) : null}
        <span className="truncate text-[15px] font-medium text-foreground md:text-[13px]">{title}</span>
      </nav>

      {nav ? (
        <div className="ml-2 hidden shrink-0 items-center gap-0.5 lg:flex">
          <Tip label="Previous page" keys="k">
            <Button variant="ghost" size="icon" className={iconButton} aria-label="Previous page" disabled={nav.index === 0} onClick={() => onNav(-1)}>
              <ChevronUp className="size-4" />
            </Button>
          </Tip>
          <Tip label="Next page" keys="j">
            <Button variant="ghost" size="icon" className={iconButton} aria-label="Next page" disabled={nav.index >= nav.count - 1} onClick={() => onNav(1)}>
              <ChevronDown className="size-4" />
            </Button>
          </Tip>
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            {nav.index + 1} of {nav.count} in {nav.label}
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-1.5">
        <VersionMenu slug={slug} version={version} latest={latest} versions={versions} onVersion={onVersion} />
        {canEdit ? (
          <Tip label="Edit" keys="e">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-fg-2 max-md:hidden" onClick={onEdit}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          </Tip>
        ) : null}

        {canEdit ? (
          <Button variant="ghost" size="icon" className={cn(iconButton, "size-10 md:hidden")} aria-label="Edit" onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
        ) : null}
        {responses !== null && responses !== undefined ? (
          <Button variant="ghost" size="sm" asChild className="h-10 gap-1.5 px-2.5 text-fg-2 md:h-8">
            <Link href={`/a/${slug}/responses`} aria-label="Responses">
              <ListChecks className="size-4 md:size-3.5" /> <span className="max-md:hidden">Responses</span>
              <span className="font-mono text-[11px] text-muted-foreground">{responses}</span>
            </Link>
          </Button>
        ) : null}
        <span className="mx-1 h-5 w-px bg-hairline max-md:hidden" />

        <Button
          variant="ghost"
          size="sm"
          aria-label="Threads"
          className={cn("h-10 gap-1.5 px-2.5 text-fg-2 md:h-8", panel === "list" && "bg-raised text-foreground")}
          onClick={onThreads}
        >
          <MessageSquare className="size-4 md:size-3.5" /> <span className="max-md:hidden">Threads</span>
          {threads ? <span className="font-mono text-[11px] text-muted-foreground">{threads}</span> : null}
        </Button>
        {onShare ? (
          <ShareButton sharing={sharing} onShare={onShare} />
        ) : null}
        {unsent ? (
          <Button size="sm" className="h-10 gap-1.5 px-3 md:h-8" onClick={onSend} aria-label="Send to agent">
            <Send className="size-4 md:size-3.5" /> <span className="max-md:hidden">Send to agent</span>
            <span className="font-mono text-[11px] opacity-70">{unsent}</span>
          </Button>
        ) : null}
        {menu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={cn(iconButton, "size-10 md:size-7")} aria-label="More">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

const SHARING = {
  private: { icon: Share2, label: "Share", tip: "Only you can open this. Share it" },
  link: { icon: Globe, label: "Shared", tip: "Anyone with the link can open this" },
  email: { icon: AtSign, label: "Shared", tip: "Anyone who confirms their email can open this" },
} as const;

/**
 * Share, and what sharing is on: a plain button while the page is private,
 * a globe or an @ in sand once others can open it. On a phone it shows only
 * when shared, as a sign; the menu has Share either way.
 */
function ShareButton({ sharing, onShare }: { sharing: "private" | "link" | "email"; onShare: () => void }) {
  const { icon: Icon, label, tip } = SHARING[sharing];
  const shared = sharing !== "private";
  return (
    <Tip label={tip}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={tip}
        className={cn(
          "h-10 gap-1.5 px-2.5 text-fg-2 md:h-8",
          shared ? "text-sand-strong hover:bg-sand-soft hover:text-sand-strong" : "max-md:hidden",
        )}
        onClick={onShare}
      >
        <Icon className="size-4 md:size-3.5" /> <span className="max-lg:hidden">{label}</span>
      </Button>
    </Tip>
  );
}

/**
 * One icon for the page's history. The list names each version; the button at
 * the end of a row compares it with the version on screen.
 */
function VersionMenu({
  slug,
  version,
  latest,
  versions,
  onVersion,
}: {
  slug: string;
  version: VersionStep;
  latest: number;
  versions: VersionStep[];
  onVersion: (n: number) => void;
}) {
  const behind = version.number !== latest;
  const compareHref = (other: number) =>
    `/a/${slug}/v/${Math.max(other, version.number)}?diff=${Math.min(other, version.number)}`;
  return (
    <DropdownMenu>
      <Tip label={versions.length > 1 ? "Versions and compare" : "Versions"} keys="[ ]">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Version ${version.number} of ${latest}`}
            className={cn(
              "h-10 gap-1 px-2.5 text-fg-2 md:h-8 md:px-2",
              behind && "bg-sand-soft text-sand-strong hover:bg-sand-soft hover:text-sand-strong",
            )}
          >
            <History className="size-4 md:size-3.5" />
            {behind ? <span className="font-mono text-[12px]">v{version.number}</span> : null}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-[300px] p-1">
        <div className="px-2 pt-1.5 pb-2 text-[12px] font-medium text-muted-foreground">Versions</div>
        <div className="max-h-[360px] overflow-y-auto">
          {versions.map((v) => {
            const here = v.number === version.number;
            return (
              <DropdownMenuItem
                key={v.number}
                onSelect={() => onVersion(v.number)}
                className={cn("group gap-2 py-1.5 pr-1 font-mono text-[12px]", here && "bg-sand-soft")}
              >
                <span className={cn("w-7", here ? "text-sand-strong" : "text-foreground")}>v{v.number}</span>
                <span className="flex-1 truncate text-muted-foreground">{v.authorName}</span>
                <span className="text-muted-foreground">{ago(v.createdAt)}</span>
                {here ? (
                  <span className="flex size-7 items-center justify-center text-[10px] text-faint" aria-label="Showing">
                    ●
                  </span>
                ) : (
                  <Link
                    href={compareHref(v.number)}
                    onClick={(e) => e.stopPropagation()}
                    title={`Compare v${v.number} with v${version.number}`}
                    aria-label={`Compare v${v.number} with v${version.number}`}
                    className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-background hover:text-foreground group-focus:text-fg-2"
                  >
                    <Columns2 className="size-3.5" />
                  </Link>
                )}
              </DropdownMenuItem>
            );
          })}
        </div>
        {version.number > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={compareHref(version.number - 1)} className="gap-2 text-[13px]">
                <Columns2 className="size-3.5" /> Compare v{version.number} with v{version.number - 1}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DropdownMenuItem as ViewerMenuItem, DropdownMenuSeparator as ViewerMenuSeparator };
