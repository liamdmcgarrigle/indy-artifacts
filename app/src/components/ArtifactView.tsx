"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  truncate,
  type Anchor,
  type Spot,
} from "@/lib/anchors";
import type { JSONContent } from "@tiptap/core";
import { DocView } from "./viewer/DocView";
import { ViewerHeader, ViewerMenuItem, ViewerMenuSeparator } from "./viewer/ViewerHeader";
import { readNavList, type NavList } from "./library/nav-list";
import { agoLong } from "@/lib/time";

export interface ThreadView {
  id: string;
  authorKind: "agent" | "human";
  authorName: string;
  body: string;
  anchor: Anchor | null;
  status: "open" | "resolved";
  sentAt: string | null;
  versionNumber: number;
  createdAt: string;
  replies: {
    id: string;
    authorKind: "agent" | "human";
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
  /** The signed-in owner's name, used as the comment author. */
  userName?: string | null;
  /** The markdown as a document for the editor; null for framed artifacts. */
  doc: JSONContent | null;
  assetBase: string;
  kind: string;
  theme: string;
  currentVersion: number;
  versionNumber: number;
  authorKind: string;
  authorName: string;
  buildStatus: string;
  buildLog: string | null;
  warnings: { line: number; message: string }[];
  html: string | null;
  source: string | null;
  embedBase: string;
  framed: boolean;
  versions: VersionStub[];
  initialThreads: ThreadView[];
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

const NAME_KEY = "art-author-name";
const POP_W = 312;
/** How far outside the text column the edit pencil sits, and stays alive. */
const EDIT_GUTTER = 48;
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
  const [author, setAuthor] = useState(props.userName ?? "operator");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [batchMessage, setBatchMessage] = useState("");
  const [panel, setPanel] = useState<"none" | "list" | "send">("none");
  const [frameHeight, setFrameHeight] = useState(600);
  const [hover, setHover] = useState<{ lines: [number, number]; top: number; left: number } | null>(null);
  const [edit, setEdit] = useState<{
    lines: [number, number];
    text: string;
    box: { top: number; left: number; width: number; minHeight: number };
  } | null>(null);

  const isLatest = props.versionNumber === props.currentVersion;
  const somethingOpen = useRef(false);
  somethingOpen.current = tool || draft !== null || activeId !== null || panel !== "none" || bubble !== null || edit !== null || menu !== null;
  const visible = useMemo(
    () => threads.filter((t) => (showResolved ? true : t.status === "open")),
    [threads, showResolved],
  );
  const unsent = useMemo(
    () => threads.filter((t) => t.status === "open" && t.authorKind === "human" && !t.sentAt).length,
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
    script.src = "/primitives/primitives.js";
    document.head.appendChild(script);
  }, []);

