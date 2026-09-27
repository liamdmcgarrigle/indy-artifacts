import type { Editor, JSONContent } from "@tiptap/core";

/**
 * What the slash menu can make. Each entry either turns the current empty
 * line into something (a heading, a list) or puts a new block in its place.
 */
export interface BlockChoice {
  id: string;
  label: string;
  hint: string;
  /** Extra words the filter matches on. */
  words: string;
  group: "Text" | "Layout" | "Data" | "Form";
  run: (editor: Editor, range: { from: number; to: number }) => void;
}

const p = (): JSONContent => ({ type: "paragraph" });

/** A field name no other question on the page uses. */
function freshName(editor: Editor, base: string): string {
  const taken = new Set<string>();
  editor.state.doc.descendants((node) => {
    const name = (node.attrs.attributes as Record<string, unknown> | undefined)?.name;
    if (typeof name === "string") taken.add(name);
  });
  let n = 1;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Swap the line the slash was typed on for a block. */
function place(editor: Editor, range: { from: number; to: number }, block: JSONContent) {
  const $from = editor.state.doc.resolve(range.from);
  const start = $from.before();
  const end = $from.after();
  editor.chain().focus().insertContentAt({ from: start, to: end }, block).run();
}

/** Clear the typed "/word", then change the line itself. */
function turn(editor: Editor, range: { from: number; to: number }) {
  return editor.chain().focus().deleteRange(range);
}

export const BLOCKS: BlockChoice[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", words: "paragraph", group: "Text", run: (e, r) => turn(e, r).setParagraph().run() },
  { id: "h1", label: "Heading 1", hint: "Page section", words: "title h1", group: "Text", run: (e, r) => turn(e, r).setHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", hint: "Section", words: "subtitle h2", group: "Text", run: (e, r) => turn(e, r).setHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", hint: "Small section", words: "h3", group: "Text", run: (e, r) => turn(e, r).setHeading({ level: 3 }).run() },
  { id: "bullets", label: "Bulleted list", hint: "Points", words: "ul unordered", group: "Text", run: (e, r) => turn(e, r).toggleBulletList().run() },
  { id: "numbers", label: "Numbered list", hint: "Steps", words: "ol ordered", group: "Text", run: (e, r) => turn(e, r).toggleOrderedList().run() },
  { id: "tasks", label: "Checklist", hint: "Things to tick off", words: "todo task", group: "Text", run: (e, r) => turn(e, r).toggleTaskList().run() },
  { id: "quote", label: "Quote", hint: "Words from elsewhere", words: "blockquote", group: "Text", run: (e, r) => turn(e, r).toggleBlockquote().run() },
  { id: "code", label: "Code", hint: "Monospace block", words: "snippet pre", group: "Text", run: (e, r) => turn(e, r).setCodeBlock().run() },
  {
    id: "callout",
    label: "Callout",
    hint: "A note that stands out",
    words: "info warning note tip",
    group: "Layout",
    run: (e, r) => place(e, r, { type: "callout", attrs: { attributes: { tone: "info" } }, content: [p()] }),
  },
  { id: "card", label: "Card", hint: "A boxed section with a title", words: "box panel", group: "Layout", run: (e, r) => place(e, r, { type: "card", attrs: { attributes: {} }, content: [p()] }) },
  {
    id: "details",
    label: "Toggle",
    hint: "Hidden until opened",
    words: "details collapse accordion",
    group: "Layout",
    run: (e, r) => place(e, r, { type: "details", attrs: { attributes: {} }, content: [p()] }),
  },
  {
    id: "columns",
    label: "Columns",
    hint: "Side by side",
    words: "grid split two",
    group: "Layout",
    run: (e, r) =>
      place(e, r, {
        type: "columns",
        attrs: { attributes: {} },
        content: [
          { type: "col", attrs: { attributes: {} }, content: [p()] },
          { type: "col", attrs: { attributes: {} }, content: [p()] },
        ],
      }),
  },
  {
    id: "tabs",
    label: "Tabs",
    hint: "Panels you switch between",
    words: "switch",
    group: "Layout",
    run: (e, r) =>
      place(e, r, {
        type: "tabs",
        attrs: { attributes: {} },
        content: [
          { type: "tab", attrs: { attributes: { label: "First" } }, content: [p()] },
          { type: "tab", attrs: { attributes: { label: "Second" } }, content: [p()] },
        ],
      }),
  },
  {
    id: "timeline",
    label: "Timeline",
    hint: "Dated events in order",
    words: "history dates events chronology",
    group: "Layout",
    run: (e, r) =>
      place(e, r, {
        type: "timeline",
        attrs: { attributes: {} },
        content: [
          { type: "event", attrs: { attributes: {} }, content: [p()] },
          { type: "event", attrs: { attributes: {} }, content: [p()] },
        ],
      }),
  },
  { id: "divider", label: "Divider", hint: "A line across", words: "hr rule separator", group: "Layout", run: (e, r) => turn(e, r).setHorizontalRule().run() },
  {
    id: "kpis",
    label: "Numbers",
    hint: "Counter tiles",
    words: "kpi metrics stats",
    group: "Data",
    run: (e, r) =>
      place(e, r, {
        type: "kpis",
        attrs: {
          items: [
            { label: "Label", value: "0", tone: null, delta: null },
            { label: "Label", value: "0", tone: null, delta: null },
            { label: "Label", value: "0", tone: null, delta: null },
          ],
        },
      }),
  },
  {
    id: "chart",
    label: "Chart",
    hint: "Bars or lines from a grid",
    words: "graph plot bar line",
    group: "Data",
    run: (e, r) =>
      place(e, r, {
        type: "chart",
        attrs: {
          code: ["type: bar", "x: month", "y: value", "data:", "  - { month: Jan, value: 12 }", "  - { month: Feb, value: 18 }", "  - { month: Mar, value: 15 }"].join("\n"),
        },
      }),
  },
  {
    id: "datatable",
    label: "Data table",
    hint: "Rows and columns, sortable",
    words: "csv sheet",
    group: "Data",
    run: (e, r) => place(e, r, { type: "dataTable", attrs: { code: "# sortable\nName, Value\nFirst, 1\nSecond, 2" } }),
  },
  {
    id: "table",
    label: "Table",
    hint: "A plain table",
    words: "grid",
    group: "Data",
    run: (e, r) => turn(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "question",
    label: "Question",
    hint: "A field readers answer",
    words: "field input form ask",
    group: "Form",
    run: (e, r) => place(e, r, { type: "field", attrs: { attributes: { name: freshName(e, "q"), type: "text", label: "" } } }),
  },
  {
    id: "choice",
    label: "Choice",
    hint: "Pick one of several options",
    words: "select option radio form",
    group: "Form",
    run: (e, r) =>
      place(e, r, {
        type: "choice",
        attrs: { attributes: { name: freshName(e, "pick"), label: "" } },
        content: [
          { type: "option", attrs: { attributes: { value: "a", label: "Option A" } }, content: [p()] },
          { type: "option", attrs: { attributes: { value: "b", label: "Option B" } }, content: [p()] },
        ],
      }),
  },
];

export function filterBlocks(query: string): BlockChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCKS;
  return BLOCKS.filter((b) => `${b.label} ${b.words}`.toLowerCase().includes(q));
}
