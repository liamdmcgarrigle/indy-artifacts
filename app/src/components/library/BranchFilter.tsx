import Link from "next/link";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

/** Branch chips above a project's pages: all of them, or one branch's. */
export function BranchFilter({
  project,
  branches,
  active,
}: {
  project: string;
  branches: { name: string; count: number }[];
  active: string | null;
}) {
  if (!branches.length) return null;
  const base = `/project/${encodeURIComponent(project)}`;
  const chip = (href: string, on: boolean, children: React.ReactNode, key: string) => (
    <Link
      key={key}
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] md:h-7 md:text-xs",
        on ? "border-sand-line bg-sand-soft text-sand-strong" : "border-border text-fg-2 hover:border-input hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
  return (
    <nav aria-label="Branches" className="scroll-thin flex gap-2 overflow-x-auto px-3 pt-4 md:px-7">
      {chip(base, active === null, "All branches", "all")}
      {branches.map((b) =>
        chip(
          `${base}?branch=${encodeURIComponent(b.name)}`,
          active === b.name,
          <>
            <GitBranch className="size-3.5" />
            <span className="font-mono">{b.name}</span>
            <span className="font-mono text-muted-foreground">{b.count}</span>
          </>,
          b.name,
        ),
      )}
    </nav>
  );
}
