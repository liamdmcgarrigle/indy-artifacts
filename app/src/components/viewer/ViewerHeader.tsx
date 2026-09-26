"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, MessageSquare, MoreHorizontal, Pencil, Send } from "lucide-react";
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
  version,
  latest,
  versions,
  nav,
  threads,
  unsent,
  agentName,
  panel,
  canEdit,
  canCompare,
  onVersion,
  onNav,
  onThreads,
  onSend,
  menu,
}: {
  slug: string;
  title: string;
  project: string | null;
  series: string | null;
  version: VersionStep;
  latest: number;
  versions: VersionStep[];
  nav: { label: string; index: number; count: number } | null;
  threads: number;
  unsent: number;
  agentName: string | null;
  panel: "none" | "list" | "send";
  canEdit: boolean;
  canCompare: boolean;
  onVersion: (n: number) => void;
  onNav: (step: 1 | -1) => void;
  onThreads: () => void;
  onSend: () => void;
  menu?: React.ReactNode;
}) {
  const first = versions[versions.length - 1]?.number ?? 1;
  return (
    <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline bg-background/92 px-4 backdrop-blur">
      <Tip label="Back to the library" keys="esc">
        <Link href="/" aria-label="Back to the library" className={cn(iconButton, "flex items-center justify-center")}>
          <ArrowLeft className="size-4" />
        </Link>
      </Tip>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {project ? (
          <>
            <Link href={`/project/${encodeURIComponent(project)}`} className="flex shrink-0 items-center gap-1.5 text-fg-2 hover:text-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: projectColour(project) }} />
              {project}
            </Link>
            <span className="text-faint">/</span>
          </>
        ) : null}
        {series ? (
          <>
            <Link href={`/series/${encodeURIComponent(series)}`} className="shrink-0 text-fg-2 hover:text-foreground">
              {series}
            </Link>
            <span className="text-faint">/</span>
          </>
        ) : null}
        <span className="truncate font-medium text-foreground">{title}</span>
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

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="flex h-8 items-center rounded-lg border border-border bg-card">
          <Tip label="Older version" keys="[">
            <Button variant="ghost" size="icon" className={cn(iconButton, "rounded-r-none")} aria-label="Older version" disabled={version.number <= first} onClick={() => onVersion(version.number - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger className="h-7 px-1.5 font-mono text-[12px] outline-none hover:text-foreground">
              v{version.number}
              <span className="text-muted-foreground">
                {" "}
                of {latest} · {version.authorName} · {ago(version.createdAt)}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[360px] w-[260px] overflow-y-auto">
              {versions.map((v) => (
                <DropdownMenuItem key={v.number} onSelect={() => onVersion(v.number)} className={cn("font-mono text-[12px]", v.number === version.number && "bg-raised")}>
                  <span className="w-8">v{v.number}</span>
                  <span className="flex-1 truncate text-muted-foreground">{v.authorName}</span>
                  <span className="text-muted-foreground">{ago(v.createdAt)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label="Newer version" keys="]">
            <Button variant="ghost" size="icon" className={cn(iconButton, "rounded-l-none")} aria-label="Newer version" disabled={version.number >= latest} onClick={() => onVersion(version.number + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </Tip>
        </div>

        {canCompare ? (
          <Button variant="ghost" size="sm" asChild className="h-8 gap-1.5 text-fg-2">
            <Link href={`/a/${slug}/v/${version.number}?diff=${version.number - 1}`}>
              <Columns2 className="size-3.5" /> Compare
            </Link>
          </Button>
        ) : null}
        {canEdit ? (
          <Tip label="Edit" keys="e">
            <Button variant="ghost" size="sm" asChild className="h-8 gap-1.5 text-fg-2">
              <Link href={`/a/${slug}/edit`}>
                <Pencil className="size-3.5" /> Edit
              </Link>
            </Button>
          </Tip>
        ) : null}

        <span className="mx-1 h-5 w-px bg-hairline" />

        <Button variant="ghost" size="sm" className={cn("h-8 gap-1.5 text-fg-2", panel === "list" && "bg-raised text-foreground")} onClick={onThreads}>
          <MessageSquare className="size-3.5" /> Threads
          {threads ? <span className="font-mono text-[11px] text-muted-foreground">{threads}</span> : null}
        </Button>
        {unsent ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={onSend}>
            <Send className="size-3.5" /> Send to {agentName ?? "agent"}
            <span className="font-mono text-[11px] opacity-70">{unsent}</span>
          </Button>
        ) : null}
        {menu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={iconButton} aria-label="More">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

export { DropdownMenuItem as ViewerMenuItem, DropdownMenuSeparator as ViewerMenuSeparator };
