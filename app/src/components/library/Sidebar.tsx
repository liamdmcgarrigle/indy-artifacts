"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, Clock3, GitBranch, Inbox, Layers3, LogOut, Moon, Pin, Search, Settings, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SackMark } from "@/components/indy/brand";
import { openCommand } from "@/components/indy/CommandPalette";
import { useScheme } from "@/components/indy/scheme";
import { projectColour } from "@/lib/colors";
import type { SidebarCounts } from "@/lib/service/library";
import { cn } from "@/lib/utils";

function NavItem({
  href,
  icon,
  label,
  count,
  badge,
  active,
  mono,
  indent,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: boolean;
  active: boolean;
  mono?: boolean;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-[7px] px-2 text-[15px] md:h-[30px] md:text-[13px] text-sidebar-foreground transition-colors hover:bg-raised hover:text-foreground",
        active && "bg-raised font-medium text-foreground",
        indent && "ml-4",
      )}
    >
      <span className="flex w-[15px] justify-center">{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-[12px] md:text-[12px]")}>{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          className={cn(
            "font-mono text-[11px]",
            badge ? "rounded-full bg-primary px-[7px] py-px text-primary-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function Sidebar({
  counts,
  userName,
  host,
  signedIn,
  className,
}: {
  counts: SidebarCounts;
  userName: string;
  host: string;
  signedIn: boolean;
  className?: string;
}) {
  const path = usePathname();
  const branch = useSearchParams().get("branch");
  const { scheme, toggle } = useScheme();
  const is = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <nav
      aria-label="Library"
      className={cn("flex h-dvh w-[248px] shrink-0 flex-col gap-5 border-r border-hairline bg-sidebar px-3 py-3.5", className)}
    >
      <Link href="/" className="flex items-center gap-2.5 px-1.5 py-1">
        <SackMark size={16} className="text-sand" />
        <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">indy</span>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{host}</span>
      </Link>

      <button
        type="button"
        onClick={() => openCommand()}
        className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card pl-2.5 pr-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-fg-2"
      >
        <Search className="size-3.5" />
        <span className="flex-1">Search or jump to…</span>
        <kbd className="kbd max-md:hidden">⌘K</kbd>
      </button>

      <div className="flex flex-col gap-0.5">
        <NavItem href="/" icon={<Inbox className="size-[15px]" />} label="Needs you" count={counts.needsYou} badge active={is("/")} />
        <NavItem href="/recent" icon={<Clock3 className="size-[15px]" />} label="All recent" count={counts.recent} active={is("/recent")} />
        <NavItem href="/pinned" icon={<Pin className="size-[15px]" />} label="Pinned" count={counts.pinned} active={is("/pinned")} />
        <NavItem
          href="/live"
          icon={
            <span
              className={cn("size-[7px] rounded-full", counts.live ? "bg-good shadow-[0_0_0_3px_rgb(61_220_132/0.16)]" : "bg-faint")}
            />
          }
          label="Live now"
          count={counts.live}
          active={is("/live")}
        />
      </div>

      <div className="scroll-thin -mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        {counts.projects.length ? (
          <Section title="Projects">
            {counts.projects.map((p) => (
              <div key={p.name} className="flex flex-col gap-0.5">
                <NavItem
                  href={`/project/${encodeURIComponent(p.name)}`}
                  icon={<span className="size-2 rounded-[2px]" style={{ background: projectColour(p.name) }} />}
                  label={p.name}
                  count={p.count}
                  active={is(`/project/${encodeURIComponent(p.name)}`) && !branch}
                />
                {/* The open project lists its branches, so one branch's pages are a click away. */}
                {is(`/project/${encodeURIComponent(p.name)}`)
                  ? p.branches.map((b) => (
                      <NavItem
                        key={b.name}
                        href={`/project/${encodeURIComponent(p.name)}?branch=${encodeURIComponent(b.name)}`}
                        icon={<GitBranch className="size-3.5" />}
                        label={b.name}
                        count={b.count}
                        mono
                        indent
                        active={branch === b.name}
                      />
                    ))
                  : null}
              </div>
            ))}
          </Section>
        ) : null}
        {counts.series.length ? (
          <Section title="Series">
            {counts.series.map((s) => (
              <NavItem
                key={s.name}
                href={`/series/${encodeURIComponent(s.name)}`}
                icon={<Layers3 className="size-[15px]" />}
                label={s.name}
                count={s.count}
                active={is(`/series/${encodeURIComponent(s.name)}`)}
              />
            ))}
          </Section>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <NavItem href="/archive" icon={<Archive className="size-[15px]" />} label="Archive" count={counts.archived} active={is("/archive")} />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-[34px] items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] text-sidebar-foreground outline-none hover:bg-raised hover:text-foreground data-[state=open]:bg-raised">
            <span className="flex size-[18px] items-center justify-center rounded-full bg-sand-soft text-[10px] font-semibold text-sand-strong">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{userName}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[224px]">
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggle}>
              {scheme === "dark" ? <Sun /> : <Moon />} {scheme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            {signedIn ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.assign("/login");
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
