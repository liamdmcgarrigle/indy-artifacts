"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import dynamic from "next/dynamic";
import { viewExtensions } from "@/lib/doc/views";
import { primitivesUrl } from "@/lib/primitives";
import type * as EditViews from "@/components/editor/edit-views";
import type { TickStore } from "@/lib/doc/tasks-view";
import { keepPlace, type Place } from "@/lib/doc/keep-place";

// Editing code loads when editing starts; reading a page never fetches it.
const EditChrome = dynamic(() => import("@/components/editor/EditChrome").then((m) => m.EditChrome), { ssr: false });

/** The editing node views, fetched the first time editing starts and kept after. */
function useEditViews(editing: boolean): typeof EditViews | null {
  const [views, setViews] = useState<typeof EditViews | null>(null);
  useEffect(() => {
    if (!editing || views) return;
    let live = true;
    void import("@/components/editor/edit-views").then((m) => live && setViews(m));
    return () => {
      live = false;
    };
  }, [editing, views]);
  return views;
}

/** Wait for the <art-*> primitives, which the node views build on. */
function usePrimitives(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!document.getElementById("art-primitives")) {
      const script = document.createElement("script");
      script.id = "art-primitives";
      script.type = "module";
      script.src = primitivesUrl("primitives.js");
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
  /** People's ticks on task items; the store stays the same for the life of the page. */
  ticks?: TickStore;
  /** Where the reader was when editing started or stopped, to be put back once the page settles. */
  place?: { current: Place | null };
}) {
  const primitives = usePrimitives();
  const editViews = useEditViews(props.editing === true);
  const editing = props.editing === true && editViews !== null;
  const mode = editing ? "edit" : "view";
  // The editor on show. A switch builds the other one unseen and swaps it in
  // once it is up, so the page never empties under the reader.
  const [shown, setShown] = useState<Mode>(mode);
  const [mounted, setMounted] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const editors = useRef<Partial<Record<Mode, Editor>>>({});
  const built = useMemo(() => {
    const make = (m: Mode) => (editor: Editor | null) => {
      if (!editor) return void delete editors.current[m];
      editors.current[m] = editor;
      if (m !== modeRef.current) return;
      setMounted(true);
      setShown(m);
    };
    return { view: make("view"), edit: make("edit") };
  }, []);

  // The bars above the page change with editing, then the page itself swaps:
  // hold the reader's place through both.
  const hold = useRef<ReturnType<typeof keepPlace> | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const place = props.place;
  useLayoutEffect(() => {
    // A switch with no place to keep still ends the last one's hold.
    hold.current?.stop();
    hold.current = null;
    if (!place?.current) return;
    hold.current = keepPlace(place.current, () => editors.current[shownRef.current]?.view ?? null);
    place.current = null;
  }, [props.editing, place]);
  // The new editor is on show: the page settles from here.
  useLayoutEffect(() => hold.current?.settle(), [shown]);
  useEffect(() => () => hold.current?.stop(), []);

  const modes: Mode[] = shown === mode ? [shown] : [shown, mode];
  return (
    <div className="docview">
      {/* Editing is a different set of node views, so it is a fresh editor. */}
      {/* Until the editing code arrives, the page stays up as it was. */}
      {/* An editor builds out of the flow, unseen, and takes the place of what
          stood there in one step. Built in the flow above it, it pushed the
          stand-in down, the browser's scroll anchoring followed it, and a
          reload landed at the foot of the page. */}
      {primitives
        ? modes.map((m) => {
            const visible = m === shown && mounted;
            return (
              <div key={m} className={visible ? undefined : "docview__pending"} aria-hidden={visible ? undefined : true}>
                <DocEditor
                  doc={props.doc}
                  assetBase={props.assetBase}
                  ticks={props.ticks}
                  editing={m === "edit"}
                  editViews={m === "edit" ? editViews : null}
                  onBuilt={built[m]}
                  // Only the editor on show is the page's, and one on its way out takes no more typing.
                  retiring={m !== mode}
                  onEditor={visible ? props.onEditor : undefined}
                  onDirty={visible && m === mode ? props.onDirty : undefined}
                  onReady={visible ? props.onReady : undefined}
                />
              </div>
            );
          })
        : null}
      {mounted ? null : <div className="art-content" dangerouslySetInnerHTML={{ __html: props.fallbackHtml }} />}
    </div>
  );
}

type Mode = "view" | "edit";

function DocEditor({
  doc,
  assetBase,
  editing = false,
  retiring = false,
  onReady,
  onBuilt,
  onEditor,
  onDirty,
  editViews,
  ticks,
}: {
  doc: JSONContent;
  assetBase: string;
  editing?: boolean;
  retiring?: boolean;
  editViews: typeof EditViews | null;
  onReady?: () => void;
  onBuilt: (editor: Editor | null) => void;
  onEditor?: (editor: Editor | null) => void;
  onDirty?: () => void;
  ticks?: TickStore;
}) {
  const extensions = useMemo(
    () => viewExtensions({ assetBase, editing, editViews: editViews ?? undefined, ticks }),
    [assetBase, editing, editViews, ticks],
  );
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
    onBuilt(editor);
    return () => onBuilt(null);
  }, [editor, onBuilt]);

  useEffect(() => {
    if (editor) onReady?.();
  }, [editor, onReady]);

  // Saved or cancelled: what is typed now, before the page swaps back, would be lost.
  useLayoutEffect(() => {
    if (editor && !editor.isDestroyed && editing && retiring) editor.setEditable(false);
  }, [editor, editing, retiring]);

  if (!editor) return null;
  return (
    <>
      <EditorContent editor={editor} />
      {editing && !retiring ? <EditChrome editor={editor} /> : null}
    </>
  );
}
