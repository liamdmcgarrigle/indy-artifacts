"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SchemeToggle } from "./SchemeToggle";

export interface EditorProps {
  slug: string;
  title: string;
  theme: string;
  kind: string;
  version: number;
  source: string | null;
  files: Record<string, string> | null;
}

const NAME_KEY = "art-author-name";

export function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<{ state: { doc: { toString(): string } }; dispatch: (t: unknown) => void; destroy(): void } | null>(null);

  const fileNames = props.files ? Object.keys(props.files).sort() : [];
  const [active, setActive] = useState(fileNames[0] ?? "");
  const [buffers, setBuffers] = useState<Record<string, string>>(
    props.files ?? { source: props.source ?? "" },
  );
  const [author, setAuthor] = useState("operator");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const key = props.files ? active : "source";

  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAME_KEY);
      if (stored) setAuthor(stored);
    } catch {
      /* private mode */
    }
  }, []);

  // CodeMirror is heavy and browser-only; load it after mount.
  useEffect(() => {
    let cancelled = false;
    let view: { destroy(): void } | null = null;

    (async () => {
      const [{ EditorView, basicSetup }, { markdown }, { html }, { javascript }, { EditorState }] = await Promise.all([
        import("codemirror"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/lang-html").catch(() => ({ html: null }) as never),
        import("@codemirror/lang-javascript").catch(() => ({ javascript: null }) as never),
        import("@codemirror/state"),
      ]);
      if (cancelled || !host.current) return;

      const language =
        key.endsWith(".svelte") || key.endsWith(".html") || props.kind === "html"
          ? (html ? html() : [])
          : key.endsWith(".tsx") || key.endsWith(".ts") || key.endsWith(".js") || key.endsWith(".jsx")
            ? (javascript ? javascript({ jsx: true, typescript: true }) : [])
            : markdown();

      const themeExtension = EditorView.theme({
        "&": { backgroundColor: "var(--art-bg)", color: "var(--art-text)", height: "100%" },
        ".cm-gutters": {
          backgroundColor: "var(--art-surface)",
          color: "var(--art-text-faint)",
          border: "none",
          borderRight: "1px solid var(--art-border)",
        },
        ".cm-activeLine": { backgroundColor: "var(--art-surface-2)" },
        ".cm-activeLineGutter": { backgroundColor: "var(--art-surface-2)" },
        ".cm-content": { caretColor: "var(--art-accent)", padding: "12px 0" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--art-accent)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
          backgroundColor: "var(--art-accent-wash)",
        },
        ".cm-selectionMatch": { backgroundColor: "var(--art-warn-wash)" },
      });

      host.current.innerHTML = "";
      const instance = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: buffers[key] ?? "",
          extensions: [
            basicSetup,
            language,
            themeExtension,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              const text = update.state.doc.toString();
              setBuffers((prev) => ({ ...prev, [key]: text }));
              setDirty(true);
            }),
          ],
        }),
      });
      view = instance;
      viewRef.current = instance as never;
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
    // Rebuilding on `key` swaps the document when the operator picks another file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, props.kind]);

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        author_kind: "human",
        author_name: author,
        expected_version: props.version,
        message: message.trim() || undefined,
      };
      if (props.files) payload.files = buffers;
      else payload.source = buffers.source;

      const res = await fetch(`/api/artifacts/${props.slug}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        version?: number;
        build_status?: string;
        buildStatus?: string;
        buildLog?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        setNotice({ kind: "bad", text: data.error?.message ?? "could not save" });
        return;
      }
      setDirty(false);
      window.location.href = `/a/${props.slug}`;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  return (
    <>
      <link rel="stylesheet" href={`/themes/${props.theme}.css`} />
      <header className="top">
        <Link className="top__home" href="/">
          <span className="top__dot" /> Artifacts
        </Link>
        <div className="top__title">
          Editing {props.title} <span className="top__meta">v{props.version}</span>
        </div>
        <div className="top__actions">
          <SchemeToggle />
        </div>
      </header>

      <div className="editor">
        <div className="editor__bar">
          {props.files ? (
            <select className="select" value={active} onChange={(e) => setActive(e.target.value)} aria-label="File">
              {fileNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <span className="tiny">{props.kind} source</span>
          )}
          <input
            className="field"
            style={{ maxWidth: 280 }}
            placeholder="What did you change?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <input
            className="field"
            style={{ maxWidth: 160 }}
            placeholder="Your name"
            aria-label="Your name"
            value={author}
            onChange={(e) => {
              setAuthor(e.target.value);
              try {
                localStorage.setItem(NAME_KEY, e.target.value);
              } catch {
                /* private mode */
              }
            }}
          />
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {notice ? <span className={notice.kind === "bad" ? "notice notice--bad" : "notice notice--good"}>{notice.text}</span> : null}
            {dirty ? <span className="tiny">unsaved</span> : null}
            <Link className="btn btn--ghost" href={`/a/${props.slug}`}>
              Cancel
            </Link>
            <button className="btn btn--primary" onClick={save} disabled={busy || !dirty}>
              Save as v{props.version + 1}
            </button>
          </span>
        </div>
        <div className="editor__panes">
          <div className="editor__pane" ref={host} />
        </div>
      </div>
    </>
  );
}
