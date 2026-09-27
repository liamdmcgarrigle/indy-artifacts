"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { ArrowDown, ArrowUp, Bold, Code, Copy, GripVertical, Italic, Link2, Plus, Strikethrough, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterBlocks, type BlockChoice } from "./blocks";

/**
 * Everything around the page while it is being edited: a small bar over
 * selected words, a menu behind "/", a handle beside each block, and a bar for
 * the block the cursor is in. None of it is a box the page opens into; the
 * page stays the page.
 */
export function EditChrome({ editor }: { editor: Editor }) {
  return (
    <>
      <TextBubble editor={editor} />
      <SlashMenu editor={editor} />
      <Handle editor={editor} />
      <BlockBar editor={editor} />
    </>
  );
}

/** Re-render on every change to the editor's state. */
function useEditorTick(editor: Editor): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    editor.on("transaction", bump);
    editor.on("focus", bump);
    editor.on("blur", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("focus", bump);
      editor.off("blur", bump);
    };
  }, [editor]);
  return tick;
}

// ----------------------------------------------------------- selected words

/**
 * The menu plugins re-register whenever their props change, and registering
 * is a transaction, so everything handed to them is fixed.
 */
const BUBBLE_OPTIONS = { placement: "top", offset: 8 } as const;
const showBubble: NonNullable<React.ComponentProps<typeof BubbleMenu>["shouldShow"]> = ({ editor, state }) => {
  const sel = state.selection;
  if (!editor.isEditable || sel.empty || !(sel instanceof TextSelection)) return false;
  return !editor.isActive("codeBlock");
};

function TextBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu editor={editor} className="text-bubble" options={BUBBLE_OPTIONS} shouldShow={showBubble}>
      <TextTools editor={editor} />
    </BubbleMenu>
  );
}

function TextTools({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const [linking, setLinking] = useState<string | null>(null);
  const mark = (name: string, run: () => boolean, Icon: typeof Bold, label: string) => (
    <button
      type="button"
      className={cn("bubble-tool", editor.isActive(name) && "is-on")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </button>
  );
  const applyLink = () => {
    const href = (linking ?? "").trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setLinking(null);
  };
  return (
    <>
      {linking !== null ? (
        <form
          className="text-bubble__link"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={linking}
            placeholder="Paste a link"
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setLinking(null);
                editor.commands.focus();
              }
            }}
          />
          <button type="submit" className="bubble-tool bubble-tool--word">
            {linking.trim() ? "Link" : "Remove"}
          </button>
        </form>
      ) : (
        <>
          {mark("bold", () => editor.chain().focus().toggleBold().run(), Bold, "Bold")}
          {mark("italic", () => editor.chain().focus().toggleItalic().run(), Italic, "Italic")}
          {mark("strike", () => editor.chain().focus().toggleStrike().run(), Strikethrough, "Strikethrough")}
          {mark("code", () => editor.chain().focus().toggleCode().run(), Code, "Code")}
          {mark("link", () => (setLinking(String(editor.getAttributes("link").href ?? "")), true), Link2, "Link")}
        </>
      )}
    </>
  );
}

// -------------------------------------------------------------- slash menu

interface Slash {
  query: string;
  from: number;
  to: number;
}

/** "/word" typed at the start of an otherwise empty line. */
function slashAt(editor: Editor): Slash | null {
  const { selection } = editor.state;
  if (!selection.empty || !editor.isFocused) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, "￼");
  const m = /^\/([a-z0-9 ]{0,24})$/i.exec(text);
  if (!m || $from.parentOffset !== text.length) return null;
  return { query: m[1], from: $from.start(), to: $from.pos };
}

