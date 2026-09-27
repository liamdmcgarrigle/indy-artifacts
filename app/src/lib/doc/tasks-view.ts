import { Extension, type NodeViewRendererProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { initialOf, tickAgo, type TickView } from "@/lib/tasks";

/**
 * Tickable task lists, for reading a page (never while editing it, where a
 * checkbox changes the source instead).
 *
 * The page's ticks live in a small store the viewer owns. Items in the
 * editor's own lists get a node view; items inside blocks shown as rendered
 * HTML (a list that mixes tasks and bullets, say) are wired up in place. Both
 * redraw from the store, so a tick made here or arriving from someone else
 * looks the same.
 */

export interface TickStore {
  get(key: string): TickView | undefined;
  all(): TickView[];
  /** Whether this reader may tick. */
  canTick(): boolean;
  toggle(key: string, checked: boolean): void;
  subscribe(fn: () => void): () => void;
  /** Changes whenever what the store holds changes, so views can tell. */
  stamp(): number;
}

export interface WritableTickStore extends TickStore {
  set(ticks: TickView[]): void;
  setCanTick(on: boolean): void;
  setHandler(fn: ((key: string, checked: boolean) => void) | null): void;
  /** Redraw without new data, for "2m ago" to become "3m ago". */
  touch(): void;
}

export function createTickStore(initial: TickView[] = [], canTick = false): WritableTickStore {
  let ticks = new Map(initial.map((t) => [t.key, t]));
  let allowed = canTick;
  let handler: ((key: string, checked: boolean) => void) | null = null;
  let stamp = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    stamp++;
    for (const fn of [...listeners]) fn();
  };
  return {
    get: (key) => ticks.get(key),
    all: () => [...ticks.values()],
    canTick: () => allowed && handler !== null,
    toggle: (key, checked) => handler?.(key, checked),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stamp: () => stamp,
    set(next) {
      ticks = new Map(next.map((t) => [t.key, t]));
      emit();
    },
    setCanTick(on) {
      if (on === allowed) return;
      allowed = on;
      emit();
    },
    setHandler(fn) {
      handler = fn;
      emit();
    },
    touch: emit,
  };
}

// ---------------------------------------------------------------- pieces

const SVG = "http://www.w3.org/2000/svg";

