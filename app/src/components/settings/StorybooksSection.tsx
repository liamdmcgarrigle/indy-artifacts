"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Copy, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import { agoLong } from "@/lib/time";
import type { StoryEntry, StorybookSummary } from "@/lib/service/storybooks";
import { Card, Head, send, type Say } from "./parts";

export interface StorybooksState {
  storybooks: StorybookSummary[];
}

function size(n: number): string {
  const mb = n / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function globals(value: Record<string, unknown> | undefined): string {
  const entries = Object.entries(value ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ") : "Storybook's default";
}

/**
 * The Storybooks agents have uploaded. Pages show their stories; this is
 * where the owner sees what is stored, finds a story's id, and deletes one.
 */
export function StorybooksSection({ state, setState, say }: { state: StorybooksState; setState: (s: StorybooksState) => void; say: Say }) {
  const [open, setOpen] = useState<string | null>(null);

  async function remove(name: string) {
    if (!window.confirm(`Delete the "${name}" Storybook and every build of it? Pages that show its stories will say it is gone until an agent uploads it again.`)) return;
    try {
      const next = (await send(`/api/storybooks/${encodeURIComponent(name)}`, "DELETE")) as unknown as StorybooksState;
      setState(next);
      say.good(`Deleted the "${name}" Storybook.`);
    } catch (err) {
      say.bad(err);
    }
  }

  return (
    <>
      <Head
        title="Storybooks"
        lede="Built Storybooks your agents uploaded, so pages can show real components with story blocks. A page keeps the build it was written against; anyone who can see that page can load that build's files."
      />
      {state.storybooks.length === 0 ? (
        <Card>
          <div className="flex flex-col gap-2 px-[18px] py-6 text-sm">
            <p className="m-0 font-medium">No Storybooks yet.</p>
            <p className="m-0 leading-relaxed text-muted-foreground">
              Ask an agent working in a project with Storybook to upload it. It builds the Storybook, then sends it here with one command from artifact_storybook_upload.
            </p>
          </div>
        </Card>
      ) : (
        state.storybooks.map((s) => (
          <Card
            key={s.name}
            title={s.name}
            action={
              <button type="button" className="text-[13px] text-bad hover:underline" onClick={() => void remove(s.name)}>
                Delete
              </button>
            }
          >
            <div className="flex flex-col gap-3 px-[18px] py-4 text-[13px]">
              <p className="m-0 text-fg-2">
                {s.latest ? (
                  <>
                    {s.latest.stories} stories · uploaded {agoLong(s.latest.createdAt)} by {s.latest.createdBy} · {s.builds} build{s.builds === 1 ? "" : "s"} kept, {size(s.bytes)}
                  </>
                ) : (
                  "No builds."
                )}
              </p>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-muted-foreground max-sm:grid-cols-1">
                <dt className="font-medium text-fg-2">Light pages</dt>
                <dd className="m-0 min-w-0 break-words max-sm:mb-1">{globals(s.settings.light)}</dd>
                <dt className="font-medium text-fg-2">Dark pages</dt>
                <dd className="m-0 min-w-0 break-words max-sm:mb-1">{globals(s.settings.dark)}</dd>
                <dt className="font-medium text-fg-2">Remote images</dt>
                <dd className="m-0 min-w-0 break-words">{s.settings.hosts?.length ? s.settings.hosts.join(", ") : "none allowed"}</dd>
              </dl>
              {s.latest ? (
                <button
                  type="button"
                  className="flex w-fit items-center gap-1.5 text-fg-2 hover:text-foreground"
                  aria-expanded={open === s.name}
                  onClick={() => setOpen(open === s.name ? null : s.name)}
                >
                  <BookOpen className="size-3.5" /> {open === s.name ? "Hide stories" : "Browse stories"}
                </button>
              ) : null}
            </div>
            {open === s.name ? <StoryList name={s.name} say={say} /> : null}
          </Card>
        ))
      )}
    </>
  );
}

function StoryList({ name, say }: { name: string; say: Say }) {
  const [query, setQuery] = useState("");
  const [stories, setStories] = useState<{ total: number; stories: StoryEntry[] } | null>(null);

  // The parent makes a new say on every render; the search must not rerun for it.
  const sayRef = useRef(say);
  sayRef.current = say;

  // Each keystroke searches; a slower answer to an older query is dropped.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/storybooks/${encodeURIComponent(name)}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? "Could not load the stories.");
        setStories({ total: data.total, stories: data.stories });
      } catch (err) {
        if (!controller.signal.aborted) sayRef.current.bad(err);
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [name, query]);

  return (
    <div className="border-t border-hairline">
      <form
        className="flex items-center gap-2 px-[18px] py-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          aria-label={`Search the ${name} stories`}
          placeholder="Search by component or story"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
        {(stories?.stories ?? []).map((story) => (
          <li key={story.id} className="flex items-center gap-3 border-t border-hairline px-[18px] py-2 text-[13px]">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                {story.title} <span className="text-muted-foreground">/ {story.name}</span>
              </span>
              <code className="truncate text-[12px] text-muted-foreground">{story.id}</code>
            </span>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 text-fg-2 hover:text-foreground"
              aria-label={`Copy the id ${story.id}`}
              onClick={async () => ((await copyText(story.id)) ? say.good("Story id copied.") : say.bad("Your browser would not copy."))}
            >
              <Copy className="size-3.5" /> Copy id
            </button>
          </li>
        ))}
      </ul>
      {stories ? (
        <p className="m-0 border-t border-hairline px-[18px] py-2.5 text-[12px] text-muted-foreground">
          {stories.total === 0 ? "No stories match." : stories.total > stories.stories.length ? `Showing ${stories.stories.length} of ${stories.total}; search to narrow.` : `${stories.total} ${stories.total === 1 ? "story" : "stories"}.`}
        </p>
      ) : null}
    </div>
  );
}
