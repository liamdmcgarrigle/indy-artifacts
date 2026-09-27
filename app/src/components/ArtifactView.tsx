"use client";

import { Ago } from "@/components/indy/Ago";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCommands, type PaletteCommand } from "@/components/indy/CommandPalette";
import {
  anchorForBlock,
  anchorFromPick,
  anchorFromPoint,
  pickTarget,
  anchorFromSelection,
  blockOf,
  describeAnchor,
  rangeForAnchor,
  resolveAnchor,
  isOverText,
  kindName,
  pointQuote,
  truncate,
  type Anchor,
  type Spot,
} from "@/lib/anchors";
import type { Editor, JSONContent } from "@tiptap/core";
import { Typeable } from "./editor/Typeable";
import { DocView } from "./viewer/DocView";
import { ViewerHeader, ViewerMenuItem, ViewerMenuSeparator } from "./viewer/ViewerHeader";
import { readNavList, type NavList } from "./library/nav-list";
import type { FieldSpec, FormSettings } from "@/lib/forms/spec";
import { FormProvider } from "./forms/FormState";
import { FormBar } from "./forms/FormBar";
import { ShareDialog } from "./viewer/ShareDialog";
import { primitivesUrl } from "@/lib/primitives";
import { MadeWithIndy, VisitorHeader } from "./viewer/VisitorHeader";
import { IDENTITY_HEADER, IdentityDialog, renewIdentity, storedIdentity, storeIdentity, type VisitorIdentity } from "./share/IdentityDialog";
import { createTickStore } from "@/lib/doc/tasks-view";
import type { TickView } from "@/lib/tasks";
import type { Listener } from "@/lib/service/listeners";

export interface ThreadView {
  id: string;
  authorKind: "agent" | "human" | "visitor";
  authorName: string;
  body: string;
  anchor: Anchor | null;
  status: "open" | "resolved";
  sentAt: string | null;
  /** A visitor's thread, once the owner has passed it on to the agent. */
  approvedAt?: string | null;
  /** A visitor's thread the owner asked the agent to address. */
  endorsedAt?: string | null;
  versionNumber: number;
  createdAt: string;
  replies: {
    id: string;
    authorKind: "agent" | "human" | "visitor";
    authorName: string;
    body: string;
    createdAt: string;
  }[];
}

export interface VersionStub {
  number: number;
  authorKind: "agent" | "human";
  authorName: string;
  message: string | null;
  createdAt: string;
  buildStatus: string;
}

export interface ArtifactViewProps {
  slug: string;
  title: string;
  project: string | null;
  series: string | null;
  branch: string | null;
  description: string | null;
  agentName: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  /** The page's questions, when it is a form. */
  form: { fields: FieldSpec[]; settings: FormSettings; responses: number } | null;
  /** The signed-in owner's name, used as the comment author. */
  userName?: string | null;
  /** The markdown as a document for the editor; null for framed artifacts. */
  doc: JSONContent | null;
  assetBase: string;
  kind: string;
  /** The effective theme's name, and its stylesheet. */
  theme: string;
  themeHref: string;
  currentVersion: number;
  versionNumber: number;
  authorKind: string;
  authorName: string;
  buildStatus: string;
  buildLog: string | null;
  warnings: { line: number; message: string }[];
  html: string | null;
  embedBase: string;
  framed: boolean;
  versions: VersionStub[];
  initialThreads: ThreadView[];
  /** Who can open the page besides the owner. */
  sharing?: "private" | "link" | "email";
  /** Storybooks this version shows stories from. */
  storybooks?: string[];
  /** Set when a visitor opens the page through a share link. */
  visitor?: VisitorInfo | null;
  /** People's ticks on this version's task items. */
  ticks?: TickView[];
  /** Ticks not yet sent to the agent. */
  unsentTicks?: number;
}

export interface VisitorInfo {
  token: string;
  email: string | null;
  /** Whether the link lets visitors take part: comment and tick. */
  allowComments: boolean;
  sharedBy: string | null;
  mode?: "link" | "email";
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Pin extends Spot {
  thread: ThreadView;
  exact: boolean;
  /** Where the anchor itself sits, in overlay coordinates. */
  mark: Box;
  /** The picked element, for element anchors. */
  box?: Box;
}

/**
 * Comments sit on the page the way they do in Figma: a pin on the exact spot,
 * its point on the words or element it is about, and the card opening beside
 * it (a sheet from the bottom on a phone).
 */
const PIN_SIZE = 26;

/** Where a pin goes for a resolved anchor: the end of a selection, the spot itself otherwise. */
function pinPoint(rect: DOMRect, type: Anchor["type"]): { x: number; y: number } {
  return type === "range" ? { x: rect.right, y: rect.top + 2 } : { x: rect.left + rect.width, y: rect.top + (rect.height ? 2 : 0) };
}

/** Pins on the same spot fan out sideways, so each stays tappable. */
function fanOut<T extends { top: number; left: number }>(pins: T[]): T[] {
  const placed: T[] = [];
  for (const pin of [...pins].sort((a, b) => a.top - b.top || a.left - b.left)) {
    while (placed.some((p) => Math.abs(p.top - pin.top) < PIN_SIZE - 4 && Math.abs(p.left - pin.left) < PIN_SIZE - 4)) pin.left += PIN_SIZE - 2;
    placed.push(pin);
  }
  return placed;
}

/** autoFocus without the scroll: the box is placed where the reader already is. */
function focusInPlace(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true });
}

const NAME_KEY = "art-author-name";

const LISTENER_TEXT: Record<Listener, [label: string, detail: string]> = {
  waiting: ["Agent is waiting", "It gets this right away."],
  terminal: ["Agent's terminal", "Orca types this into its session now."],
  "terminal-offline": ["Orca is not picking up", "The agent sees this next time it checks the page."],
  none: ["No agent listening", "It sees this next time it checks the page."],
};
const POP_W = 312;
const POP_GAP = 16;

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}


function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Whether two pin layouts put every pin in the same place. */
function samePins<T extends { thread: { id: string } }>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const flat = (list: T[]) => JSON.stringify(list.map((p) => ({ ...p, thread: p.thread.id })));
  return flat(a) === flat(b);
}

