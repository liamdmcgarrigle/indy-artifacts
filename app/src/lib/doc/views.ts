import { Extension, type AnyExtension, type Editor, type NodeViewRendererProps } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Placeholder, UndoRedo, Dropcursor, Gapcursor } from "@tiptap/extensions";
import { docExtensions, type DocOptions } from "./schema";
import { ChoiceView, FieldView, OptionView } from "@/components/forms/NodeViews";
import { KpisEdit } from "@/components/editor/KpisEdit";
import { ChartEdit, TableEdit } from "@/components/editor/DataEdit";
import { EmbedEdit, RawEdit } from "@/components/editor/SourceEdit";

/**
 * Browser-only node views for the directive containers and raw blocks.
 *
 * The <art-*> primitives wrap whatever children they find when they connect.
 * ProseMirror has to own the children of its content element, so each view
 * creates the element, lets it render while it is still empty (building its
 * title, icon and body box), and hands ProseMirror that body box. The
 * element's own guard stops it rendering a second time when it is attached.
 *
 * When editing, the same views make their titles typeable in place: a card's
 * title is edited where it is shown, not in a box.
 */

type Rendered = HTMLElement & { connectedCallback?: () => void };

export interface ViewOptions extends DocOptions {
  editing?: boolean;
}

const BODY: Record<string, string | null> = {
  callout: ".art-callout__body",
  card: ".art-card__body",
  details: ".art-details__body",
  columns: null,
  col: null,
  tab: null,
};

const TAGS: Record<string, string> = {
  callout: "art-callout",
  card: "art-card",
  details: "art-details",
  columns: "art-columns",
  col: "art-col",
  tabs: "art-tabs",
  tab: "art-tab",
};

const KEYS: Record<string, string[]> = {
  callout: ["tone", "title"],
  card: ["title", "subtitle"],
  details: ["summary", "open"],
  columns: ["n"],
  tab: ["label"],
};

/** The words on a block that are attributes, and where the primitive shows them. */
const TEXT_ATTRS: Record<string, { key: string; selector: string; placeholder: string; make?: (el: HTMLElement) => HTMLElement }[]> = {
  callout: [
    {
      key: "title",
      selector: ".art-callout__title",
      placeholder: "Title",
      make: (el) => {
        const title = document.createElement("div");
        title.className = "art-callout__title";
        el.querySelector(".art-callout__main")?.prepend(title);
        return title;
      },
    },
  ],
  card: [
    {
      key: "title",
      selector: ".art-card__title",
      placeholder: "Card title",
      make: (el) => {
        let head = el.querySelector<HTMLElement>(".art-card__head");
        if (!head) {
          head = document.createElement("div");
          head.className = "art-card__head";
          el.prepend(head);
        }
        const title = document.createElement("div");
        title.className = "art-card__title";
        head.prepend(title);
        return title;
      },
    },
  ],
  details: [{ key: "summary", selector: ".art-details__summary", placeholder: "Summary" }],
};

function element(node: PMNode): Rendered {
  const el = document.createElement(TAGS[node.type.name]) as Rendered;
  const attrs = (node.attrs.attributes ?? {}) as Record<string, string>;
  for (const key of KEYS[node.type.name] ?? []) {
    if (attrs[key] !== undefined && attrs[key] !== "") el.setAttribute(key, String(attrs[key]));
  }
  el.connectedCallback?.();
  return el;
}

/** Write one attribute of the node at `getPos()` without rebuilding its view. */
function setAttribute(editor: Editor, getPos: NodeViewRendererProps["getPos"], key: string, value: string) {
  const pos = typeof getPos === "function" ? getPos() : undefined;
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const attributes = { ...(node.attrs.attributes ?? {}) } as Record<string, string>;
  if (value) attributes[key] = value;
  else delete attributes[key];
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, attributes }));
}

