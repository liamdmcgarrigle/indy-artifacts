import type { AnyExtension, NodeViewRendererProps } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { docExtensions, type DocOptions } from "./schema";

/**
 * Browser-only node views for the directive containers and raw blocks.
 *
 * The <art-*> primitives wrap whatever children they find when they connect.
 * ProseMirror has to own the children of its content element, so each view
 * creates the element, lets it render while it is still empty (building its
 * title, icon and body box), and hands ProseMirror that body box. The
 * element's own guard stops it rendering a second time when it is attached.
 */

type Rendered = HTMLElement & { connectedCallback?: () => void };

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

function element(node: PMNode): Rendered {
  const el = document.createElement(TAGS[node.type.name]) as Rendered;
  const attrs = (node.attrs.attributes ?? {}) as Record<string, string>;
  for (const key of KEYS[node.type.name] ?? []) {
    if (attrs[key] !== undefined && attrs[key] !== "") el.setAttribute(key, String(attrs[key]));
  }
  el.connectedCallback?.();
  return el;
}

/** A change to anything but the content (the primitive's own chrome, its attributes) is not an edit. */
function outsideContent(contentDOM: HTMLElement) {
  return (m: ViewMutationRecord) => m.type === "selection" ? false : !contentDOM.contains(m.target) || m.target === contentDOM && m.type === "attributes";
}

function containerView(props: NodeViewRendererProps): NodeView {
  const name = props.node.type.name;
  const dom = element(props.node);
  const selector = BODY[name];
  const contentDOM = (selector ? dom.querySelector<HTMLElement>(selector) : dom) ?? dom;
  return {
    dom,
    contentDOM,
    ignoreMutation: outsideContent(contentDOM),
    update: (node) => node.type === props.node.type && JSON.stringify(node.attrs.attributes) === JSON.stringify(props.node.attrs.attributes),
  };
}

/**
 * Tabs get their bar from here rather than the primitive, which builds it
 * from the panels present when it connects: here there are none yet.
 */
function tabsView(props: NodeViewRendererProps): NodeView {
  const dom = document.createElement("art-tabs") as Rendered;
  dom.classList.add("art-tabs");
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
    Array.from(contentDOM.children).forEach((panel, i) => ((panel as HTMLElement).hidden = i !== active));
  };
  // Panels arrive after this returns; show the right one once they are in.
  queueMicrotask(() => sync(props.node));

  return {
    dom,
    contentDOM,
    ignoreMutation: (m) => m.type !== "selection" && (bar.contains(m.target) || (m.type === "attributes" && m.attributeName === "hidden")),
    update: (node) => {
      if (node.type !== props.node.type) return false;
      queueMicrotask(() => sync(node));
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

/** The shared extensions with browser node views attached. */
export function viewExtensions(options: DocOptions = {}): AnyExtension[] {
  return docExtensions(options).map((ext) => {
    if (ext.name === "tabs") return ext.extend({ addNodeView: () => tabsView });
    if (ext.name in BODY) return ext.extend({ addNodeView: () => containerView });
    if (ext.name === "rawBlock") return ext.extend({ addNodeView: () => rawView });
    return ext;
  });
}
