"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  anchorForBlock,
  anchorFromPoint,
  anchorFromSelection,
  blockOf,
  describeAnchor,
  rangeForAnchor,
  resolveAnchor,
  spotFor,
  spreadPins,
  truncate,
  type Anchor,
  type Spot,
} from "@/lib/anchors";
import { SchemeToggle } from "./SchemeToggle";

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

interface Pin extends Spot {
  thread: ThreadView;
  exact: boolean;
}

const NAME_KEY = "art-author-name";
const POP_W = 312;

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
  const hideHover = useRef<number | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
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
  const [author, setAuthor] = useState("operator");
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

  // ---- pin and popover positions ------------------------------------------

  const recompute = useCallback(() => {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;
    // The overlay is a child of .stage__inner, so that is the origin; measuring
    // against .stage would shift every pin by the stage padding and centring.
    const origin = inner.getBoundingClientRect();

    const box = content.getBoundingClientRect();
    const layout = {
      viewportWidth: window.innerWidth,
      contentLeft: box.left,
      contentRight: box.right,
      popWidth: POP_W,
    };

    const next: Pin[] = [];
    visible.forEach((thread) => {
      if (!thread.anchor) return;
      const resolved = resolveAnchor(content, thread.anchor);
      if (!resolved) return;
      next.push({
        thread,
        exact: resolved.exact,
        ...spotFor(resolved.rect, origin, thread.anchor.type, layout),
      });
    });
    setPins(spreadPins(next));

    if (draft?.anchor) {
      const resolved = resolveAnchor(content, draft.anchor);
      setDraftSpot(resolved ? spotFor(resolved.rect, origin, draft.anchor.type, layout) : null);
    } else {
      setDraftSpot(null);
    }
  }, [visible, draft?.anchor]);

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
  }, [visible, activeId, threads]);

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
      if (event.key === "c" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleTool();
      } else if (event.key === "Escape") {
        setTool(false);
        setFramePicking(false);
        setBubble(null);
        setDraft(null);
        setActiveId(null);
        setPanel("none");
        setHover(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTool, setFramePicking]);

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

  function onContentMouseUp(event: React.MouseEvent) {
    const content = contentRef.current;
    const inner = innerRef.current;
    if (!content || !inner) return;

    if (tool) {
      const anchor = anchorFromPoint(content, event.clientX, event.clientY);
      setTool(false);
      setFramePicking(false);
      if (anchor) {
        setActiveId(null);
        setDraft({ anchor, body: "", notify: false });
      }
      return;
    }

    const anchor = anchorFromSelection(content);
    if (!anchor) {
      setBubble(null);
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

  function linesOfBlock(el: HTMLElement): [number, number] | null {
    const raw = el.dataset.lines;
    if (!raw) return null;
    const [from, to] = raw.split("-").map(Number);
    return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : null;
  }

  /**
   * The Edit affordance sits outside the content box, so moving the pointer
   * towards it fires mouseleave. Hold it for a moment instead of yanking it
   * away under the cursor.
   */
  function keepHover() {
    if (hideHover.current) window.clearTimeout(hideHover.current);
    hideHover.current = null;
  }

  function dropHover() {
    keepHover();
    hideHover.current = window.setTimeout(() => setHover(null), 220);
  }

  function onContentMove(event: React.MouseEvent) {
    if (!canEdit || tool || edit) return;
    keepHover();
    const inner = innerRef.current;
    const block = blockOf(event.target as Node);
    if (!inner || !block) return setHover(null);
    const lines = linesOfBlock(block);
    if (!lines) return setHover(null);
    const origin = inner.getBoundingClientRect();
    const box = block.getBoundingClientRect();
    setHover({ lines, top: box.top - origin.top + 2, left: box.right - origin.left + 10 });
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
    keepHover();
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
      <header className="top">
        <Link className="top__home" href="/">
          <span className="top__dot" /> Artifacts
        </Link>
        <div className="top__title">
          {props.title} <span className="top__meta">v{props.versionNumber}</span>
        </div>
        <div className="top__actions">
          <select
            className="select"
            value={props.versionNumber}
            onChange={(e) => {
              const n = Number(e.target.value);
              window.location.href = n === props.currentVersion ? `/a/${props.slug}` : `/a/${props.slug}/v/${n}`;
            }}
            aria-label="Version"
          >
            {props.versions.map((v) => (
              <option key={v.number} value={v.number}>
                v{v.number} · {v.authorKind === "human" ? "edited" : "agent"} · {when(v.createdAt)}
              </option>
            ))}
          </select>
          {props.versionNumber > 1 ? (
            <Link className="btn btn--ghost" href={`/a/${props.slug}/v/${props.versionNumber}?diff=${props.versionNumber - 1}`}>
              Diff
            </Link>
          ) : null}
          <button className={tool ? "btn btn--on" : "btn"} onClick={toggleTool} title="Comment tool (c)">
            {tool ? "Click a spot…" : "Comment"}
          </button>
          <button
            className={panel === "list" ? "btn btn--on panel-btn" : "btn panel-btn"}
            onClick={() => setPanel((p) => (p === "list" ? "none" : "list"))}
            title="All comments"
          >
            {visible.length > 0 ? `Threads ${visible.length}` : "Threads"}
          </button>
          {unsent > 0 ? (
            <button
              className="btn btn--primary panel-btn"
              onClick={() => setPanel((p) => (p === "send" ? "none" : "send"))}
              disabled={busy}
            >
              Send {unsent}
            </button>
          ) : null}
          {isLatest ? (
            <Link className="btn" href={`/a/${props.slug}/edit`}>
              Edit
            </Link>
          ) : null}
          <SchemeToggle />
        </div>
      </header>

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

      <main className={tool ? "stage stage--picking" : "stage"}>
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
            className="art-content"
            ref={contentRef}
            onMouseUp={onContentMouseUp}
            onMouseMove={onContentMove}
            onMouseLeave={dropHover}
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
              <div dangerouslySetInnerHTML={{ __html: props.html ?? "" }} />
            )}
          </div>

          <div className="pins">
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
                onClick={() => (pin.thread.id === activeId ? setActiveId(null) : openThread(pin.thread))}
              >
                {initials(pin.thread.authorName)}
                {pin.thread.replies.length > 0 ? <span className="pin__count">{pin.thread.replies.length}</span> : null}
              </button>
            ))}

            {/* A thread whose block is gone has no pin, so its card opens at the
                top of the page rather than nowhere. */}
            {active ? (
              <div className="pop" style={{ top: activePin?.popTop ?? 8, left: activePin?.popLeft ?? 8 }}>
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
                  <div className="pop__head">
                    <span className={"avatar"}>{initials(author)}</span>
                    <span className="pop__anchor" title={describeAnchor(draft.anchor)}>
                      {describeAnchor(draft.anchor)}
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
                  <input
                    className="field"
                    value={author}
                    onChange={(e) => rememberName(e.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                  />
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
              onMouseEnter={keepHover}
              onMouseLeave={dropHover}
              onClick={() => startEdit(hover.lines)}
              title={`Edit lines ${hover.lines[0]}-${hover.lines[1]}`}
            >
              Edit
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

      {notice ? (
        <div className={notice.kind === "bad" ? "toast toast--bad" : "toast toast--good"} role="status">
          {notice.text}
        </div>
      ) : null}
    </>
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
      <div className="pop__head">
        <span className={thread.authorKind === "agent" ? "avatar avatar--agent" : "avatar"}>
          {initials(thread.authorName)}
        </span>
        <span className="pop__who">
          {thread.authorName}
          <span className="tiny"> · {when(thread.createdAt)} · v{thread.versionNumber}</span>
        </span>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="pop__anchor" title={describeAnchor(thread.anchor)}>
        {describeAnchor(thread.anchor)}
      </div>

      <div className="thread__body">{thread.body}</div>
      {thread.authorKind === "human" && !thread.sentAt && thread.status === "open" ? (
        <div className="tiny">Not sent to the agent yet.</div>
      ) : null}

      {thread.replies.length > 0 ? (
        <div className="thread__replies">
          {thread.replies.map((reply) => (
            <div key={reply.id}>
              <div className="thread__head">
                <span className={reply.authorKind === "agent" ? "avatar avatar--agent" : "avatar"}>
                  {initials(reply.authorName)}
                </span>
                <span className="thread__who">{reply.authorName}</span>
                <span>{when(reply.createdAt)}</span>
              </div>
              <div className="thread__body">{reply.body}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="thread__actions">
        <button
          className="btn btn--ghost"
          onClick={() => onStatus(thread.status === "open" ? "resolved" : "open")}
          disabled={busy}
        >
          {thread.status === "open" ? "Resolve" : "Reopen"}
        </button>
        <ReplyBox onSend={onReply} busy={busy} />
      </div>
    </div>
  );
}

function ReplyBox({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button className="btn btn--ghost" onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  return (
    <div className="composer" style={{ width: "100%" }}>
      <textarea
        value={text}
        autoFocus
        placeholder="Reply"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            onSend(text);
            setText("");
            setOpen(false);
          }
        }}
      />
      <div className="composer__row">
        <button className="btn btn--ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn btn--primary"
          disabled={busy || !text.trim()}
          onClick={() => {
            onSend(text);
            setText("");
            setOpen(false);
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
