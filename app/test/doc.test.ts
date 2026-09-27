import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JSONContent } from "@tiptap/core";
import { markdownToDoc } from "@/lib/doc/parse";
import { docToMarkdown } from "@/lib/doc/serialize";
import { ORIGIN_ATTRS } from "@/lib/doc/schema";
import { withFront } from "@/lib/doc/frontmatter";

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

describe("forms", () => {
  const FORM = `---
title: Pick one
form:
  submit: Send my pick
---

Try each one first.

:::choice{name=direction label="Which one would you ship?" required}
:::option{value=stepped label="Stepped"}
Four screens.
:::
:::option{value=single label="Single page"}
Everything on one screen.
:::
:::

::field{name=why type=textarea label="Why this one?" required}

::field{name=sure type=scale label="How sure are you?" min=1 max=5}
`;

  it("round-trips, and models questions as fields and choices", async () => {
    const doc = markdownToDoc(FORM);
    expect(docToMarkdown(doc)).toBe(FORM);
    expect((doc.content ?? []).map((n) => n.type)).toEqual(["paragraph", "choice", "field", "field"]);
    const again = markdownToDoc(docToMarkdown(doc, { fresh: true }));
    expect(content(again)).toEqual(content(doc));
  });

  it("reads the questions and checks answers against them", async () => {
    const { formFields, checkAnswers, cleanAnswers, formSettings } = await import("@/lib/forms/spec");
    const fields = formFields(markdownToDoc(FORM));
    expect(fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ["direction", "choice", true],
      ["why", "textarea", true],
      ["sure", "scale", false],
    ]);
    expect(fields[0].options?.map((o) => o.value)).toEqual(["stepped", "single"]);
    expect(Object.keys(checkAnswers(fields, {}))).toEqual(["direction", "why"]);
    const answers = cleanAnswers(fields, { direction: "single", why: "Fewer steps", sure: "4", extra: "dropped" });
    expect(answers).toEqual({ direction: "single", why: "Fewer steps", sure: 4 });
    expect(checkAnswers(fields, answers)).toEqual({});
    expect(checkAnswers(fields, { ...answers, direction: "nope", sure: 9 })).toEqual({
      direction: "Pick one of the options.",
      sure: "The highest is 5.",
    });
    expect(formSettings({ form: { submit: "Send my pick" } }).submit).toBe("Send my pick");
  });
});

describe("editing in place", () => {
  it("changes a title in the frontmatter and keeps the rest as written", () => {
    const front = ["---", "title: Old", "# a comment", "theme: default", "---"];
    expect(withFront(front, { title: "New: a better one", description: "Short" })).toEqual([
      "---",
      'title: "New: a better one"',
      "# a comment",
      "theme: default",
      "description: Short",
      "---",
    ]);
    expect(withFront(front, { title: null })).toEqual(["---", "# a comment", "theme: default", "---"]);
    expect(withFront(null, { title: "Fresh" })).toEqual(["---", "title: Fresh", "---"]);
  });

  it("writes the frontmatter back through the document", () => {
    const doc = markdownToDoc("---\ntitle: Old\n---\n\nBody text.\n");
    doc.attrs = { ...doc.attrs, front: withFront(doc.attrs?.front as string[], { title: "New" }) };
    expect(docToMarkdown(doc)).toBe("---\ntitle: New\n---\n\nBody text.\n");
  });

  it("drops empty lines added while typing", () => {
    const doc = markdownToDoc("One.\n\nTwo.\n");
    doc.content!.splice(1, 0, { type: "paragraph" }, { type: "paragraph" });
    expect(docToMarkdown(doc)).toBe("One.\n\nTwo.\n");
  });

  it("writes a moved block as it was written", () => {
    const doc = markdownToDoc("# Head\n\n> quoted  *as is*\n\nLast.\n");
    const [a, b, c] = doc.content!;
    doc.content = [a, c, b];
    expect(docToMarkdown(doc)).toContain("> quoted  *as is*");
  });
});

describe("dossier blocks", () => {
  const DOSSIER = `#### Project history

# Riverside works

:::timeline{legend="key:Milestone, good:Done, warn:Pending, gap:Inferred"}
:::event{date="Mar 2021" title="Survey" kind=key source="report 12"}
The roof survey found **two** leaks.
:::
:::event{date="2021 – 2022" title="No records" kind=gap}
Probably paused.
:::
:::

### Phased works :badge[Recommended]{tone=good}

:::columns{aside}
:::col
Main text.
:::
:::col
#### Watch out
Side note.
:::
:::

:::kpis
- Budget: 4.2M (+12%) {tone=bad note="over since March"}
- Rooms: 14
:::

| Item | Cost |
|:-----|-----:|
| Roof | 1,200 |
| **Total** | **1,200** |
`;

  it("round-trips byte for byte and models the timeline", () => {
    const doc = markdownToDoc(DOSSIER);
    expect(docToMarkdown(doc)).toBe(DOSSIER);
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "heading", "timeline", "heading", "columns", "kpis", "table"]);
    const timeline = doc.content![2];
    expect(timeline.content!.map((e) => e.type)).toEqual(["event", "event"]);
    expect(timeline.attrs!.attributes).toEqual({ legend: "key:Milestone, good:Done, warn:Pending, gap:Inferred" });
    expect(timeline.content![0].attrs!.attributes).toEqual({ date: "Mar 2021", title: "Survey", kind: "key", source: "report 12" });
  });

  it("models a badge as an inline node", () => {
    const heading = markdownToDoc(DOSSIER).content![3];
    expect(heading.content).toEqual([
      { type: "text", text: "Phased works " },
      { type: "badge", attrs: { label: "Recommended", attributes: { tone: "good" } } },
    ]);
  });

  it("writes every dossier block afresh to markdown that means the same", () => {
    const doc = markdownToDoc(DOSSIER);
    const fresh = docToMarkdown(doc, { fresh: true });
    expect(fresh).toContain(":badge[Recommended]{tone=\"good\"}");
    expect(fresh).toContain('- Budget: 4.2M (+12%) {tone=bad note="over since March"}');
    expect(content(markdownToDoc(fresh))).toEqual(content(doc));
  });

  it("rewrites an edited event and keeps its neighbours as written", () => {
    const doc = markdownToDoc(DOSSIER);
    const event = doc.content![2].content![1];
    event.attrs = { ...event.attrs, attributes: { ...event.attrs!.attributes, title: "Paused" } };
    const out = docToMarkdown(doc);
    expect(out).toContain('title="Paused"');
    expect(out).toContain('### Phased works :badge[Recommended]{tone=good}');
    expect((content(markdownToDoc(out)) as unknown[]).length).toBe((content(doc) as unknown[]).length);
  });

  it("keeps an event outside a timeline as written", () => {
    const md = ':::event{date="x"}\nLoose.\n:::\n';
    const doc = markdownToDoc(md);
    expect(doc.content![0].type).toBe("rawBlock");
    expect(docToMarkdown(doc)).toBe(md);
  });
});

describe("leading blank lines", () => {
  it("survive a round trip", async () => {
    const { markdownToDoc } = await import("@/lib/doc/parse");
    const { docToMarkdown } = await import("@/lib/doc/serialize");
    for (const md of ["\n# Title\n\nPara\n", "\n\n# Title\n", "# Title\n\nPara\n", "---\ntitle: x\n---\n\n# T\n"]) {
      expect(docToMarkdown(markdownToDoc(md))).toBe(md);
    }
  });
});
