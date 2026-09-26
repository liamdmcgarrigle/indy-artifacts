"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { viewExtensions } from "@/lib/doc/views";
import { EditChrome } from "@/components/editor/EditChrome";

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
  /** The same page, typed into where it stands. */
  editing?: boolean;
  onReady?: () => void;
  /** The live editor, for whoever saves it; null when it goes away. */
  onEditor?: (editor: Editor | null) => void;
  /** Called on the first change after the editor opens. */
  onDirty?: () => void;
}) {
  const primitives = usePrimitives();
  const [mounted, setMounted] = useState(false);
  const markMounted = useCallback(() => setMounted(true), []);
  return (
    <>
      {/* Editing is a different set of node views, so it is a fresh editor. */}
      {primitives ? <DocEditor key={props.editing ? "edit" : "view"} {...props} onMounted={markMounted} /> : null}
      {mounted ? null : <div className="art-content" dangerouslySetInnerHTML={{ __html: props.fallbackHtml }} />}
    </>
  );
}

function DocEditor({
  doc,
  assetBase,
  editing = false,
  onReady,
  onMounted,
  onEditor,
  onDirty,
}: {
  doc: JSONContent;
  assetBase: string;
  editing?: boolean;
  onReady?: () => void;
  onMounted: () => void;
  onEditor?: (editor: Editor | null) => void;
  onDirty?: () => void;
}) {
  const extensions = useMemo(() => viewExtensions({ assetBase, editing }), [assetBase, editing]);
  const editor = useEditor({
    extensions,
    content: doc,
    editable: editing,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: editing ? "art-content art-content--editing" : "art-content", "aria-label": editing ? "Page, editing" : "Page" },
    },
  });

  // A new version arrives as a new document; swap it in without remounting.
  // Never while editing: that would throw away what is being typed.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editing) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, doc, editing]);

  useEffect(() => {
    if (!editor) return;
    onEditor?.(editor);
    const dirty = () => onDirty?.();
    editor.on("update", dirty);
    return () => {
      editor.off("update", dirty);
      onEditor?.(null);
    };
  }, [editor, onEditor, onDirty]);

  useEffect(() => {
    if (!editor) return;
    onMounted();
    onReady?.();
  }, [editor, onMounted, onReady]);

  if (!editor) return null;
  return (
    <>
      <EditorContent editor={editor} />
      {editing ? <EditChrome editor={editor} /> : null}
    </>
  );
}
