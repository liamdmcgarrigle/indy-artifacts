"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  anchorForBlock,
  anchorFromPoint,
  anchorFromSelection,
  blockOf,
  describeAnchor,
  resolveAnchor,
  truncate,
  type Anchor,
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
  embedBase: string;
  framed: boolean;
  versions: VersionStub[];
  initialThreads: ThreadView[];
}

interface Pin {
  thread: ThreadView;
  top: number;
  left: number;
  exact: boolean;
  index: number;
}

const NAME_KEY = "art-author-name";

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

  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [threads, setThreads] = useState<ThreadView[]>(props.initialThreads);
  const [showResolved, setShowResolved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState(false);
  const [draft, setDraft] = useState<{ anchor: Anchor | null; body: string; notify: boolean } | null>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number; anchor: Anchor } | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [author, setAuthor] = useState("operator");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [batchMessage, setBatchMessage] = useState("");
  const [showBatch, setShowBatch] = useState(false);

  const isLatest = props.versionNumber === props.currentVersion;
  const visible = useMemo(
    () => threads.filter((t) => (showResolved ? true : t.status === "open")),
    [threads, showResolved],
  );
  const unsent = useMemo(
    () => threads.filter((t) => t.status === "open" && t.authorKind === "human" && !t.sentAt).length,
    [threads],
  );

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

  const refreshThreads = useCallback(async () => {
    const res = await fetch(`/api/artifacts/${props.slug}/comments?status=all`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { threads: ThreadView[] };
    setThreads(data.threads);
  }, [props.slug]);

  // ---- pin positions -------------------------------------------------------

  const recompute = useCallback(() => {
    const content = contentRef.current;
    const stage = stageRef.current;
    if (!content || !stage) return setPins([]);
    const origin = stage.getBoundingClientRect();
    const next: Pin[] = [];
    visible.forEach((thread, index) => {
      if (!thread.anchor) return;
      const resolved = resolveAnchor(content, thread.anchor);
      if (!resolved) return;
      next.push({
        thread,
        index: index + 1,
        exact: resolved.exact,
        top: resolved.rect.top - origin.top + (thread.anchor.type === "range" ? resolved.rect.height : 0),
        left: resolved.rect.left - origin.left + (thread.anchor.type === "element" ? 0 : resolved.rect.width),
      });
    });
    setPins(next);
  }, [visible]);

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

  // ---- messages from sandbox frames ---------------------------------------

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; selector?: string; text?: string; point?: { x: number; y: number } };
      if (!data || typeof data !== "object") return;
      if (data.type !== "art:picked" || !contentRef.current) return;

      const frames = Array.from(contentRef.current.querySelectorAll("iframe"));
      const frame = frames.find((f) => f.contentWindow === event.source);
      if (!frame) return;
      const block = blockOf(frame);
      if (!block) return;
      setTool(false);
      frames.forEach((f) => f.contentWindow?.postMessage({ type: "art:pick", on: false }, "*"));
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
  }, []);

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
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "c" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleTool();
      } else if (event.key === "Escape") {
        setTool(false);
        setFramePicking(false);
        setBubble(null);
        setDraft(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTool, setFramePicking]);

  function onContentMouseUp(event: React.MouseEvent) {
    const content = contentRef.current;
    const stage = stageRef.current;
    if (!content || !stage) return;

    if (tool) {
      const anchor = anchorFromPoint(content, event.clientX, event.clientY);
      setTool(false);
      setFramePicking(false);
      if (anchor) setDraft({ anchor, body: "", notify: false });
      return;
    }

    const anchor = anchorFromSelection(content);
    if (!anchor) {
      setBubble(null);
      return;
    }
    const selection = window.getSelection();
    const rect = selection?.getRangeAt(0).getBoundingClientRect();
    const origin = stage.getBoundingClientRect();
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
    setDraft({ anchor: anchorForBlock(block), body: "", notify: false });
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
      setDraft(null);
      setBubble(null);
      await refreshThreads();
      setNotice(payload.notify ? { kind: "good", text: "Comment sent to the agent." } : null);
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
      setShowBatch(false);
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
          {isLatest ? (
            <Link className="btn" href={`/a/${props.slug}/edit`}>
              Edit
            </Link>
          ) : null}
          <SchemeToggle />
        </div>
      </header>

      <div className="layout">
        <main className={tool ? "stage stage--picking" : "stage"} ref={stageRef}>
          <div className="stage__inner">
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
              onDoubleClick={commentOnBlock}
            >
              {props.framed ? (
                <div className="framewrap" data-block="b0" data-lines="1-1">
                  <iframe
                    src={`${props.embedBase}/page`}
                    sandbox="allow-scripts"
                    title={props.title}
                    style={{ height: 600 }}
                    onLoad={(e) => {
                      const frame = e.currentTarget;
                      const scheme = document.documentElement.getAttribute("data-scheme") ?? "light";
                      frame.contentWindow?.postMessage({ type: "art:scheme", scheme }, "*");
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
                  onClick={() => setActiveId(pin.thread.id === activeId ? null : pin.thread.id)}
                >
                  {initials(pin.thread.authorName)}
                </button>
              ))}
            </div>

            {bubble ? (
              <div className="bubble" style={{ top: bubble.top, left: bubble.left }}>
                <button
                  className="btn btn--primary"
                  onClick={() => {
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

        <aside className="side">
          <div className="side__head">
            <span className="side__title">
              Comments {visible.length > 0 ? `(${visible.length})` : ""}
            </span>
            {unsent > 0 ? (
              <button className="btn btn--primary" onClick={() => setShowBatch((s) => !s)} disabled={busy}>
                Send {unsent}
              </button>
            ) : null}
            <button className="btn btn--ghost" onClick={() => setShowResolved((s) => !s)}>
              {showResolved ? "Hide resolved" : "Show resolved"}
            </button>
          </div>

          {showBatch ? (
            <div className="side__foot">
              <div className="composer">
                <input
                  className="field"
                  placeholder="Optional note, e.g. done reviewing"
                  value={batchMessage}
                  onChange={(e) => setBatchMessage(e.target.value)}
                />
                <div className="composer__row">
                  <span className="tiny">{unsent} unsent comment{unsent === 1 ? "" : "s"}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn--ghost" onClick={() => setShowBatch(false)}>
                      Cancel
                    </button>
                    <button className="btn btn--primary" onClick={sendBatch} disabled={busy}>
                      Send to agent
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {notice ? (
            <div className="side__foot">
              <div className={notice.kind === "bad" ? "notice notice--bad" : "notice notice--good"}>{notice.text}</div>
            </div>
          ) : null}

          <div className="side__list">
            {visible.length === 0 && !draft ? (
              <p className="muted">
                Select text to comment on it, or press <strong>c</strong> and click a spot. Nothing is sent to the
                agent until you tick <em>Notify agent</em> or press Send.
              </p>
            ) : null}

            {visible.map((thread, index) => (
              <div
                key={thread.id}
                className={[
                  "thread",
                  thread.id === activeId ? "thread--active" : "",
                  thread.status === "resolved" ? "thread--resolved" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setActiveId(thread.id === activeId ? null : thread.id);
                  const content = contentRef.current;
                  if (!content || !thread.anchor) return;
                  const resolved = resolveAnchor(content, thread.anchor);
                  if (resolved) window.scrollTo({ top: window.scrollY + resolved.rect.top - 140, behavior: "smooth" });
                }}
              >
                <div className="thread__head">
                  <span className="thread__who">
                    {index + 1}. {thread.authorName}
                  </span>
                  <span>{when(thread.createdAt)}</span>
                  <span>v{thread.versionNumber}</span>
                  {thread.authorKind === "human" && !thread.sentAt && thread.status === "open" ? (
                    <span className="badge badge--unsent">unsent</span>
                  ) : null}
                  {thread.status === "resolved" ? <span className="badge">resolved</span> : null}
                </div>
                <div className="thread__anchor">{describeAnchor(thread.anchor)}</div>
                <div className="thread__body">{thread.body}</div>

                {thread.replies.length > 0 ? (
                  <div className="thread__replies">
                    {thread.replies.map((reply) => (
                      <div key={reply.id}>
                        <div className="thread__head">
                          <span className="thread__who">{reply.authorName}</span>
                          <span>{when(reply.createdAt)}</span>
                          {reply.authorKind === "agent" ? <span className="badge">agent</span> : null}
                        </div>
                        <div className="thread__body">{reply.body}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {thread.id === activeId ? (
                  <div className="thread__actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn--ghost"
                      onClick={() => setStatus(thread.id, thread.status === "open" ? "resolved" : "open")}
                      disabled={busy}
                    >
                      {thread.status === "open" ? "Resolve" : "Reopen"}
                    </button>
                    <ReplyBox onSend={(text) => postComment(thread.id, text)} busy={busy} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {draft ? (
            <div className="side__foot">
              <div className="composer">
                <div className="tiny">New comment on {describeAnchor(draft.anchor)}</div>
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
        </aside>
      </div>
    </>
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
      <textarea value={text} autoFocus placeholder="Reply" onChange={(e) => setText(e.target.value)} />
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