export function ArtifactView(props: ArtifactViewProps) {
  // art-embed reads this when it upgrades, which happens during commit, before
  // effects run, so it has to be set in the render phase.
  if (typeof window !== "undefined") {
    (window as unknown as { __ARTIFACT_EMBED_BASE?: string }).__ARTIFACT_EMBED_BASE = props.embedBase;
  }

  const router = useRouter();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popNudge, setPopNudge] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageFrameRef = useRef<HTMLIFrameElement | null>(null);

  const [threads, setThreads] = useState<ThreadView[]>(props.initialThreads);
  const [showResolved, setShowResolved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState(false);
  // Read by the message handler: a frame's pick counts only while picking is on.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [draft, setDraft] = useState<{ anchor: Anchor | null; body: string; notify: boolean } | null>(null);
  const [draftSpot, setDraftSpot] = useState<Spot | null>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number; anchor: Anchor } | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [menu, setMenu] = useState<{ top: number; left: number; options: { label: string; anchor: Anchor }[] } | null>(null);
  const [domTick, setDomTick] = useState(0);
  const onDocReady = useCallback(() => setDomTick((t) => t + 1), []);
  const [pick, setPick] = useState<Box | null>(null);
  const [selected, setSelected] = useState<Anchor | null>(null);
  // Signed in, you are who you are; the name box is for when you are not.
  const [author, setAuthor] = useState(props.userName ?? (props.visitor ? "" : "operator"));
  const visitor = props.visitor ?? null;
  // Where this page's comments live: the owner's API, or the share link's.
  const commentsApi = visitor ? `/s/${visitor.token}/api/comments` : `/api/artifacts/${props.slug}/comments`;
  const canComment = !visitor || visitor.allowComments;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [batchMessage, setBatchMessage] = useState("");
  const [panel, setPanel] = useState<"none" | "list" | "send">("none");
  // Who would get a send right now; asked while the Send panel is open.
  const [listener, setListener] = useState<Listener | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(props.sharing ?? "private");
  useEffect(() => setSharing(props.sharing ?? "private"), [props.sharing]);
  const [frameHeight, setFrameHeight] = useState(600);
  // Editing happens on the page itself: the same editor, made typeable.
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [head, setHead] = useState<{ title: string; description: string } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);
  const onDirty = useCallback(() => setDirty(true), []);
  const setHeadDirty = useCallback((next: { title: string; description: string }) => {
    setHead(next);
    setDirty(true);
  }, []);
  // What was just saved, shown until the new version arrives from the server.
  const [savedDoc, setSavedDoc] = useState<{ version: number; doc: JSONContent } | null>(null);
  const shownDoc = savedDoc && savedDoc.version === props.versionNumber ? savedDoc.doc : props.doc;

  const isLatest = props.versionNumber === props.currentVersion;
  const somethingOpen = useRef(false);
  somethingOpen.current = tool || draft !== null || activeId !== null || panel !== "none" || bubble !== null || editing || menu !== null || shareOpen;
  const visible = useMemo(
    () => threads.filter((t) => (showResolved ? true : t.status === "open")),
    [threads, showResolved],
  );
  const unsent = useMemo(
    () => threads.filter((t) => t.status === "open" && !t.sentAt && (t.authorKind === "human" || (t.authorKind === "visitor" && t.approvedAt))).length,
    [threads],
  );
  const active = useMemo(() => visible.find((t) => t.id === activeId) ?? null, [visible, activeId]);
  const activePin = useMemo(() => pins.find((p) => p.thread.id === activeId) ?? null, [pins, activeId]);

  useEffect(() => {
    if (props.userName) return;
    try {
      const stored = localStorage.getItem(NAME_KEY);
      if (stored) setAuthor(stored);
    } catch {
      /* private mode */
    }
  }, []);

  // Load the primitives bundle once; it upgrades the art-* elements in place.
  useEffect(() => {
    if (document.getElementById("art-primitives")) return;
    const script = document.createElement("script");
    script.id = "art-primitives";
    script.type = "module";
    script.src = primitivesUrl("primitives.js");
    document.head.appendChild(script);
  }, []);

  // Notices fade on their own; there is no sidebar to park them in.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshThreads = useCallback(async () => {
    const res = await fetch(`${commentsApi}?status=all`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ThreadView[] };
    setThreads(data.threads);
  }, [commentsApi]);

  // ---- ticks -----------------------------------------------------------------

  // One store for the life of the page: the document's task items draw from it.
  const [tickStore] = useState(() => createTickStore(props.ticks ?? []));
  const [unsentTicks, setUnsentTicks] = useState(props.unsentTicks ?? 0);
  useEffect(() => setUnsentTicks(props.unsentTicks ?? 0), [props.unsentTicks]);
  useEffect(() => tickStore.set(props.ticks ?? []), [tickStore, props.ticks]);
  // A visitor's name and email live in this browser, signed by Indy, and
  // follow them to every share link; they are asked once, then never again.
  const [identity, setIdentity] = useState<VisitorIdentity | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const remember = useCallback((who: VisitorIdentity | null) => {
    identityRef.current = who;
    setIdentity(who);
    storeIdentity(who);
    if (who) setAuthor(who.name);
  }, []);
  useEffect(() => {
    if (!visitor) return;
    const stored = storedIdentity();
    identityRef.current = stored;
    setIdentity(stored);
    if (stored) setAuthor(stored.name);
  }, [visitor]);
  // A visitor who has not said who they are yet is asked, then the action goes ahead.
  const [ask, setAsk] = useState<{ reason: "tick" | "comment"; then: (who: VisitorIdentity) => void } | null>(null);

  /**
   * A visitor's write, carrying their identity. If this link does not take the
   * stored one as it is (an email link wants its confirmed address), it is
   * shown to the link once to be renewed. "ask" means there is none to use.
   */
  const identityFetch = useCallback(
    async (url: string, init: RequestInit): Promise<Response | "ask"> => {
      if (!visitor) return fetch(url, init);
      const send = (who: VisitorIdentity) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), [IDENTITY_HEADER]: who.token } });
      const who = identityRef.current;
      if (!who) return "ask";
      const res = await send(who);
      if (res.status !== 403) return res;
      const data = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
      if (data?.error?.code !== "identify") return res;
      const fresh = await renewIdentity(visitor.token, who);
      if (fresh === "rejected") {
        remember(null);
        return "ask";
      }
      // Could not ask just now: keep who they are and let the write fail as it did.
      if (!fresh) return res;
      remember(fresh);
      return send(fresh);
    },
    [visitor, remember],
  );
  const ticksApi = visitor ? `/s/${visitor.token}/api/ticks` : `/api/artifacts/${props.slug}/ticks`;
  // The owner ticks the latest version; a visitor, whatever the link shows.
  const canTick = props.kind === "markdown" && !editing && (visitor ? visitor.allowComments : isLatest);
  useEffect(() => tickStore.setCanTick(canTick), [tickStore, canTick]);

  const refreshTicks = useCallback(async () => {
    const res = await fetch(`${ticksApi}${visitor ? "" : `?version=${props.versionNumber}`}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { ticks: TickView[]; unsent?: number };
    tickStore.set(data.ticks);
    if (typeof data.unsent === "number") setUnsentTicks(data.unsent);
  }, [ticksApi, visitor, props.versionNumber, tickStore]);

  const tickNow = useCallback(
    async (key: string, checked: boolean) => {
      // Show it straight away; the answer from the server replaces it.
      const mine: TickView = {
        key,
        checked,
        byKind: visitor ? "visitor" : "owner",
        byName: identityRef.current?.name ?? props.userName ?? "You",
        at: new Date().toISOString(),
      };
      const snapshot = tickStore.all();
      tickStore.set([...snapshot.filter((t) => t.key !== key), mine]);
      try {
        const res = await identityFetch(ticksApi, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, checked, version: props.versionNumber }),
        });
        if (res === "ask") {
          tickStore.set(snapshot);
          setAsk({ reason: "tick", then: () => void tickNow(key, checked) });
          return;
        }
        const data = (await res.json()) as { ticks?: TickView[]; unsent?: number; error?: { code?: string; message?: string } };
        if (!res.ok || !data.ticks) {
          tickStore.set(snapshot);
          setNotice({ kind: "bad", text: data.error?.message ? capitalise(data.error.message) : "Could not save that tick." });
          return;
        }
        tickStore.set(data.ticks);
        if (typeof data.unsent === "number") setUnsentTicks(data.unsent);
      } catch {
        tickStore.set(snapshot);
        setNotice({ kind: "bad", text: "Indy did not answer. Check the connection and try again." });
      }
    },
    [props.userName, props.versionNumber, ticksApi, tickStore, visitor, identityFetch],
  );

  useEffect(() => {
    tickStore.setHandler((key, checked) => {
      if (visitor && !identityRef.current) {
        setAsk({ reason: "tick", then: () => void tickNow(key, checked) });
        return;
      }
      void tickNow(key, checked);
    });
    return () => tickStore.setHandler(null);
  }, [tickStore, tickNow, visitor]);

  // "2m ago" moves on while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => tickStore.touch(), 60_000);
    return () => window.clearInterval(timer);
  }, [tickStore]);

  // A visitor has no live stream; their page looks for other people's ticks now and then.
  useEffect(() => {
    if (!visitor || props.kind !== "markdown") return;
    const poll = () => {
      if (document.visibilityState === "visible") void refreshTicks();
    };
    const timer = window.setInterval(poll, 10_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [visitor, props.kind, refreshTicks]);

  // A card anchored near the foot of a long page would open with half of it
  // below the fold. Measure it on the frame after it appears and lift it back
  // into the window. Once per card: measuring inside the render pass reads a
  // rectangle the browser has not laid out yet.
  useEffect(() => {
    setPopNudge(0);
    if (!activeId) return;
    const frame = requestAnimationFrame(() => {
      const card = popRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const floor = window.innerHeight - 10;
      let next = 0;
      if (rect.bottom > floor) {
        // Sitting below the spot would run off the screen. Put it above the
        // spot instead, which keeps the card and its words together; only when
        // there is no room either way does it slide up the window.
        const above = -(rect.height + 18);
        next = rect.top + above >= 10 ? above : floor - rect.bottom;
      }
      if (rect.top + next < 10) next = 10 - rect.top;
      setPopNudge(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  // ---- pin and popover positions ------------------------------------------

  const recompute = useCallback(() => {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;
    // The overlay is a child of .stage__inner, so that is the origin.
    const origin = inner.getBoundingClientRect();
    const local = (r: DOMRect): Box => ({ top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height });

    const spot = (rect: DOMRect, type: Anchor["type"]): Spot => {
      const at = pinPoint(rect, type);
      // The card opens to the right of the pin, or to its left when the
      // window runs out; the phone stylesheet turns it into a bottom sheet.
      const right = at.x + PIN_SIZE + 10;
      const x = right + POP_W <= window.innerWidth - 12 ? right : Math.max(at.x - POP_W - 10, 12);
      return { top: at.y - origin.top, left: at.x - origin.left, popTop: at.y - origin.top - PIN_SIZE, popLeft: x - origin.left };
    };

    const next: Pin[] = [];
    visible.forEach((thread) => {
      if (!thread.anchor) return;
      const resolved = resolveAnchor(content, thread.anchor);
      if (!resolved) return;
      next.push({
        thread,
        exact: resolved.exact,
        mark: local(resolved.rect),
        box: resolved.box ? local(resolved.box) : undefined,
        ...spot(resolved.rect, thread.anchor.type),
      });
    });
    // Measuring runs often; re-rendering the page only when a pin moved.
    const placed = fanOut(next);
    setPins((prev) => (samePins(prev, placed) ? prev : placed));

    if (draft?.anchor) {
      const resolved = resolveAnchor(content, draft.anchor);
      setDraftSpot(resolved ? spot(resolved.rect, draft.anchor.type) : null);
    } else {
      setDraftSpot(null);
    }
    // domTick: the editor replaced the placeholder page, so measure again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft?.anchor, domTick]);

  // Light up the text a comment points at. Progressive enhancement: browsers
  // without the Custom Highlight API simply show the pins.
  useEffect(() => {
    const content = contentRef.current;
    const api = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!content || !api || !Ctor) return;

    const quiet: Range[] = [];
    const loud: Range[] = [];
    for (const thread of visible) {
      if (!thread.anchor) continue;
      const range = rangeForAnchor(content, thread.anchor);
      if (!range) continue;
      (thread.id === activeId ? loud : quiet).push(range);
    }

    if (quiet.length) api.set("art-anchor", new Ctor(...quiet));
    else api.delete("art-anchor");
    if (loud.length) api.set("art-anchor-active", new Ctor(...loud));
    else api.delete("art-anchor-active");

    return () => {
      api.delete("art-anchor");
      api.delete("art-anchor-active");
    };
  }, [visible, activeId, threads, domTick]);

  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", schedule);
    // Frames, images and charts settle after the first paint and move the
    // text under the pins; watch for that instead of polling.
    const mutations = new MutationObserver(schedule);
    if (contentRef.current) mutations.observe(contentRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "height", "class"] });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [recompute]);

  // Follow the artifact while it is open. An agent publishing a new version or
  // answering a comment should show up here without a reload. A refresh is held
  // back while something is half typed, so nothing under the cursor moves.
  const pendingRefresh = useRef(false);
  const busyEditingRef = useRef(false);
  const busyEditing = draft !== null || editing;

  useEffect(() => {
    // Live updates are for the owner; a visitor sees the page as it was opened.
    if (visitor) return;
    const source = new EventSource(`/api/live/${props.slug}`);
    source.addEventListener("changed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { version: number };
      if (data.version !== props.versionNumber) {
        if (busyEditingRef.current) pendingRefresh.current = true;
        else router.refresh();
      }
      void refreshThreads();
      void refreshTicks();
    });
    return () => source.close();
  }, [visitor, props.slug, props.versionNumber, refreshThreads, refreshTicks, router]);

  useEffect(() => {
    busyEditingRef.current = busyEditing;
    if (!busyEditing && pendingRefresh.current) {
      pendingRefresh.current = false;
      router.refresh();
    }
  }, [busyEditing, router]);

  // ---- messages from sandbox frames ---------------------------------------

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        selector?: string;
        text?: string;
        px?: number;
        point?: { x: number; y: number };
      };
      if (!data || typeof data !== "object") return;

      // A whole-page artifact sizes itself, the way an embedded block does,
      // rather than sitting in a fixed box with dead space under it.
      if (data.type === "art:height" && event.source === pageFrameRef.current?.contentWindow) {
        const px = Number(data.px);
        if (Number.isFinite(px)) setFrameHeight(Math.min(Math.max(px, 240), 4000));
        return;
      }

      // Only a pick the operator asked for: code in a frame (a Storybook's
      // dependencies, say) must not open a comment with words it chose.
      if (data.type !== "art:picked" || !contentRef.current || !toolRef.current) return;

      const frames = Array.from(contentRef.current.querySelectorAll("iframe"));
      const frame = frames.find((f) => f.contentWindow === event.source);
      if (!frame) return;
      const block = blockOf(frame);
      if (!block) return;
      setTool(false);
      frames.forEach((f) => f.contentWindow?.postMessage({ type: "art:pick", on: false }, "*"));
      setActiveId(null);
      setDraft({
        anchor: anchorForBlock(block, {
          selector: data.selector,
          quote: data.text ? truncate(data.text, 200) : undefined,
          x: data.point?.x ?? 0.5,
          y: data.point?.y ?? 0.5,
        }),
        body: "",
        notify: false,
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.framed]);

  // Keep frames in step with the colour scheme.
  useEffect(() => {
    function onScheme(event: Event) {
      const scheme = (event as CustomEvent<string>).detail;
      contentRef.current
        ?.querySelectorAll("iframe")
        .forEach((f) => f.contentWindow?.postMessage({ type: "art:scheme", scheme }, "*"));
    }
    window.addEventListener("art:scheme", onScheme);
    // A frame that finished loading before hydration fired its load event
    // before the handler that sends the scheme existed, so tell it now.
    onScheme(new CustomEvent("art:scheme", { detail: document.documentElement.getAttribute("data-scheme") ?? "light" }));
    return () => window.removeEventListener("art:scheme", onScheme);
  }, []);

  // On a touch screen a selection is made with handles, not a mouse-up, and
  // the system menu sits right over it; offer the comment from the bottom bar.
  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) return;
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const content = contentRef.current;
        setSelected(content ? anchorFromSelection(content) : null);
      }, 180);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  // ---- moving between pages and versions ------------------------------------

  const [nav, setNav] = useState<NavList | null>(null);
  useEffect(() => setNav(readNavList()), []);
  const navIndex = nav ? nav.slugs.indexOf(props.slug) : -1;

  const goNav = useCallback(
    (step: 1 | -1) => {
      if (!nav || navIndex < 0) return;
      const next = nav.slugs[navIndex + step];
      if (next) router.push(`/a/${next}`);
    },
    [nav, navIndex, router],
  );

  const versionRef = useRef(props.versionNumber);
  versionRef.current = props.versionNumber;
  const goVersion = useCallback(
    (n: number) => {
      if (n < 1 || n > props.currentVersion || n === props.versionNumber) return;
      router.push(n === props.currentVersion ? `/a/${props.slug}` : `/a/${props.slug}/v/${n}`);
    },
    [props.currentVersion, props.versionNumber, props.slug, router],
  );

  // Opening the latest version counts as having seen it.
  useEffect(() => {
    if (!isLatest || visitor) return;
    void fetch(`/api/artifacts/${props.slug}/seen`, { method: "POST" }).catch(() => {});
  }, [isLatest, visitor, props.slug, props.versionNumber]);

  // ---- placing comments ----------------------------------------------------

  const setFramePicking = useCallback((on: boolean) => {
    contentRef.current
      ?.querySelectorAll("iframe")
      .forEach((f) => f.contentWindow?.postMessage({ type: "art:pick", on }, "*"));
  }, []);

  const toggleTool = useCallback(() => {
    setTool((on) => {
      setFramePicking(!on);
      return !on;
    });
    setBubble(null);
  }, [setFramePicking]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (editingRef.current) {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          void finishRef.current();
        }
        return;
      }
      // A menu or dialog closing on Escape has already handled the key; the
      // page's shortcuts must not also act on it, or send the reader home.
      if (event.defaultPrevented) return;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
        if (event.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A visitor has one page: no library to go back to, no versions to step.
      if (visitorRef.current && !["c", "Escape"].includes(event.key)) return;
      if (event.key === "c" && !canCommentRef.current) return;
      if (event.key === "Escape" && !somethingOpen.current && visitorRef.current) return;
      if (event.key === "c") {
        event.preventDefault();
        toggleTool();
      } else if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        goNav(event.key === "j" ? 1 : -1);
      } else if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        goVersion(versionRef.current + (event.key === "]" ? 1 : -1));
      } else if (event.key === "e" && canEditRef.current) {
        event.preventDefault();
        startRef.current();
      } else if (event.key === "Escape" && !somethingOpen.current) {
        router.push("/");
      } else if (event.key === "Escape") {
        setTool(false);
        setFramePicking(false);
        setBubble(null);
        setDraft(null);
        setActiveId(null);
        setPanel("none");
        setMenu(null);
        setPick(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTool, setFramePicking, goNav, goVersion, router]);

  // A click outside the open card closes it. The draft composer stays put, so a
  // half-typed comment is never thrown away by a stray click.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      const el = event.target as HTMLElement | null;
      if (!el) return;
      if (el.closest(".pop") || el.closest(".pin") || el.closest(".panel") || el.closest(".panel-btn")) return;
      setActiveId(null);
      setPanel("none");
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ---- press and hold -------------------------------------------------------

  // Holding a finger (or the mouse) on anything that is not text offers to
  // comment on it: the element under the finger, or its whole block. Text is
  // left alone, where holding selects words the usual way.
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

  function onPressStart(event: React.PointerEvent) {
    if (editing || !canComment || !event.isPrimary || event.button > 0 || tool || draft) return;
    if ((event.target as HTMLElement).closest("a, button, input, textarea, select, label, iframe")) return;
    const { clientX: x, clientY: y } = event;
    window.clearTimeout(press.current?.timer);
    press.current = {
      x,
      y,
      fired: false,
      timer: window.setTimeout(() => {
        if (!press.current || isOverText(x, y)) return;
        press.current.fired = true;
        openPressMenu(x, y);
      }, 450),
    };
  }

  function onPressMove(event: React.PointerEvent) {
    const p = press.current;
    if (p && !p.fired && Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8) {
      window.clearTimeout(p.timer);
      press.current = null;
    }
  }

  function onPressEnd() {
    if (press.current && !press.current.fired) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
  }

  function openPressMenu(x: number, y: number) {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;
    const el = pickTarget(content, document.elementFromPoint(x, y));
    const block = el ? blockOf(el) : null;
    if (!el || !block) return;
    const options: { label: string; anchor: Anchor }[] = [];
    const picked = anchorFromPick(content, el, x, y);
    if (picked) options.push({ label: picked.point ? `Comment on ${truncate(pointQuote(picked.point), 48)}` : `Comment on this ${kindName(el)}`, anchor: picked });
    if (el !== block) {
      const r = block.getBoundingClientRect();
      options.push({
        label: `Comment on the whole ${kindName(block)}`,
        anchor: anchorForBlock(block, { x: (x - r.left) / (r.width || 1), y: (y - r.top) / (r.height || 1) }),
      });
    }
    if (!options.length) return;
    navigator.vibrate?.(12);
    window.getSelection()?.removeAllRanges();
    const origin = inner.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPick({ top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height });
    setActiveId(null);
    setBubble(null);
    setMenu({
      top: y - origin.top + 12,
      left: Math.min(Math.max(x - origin.left - 120, 8 - origin.left), window.innerWidth - origin.left - 256),
      options,
    });
  }

  function onContentMouseUp(event: React.MouseEvent) {
    if (editing) return;
    if (!canComment) return;
    // The release that ends a press-and-hold is not a click.
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    if (menu) {
      setMenu(null);
      setPick(null);
      return;
    }
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;

    if (tool) {
      const el = pickTarget(content, document.elementFromPoint(event.clientX, event.clientY));
      const anchor = el ? anchorFromPick(content, el, event.clientX, event.clientY) : anchorFromPoint(content, event.clientX, event.clientY);
      setTool(false);
      setFramePicking(false);
      setPick(null);
      if (anchor) {
        setActiveId(null);
        setDraft({ anchor, body: "", notify: false });
      }
      return;
    }

    const anchor = anchorFromSelection(content);
    if (!anchor) {
      setBubble(null);
      // A tap on words that already carry a comment opens that thread.
      const hit = threadAt(event.clientX, event.clientY);
      if (hit) openThread(hit);
      return;
    }
    const selection = window.getSelection();
    const rect = selection?.getRangeAt(0).getBoundingClientRect();
    const origin = inner.getBoundingClientRect();
    if (!rect) return;
    setBubble({
      anchor,
      top: rect.top - origin.top - 6,
      left: rect.left - origin.left + rect.width / 2,
    });
  }

  /** The open thread whose words, element or spot is under a point, if any. */
  function threadAt(x: number, y: number): ThreadView | null {
    const content = contentRef.current;
    if (!content) return null;
    const inside = (r: { top: number; left: number; right: number; bottom: number }, pad = 0) =>
      x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    for (const thread of visible) {
      if (!thread.anchor) continue;
      if (thread.anchor.type === "range") {
        const range = rangeForAnchor(content, thread.anchor);
        if (range && Array.from(range.getClientRects()).some((r) => inside(r, 2))) return thread;
        continue;
      }
      const resolved = resolveAnchor(content, thread.anchor);
      if (!resolved) continue;
      if (resolved.box && thread.anchor.selector?.startsWith(":scope") && inside(resolved.box)) return thread;
      if (thread.anchor.type === "point" && inside(resolved.rect, 10)) return thread;
    }
    return null;
  }

  function commentOnBlock(event: React.MouseEvent) {
    if (editing || !canComment) return;
    // Two quick taps on a checkbox are two ticks, not a comment.
    if ((event.target as HTMLElement).closest?.(".art-task__hit, .art-tick-by")) return;
    const block = blockOf(event.target as Node);
    if (!block) return;
    setActiveId(null);
    setDraft({ anchor: anchorForBlock(block), body: "", notify: false });
  }

  function openThread(thread: ThreadView) {
    setActiveId(thread.id);
    setPanel("none");
    const content = contentRef.current;
    if (!content || !thread.anchor) return;
    const resolved = resolveAnchor(content, thread.anchor);
    if (!resolved) return;
    const y = window.scrollY + resolved.rect.top;
    if (resolved.rect.top < 90 || resolved.rect.bottom > window.innerHeight - 120) {
      window.scrollTo({ top: y - 160, behavior: "smooth" });
    }
  }

  // ---- editing ---------------------------------------------------------------

  const canEdit = !visitor && isLatest && props.kind === "markdown" && props.doc !== null;
  // A phone has no hover, so it gets the bottom bar instead of shortcuts.
  const [hoverless, setHoverless] = useState(false);
  useEffect(() => setHoverless(!window.matchMedia("(hover: hover)").matches), []);

  /** While placing a comment, outline the smallest thing under the pointer. */
  function onStageMove(event: React.MouseEvent) {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!tool || !content || !inner) return;
    const el = pickTarget(content, event.target as HTMLElement | null);
    if (!el) return setPick(null);
    const origin = inner.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPick({ top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height });
  }

  function startEditing() {
    if (!canEdit || editing) return;
    setTool(false);
    setFramePicking(false);
    setDraft(null);
    setBubble(null);
    setActiveId(null);
    setMenu(null);
    setPick(null);
    setPanel("none");
    setHead({ title: props.title, description: props.description ?? "" });
    setDirty(false);
    setEditing(true);
  }

  function cancelEditing() {
    if (dirty && !window.confirm("Throw away your changes to this page?")) return;
    setEditing(false);
    setDirty(false);
  }

  async function finishEditing() {
    const editor = editorRef.current;
    if (!editor || saving) return;
    // The serializer is editing code: loaded here, not with the page.
    const [{ docToMarkdown }, { withFront }] = await Promise.all([import("@/lib/doc/serialize"), import("@/lib/doc/frontmatter")]);
    const json = editor.getJSON();
    const patch: Record<string, string | null> = {};
    const title = head?.title.trim() ?? "";
    const description = head?.description.trim() ?? "";
    if (head && title && title !== props.title) patch.title = title;
    if (head && description !== (props.description ?? "")) patch.description = description || null;
    if (Object.keys(patch).length) {
      json.attrs = { ...json.attrs, front: withFront((json.attrs?.front as string[] | null) ?? null, patch) };
    }
    const source = docToMarkdown(json);
    // Nothing changed if the edit reads back exactly as the page it started from.
    if (shownDoc && source === docToMarkdown(shownDoc)) {
      setEditing(false);
      setDirty(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/artifacts/${props.slug}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, expected_version: props.versionNumber, author_kind: "human", author_name: author }),
      });
      const data = (await res.json()) as { version?: { number?: number }; error?: { message?: string } };
      if (res.status === 409) {
        setNotice({
          kind: "bad",
          text: "A newer version was saved while you were editing. Your changes are still on the page; copy what you need, then reload.",
        });
        return;
      }
      if (!res.ok) {
        setNotice({ kind: "bad", text: data.error?.message ?? "Could not save the page." });
        return;
      }
      setSavedDoc({ version: props.versionNumber, doc: json });
      setEditing(false);
      setDirty(false);
      setNotice({ kind: "good", text: `Saved as version ${data.version?.number ?? props.currentVersion + 1}.` });
      router.refresh();
    } catch {
      setNotice({ kind: "bad", text: "Indy did not answer, so nothing was saved. Your changes are still on the page." });
    } finally {
      setSaving(false);
    }
  }

  // The key handler is bound once; these keep it pointed at the current state.
  const editingRef = useRef(false);
  editingRef.current = editing;
  const visitorRef = useRef(false);
  visitorRef.current = visitor !== null;
  const canCommentRef = useRef(true);
  canCommentRef.current = canComment;
  const canEditRef = useRef(false);
  canEditRef.current = canEdit;
  const startRef = useRef(startEditing);
  startRef.current = startEditing;
  const finishRef = useRef(finishEditing);
  finishRef.current = finishEditing;

  // ?edit=1 opens the page ready to type into.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("edit") !== "1") return;
    url.searchParams.delete("edit");
    // Keep the router's state on the entry; a null state makes Back reload.
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    startRef.current();
  }, []);

  // ?find=words comes from a search hit in the command palette: select the
  // first place the page says it and bring it into view.
  useEffect(() => {
    const url = new URL(window.location.href);
    const term = url.searchParams.get("find")?.trim().toLowerCase();
    if (!term) return;
    url.searchParams.delete("find");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // The document replaces its server-rendered fallback just after mount.
    const timer = window.setTimeout(() => {
      const root = document.querySelector(".art-content");
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node.textContent ?? "").toLowerCase().indexOf(term);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + term.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        node.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);

  // What this page can do, offered in the command palette too.
  const commands = useMemo(() => {
    if (visitor) return [];
    const list: PaletteCommand[] = [];
    if (canEdit) list.push({ id: "edit", label: "Edit this page", keys: ["e"], run: () => startRef.current() });
    list.push({ id: "share", label: "Share…", run: () => setShareOpen(true) });
    if (canComment) list.push({ id: "comment", label: "Comment on the page", keys: ["c"], run: () => toggleTool() });
    if (props.versionNumber > 1) list.push({ id: "older", label: "Previous version", keys: ["["], run: () => goVersion(props.versionNumber - 1) });
    if (props.versionNumber < props.currentVersion) list.push({ id: "newer", label: "Next version", keys: ["]"], run: () => goVersion(props.versionNumber + 1) });
    return list;
  }, [visitor, canEdit, canComment, toggleTool, goVersion, props.versionNumber, props.currentVersion]);
  useCommands("viewer", commands);

  // Leaving with unsaved changes asks first, by reload, close or Back.
  useLeaveGuard(editing && dirty && !saving);

  // ---- writes --------------------------------------------------------------

  function rememberName(name: string) {
    setAuthor(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* private mode */
    }
  }

  /** True once the comment is saved, so a reply box only clears on success. */
  async function postComment(parentId?: string, bodyText?: string): Promise<boolean> {
    // A visitor's comment goes under their name, so the first one asks for it.
    if (visitor && !identityRef.current) {
      return new Promise<boolean>((resolve) => {
        setAsk({ reason: "comment", then: () => void postComment(parentId, bodyText).then(resolve) });
      });
    }
    const payload = {
      body: bodyText ?? draft?.body ?? "",
      author_name: author,
      anchor: parentId ? null : (draft?.anchor ?? null),
      notify: parentId ? false : (draft?.notify ?? false),
      parent_id: parentId ?? null,
      version_number: props.versionNumber,
    };
    if (!payload.body.trim()) return false;
    setBusy(true);
    try {
      const res = await identityFetch(commentsApi, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res === "ask") {
        setBusy(false);
        return postComment(parentId, bodyText);
      }
      if (!res.ok) {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        setNotice({ kind: "bad", text: err.error?.message ?? "could not save that comment" });
        return false;
      }
      if (!parentId) {
        setDraft(null);
        setBubble(null);
        window.getSelection()?.removeAllRanges();
      }
      await refreshThreads();
      if (payload.notify) setNotice({ kind: "good", text: "Comment sent to the agent." });
      return true;
    } catch {
      setNotice({ kind: "bad", text: "Indy did not answer. Check the connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "open" | "resolved") {
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setNotice({ kind: "bad", text: status === "resolved" ? "Could not resolve that thread." : "Could not reopen that thread." });
        return;
      }
      if (status === "resolved") setActiveId(null);
      await refreshThreads();
    } catch {
      setNotice({ kind: "bad", text: "Indy did not answer. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  /** Ask the agent to address a visitor's thread: it drops the flag that says to check with you first. */
  async function endorseThread(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "endorse" }),
      });
      if (!res.ok) {
        setNotice({ kind: "bad", text: "Could not pass that on to the agent." });
        return;
      }
      await refreshThreads();
      setNotice({ kind: "good", text: "The agent will address it." });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (panel !== "send") return;
    let live = true;
    const ask = async () => {
      try {
        const res = await fetch(`/api/artifacts/${props.slug}/send`, { cache: "no-store" });
        const data = (await res.json()) as { listener?: Listener };
        if (live && res.ok && data.listener) setListener(data.listener);
      } catch {
        /* the panel still sends; it just cannot say who is listening */
      }
    };
    void ask();
    const timer = window.setInterval(ask, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [panel, props.slug]);

  async function sendBatch() {
    setBusy(true);
    try {
      const res = await fetch(`/api/artifacts/${props.slug}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: batchMessage, author_name: author }),
      });
      const data = (await res.json()) as { count?: number; ticks?: number; error?: { message?: string } };
      if (!res.ok) {
        setNotice({ kind: "bad", text: data.error?.message ?? "could not send" });
        return;
      }
      setPanel("none");
      setBatchMessage("");
      await Promise.all([refreshThreads(), refreshTicks()]);
      const sent = sentWhat(data.count ?? 0, data.ticks ?? 0);
      const heard = listener === "waiting" || listener === "terminal";
      setNotice({
        kind: "good",
        text: !sent ? "Nothing new to send." : heard ? `Sent ${sent} to the agent.` : `Saved ${sent} for the agent. It sees them the next time it checks this page.`,
      });
    } catch {
      setNotice({ kind: "bad", text: "Indy did not answer. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  // ---- render --------------------------------------------------------------

  return (
    <FormGate
      slug={props.slug}
      form={props.form}
      submitUrl={visitor ? `/s/${visitor.token}/api/responses` : undefined}
      onSent={() => (visitor ? undefined : router.refresh())}
    >
      <link rel="stylesheet" href={props.themeHref} />
      {visitor ? (
        <VisitorHeader
          title={props.title}
          sharedBy={visitor.sharedBy}
          threads={canComment ? visible.length : null}
          panel={panel}
          onThreads={() => setPanel((p) => (p === "list" ? "none" : "list"))}
          onComment={canComment ? toggleTool : null}
          as={identity?.name ?? null}
        />
      ) : (
      <ViewerHeader
        slug={props.slug}
        title={props.title}
        project={props.project}
        series={props.series}
        branch={props.branch}
        version={{ number: props.versionNumber, authorName: props.authorName, createdAt: props.createdAt }}
        latest={props.currentVersion}
        versions={props.versions}
        nav={nav && navIndex >= 0 ? { label: nav.label, index: navIndex, count: nav.slugs.length } : null}
        threads={visible.length}
        unsent={unsent + unsentTicks}
        panel={panel}
        canEdit={canEdit}
        responses={props.form ? props.form.responses : null}
        onVersion={goVersion}
        onNav={goNav}
        onThreads={() => setPanel((p) => (p === "list" ? "none" : "list"))}
        onSend={() => setPanel((p) => (p === "send" ? "none" : "send"))}
        onEdit={startEditing}
        onShare={() => setShareOpen(true)}
        sharing={sharing}
        editing={editing ? { dirty, saving, onCancel: cancelEditing, onDone: () => void finishEditing() } : null}
        menu={
          <>
            <ViewerMenuItem onSelect={toggleTool}>Comment on a spot</ViewerMenuItem>
            <ViewerMenuItem onSelect={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide resolved threads" : "Show resolved threads"}
            </ViewerMenuItem>
            <ViewerMenuSeparator />
            <ViewerMenuItem onSelect={() => setShareOpen(true)}>Share…</ViewerMenuItem>
          </>
        }
      />
      )}
      {!visitor && shareOpen ? <ShareDialog slug={props.slug} title={props.title} versionNumber={props.versionNumber} storybooks={props.storybooks ?? []} onClose={() => setShareOpen(false)} onMode={setSharing} /> : null}

      {panel === "list" ? (
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Comments</span>
            <button className="btn btn--ghost" onClick={() => setShowResolved((s) => !s)}>
              {showResolved ? "Hide resolved" : "Show resolved"}
            </button>
          </div>
          <div className="panel__list">
            {visible.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No comments yet. Select text to comment on it, or press <kbd>c</kbd> and click a spot.
              </p>
            ) : (
              visible.map((thread) => (
                <button key={thread.id} className="rowitem" onClick={() => openThread(thread)}>
                  <span className={thread.authorKind === "agent" ? "avatar avatar--agent" : "avatar"}>
                    {initials(thread.authorName)}
                  </span>
                  <span className="rowitem__text">
                    <span className="rowitem__head">
                      {thread.authorName} · {when(thread.createdAt)}
                      {thread.authorKind === "human" && !thread.sentAt && thread.status === "open" ? (
                        <span className="badge badge--unsent">unsent</span>
                      ) : null}
                      {thread.status === "resolved" ? <span className="badge">resolved</span> : null}
                      {!visitor && thread.authorKind === "visitor" ? <span className="badge">{thread.endorsedAt ? "visitor" : "visitor · ask first"}</span> : null}
                    </span>
                    <span className="rowitem__body">{truncate(thread.body, 90)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {panel === "send" ? (
        <div className="panel panel--narrow">
          <div className="composer">
            <div className="tiny">{capitalise(sentWhat(unsent, unsentTicks) || "nothing")} will go to the agent as one message.</div>
            {listener ? (
              <div className={`listener listener--${listener}`} role="status">
                <span className="listener__dot" aria-hidden />
                <span>
                  <strong className="listener__label">{LISTENER_TEXT[listener][0]}</strong>{" "}
                  <span className="listener__detail">{LISTENER_TEXT[listener][1]}</span>
                </span>
              </div>
            ) : null}
            <input
              className="field"
              autoFocus
              placeholder="Optional note, e.g. done reviewing"
              value={batchMessage}
              onChange={(e) => setBatchMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendBatch();
              }}
            />
            <div className="composer__row">
              <button className="btn btn--ghost" onClick={() => setPanel("none")}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={sendBatch} disabled={busy}>
                Send to agent
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main
        className={["stage", tool && "stage--picking", editing && "stage--editing"].filter(Boolean).join(" ")}
        onMouseMove={onStageMove}
      >
        <div className="stage__inner" ref={innerRef}>
          {!isLatest ? (
            <div className="warnings" style={{ marginBottom: 16 }}>
              Viewing version {props.versionNumber} of {props.currentVersion}.{" "}
              <Link href={`/a/${props.slug}`}>Go to the latest</Link>.
            </div>
          ) : null}

          {props.warnings.length > 0 ? (
            <div className="warnings">
              <strong>{props.warnings.length} block warning{props.warnings.length === 1 ? "" : "s"}</strong>
              <ul>
                {props.warnings.map((w, i) => (
                  <li key={i}>
                    line {w.line}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {props.buildStatus === "error" ? (
            <>
              <div className="warnings">This version did not build. The source is unchanged; fix it and publish again.</div>
              <pre className="buildlog">{props.buildLog}</pre>
            </>
          ) : null}

          <div
            className="doc"
            ref={contentRef}
            onMouseUp={onContentMouseUp}
            onPointerDown={onPressStart}
            onPointerMove={onPressMove}
            onPointerUp={onPressEnd}
            onPointerCancel={onPressEnd}
            onContextMenu={(e) => {
              if (press.current?.fired || menu) e.preventDefault();
            }}
            onDoubleClick={commentOnBlock}
          >
            {props.framed ? (
              <div className="framewrap" data-block="b0" data-lines="1-1">
                <iframe
                  ref={pageFrameRef}
                  src={`${props.embedBase}/page`}
                  sandbox="allow-scripts allow-forms"
                  title={props.title}
                  style={{ height: frameHeight }}
                  onLoad={(e) => {
                    const frame = e.currentTarget;
                    const scheme = document.documentElement.getAttribute("data-scheme") ?? "light";
                    frame.contentWindow?.postMessage({ type: "art:scheme", scheme }, "*");
                    // A frame reports its height once and then only when it
                    // changes, so a first report that landed before this
                    // listener existed would leave the frame at its default.
                    frame.contentWindow?.postMessage({ type: "art:measure" }, "*");
                  }}
                />
              </div>
            ) : (
              <>
                <ArticleHead {...props} doc={shownDoc} head={editing ? head : null} onHead={setHeadDirty} />
                {shownDoc ? (
                  <DocView
                    doc={shownDoc}
                    fallbackHtml={props.html ?? ""}
                    assetBase={props.assetBase}
                    editing={editing}
                    onReady={onDocReady}
                    onEditor={onEditor}
                    onDirty={onDirty}
                    ticks={props.kind === "markdown" ? tickStore : undefined}
                  />
                ) : (
                  <div className="art-content" dangerouslySetInnerHTML={{ __html: props.html ?? "" }} />
                )}
              </>
            )}
          </div>

          <div className="pins">
            {/* The element a comment is about is outlined while its thread is open. */}
            {activePin?.box && activePin.thread.anchor?.selector?.startsWith(":scope") ? (
              <span
                className="mark-box mark-box--active"
                style={{ top: activePin.box.top - 3, left: activePin.box.left - 3, width: activePin.box.width + 6, height: activePin.box.height + 6 }}
              />
            ) : null}

            {pins.map((pin) => (
              <button
                key={pin.thread.id}
                className={[
                  "pin",
                  pin.thread.authorKind === "agent" ? "pin--agent" : "",
                  !pin.thread.sentAt && pin.thread.status === "open" ? "pin--unsent" : "",
                  pin.exact ? "" : "pin--moved",
                  pin.thread.id === activeId ? "pin--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ top: pin.top, left: pin.left }}
                title={`${pin.thread.authorName}: ${truncate(pin.thread.body, 80)}`}
                aria-label={`Comment by ${pin.thread.authorName}: ${truncate(pin.thread.body, 80)}`}
                onClick={() => (pin.thread.id === activeId ? setActiveId(null) : openThread(pin.thread))}
              >
                {initials(pin.thread.authorName)}
                {pin.thread.replies.length > 0 ? <span className="pin__count">{pin.thread.replies.length}</span> : null}
              </button>
            ))}

            {draft && draftSpot ? <span className="pin pin--draft" style={{ top: draftSpot.top, left: draftSpot.left }} /> : null}

            {menu ? (
              <div className="pressmenu" role="menu" style={{ top: menu.top, left: menu.left }}>
                {menu.options.map((o) => (
                  <button
                    key={o.label}
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      setPick(null);
                      setDraft({ anchor: o.anchor, body: "", notify: false });
                    }}
                  >
                    {o.label}
                  </button>
                ))}
                <button
                  role="menuitem"
                  className="pressmenu__cancel"
                  onClick={() => {
                    setMenu(null);
                    setPick(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {pick && (tool || menu) ? (
              <span className="pick-box" style={{ top: pick.top - 4, left: pick.left - 4, width: pick.width + 8, height: pick.height + 8 }} />
            ) : null}

            {/* A thread whose block is gone has no pin, so its card opens at the
                top of the page rather than nowhere. */}
            {active ? (
              <div
                className="pop"
                ref={popRef}
                style={{ top: (activePin?.popTop ?? 8) + popNudge, left: activePin?.popLeft ?? 8 }}
              >
                <ThreadCard
                  thread={active}
                  busy={busy}
                  role={visitor ? "visitor" : "owner"}
                  onEndorse={() => endorseThread(active.id)}
                  onClose={() => setActiveId(null)}
                  onStatus={(status) => setStatus(active.id, status)}
                  onReply={(text) => postComment(active.id, text)}
                />
              </div>
            ) : null}

            {/* Not until the spot is measured: at the top of the page, focusing
                the box would scroll the reader there. */}
            {draft && draftSpot ? (
              <div className="pop" style={{ top: draftSpot.popTop, left: draftSpot.popLeft }}>
                <div className="composer">
                  <div className="pop__bar">
                    <span className="pop__quote" title={describeAnchor(draft.anchor)}>
                      {quoteOf(draft.anchor)}
                    </span>
                    <button className="iconbtn" onClick={() => setDraft(null)} aria-label="Cancel">
                      ✕
                    </button>
                  </div>
                  <textarea
                    ref={focusInPlace}
                    value={draft.body}
                    placeholder="What should change?"
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void postComment();
                    }}
                  />
                  {props.userName || visitor ? null : <input
                    className="field"
                    value={author}
                    onChange={(e) => rememberName(e.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                  />}
                  <div className="composer__row">
                    {visitor ? (
                      <span className="tiny">{identity ? `Commenting as ${identity.name}` : "You'll be asked for your name first."}</span>
                    ) : (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={draft.notify}
                          onChange={(e) => setDraft({ ...draft, notify: e.target.checked })}
                        />
                        Notify agent
                      </label>
                    )}
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn--ghost" onClick={() => setDraft(null)}>
                        Cancel
                      </button>
                      <button className="btn btn--primary" onClick={() => void postComment()} disabled={busy || !draft.body.trim()}>
                        Comment
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {bubble ? (
            <div className="bubble" style={{ top: bubble.top, left: bubble.left }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setActiveId(null);
                  setDraft({ anchor: bubble.anchor, body: "", notify: false });
                  setBubble(null);
                }}
              >
                Comment
              </button>
            </div>
          ) : null}
        </div>
      </main>

      {/* Touch screens: commenting without a keyboard shortcut or hover. */}
      {hoverless && !editing ? (
        <div className={props.form ? "touchbar touchbar--raised" : "touchbar"}>
          {selected && !draft ? (
            <button
              className="touchbar__select"
              onClick={() => {
                setActiveId(null);
                setDraft({ anchor: selected, body: "", notify: false });
                setSelected(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              Comment on the selected words
            </button>
          ) : null}
          {tool ? <span className="touchbar__hint">Tap the spot or element the comment is about</span> : null}
          {/* A form's send bar owns the foot of a phone screen; hold to comment there. */}
          {!draft && !active && !props.form && canComment ? (
            <button
              className={tool ? "touchbar__fab touchbar__fab--on" : "touchbar__fab"}
              onClick={toggleTool}
              aria-label={tool ? "Stop placing a comment" : "Add a comment"}
            >
              {tool ? "✕" : "+"}
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div className={notice.kind === "bad" ? "toast toast--bad" : "toast toast--good"} role="status">
          {notice.text}
        </div>
      ) : null}
      {props.form && !editing ? (
        <FormBar responsesHref={visitor ? undefined : `/a/${props.slug}/responses`} responseCount={visitor ? undefined : props.form.responses} />
      ) : null}
      {visitor ? <MadeWithIndy raised={props.form !== null} /> : null}
      {visitor && ask ? (
        <IdentityDialog
          token={visitor.token}
          verifiedEmail={visitor.email}
          sharedBy={visitor.sharedBy}
          reason={ask.reason}
          onCancel={() => setAsk(null)}
          onDone={(who) => {
            const then = ask.then;
            remember(who);
            setAsk(null);
            then(who);
          }}
        />
      ) : null}
    </FormGate>
  );
}

/** "2 comments and 3 ticks", for the send panel and its notice. */
function sentWhat(comments: number, ticks: number): string {
  const parts = [
    comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "",
    ticks ? `${ticks} tick${ticks === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" and ");
}

/** The form's state around the page and its bar, on pages that have questions. */
function FormGate({
  slug,
  form,
  submitUrl,
  onSent,
  children,
}: {
  slug: string;
  form: ArtifactViewProps["form"];
  submitUrl?: string;
  onSent: () => void;
  children: React.ReactNode;
}) {
  if (!form) return <>{children}</>;
  return (
    <FormProvider slug={slug} fields={form.fields} settings={form.settings} submitUrl={submitUrl} onSent={onSent}>
      {children}
    </FormProvider>
  );
}

const KIND_LABEL: Record<string, string> = { markdown: "Page", html: "HTML page", react: "React app", svelte: "Svelte app" };

/** Kicker, title and lede above the page, unless the page opens with its own title. */
function ArticleHead(
  props: ArtifactViewProps & {
    /** The title and lede being typed, while editing. */
    head: { title: string; description: string } | null;
    onHead: (head: { title: string; description: string }) => void;
  },
) {
  const first = props.doc?.content?.[0];
  const ownTitle = first?.type === "heading" && first.attrs?.level === 1;
  const { head, onHead } = props;
  return (
    <div className="doc-head">
      <div className="doc-head__kicker">
        {KIND_LABEL[props.kind] ?? "Page"} · updated <Ago iso={props.createdAt} long />
        {props.visitor ? null : ` by ${props.authorName}`}
      </div>
      {ownTitle ? null : head ? (
        <Typeable as="h1" className="doc-head__title" value={head.title} placeholder="Title" onChange={(title) => onHead({ ...head, title })} />
      ) : (
        <h1 className="doc-head__title">{props.title}</h1>
      )}
      {ownTitle ? null : head ? (
        <Typeable
          as="p"
          className="doc-head__lede"
          value={head.description}
          placeholder="Add a line about what this page is for"
          onChange={(description) => onHead({ ...head, description })}
        />
      ) : props.description ? (
        <p className="doc-head__lede">{props.description}</p>
      ) : null}
    </div>
  );
}

function ThreadCard({
  thread,
  busy,
  role,
  onEndorse,
  onClose,
  onStatus,
  onReply,
}: {
  thread: ThreadView;
  busy: boolean;
  role: "owner" | "visitor";
  onEndorse: () => void;
  onClose: () => void;
  onStatus: (status: "open" | "resolved") => void;
  onReply: (text: string) => Promise<boolean>;
}) {
  return (
    <div className="pop__card">
      <div className="pop__bar">
        <span className="pop__quote" title={describeAnchor(thread.anchor)}>
          {quoteOf(thread.anchor)}
        </span>
        {role === "owner" ? (
          <button
            className="iconbtn"
            onClick={() => onStatus(thread.status === "open" ? "resolved" : "open")}
            disabled={busy}
            title={thread.status === "open" ? "Resolve" : "Reopen"}
            aria-label={thread.status === "open" ? "Resolve" : "Reopen"}
          >
            {thread.status === "open" ? "✓" : "↺"}
          </button>
        ) : null}
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="pop__thread">
        {[thread as Message, ...thread.replies].map((message, index) => (
          <article className="msg" key={message.id}>
            <span className={message.authorKind === "agent" ? "avatar avatar--agent" : "avatar"}>
              {initials(message.authorName)}
            </span>
            <div className="msg__main">
              <div className="msg__meta">
                <span className="msg__who">{message.authorName}</span>
                <span>{when(message.createdAt)}</span>
                {index === 0 && role === "owner" && thread.authorKind === "human" && !thread.sentAt && thread.status === "open" ? (
                  <span className="chip">not sent</span>
                ) : null}
                {role === "owner" && message.authorKind === "visitor" ? <span className="chip chip--visitor">visitor</span> : null}
              </div>
              <div className="msg__body">{message.body}</div>
            </div>
          </article>
        ))}
      </div>

      {role === "owner" && thread.authorKind === "visitor" ? (
        <div className="pop__forward">
          {thread.endorsedAt ? (
            <span className="tiny">You asked the agent to address this.</span>
          ) : (
            <>
              <span className="tiny">From a visitor. The agent sees it, flagged to check with you first.</span>
              <button className="btn btn--primary" onClick={onEndorse} disabled={busy}>
                Ask agent to address
              </button>
            </>
          )}
        </div>
      ) : null}
      <ReplyBox onSend={onReply} busy={busy} />
    </div>
  );
}

/** One message in a thread: the comment itself has the same shape as a reply. */
interface Message {
  id: string;
  authorKind: "agent" | "human" | "visitor";
  authorName: string;
  body: string;
  createdAt: string;
}

/**
 * The words the comment was left on. A reader recognises the sentence far
 * faster than a block id, so the card leads with it and keeps the technical
 * description in the tooltip.
 */
function quoteOf(anchor: Anchor | null): string {
  if (anchor?.quote) return `\u201c${truncate(anchor.quote.replace(/\s+/g, " ").trim(), 90)}\u201d`;

  const text = (anchor?.context ?? "").replace(/\s+/g, " ").trim();
  if (!text) return anchor?.type === "element" ? "a spot on the page" : "this page";

  // Stored context is a fixed-length slice of the sentence, so both ends
  // usually land mid-word. Drop the broken halves and say so with an ellipsis.
  let quote = text;
  let head = "";
  let tail = "";
  if (!/^[A-Z\u201c"([]/.test(quote)) {
    quote = quote.replace(/^\S+\s+/, "");
    head = "\u2026";
  }
  if (!/[.!?:;,\u201d")\]]$/.test(quote)) {
    quote = quote.replace(/\s+\S+$/, "");
    tail = "\u2026";
  }
  return `\u201c${head}${truncate(quote, 90)}${tail}\u201d`;
}

function ReplyBox({ onSend, busy }: { onSend: (text: string) => Promise<boolean>; busy: boolean }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  async function send() {
    if (!text.trim()) return;
    // The text stays until the reply is saved, so a failure loses nothing.
    if (!(await onSend(text))) return;
    setText("");
    setFocused(false);
  }

  return (
    <div className={focused || text ? "reply reply--open" : "reply"}>
      <textarea
        value={text}
        rows={focused || text ? 3 : 1}
        placeholder="Reply"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {focused || text ? (
        <div className="reply__row">
          <span className="tiny">Enter sends</span>
          <button className="btn btn--primary" disabled={busy || !text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={send}>
            Reply
          </button>
        </div>
      ) : null}
    </div>
  );
}