/** Make a piece of a primitive's chrome typeable, writing back to an attribute. */
function typeable(el: HTMLElement, props: NodeViewRendererProps, key: string, placeholder: string) {
  // Inside the editor, an editable element only becomes its own editing host
  // when its parent is not editable; without the shell the caret lands in the
  // document instead.
  if (el.parentElement?.contentEditable !== "false") {
    const shell = document.createElement("div");
    shell.className = "art-typeable-shell";
    shell.contentEditable = "false";
    el.replaceWith(shell);
    shell.append(el);
  }
  el.contentEditable = "true";
  el.spellcheck = true;
  el.dataset.placeholder = placeholder;
  el.classList.add("art-typeable");
  el.addEventListener("keydown", (e) => {
    // One line: Enter moves on into the block's content.
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
      const pos = typeof props.getPos === "function" ? props.getPos() : undefined;
      if (typeof pos === "number") props.editor.chain().focus().setTextSelection(pos + 2).run();
    }
  });
  el.addEventListener("input", () => setAttribute(props.editor, props.getPos, key, (el.textContent ?? "").replace(/\s+/g, " ").trim()));
  // The summary toggles its <details>; while editing, a click is for the caret.
  el.addEventListener("click", (e) => e.preventDefault());
}

/** A change to anything but the content (the primitive's own chrome, its attributes) is not an edit. */
function outsideContent(contentDOM: HTMLElement) {
  return (m: ViewMutationRecord) =>
    m.type === "selection"
      ? // A caret in a typed title is the title's, not a place in the document.
        !contentDOM.contains(m.target) && !!(m.target as HTMLElement).closest?.(".art-typeable") || !!m.target.parentElement?.closest(".art-typeable")
      : !contentDOM.contains(m.target) || (m.target === contentDOM && m.type === "attributes");
}

function sameExcept(a: Record<string, unknown>, b: Record<string, unknown>, typed: string[]): boolean {
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !typed.includes(k)));
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function containerView(editing: boolean) {
  return (props: NodeViewRendererProps): NodeView => {
    const name = props.node.type.name;
    const dom = element(props.node);
    const selector = BODY[name];
    const contentDOM = (selector ? dom.querySelector<HTMLElement>(selector) : dom) ?? dom;
    const texts = editing ? (TEXT_ATTRS[name] ?? []) : [];
    const typed: HTMLElement[] = [];
    for (const t of texts) {
      const el = dom.querySelector<HTMLElement>(t.selector) ?? t.make?.(dom) ?? null;
      if (!el) continue;
      typeable(el, props, t.key, t.placeholder);
      typed.push(el);
    }
    if (editing && name === "details") dom.querySelector("details")?.setAttribute("open", "");
    let current = props.node;
    return {
      dom,
      contentDOM,
      ignoreMutation: outsideContent(contentDOM),
      // Keys and clicks in a typed title are the title's, not the document's.
      stopEvent: (e) => typed.some((el) => el.contains(e.target as globalThis.Node)),
      update: (node) => {
        if (node.type !== current.type) return false;
        // A title typed in place changes the attribute the view already shows;
        // anything else (a new tone) needs the view built again.
        const ok = sameExcept(node.attrs.attributes ?? {}, current.attrs.attributes ?? {}, texts.map((t) => t.key));
        if (ok) current = node;
        return ok;
      },
    };
  };
}

/**
 * Tabs get their bar from here rather than the primitive, which builds it
 * from the panels present when it connects: here there are none yet. When
 * editing, every panel shows, each under its own typeable label.
 */
function tabsView(editing: boolean) {
  return (props: NodeViewRendererProps): NodeView => {
    const dom = document.createElement("art-tabs") as Rendered;
    dom.classList.add("art-tabs");
    if (editing) dom.classList.add("art-tabs--editing");
    const bar = document.createElement("div");
    bar.className = "art-tabs__bar";
    bar.setAttribute("role", "tablist");
    bar.contentEditable = "false";
    const contentDOM = document.createElement("div");
    contentDOM.className = "art-tabs__panels";
    dom.append(bar, contentDOM);

    let active = 0;
    const sync = (node: PMNode) => {
      const labels: string[] = [];
      node.forEach((tab, _o, i) => labels.push(String((tab.attrs.attributes as Record<string, string>)?.label || `Tab ${i + 1}`)));
      if (active >= labels.length) active = 0;
      bar.replaceChildren(
        ...labels.map((label, i) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = i === active ? "art-tabs__tab is-active" : "art-tabs__tab";
          button.setAttribute("role", "tab");
          button.setAttribute("aria-selected", String(i === active));
          button.textContent = label;
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", () => {
            active = i;
            sync(node);
          });
          return button;
        }),
      );
      Array.from(contentDOM.children).forEach((panel, i) => ((panel as HTMLElement).hidden = !editing && i !== active));
    };
    // Panels arrive after this returns; show the right one once they are in.
    queueMicrotask(() => sync(props.node));

    return {
      dom,
      contentDOM,
      ignoreMutation: (m) => m.type !== "selection" && (bar.contains(m.target) || (m.type === "attributes" && m.attributeName === "hidden")),
      stopEvent: (e) => bar.contains(e.target as globalThis.Node),
      update: (node) => {
        if (node.type !== props.node.type) return false;
        queueMicrotask(() => sync(node));
        return true;
      },
    };
  };
}