/** The box: a real checkbox for keys and screen readers, drawn over by a mark. */
function checkbox(): { hit: HTMLLabelElement; input: HTMLInputElement } {
  const hit = document.createElement("label");
  hit.className = "art-task__hit";
  hit.contentEditable = "false";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "art-task__input";
  const box = document.createElement("span");
  box.className = "art-task__box";
  box.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M3.5 8.5l3 3 6-7");
  svg.append(path);
  box.append(svg);
  hit.append(input, box);
  return { hit, input };
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

/** "L Liam · 2m ago", with the whole story on hover. Names are set as text, never markup. */
export function tickChip(tick: TickView): HTMLElement {
  const chip = document.createElement("span");
  chip.className = tick.byKind === "visitor" ? "art-tick-by art-tick-by--visitor" : tick.byKind === "agent" ? "art-tick-by art-tick-by--agent" : "art-tick-by";
  chip.contentEditable = "false";
  const role = tick.byKind === "visitor" ? (tick.verified ? " (visitor, email confirmed)" : " (visitor, name as given)") : tick.byKind === "agent" ? " (agent)" : "";
  chip.title = `Ticked by ${tick.byName}${role}, ${fullTime(tick.at)}`;
  const avatar = document.createElement("span");
  avatar.className = "art-tick-by__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initialOf(tick.byName);
  const name = document.createElement("span");
  name.className = "art-tick-by__name";
  name.textContent = tick.byName;
  const ago = document.createElement("span");
  ago.className = "art-tick-by__ago";
  ago.textContent = tickAgo(tick.at);
  const label = document.createElement("span");
  label.className = "art-sr-only";
  label.textContent = `, ticked by ${tick.byName}${role}, ${tickAgo(tick.at)}`;
  chip.append(avatar, name, ago, label);
  return chip;
}

function itemLabel(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

/** Apply what an item shows: done or not, whether a person did it, whether it can be changed. */
function paint(li: HTMLElement, input: HTMLInputElement, done: boolean, tick: TickView | undefined, canTick: boolean, text: string) {
  input.checked = done;
  input.disabled = !canTick;
  li.dataset.done = String(done);
  li.classList.toggle("is-ticked", !!tick?.checked);
  input.setAttribute("aria-label", itemLabel(text) || "Task");
}

// ------------------------------------------------------------ editor items

/** A task item in the editor's own list, while reading. */
export function taskItemView(store: TickStore) {
  return (props: NodeViewRendererProps): NodeView => {
    let node = props.node;
    const li = document.createElement("li");
    li.className = "art-task";
    li.dataset.type = "taskItem";
    const { hit, input } = checkbox();
    const body = document.createElement("div");
    body.className = "art-task__body";
    li.append(hit, body);

    const key = () => (node.attrs.taskKey as string | null) ?? null;
    const draw = () => {
      const k = key();
      const tick = k ? store.get(k) : undefined;
      paint(li, input, tick ? tick.checked : Boolean(node.attrs.checked), tick, store.canTick() && k !== null, ownText(node));
      if (k) li.dataset.taskKey = k;
    };
    draw();
    // Let the first paint settle before the strike-through can animate.
    requestAnimationFrame(() => li.classList.add("art-task--live"));
    const off = store.subscribe(draw);

    input.addEventListener("change", () => {
      const k = key();
      const want = input.checked;
      draw();
      if (k) store.toggle(k, want);
    });

    return {
      dom: li,
      contentDOM: body,
      stopEvent: (e) => hit.contains(e.target as globalThis.Node),
      ignoreMutation: (m) => m.type !== "selection" && !body.contains(m.target),
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        draw();
        return true;
      },
      destroy: off,
    };
  };
}

/** The item's own words, not the lists under it. */
function ownText(node: PMNode): string {
  const parts: string[] = [];
  node.forEach((child) => {
    if (child.type.name.endsWith("List")) return;
    parts.push(child.textContent);
  });
  return parts.join(" ");
}

const tasksKey = new PluginKey<DecorationSet>("tickedTasks");

/**
 * The words of each item get a span the strike-through is drawn on, and a
 * ticked item gets who ticked it after its words. Both are decorations, so
 * the document itself never changes.
 */
export function TickDecorations(store: TickStore) {
  return Extension.create({
    name: "tickDecorations",
    addProseMirrorPlugins() {
      const build = (doc: PMNode) => {
        const out: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (node.type.name !== "taskItem") return true;
          const key = node.attrs.taskKey as string | null;
          let lastEnd = -1;
          node.forEach((child, offset) => {
            if (!child.isTextblock || child.content.size === 0) return;
            const from = pos + 1 + offset + 1;
            const to = from + child.content.size;
            out.push(Decoration.inline(from, to, { class: "art-task__text" }));
            if (lastEnd < 0) lastEnd = to;
          });
          const tick = key ? store.get(key) : undefined;
          if (tick?.checked && lastEnd >= 0) {
            out.push(
              Decoration.widget(lastEnd, () => tickChip(tick), {
                side: 1,
                ignoreSelection: true,
                key: `tick:${key}:${tick.byName}:${tick.at}:${tickAgo(tick.at)}`,
              }),
            );
          }
          return true;
        });
        return DecorationSet.create(doc, out);
      };
      return [
        new Plugin({
          key: tasksKey,
          state: {
            init: (_, state) => build(state.doc),
            apply: (tr, old, _prev, state) => (tr.docChanged || tr.getMeta(tasksKey) ? build(state.doc) : old),
          },
          props: {
            decorations: (state) => tasksKey.getState(state),
          },
          view: (view) => {
            const off = store.subscribe(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(tasksKey, true).setMeta("addToHistory", false));
            });
            return { destroy: off };
          },
        }),
      ];
    },
  });
}

// --------------------------------------------------------------- raw HTML

/**
 * Task items inside a block shown as the pipeline rendered it. The block's
 * DOM is the view's own, so it can be rearranged: the disabled checkbox
 * becomes the live one, the words get the strike-through span, and the
 * chip goes after them. Returns a function that stops listening.
 */
export function wireRawTasks(root: HTMLElement, store: TickStore): () => void {
  const offs: (() => void)[] = [];
  for (const li of Array.from(root.querySelectorAll<HTMLLIElement>("li[data-task-key]"))) {
    const key = li.dataset.taskKey!;
    const original = li.querySelector<HTMLInputElement>(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    if (!original) continue;
    const fallback = original.checked;
    const holder = original.parentElement!;
    const { hit, input } = checkbox();
    li.classList.add("art-task", "art-task--raw");

    // The words: everything in the item or its paragraphs except nested lists.
    const hosts = holder === li ? [li] : Array.from(li.children).filter((c) => c.tagName === "P");
    const texts: HTMLElement[] = [];
    for (const host of hosts) {
      const span = document.createElement("span");
      span.className = "art-task__text";
      for (const child of Array.from(host.childNodes)) {
        if (child === original || (child instanceof HTMLElement && /^(UL|OL)$/.test(child.tagName))) continue;
        span.append(child);
      }
      const before = Array.from(host.childNodes).find((c) => c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName)) ?? null;
      host.insertBefore(span, before);
      texts.push(span);
    }
    original.replaceWith(hit);
    if (holder !== li) li.prepend(hit);
    const words = texts.map((t) => t.textContent ?? "").join(" ");

    let chip: HTMLElement | null = null;
    const draw = () => {
      const tick = store.get(key);
      paint(li, input, tick ? tick.checked : fallback, tick, store.canTick(), words);
      chip?.remove();
      chip = tick?.checked && texts[0] ? tickChip(tick) : null;
      if (chip) texts[texts.length - 1].after(chip);
    };
    draw();
    requestAnimationFrame(() => li.classList.add("art-task--live"));
    offs.push(store.subscribe(draw));
    input.addEventListener("change", () => {
      const want = input.checked;
      draw();
      store.toggle(key, want);
    });
  }
  return () => offs.forEach((off) => off());
}
