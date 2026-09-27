"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Command as Cmdk } from "cmdk";
import { Archive, Clock3, CornerDownLeft, FileText, Inbox, Layers3, Moon, Pin, Search, Settings, Sun, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { projectColour } from "@/lib/colors";
import { ago } from "@/lib/time";
import { MARK_CLOSE, MARK_OPEN } from "@/lib/service/search-marks";
import { useScheme } from "./scheme";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ registry
 *
 * A page adds the commands that make sense on it (Compare, Edit, Share on the
 * viewer) with useCommands; the palette shows them under Actions.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  icon?: React.ReactNode;
  keys?: string[];
  run: () => void;
}

let registered = new Map<string, PaletteCommand[]>();
const listeners = new Set<() => void>();
let snapshot: PaletteCommand[] = [];
function publish() {
  snapshot = [...registered.values()].flat();
  for (const l of listeners) l();
}

export function useCommands(owner: string, commands: PaletteCommand[]) {
  useEffect(() => {
    registered = new Map(registered).set(owner, commands);
    publish();
    return () => {
      registered = new Map(registered);
      registered.delete(owner);
      publish();
    };
  }, [owner, commands]);
}

function useRegistered() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

const OPEN_EVENT = "indy:command";
export function openCommand() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/* ------------------------------------------------------------ palette */

interface SearchResult {
  pages: { slug: string; title: string; project: string | null; series: string | null; updatedAt: string; kind: string }[];
  hits: { slug: string; title: string; project: string | null; snippet: string; version: number }[];
}

function Snippet({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    const open = rest.indexOf(MARK_OPEN);
    if (open < 0) {
      parts.push(rest);
      break;
    }
    const close = rest.indexOf(MARK_CLOSE, open);
    parts.push(rest.slice(0, open));
    parts.push(
      <mark key={key++} className="rounded-[2px] bg-sand-soft px-px text-foreground">
        {rest.slice(open + 1, close < 0 ? undefined : close)}
      </mark>,
    );
    rest = close < 0 ? "" : rest.slice(close + 1);
  }
  return <>{parts}</>;
}

const GROUP =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted-foreground";
const ITEM =
  "flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm outline-none data-[selected=true]:bg-sand-soft data-[selected=true]:shadow-[inset_2px_0_0_var(--sand)]";