/** While editing, a tab panel carries its label above it, typeable. */
function tabView(props: NodeViewRendererProps): NodeView {
  const dom = element(props.node);
  const label = document.createElement("div");
  label.className = "art-tab__label";
  label.textContent = String((props.node.attrs.attributes as Record<string, string>)?.label ?? "");
  const body = document.createElement("div");
  body.className = "art-tab__body";
  dom.append(label, body);
  typeable(label, props, "label", "Tab name");
  let current = props.node;
  return {
    dom,
    contentDOM: body,
    ignoreMutation: outsideContent(body),
    stopEvent: (e) => label.contains(e.target as globalThis.Node),
    update: (node) => {
      if (node.type !== current.type) return false;
      current = node;
      return true;
    },
  };
}

function rawView(props: NodeViewRendererProps): NodeView {
  const dom = document.createElement("div");
  dom.className = "art-raw";
  dom.innerHTML = String(props.node.attrs.html ?? "");
  // The pipeline's HTML is one top-level element; show it as that element.
  const only = dom.childElementCount === 1 ? (dom.firstElementChild as HTMLElement) : null;
  const view = only ?? dom;
  if (only) only.remove();
  return {
    dom: view,
    ignoreMutation: () => true,
    stopEvent: () => false,
    update: (node) => node.type === props.node.type && node.attrs.html === props.node.attrs.html,
  };
}

/** Editing views are React; their own inputs keep their events. */
const own = { stopEvent: ({ event }: { event: Event }) => !(event instanceof DragEvent) };

/**
 * Keys for a menu that floats over the editor (the slash menu): whoever owns
 * the menu sets the handler, and a key it takes never reaches the page.
 */
export const MenuKeys = Extension.create<object, { handler: ((event: KeyboardEvent) => boolean) | null }>({
  name: "menuKeys",
  addStorage: () => ({ handler: null }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({ props: { handleKeyDown: (_view, event) => storage.handler?.(event) ?? false } })];
  },
});

/** The shared extensions with browser node views attached. */
export function viewExtensions(options: ViewOptions = {}): AnyExtension[] {
  const editing = options.editing === true;
  const exts = docExtensions(options).map((ext) => {
    switch (ext.name) {
      case "tabs":
        return ext.extend({ addNodeView: () => tabsView(editing) });
      case "tab":
        return ext.extend({ addNodeView: () => (editing ? tabView : containerView(false)) });
      case "rawBlock":
        return ext.extend({ addNodeView: () => (editing ? ReactNodeViewRenderer(RawEdit, own) : rawView) });
      // Questions are React, on shadcn controls. Their events are theirs: the
      // page must not turn a tap on a radio button into a selection.
      case "field":
        return ext.extend({ addNodeView: () => ReactNodeViewRenderer(FieldView, own) });
      case "choice":
        return ext.extend({ addNodeView: () => ReactNodeViewRenderer(ChoiceView, editing ? {} : own) });
      case "option":
        return ext.extend({ addNodeView: () => ReactNodeViewRenderer(OptionView, editing ? {} : own) });
      case "kpis":
        return editing ? ext.extend({ addNodeView: () => ReactNodeViewRenderer(KpisEdit, own) }) : ext;
      case "chart":
        return editing ? ext.extend({ addNodeView: () => ReactNodeViewRenderer(ChartEdit, own) }) : ext;
      case "dataTable":
        return editing ? ext.extend({ addNodeView: () => ReactNodeViewRenderer(TableEdit, own) }) : ext;
      case "embed":
        return editing ? ext.extend({ addNodeView: () => ReactNodeViewRenderer(EmbedEdit, own) }) : ext;
      default:
        if (ext.name in BODY) return ext.extend({ addNodeView: () => containerView(editing) });
        return ext;
    }
  });
  if (!editing) return exts;
  return [
    ...exts,
    UndoRedo,
    MenuKeys,
    Dropcursor.configure({ color: "var(--sand)", width: 2 }),
    Gapcursor,
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Type, or press / for blocks"),
      includeChildren: true,
    }),
  ];
}
