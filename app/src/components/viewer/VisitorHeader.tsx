"use client";

import { MessageSquare, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SackMark } from "@/components/indy/brand";
import { cn } from "@/lib/utils";

/**
 * The bar over a shared page. A visitor has one page and nothing else, so it
 * says whose page it is and, when the link allows, offers comments.
 */
export function VisitorHeader({
  title,
  sharedBy,
  threads,
  panel,
  onThreads,
  onComment,
}: {
  title: string;
  sharedBy: string | null;
  /** Thread count, or null when comments are off on this link. */
  threads: number | null;
  panel: "none" | "list" | "send";
  onThreads: () => void;
  onComment: (() => void) | null;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-background px-3 md:h-[52px] md:bg-background/92 md:px-4 md:backdrop-blur">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-sand">
        <SackMark size={13} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[14px] font-medium text-foreground">{title}</span>
        {sharedBy ? <span className="truncate text-[12px] text-muted-foreground">Shared by {sharedBy}</span> : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {threads !== null ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Comments"
            className={cn("h-10 gap-1.5 px-2.5 text-fg-2 md:h-8", panel === "list" && "bg-raised text-foreground")}
            onClick={onThreads}
          >
            <MessageSquare className="size-4 md:size-3.5" /> <span className="max-md:hidden">Comments</span>
            {threads ? <span className="font-mono text-[11px] text-muted-foreground">{threads}</span> : null}
          </Button>
        ) : null}
        {onComment ? (
          <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2.5 text-fg-2 max-md:hidden md:h-8" onClick={onComment}>
            <MessageSquarePlus className="size-3.5" /> Comment
            <kbd className="kbd ml-1">c</kbd>
          </Button>
        ) : null}
      </span>
    </header>
  );
}

/** The small credit at the foot of a shared page. */
export function MadeWithIndy({ raised = false }: { raised?: boolean }) {
  return (
    <div className={cn("made-with", raised && "made-with--raised")}>
      <SackMark size={11} />
      made with indy
    </div>
  );
}