function SlashMenu({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const slash = slashAt(editor);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const items = slash ? filterBlocks(slash.query) : [];
  const open = slash !== null && dismissed !== slash.from && items.length > 0;

  // A fresh query starts at the top.
  const query = slash?.query ?? null;
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    if (!slash) setDismissed(null);
  }, [slash]);

  const choose = useCallback(
    (item: BlockChoice) => {
      const now = slashAt(editor);
      if (now) item.run(editor, { from: now.from, to: now.to });
    },
    [editor],
  );

  // The editor's keys go to the menu while it is open.
  const state = useRef({ open, items, index });
  state.current = { open, items, index };
  useEffect(() => {
    const storage = (editor.storage as unknown as Record<string, { handler: ((e: KeyboardEvent) => boolean) | null }>).menuKeys;
    if (!storage) return;
    storage.handler = (event) => {
      const s = state.current;
      if (!s.open) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setIndex((i) => (i + step + s.items.length) % s.items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = s.items[s.index];
        if (item) choose(item);
        return true;
      }
      if (event.key === "Escape") {
        const now = slashAt(editor);
        if (now) setDismissed(now.from);
        return true;
      }
      return false;
    };
    return () => {
      storage.handler = null;
    };
  }, [editor, choose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open || !slash) return null;
  const at = editor.view.coordsAtPos(slash.from);
  const below = at.bottom + 320 < window.innerHeight;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(at.left, window.innerWidth - 288)),
    ...(below ? { top: at.bottom + 6 } : { bottom: window.innerHeight - at.top + 6 }),
  };
  let group = "";
  return (
    <div className="slash-menu" style={style} ref={listRef} role="listbox" aria-label="Insert a block">
      {items.map((item, i) => {
        const head = item.group !== group ? item.group : null;
        group = item.group;
        return (
          <div key={item.id}>
            {head ? <div className="slash-menu__group">{head}</div> : null}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              className={cn("slash-menu__item", i === index && "is-on")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              <span className="slash-menu__label">{item.label}</span>
              <span className="slash-menu__hint">{item.hint}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------- the handle

/** Start a new line under a block with "/" typed, so the menu opens there. */
function insertBelow(editor: Editor, pos: number, node: PMNode) {
  const at = pos + node.nodeSize;
  editor
    .chain()
    .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
    .setTextSelection(at + 2)
    .focus()
    .run();
}

function Handle({ editor }: { editor: Editor }) {
  const current = useRef<{ node: PMNode; pos: number } | null>(null);
  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    current.current = node ? { node, pos } : null;
  }, []);
  return (
    <DragHandle editor={editor} className="block-handle" onNodeChange={onNodeChange}>
      <button
        type="button"
        className="block-handle__btn"
        aria-label="Add a block below"
        title="Add a block below"
        onClick={() => current.current && insertBelow(editor, current.current.pos, current.current.node)}
      >
        <Plus className="size-4" />
      </button>
      <span
        className="block-handle__btn block-handle__grip"
        title="Drag to move, click to select"
        onClick={() => current.current && editor.chain().setNodeSelection(current.current.pos).focus().run()}
      >
        <GripVertical className="size-4" />
      </span>
    </DragHandle>
  );
}

// --------------------------------------------------------------- block bar

const KIND: Record<string, string> = {
  paragraph: "Text",
  heading: "Heading",
  bulletList: "List",
  orderedList: "List",
  taskList: "Checklist",
  blockquote: "Quote",
  codeBlock: "Code",
  callout: "Callout",
  card: "Card",
  details: "Toggle",
  columns: "Columns",
  tabs: "Tabs",
  kpis: "Numbers",
  chart: "Chart",
  dataTable: "Data table",
  table: "Table",
  embed: "Embed",
  rawBlock: "Block",
  field: "Question",
  choice: "Choice",
  image: "Image",
  horizontalRule: "Divider",
};

const TONES = ["info", "good", "warn", "bad"] as const;

/** The top-level block the selection is in, and where it starts. */
function currentBlock(editor: Editor): { node: PMNode; pos: number; index: number } | null {
  const { selection, doc } = editor.state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    return { node: selection.node, pos: selection.from, index: selection.$from.index(0) };
  }
  const { $from } = selection;
  if ($from.depth < 1) return null;
  const pos = $from.before(1);
  const node = doc.nodeAt(pos);
  return node ? { node, pos, index: $from.index(0) } : null;
}

function moveBlock(editor: Editor, pos: number, node: PMNode, index: number, step: -1 | 1) {
  const { doc } = editor.state;
  const neighbour = doc.maybeChild(index + step);
  if (!neighbour) return;
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
  const to = step < 0 ? pos - neighbour.nodeSize : pos + neighbour.nodeSize;
  tr.insert(to, node);
  tr.setSelection(NodeSelection.create(tr.doc, to));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

function BlockBar({ editor }: { editor: Editor }) {
  const tick = useEditorTick(editor);
  const [coarse, setCoarse] = useState(false);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const spotRef = useRef(spot);
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => setCoarse(!window.matchMedia("(hover: hover)").matches), []);

  const block = editor.isFocused || editor.state.selection instanceof NodeSelection ? currentBlock(editor) : null;
  const wordsSelected = !editor.state.selection.empty && editor.state.selection instanceof TextSelection;

  // On a phone the bar sits above the keyboard, which visualViewport measures.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, []);

  // On a desktop it sits on the block's top edge, at its right.
  const pos = block?.pos ?? null;
  useLayoutEffect(() => {
    // Only a spot that moved is news.
    const put = (next: { top: number; left: number } | null) => {
      const was = spotRef.current;
      if (was === next || (was && next && was.top === next.top && was.left === next.left)) return;
      spotRef.current = next;
      setSpot(next);
    };
    if (coarse || pos === null) return put(null);
    const place = () => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      if (!dom || !(dom instanceof HTMLElement)) return put(null);
      const r = dom.getBoundingClientRect();
      // In the margin beside the block when there is room, else just above it.
      const room = window.innerWidth - r.right > 340;
      put(room ? { top: Math.max(64, Math.round(r.top)), left: Math.round(r.right + 16) } : { top: Math.max(64, Math.round(r.top - 44)), left: Math.round(r.right - 320) });
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [editor, coarse, pos, tick]);

  if (!block || (wordsSelected && !coarse) || slashAt(editor)) return null;
  // Words being typed need no toolbar on a desktop; blocks with settings do,
  // and so does a block picked up by its handle.
  const plain = ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote"].includes(block.node.type.name);
  if (!coarse && plain && !(editor.state.selection instanceof NodeSelection)) return null;
  if (!coarse && !spot) return null;
  const { node, index } = block;
  const count = editor.state.doc.childCount;
  const type = node.type.name;
  const attrs = (node.attrs.attributes ?? {}) as Record<string, unknown>;

  // Keeps the text selection while a button is pressed. A <select> is left
  // alone: preventing its mousedown stops it from opening at all.
  const keep = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("select")) return;
    e.preventDefault();
  };
  const setAttrs = (patch: Record<string, unknown>) => {
    const tr = editor.state.tr.setNodeMarkup(block.pos, undefined, { ...node.attrs, attributes: { ...attrs, ...patch } });
    editor.view.dispatch(tr);
  };

  return (
    <div
      className={cn("block-bar", coarse ? "block-bar--dock" : "block-bar--float")}
      style={coarse ? { bottom: keyboard } : { top: spot!.top, left: spot!.left }}
      onMouseDown={keep}
      role="toolbar"
      aria-label={`${KIND[type] ?? "Block"} tools`}
    >
      <span className="block-bar__kind">{KIND[type] ?? "Block"}</span>
      {type === "paragraph" || type === "heading" ? (
        <select
          className="block-bar__select"
          aria-label="Text style"
          value={type === "heading" ? `h${node.attrs.level}` : "p"}
          onChange={(e) => {
            const v = e.target.value;
            const chain = editor.chain().focus();
            if (v === "p") chain.setParagraph().run();
            else chain.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
          }}
        >
          <option value="p">Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
      ) : null}
      {type === "callout" ? (
        <span className="block-bar__tones" role="group" aria-label="Colour">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              className={cn("block-bar__tone", `block-bar__tone--${t}`, (attrs.tone ?? "info") === t && "is-on")}
              aria-label={t}
              title={t}
              onClick={() => setAttrs({ tone: t })}
            />
          ))}
        </span>
      ) : null}
      {type === "columns" ? (
        <button
          type="button"
          className="block-bar__btn block-bar__btn--word"
          onClick={() =>
            editor
              .chain()
              .insertContentAt(block.pos + node.nodeSize - 1, { type: "col", attrs: { attributes: {} }, content: [{ type: "paragraph" }] })
              .run()
          }
        >
          <Plus className="size-3.5" /> Column
        </button>
      ) : null}
      {type === "tabs" ? (
        <button
          type="button"
          className="block-bar__btn block-bar__btn--word"
          onClick={() =>
            editor
              .chain()
              .insertContentAt(block.pos + node.nodeSize - 1, {
                type: "tab",
                attrs: { attributes: { label: `Tab ${node.childCount + 1}` } },
                content: [{ type: "paragraph" }],
              })
              .run()
          }
        >
          <Plus className="size-3.5" /> Tab
        </button>
      ) : null}
      <span className="block-bar__sep" />
      <button type="button" className="block-bar__btn" aria-label="Move up" disabled={index === 0} onClick={() => moveBlock(editor, block.pos, node, index, -1)}>
        <ArrowUp className="size-4" />
      </button>
      <button type="button" className="block-bar__btn" aria-label="Move down" disabled={index >= count - 1} onClick={() => moveBlock(editor, block.pos, node, index, 1)}>
        <ArrowDown className="size-4" />
      </button>
      {coarse ? (
        <button type="button" className="block-bar__btn" aria-label="Add a block below" onClick={() => insertBelow(editor, block.pos, node)}>
          <Plus className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        className="block-bar__btn"
        aria-label="Duplicate"
        title="Duplicate"
        onClick={() => editor.chain().insertContentAt(block.pos + node.nodeSize, node.toJSON()).run()}
      >
        <Copy className="size-4" />
      </button>
      <button
        type="button"
        className="block-bar__btn block-bar__btn--bad"
        aria-label="Delete"
        title="Delete"
        onClick={() => editor.chain().focus().deleteRange({ from: block.pos, to: block.pos + node.nodeSize }).run()}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