export function CommandPalette({ projects }: { projects: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<SearchResult>({ pages: [], hits: [] });
  const [recent, setRecent] = useState<SearchResult["pages"]>([]);
  const actions = useRegistered();
  const { scheme, toggle } = useScheme();
  const seq = useRef(0);

  useHotkeys({ "mod+k": () => setOpen((o) => !o) });
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPicking(false);
      return;
    }
    fetch("/api/artifacts?limit=6")
      .then((r) => r.json())
      .then((d) =>
        setRecent(
          (d.artifacts ?? []).map((a: Record<string, unknown>) => ({
            slug: a.slug,
            title: a.title,
            project: a.project,
            series: a.series ?? null,
            updatedAt: a.updatedAt,
            kind: a.kind,
          })),
        ),
      )
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResult({ pages: [], hits: [] });
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (project) params.set("project", project);
      fetch(`/api/search?${params}`)
        .then((r) => r.json())
        .then((d) => {
          if (mine === seq.current) setResult({ pages: d.pages ?? [], hits: d.hits ?? [] });
        })
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(t);
  }, [query, project]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const navigation = useMemo(
    () => [
      { id: "nav-needs", label: "Needs you", icon: <Inbox />, href: "/" },
      { id: "nav-recent", label: "All recent", icon: <Clock3 />, href: "/recent" },
      { id: "nav-pinned", label: "Pinned", icon: <Pin />, href: "/pinned" },
      { id: "nav-archive", label: "Archive", icon: <Archive />, href: "/archive" },
      { id: "nav-settings", label: "Settings", icon: <Settings />, href: "/settings" },
    ],
    [],
  );

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const pages = q ? result.pages : project ? recent.filter((r) => r.project === project) : recent;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[110px] w-[640px] max-w-[calc(100vw-32px)] translate-y-0 gap-0 overflow-hidden rounded-[14px] border-input bg-card p-0 shadow-dialog sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <Cmdk shouldFilter={false} loop className="flex flex-col">
          <div className="flex h-14 items-center gap-3 border-b border-border px-[18px]">
            <Search className="size-[18px] text-muted-foreground" />
            {project ? (
              <span className="flex h-6 items-center gap-1.5 rounded-md bg-raised px-2 text-xs text-fg-2">
                <span className="size-[7px] rounded-[2px]" style={{ background: projectColour(project) }} />
                {project}
                <button type="button" aria-label="Clear project" onClick={() => setProject(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
            <Cmdk.Input
              value={query}
              onValueChange={setQuery}
              placeholder={picking ? "Filter by project…" : "Search pages and their text, or type a command"}
              className="h-full flex-1 bg-transparent text-[17px] text-foreground outline-none placeholder:text-faint"
              onKeyDown={(e) => {
                if (e.key === "Tab" && !e.shiftKey) {
                  e.preventDefault();
                  setPicking((p) => !p);
                  setQuery("");
                } else if (e.key === "Backspace" && !query && project) {
                  setProject(null);
                }
              }}
            />
          </div>

          <Cmdk.List className="scroll-thin max-h-[min(460px,60vh)] overflow-y-auto p-2">
            <Cmdk.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q ? `Nothing matches “${query.trim()}”.` : "Start typing."}
            </Cmdk.Empty>

            {picking ? (
              <Cmdk.Group heading="Projects" className={GROUP}>
                {projects.filter(matches).map((p) => (
                  <Cmdk.Item
                    key={p}
                    value={`project-${p}`}
                    className={ITEM}
                    onSelect={() => {
                      setProject(p);
                      setPicking(false);
                      setQuery("");
                    }}
                  >
                    <span className="size-2 rounded-[2px]" style={{ background: projectColour(p) }} />
                    {p}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            ) : (
              <>
                {pages.length ? (
                  <Cmdk.Group heading={q ? "Pages" : "Recent"} className={GROUP}>
                    {pages.map((p) => (
                      <Cmdk.Item key={p.slug} value={`page-${p.slug}`} className={ITEM} onSelect={() => go(`/a/${p.slug}`)}>
                        {p.series ? <Layers3 className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {p.project ? `${p.project} · ` : ""}
                          {ago(p.updatedAt)}
                        </span>
                      </Cmdk.Item>
                    ))}
                  </Cmdk.Group>
                ) : null}

                {q && result.hits.length ? (
                  <Cmdk.Group heading="In the text" className={GROUP}>
                    {result.hits.map((h) => (
                      <Cmdk.Item
                        key={`hit-${h.slug}`}
                        value={`hit-${h.slug}`}
                        className={cn(ITEM, "flex-col items-stretch gap-0.5 py-2")}
                        onSelect={() => go(`/a/${h.slug}?find=${encodeURIComponent(query.trim())}`)}
                      >
                        <span className="flex gap-2 text-xs text-muted-foreground">
                          <span className="text-fg-2">{h.title}</span>
                          {h.project ? <span>· {h.project}</span> : null}
                          <span className="ml-auto font-mono">v{h.version}</span>
                        </span>
                        <span className="line-clamp-2 text-[13px] text-fg-2">
                          <Snippet text={h.snippet} />
                        </span>
                      </Cmdk.Item>
                    ))}
                  </Cmdk.Group>
                ) : null}

                {actions.filter((a) => matches(a.label)).length ? (
                  <Cmdk.Group heading="Actions" className={GROUP}>
                    {actions
                      .filter((a) => matches(a.label))
                      .map((a) => (
                        <Cmdk.Item
                          key={a.id}
                          value={a.id}
                          className={ITEM}
                          onSelect={() => {
                            setOpen(false);
                            a.run();
                          }}
                        >
                          <span className="flex size-4 items-center text-muted-foreground [&_svg]:size-4">{a.icon}</span>
                          <span className="flex-1">{a.label}</span>
                          {a.keys ? (
                            <span className="flex gap-1">
                              {a.keys.map((k) => (
                                <kbd key={k} className="kbd">{k}</kbd>
                              ))}
                            </span>
                          ) : null}
                        </Cmdk.Item>
                      ))}
                  </Cmdk.Group>
                ) : null}

                {navigation.filter((n) => matches(n.label)).length ? (
                  <Cmdk.Group heading="Go to" className={GROUP}>
                    {navigation
                      .filter((n) => matches(n.label))
                      .map((n) => (
                        <Cmdk.Item key={n.id} value={n.id} className={ITEM} onSelect={() => go(n.href)}>
                          <span className="flex size-4 items-center text-muted-foreground [&_svg]:size-4">{n.icon}</span>
                          {n.label}
                        </Cmdk.Item>
                      ))}
                    {matches(scheme === "dark" ? "Light mode" : "Dark mode") ? (
                      <Cmdk.Item value="scheme" className={ITEM} onSelect={() => toggle()}>
                        <span className="flex size-4 items-center text-muted-foreground [&_svg]:size-4">
                          {scheme === "dark" ? <Sun /> : <Moon />}
                        </span>
                        {scheme === "dark" ? "Light mode" : "Dark mode"}
                      </Cmdk.Item>
                    ) : null}
                  </Cmdk.Group>
                ) : null}
              </>
            )}
          </Cmdk.List>

          <div className="flex h-[38px] items-center gap-4 border-t border-border bg-well px-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">
                <CornerDownLeft className="size-3" />
              </kbd>{" "}
              open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">⇥</kbd> {picking ? "back to search" : "filter by project"}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <kbd className="kbd">esc</kbd> close
            </span>
          </div>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}