  // Notices fade on their own; there is no sidebar to park them in.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshThreads = useCallback(async () => {
    const res = await fetch(`/api/artifacts/${props.slug}/comments?status=all`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ThreadView[] };
    setThreads(data.threads);
  }, [props.slug]);

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
    setPins(fanOut(next));

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
    const timer = window.setInterval(schedule, 1200);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.clearInterval(timer);
    };
  }, [recompute]);

  // Follow the artifact while it is open. An agent publishing a new version or
  // answering a comment should show up here without a reload. A refresh is held
  // back while something is half typed, so nothing under the cursor moves.
  const pendingRefresh = useRef(false);
  const busyEditingRef = useRef(false);
  const busyEditing = draft !== null || edit !== null;

  useEffect(() => {
    const source = new EventSource(`/api/live/${props.slug}`);
    source.addEventListener("changed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { version: number };
      if (data.version !== props.versionNumber) {
        if (busyEditingRef.current) pendingRefresh.current = true;
        else router.refresh();
      }
      void refreshThreads();
    });
    return () => source.close();
  }, [props.slug, props.versionNumber, refreshThreads, router]);

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

      if (data.type !== "art:picked" || !contentRef.current) return;

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
    if (!isLatest) return;
    void fetch(`/api/artifacts/${props.slug}/seen`, { method: "POST" }).catch(() => {});
  }, [isLatest, props.slug, props.versionNumber]);

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
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        if (event.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "c") {
        event.preventDefault();
        toggleTool();
      } else if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        goNav(event.key === "j" ? 1 : -1);
      } else if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        goVersion(versionRef.current + (event.key === "]" ? 1 : -1));
      } else if (event.key === "e" && isLatest && !props.framed) {
        event.preventDefault();
        router.push(`/a/${props.slug}/edit`);
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
        setHover(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTool, setFramePicking, goNav, goVersion, isLatest, props.framed, props.slug, router]);

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
    if (!event.isPrimary || event.button > 0 || tool || draft) return;
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
    if (picked) options.push({ label: `Comment on this ${kindName(el)}`, anchor: picked });
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

  // ---- editing one block ---------------------------------------------------

  const canEdit = isLatest && props.kind === "markdown" && props.source !== null;
  // A phone has no hover, so the pencil that hover reveals is not for it.
  const hoverCapable = useRef(true);
  const [hoverless, setHoverless] = useState(false);
  useEffect(() => {
    hoverCapable.current = window.matchMedia("(hover: hover)").matches;
    setHoverless(!hoverCapable.current);
  }, []);

  function linesOfBlock(el: HTMLElement): [number, number] | null {
    const raw = el.dataset.lines;
    if (!raw) return null;
    const [from, to] = raw.split("-").map(Number);
    return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : null;
  }

  /**
   * Which block the pointer is over, decided by where the pointer is rather
   * than what it entered and left.
   *
   * The pencil sits in the margin, outside the text column, so a handler that
   * hid it on mouseleave took it away the moment you set off to click it. This
   * asks the document what is under the pointer, widened by the gutter the
   * pencil lives in, which means the button is inside the region that keeps it
   * on screen.
   */
  function onStageMove(event: React.MouseEvent) {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;
    const target = event.target as HTMLElement | null;

    // Placing a comment: outline the smallest thing under the pointer.
    if (tool) {
      const el = pickTarget(content, target);
      if (!el) return setPick(null);
      const origin = inner.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setPick({ top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height });
      return;
    }

    if (!canEdit || edit || !hoverCapable.current) return;
    // On the way to the pencil the pointer crosses the pencil itself; keep it.
    if (target?.closest(".blockedit")) return;
    if (target?.closest(".pop, .panel, .inline-edit, .pin, .note")) return setHover(null);

    const column = content.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (y < column.top || y > column.bottom) return setHover(null);
    if (x < column.left - EDIT_GUTTER || x > column.right + EDIT_GUTTER) return setHover(null);

    // Find the block by height alone. Blocks are narrower than the column, so
    // probing at the pointer would find nothing in the space beside a block,
    // and the pencil would vanish on the way to it.
    const blocks = Array.from(content.querySelectorAll<HTMLElement>(".art-content > [data-block]"));
    const block = blocks.find((b) => {
      const r = b.getBoundingClientRect();
      return y >= r.top - 6 && y <= r.bottom + 6;
    });
    if (!block) return setHover(null);
    const lines = linesOfBlock(block);
    if (!lines) return setHover(null);

    const origin = inner.getBoundingClientRect();
    const box = block.getBoundingClientRect();
    setHover({ lines, top: box.top - origin.top + 2, left: Math.min(box.right, column.right) - origin.left + 10 });
  }

  function startEdit(lines: [number, number]) {
    const inner = innerRef.current;
    const content = contentRef.current;
    if (!inner || !content || props.source === null) return;
    const block = Array.from(content.querySelectorAll<HTMLElement>("[data-lines]")).find(
      (el) => el.dataset.lines === `${lines[0]}-${lines[1]}`,
    );
    const origin = inner.getBoundingClientRect();
    const box = (block ?? content).getBoundingClientRect();
    const text = props.source.split("\n").slice(lines[0] - 1, lines[1]).join("\n");
    setHover(null);
    setActiveId(null);
    setEdit({
      lines,
      text,
      box: {
        top: box.top - origin.top - 8,
        left: box.left - origin.left - 10,
        width: box.width + 20,
        minHeight: box.height + 16,
      },
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/artifacts/${props.slug}/lines`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: edit.lines[0],
          to: edit.lines[1],
          text: edit.text,
          author_name: author,
          expected_version: props.versionNumber,
        }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setNotice({ kind: "bad", text: data.error?.message ?? "could not save that block" });
        return;
      }
      setEdit(null);
      setNotice({ kind: "good", text: "Saved as a new version." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ---- writes --------------------------------------------------------------

  function rememberName(name: string) {
    setAuthor(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* private mode */
    }
  }

  async function postComment(parentId?: string, bodyText?: string) {
    const payload = {
      body: bodyText ?? draft?.body ?? "",
      author_name: author,
      anchor: parentId ? null : (draft?.anchor ?? null),
      notify: parentId ? false : (draft?.notify ?? false),
      parent_id: parentId ?? null,
      version_number: props.versionNumber,
    };
    if (!payload.body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/artifacts/${props.slug}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        setNotice({ kind: "bad", text: err.error?.message ?? "could not save that comment" });
        return;
      }
      if (!parentId) {
        setDraft(null);
        setBubble(null);
        window.getSelection()?.removeAllRanges();
      }
      await refreshThreads();
      if (payload.notify) setNotice({ kind: "good", text: "Comment sent to the agent." });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "open" | "resolved") {
    setBusy(true);
    try {
      await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (status === "resolved") setActiveId(null);
      await refreshThreads();
    } finally {
      setBusy(false);
    }
  }

  async function sendBatch() {
    setBusy(true);
    try {
      const res = await fetch(`/api/artifacts/${props.slug}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: batchMessage, author_name: author }),
      });
      const data = (await res.json()) as { count?: number; error?: { message?: string } };
      if (!res.ok) {
        setNotice({ kind: "bad", text: data.error?.message ?? "could not send" });
        return;
      }
      setPanel("none");
      setBatchMessage("");
      await refreshThreads();
      setNotice({
        kind: "good",
        text: data.count
          ? `Sent ${data.count} comment${data.count === 1 ? "" : "s"} to the agent.`
          : "Nothing new to send.",
      });
    } finally {
      setBusy(false);
    }
  }

  // ---- render --------------------------------------------------------------

  return (
    <>
      <link rel="stylesheet" href={`/themes/${props.theme}.css`} />
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
        unsent={unsent}
        agentName={props.agentName}
        panel={panel}
        canEdit={isLatest && !props.framed}
        canCompare={props.versionNumber > 1}
        onVersion={goVersion}
        onNav={goNav}
        onThreads={() => setPanel((p) => (p === "list" ? "none" : "list"))}
        onSend={() => setPanel((p) => (p === "send" ? "none" : "send"))}
        menu={
          <>
            <ViewerMenuItem onSelect={toggleTool}>Comment on a spot</ViewerMenuItem>
            <ViewerMenuItem onSelect={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide resolved threads" : "Show resolved threads"}
            </ViewerMenuItem>
            <ViewerMenuSeparator />
            <ViewerMenuItem onSelect={() => void navigator.clipboard?.writeText(window.location.href)}>Copy link</ViewerMenuItem>
          </>
        }
      />

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
            <div className="tiny">
              {unsent} comment{unsent === 1 ? "" : "s"} will go to the agent as one message.
            </div>
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
        className={tool ? "stage stage--picking" : "stage"}
        onMouseMove={onStageMove}
        onMouseLeave={() => setHover(null)}
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
                  sandbox="allow-scripts"
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
                <ArticleHead {...props} />
                {props.doc ? (
                  <DocView doc={props.doc} fallbackHtml={props.html ?? ""} assetBase={props.assetBase} onReady={onDocReady} />
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
                  onClose={() => setActiveId(null)}
                  onStatus={(status) => setStatus(active.id, status)}
                  onReply={(text) => postComment(active.id, text)}
                />
              </div>
            ) : null}

            {draft ? (
              <div className="pop" style={{ top: draftSpot?.popTop ?? 8, left: draftSpot?.popLeft ?? 8 }}>
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
                    autoFocus
                    value={draft.body}
                    placeholder="What should change?"
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void postComment();
                    }}
                  />
                  {props.userName ? null : <input
                    className="field"
                    value={author}
                    onChange={(e) => rememberName(e.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                  />}
                  <div className="composer__row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={draft.notify}
                        onChange={(e) => setDraft({ ...draft, notify: e.target.checked })}
                      />
                      Notify agent
                    </label>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn--ghost" onClick={() => setDraft(null)}>
                        Cancel
                      </button>
                      <button className="btn btn--primary" onClick={() => postComment()} disabled={busy || !draft.body.trim()}>
                        Comment
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {hover && !edit ? (
            <button
              className="blockedit"
              style={{ top: hover.top, left: hover.left }}
              // On press, not on click: the pointer crossing the gutter keeps
              // re-rendering this button, and a click needs the press and the
              // release to land on the same element.
              onMouseDown={(event) => {
                event.preventDefault();
                startEdit(hover.lines);
              }}
              title={`Edit lines ${hover.lines[0]}-${hover.lines[1]}`}
              aria-label={`Edit lines ${hover.lines[0]} to ${hover.lines[1]}`}
            >
              ✎
            </button>
          ) : null}

          {edit ? (
            <div
              className="inline-edit"
              style={{ top: edit.box.top, left: edit.box.left, width: edit.box.width }}
            >
              <textarea
                autoFocus
                spellCheck
                value={edit.text}
                style={{ minHeight: edit.box.minHeight }}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit();
                  if (e.key === "Escape") setEdit(null);
                }}
              />
              <div className="inline-edit__bar">
                <span className="tiny">
                  lines {edit.lines[0]}-{edit.lines[1]} · saves a new version
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn--ghost" onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                  <button className="btn btn--primary" onClick={saveEdit} disabled={busy}>
                    Save
                  </button>
                </span>
              </div>
            </div>
          ) : null}

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
      {hoverless ? (
        <div className="touchbar">
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
          {!draft && !active ? (
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
    </>
  );
}

const KIND_LABEL: Record<string, string> = { markdown: "Page", html: "HTML page", react: "React app", svelte: "Svelte app" };

/** Kicker, title and lede above the page, unless the page opens with its own title. */
function ArticleHead(props: ArtifactViewProps) {
  const first = props.doc?.content?.[0];
  const ownTitle = first?.type === "heading" && first.attrs?.level === 1;
  return (
    <div className="doc-head">
      <div className="doc-head__kicker">
        {KIND_LABEL[props.kind] ?? "Page"} · updated {agoLong(props.createdAt)} by {props.authorName}
      </div>
      {ownTitle ? null : <h1 className="doc-head__title">{props.title}</h1>}
      {props.description && !ownTitle ? <p className="doc-head__lede">{props.description}</p> : null}
    </div>
  );
}

function ThreadCard({
  thread,
  busy,
  onClose,
  onStatus,
  onReply,
}: {
  thread: ThreadView;
  busy: boolean;
  onClose: () => void;
  onStatus: (status: "open" | "resolved") => void;
  onReply: (text: string) => void;
}) {
  return (
    <div className="pop__card">
      <div className="pop__bar">
        <span className="pop__quote" title={describeAnchor(thread.anchor)}>
          {quoteOf(thread.anchor)}
        </span>
        <button
          className="iconbtn"
          onClick={() => onStatus(thread.status === "open" ? "resolved" : "open")}
          disabled={busy}
          title={thread.status === "open" ? "Resolve" : "Reopen"}
          aria-label={thread.status === "open" ? "Resolve" : "Reopen"}
        >
          {thread.status === "open" ? "✓" : "↺"}
        </button>
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
                {index === 0 && thread.authorKind === "human" && !thread.sentAt && thread.status === "open" ? (
                  <span className="chip">not sent</span>
                ) : null}
              </div>
              <div className="msg__body">{message.body}</div>
            </div>
          </article>
        ))}
      </div>

      <ReplyBox onSend={onReply} busy={busy} />
    </div>
  );
}

/** One message in a thread: the comment itself has the same shape as a reply. */
interface Message {
  id: string;
  authorKind: "agent" | "human";
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

function ReplyBox({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  function send() {
    if (!text.trim()) return;
    onSend(text);
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
            send();
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
