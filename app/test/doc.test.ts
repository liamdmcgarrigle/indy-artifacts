import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JSONContent } from "@tiptap/core";
import { markdownToDoc } from "@/lib/doc/parse";
import { docToMarkdown } from "@/lib/doc/serialize";
import { ORIGIN_ATTRS } from "@/lib/doc/schema";

const EVERYTHING = `---
title: Every block
theme: default
---

# Heading one

A paragraph with **bold**, _italic_, ~~struck~~, \`code\`, a [link](https://example.com "Example"),
and [\`linked code\`](https://example.com/x) across a soft break.\\
Then a hard break, an image ![a cat](assets/cat.png) and a time 10:30 that is not a directive.

## Lists

- one
- two
  - nested
- three

1. first
2. second

- [x] done
- [ ] not done

> A quote
> over two lines.

---

\`\`\`ts
const x = 1;
\`\`\`

| Name | Count |
|:-----|------:|
| a    | 1     |
| b    | 2     |

:::callout{tone=warn title="Needs a look"}
Three files failed.
:::

:::kpis
- Files copied: 48,211
- Failed: 3 {tone=bad}
- Duration: 41 min (+3)
:::

:::columns{n=2}
:::col
Left side.
:::
:::col
Right side.
:::
:::

:::tabs
:::tab{label="First"}
One.
:::
:::tab{label="Second"}
Two.
:::
:::

:::details{summary="More"}
Hidden text.
:::

:::card{title="A card" subtitle="with a subtitle"}
Card body.
:::

\`\`\`chart
type: bar
x: night
y: [files]
data:
  - { night: Sat, files: 41200 }
  - { night: Sun, files: 39800 }
\`\`\`

\`\`\`table
Name, Score
a, 1
\`\`\`

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

::unknown-leaf{x=1}

:::mystery
Not a block this renders.
:::

[ref]: https://example.com
Some text with a [reference][ref].
`;

/** A document's content with where-it-came-from stripped, to compare two parses. */
function content(doc: JSONContent): unknown {
  const strip = (n: JSONContent, top: boolean): unknown => {
    const attrs = { ...(n.attrs ?? {}) };
    if (top) for (const key of ORIGIN_ATTRS) delete attrs[key];
    return { ...n, attrs, content: n.content?.map((c) => strip(c, false)) };
  };
  return (doc.content ?? []).filter((n) => n.type !== "rawBlock").map((n) => strip(n, true));
}

function corpus(): [string, string][] {
  const dir = join(__dirname, ".corpus");
  if (!existsSync(dir)) return [];
  const out: [string, string][] = [];
  for (const name of readdirSync(dir).sort()) {
    const text = readFileSync(join(dir, name), "utf8");
    out.push([name, text]);
    // The reference's examples are the block vocabulary agents are taught.
    for (const [i, m] of [...text.matchAll(/^(`{3,}|~{3,})(?:markdown|md)\n([\s\S]*?)\n\1$/gm)].entries()) {
      out.push([`${name}#${i}`, m[2] + "\n"]);
    }
  }
  return out;
}

describe("markdown to document and back", () => {
  it("gives back the same bytes for an untouched document", () => {
    expect(docToMarkdown(markdownToDoc(EVERYTHING))).toBe(EVERYTHING);
  });

  it("models every block the pipeline renders, and keeps the rest raw", () => {
    const types = (markdownToDoc(EVERYTHING).content ?? []).map((n) => n.type);
    for (const t of ["heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "horizontalRule", "codeBlock", "table", "callout", "kpis", "columns", "tabs", "details", "card", "chart", "dataTable", "embed"]) {
      expect(types).toContain(t);
    }
    expect(types.filter((t) => t === "rawBlock")).toHaveLength(4); // unknown leaf, unknown container, a definition, a reference link
  });

  it("writes every modelled block afresh to markdown that parses to the same thing", () => {
    const doc = markdownToDoc(EVERYTHING);
    const again = markdownToDoc(docToMarkdown(doc, { fresh: true }));
    expect(content(again)).toEqual(content(doc));
  });

  it("rewrites only the block that changed", () => {
    const doc = markdownToDoc(EVERYTHING);
    const para = doc.content!.find((n) => n.type === "blockquote")!;
    para.content![0].content![0].text = "A changed quote over two lines.";
    expect(docToMarkdown(doc)).toBe(EVERYTHING.replace("> A quote\n> over two lines.", "> A changed quote over two lines."));
  });

  it("gives a new block a blank line before it", () => {
    const doc = markdownToDoc("# Title\n\nFirst.\n");
    doc.content!.push({ type: "paragraph", content: [{ type: "text", text: "Added." }] });
    expect(docToMarkdown(doc)).toBe("# Title\n\nFirst.\n\nAdded.\n");
  });

  it("numbers embeds the way the pipeline does", () => {
    const doc = markdownToDoc("```html\n<b>1</b>\n```\n\n:::callout\n```mermaid\ngraph TD;\n```\n:::\n\n```html\n<i>2</i>\n```\n");
    const ids: string[] = [];
    const walk = (n: JSONContent) => {
      if (n.type === "embed") ids.push(String(n.attrs?.embedId));
      n.content?.forEach(walk);
    };
    walk(doc);
    expect(ids).toEqual(["e0", "e1", "e2"]);
  });

  it("handles empty documents, frontmatter only, and no trailing newline", () => {
    for (const src of ["", "---\ntitle: x\n---\n", "Just text", "\n\n# Late start\n\n\n"]) {
      expect(docToMarkdown(markdownToDoc(src))).toBe(src);
    }
  });
});

describe("every stored artifact", () => {
  const files = corpus();
  it.skipIf(!files.length)("round-trips byte for byte, and survives a fresh write", () => {
    const failures: string[] = [];
    for (const [name, text] of files) {
      const doc = markdownToDoc(text);
      if (docToMarkdown(doc) !== text) failures.push(`${name}: not byte-identical`);
      const again = markdownToDoc(docToMarkdown(doc, { fresh: true }));
      if (JSON.stringify(content(again)) !== JSON.stringify(content(doc))) failures.push(`${name}: changed meaning when rewritten`);
    }
    expect(failures).toEqual([]);
  });
});
