"use client";

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Code2 } from "lucide-react";

/** The block as it looks, from HTML the page already has. */
function Html({ html }: { html: string }) {
  return <div className="source-edit__view" contentEditable={false} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** An element built by hand, so an <art-embed> upgrades and loads its frame. */
function Frame({ id, kind }: { id: string; kind: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement("art-embed");
    el.setAttribute("data-embed", id);
    el.setAttribute("data-kind", kind);
    host.current?.replaceChildren(el);
  }, [id, kind]);
  return <div ref={host} className="source-edit__view" contentEditable={false} />;
}

/**
 * A live frame (html or mermaid). Its code is code, so it is edited as code,
 * under the preview; the preview catches up when the edit is saved.
 */
export function EmbedEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const [open, setOpen] = useState(false);
  const code = String(node.attrs.code ?? "");
  const kind = String(node.attrs.kind ?? "html");
  return (
    <NodeViewWrapper className="source-edit">
      {node.attrs.embedId ? <Frame id={String(node.attrs.embedId)} kind={kind} /> : <p className="source-edit__note">New {kind} block: it shows once saved.</p>}
      <button type="button" className="source-edit__toggle" contentEditable={false} onClick={() => setOpen((v) => !v)}>
        <Code2 className="size-3.5" /> {open ? `Hide the ${kind}` : `Edit the ${kind}`}
      </button>
      {open ? (
        <textarea
          className="source-edit__code"
          value={code}
          spellCheck={false}
          rows={Math.min(code.split("\n").length + 1, 24)}
          onChange={(e) => updateAttributes({ code: e.target.value })}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * A block the editor keeps exactly as written, because it cannot model it.
 * It shows as it renders; its source opens only if you ask, and says why.
 */
export function RawEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const [open, setOpen] = useState(false);
  const src = node.attrs.src as string | null;
  if (src === null) return <NodeViewWrapper />;
  return (
    <NodeViewWrapper className="source-edit source-edit--raw">
      {node.attrs.html ? <Html html={String(node.attrs.html)} /> : null}
      <button type="button" className="source-edit__toggle" contentEditable={false} onClick={() => setOpen((v) => !v)}>
        <Code2 className="size-3.5" /> {open ? "Done with the source" : "Kept as written · edit its source"}
      </button>
      {open ? (
        <textarea
          className="source-edit__code"
          value={src}
          spellCheck={false}
          rows={Math.min(src.split("\n").length + 1, 24)}
          onChange={(e) => updateAttributes({ src: e.target.value })}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
