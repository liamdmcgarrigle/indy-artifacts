"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { viewExtensions } from "@/lib/doc/views";

/** Wait for the <art-*> primitives, which the node views build on. */
function usePrimitives(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!document.getElementById("art-primitives")) {
      const script = document.createElement("script");
      script.id = "art-primitives";
      script.type = "module";
      script.src = "/primitives/primitives.js";
      document.head.appendChild(script);
    }
    let live = true;
    void customElements.whenDefined("art-callout").then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/**
 * A markdown artifact, rendered by the same editor that will edit it.
 *
 * Until the editor is up, the pipeline's HTML stands in: the same blocks with
 * the same data-block and data-lines, so the first paint is the page itself
 * and comment pins can place themselves straight away.
 */
export function DocView(props: {
  doc: JSONContent;
  fallbackHtml: string;
  assetBase: string;
  onReady?: () => void;
}) {
  const primitives = usePrimitives();
  const [mounted, setMounted] = useState(false);
  const markMounted = useCallback(() => setMounted(true), []);
  return (
    <>
      {primitives ? <DocEditor {...props} onMounted={markMounted} /> : null}
      {mounted ? null : <div className="art-content" dangerouslySetInnerHTML={{ __html: props.fallbackHtml }} />}
    </>
  );
}

function DocEditor({
  doc,
  assetBase,
  onReady,
  onMounted,
}: {
  doc: JSONContent;
  assetBase: string;
  onReady?: () => void;
  onMounted: () => void;
}) {
  const extensions = useMemo(() => viewExtensions({ assetBase }), [assetBase]);
  const editor = useEditor({
    extensions,
    content: doc,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: "art-content", "aria-label": "Page" } },
  });

  // A new version arrives as a new document; swap it in without remounting.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, doc]);

  useEffect(() => {
    if (!editor) return;
    onMounted();
    onReady?.();
  }, [editor, onMounted, onReady]);

  return editor ? <EditorContent editor={editor} /> : null;
}
