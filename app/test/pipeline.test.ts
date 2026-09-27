import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/pipeline/index";
import { normalizeContainers } from "@/lib/pipeline/normalize";

/** Decode an HTML attribute value the way a browser would. */
function attr(html: string, name: string): string {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  if (!m) throw new Error(`attribute ${name} not found`);
  return m[1]
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("block identity", () => {
  it("stamps every top-level element with an id and line range", () => {
    const r = renderMarkdown("# Title\n\nA paragraph.\n\nAnother one.\n");
    expect(r.blocks.map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
    expect(r.blocks[0].kind).toBe("h1");
    expect(r.blocks[0].lines).toEqual([1, 1]);
    expect(r.blocks[2].lines).toEqual([5, 5]);
    expect(r.html).toContain('data-block="b0"');
    expect(r.html).toContain('data-lines="5-5"');
  });

  it("accounts for frontmatter when numbering lines", () => {
    const r = renderMarkdown("---\ntitle: T\n---\n\nHello.\n");
    expect(r.frontmatter.title).toBe("T");
    expect(r.blocks[0].lines).toEqual([5, 5]);
  });
});

describe("frontmatter", () => {
  it("passes the theme through, to be checked when the page is saved", () => {
    expect(renderMarkdown("---\ntitle: A\n---\n").frontmatter.theme).toBe("");
    expect(renderMarkdown("---\ntitle: A\ntheme: graphite\n---\n").frontmatter.theme).toBe("graphite");
  });

  it("carries project, description and tags", () => {
    const r = renderMarkdown("---\ntitle: A\nproject: p\ndescription: d\ntags: [x, y]\n---\n");
    expect(r.frontmatter.project).toBe("p");
    expect(r.frontmatter.description).toBe("d");
    expect(r.frontmatter.tags).toEqual(["x", "y"]);
  });
});

describe("directives", () => {
  it("renders cards, callouts, columns, tabs and details", () => {
    const r = renderMarkdown(
      [
        ':::card{title="T" subtitle="S"}',
        "body",
        ":::",
        "",
        ':::callout{tone=bad title="Oops"}',
        "bad news",
        ":::",
        "",
        ":::columns{n=3}",
        ":::col",
        "one",
        ":::",
        ":::",
        "",
        ":::tabs",
        ':::tab{label="First"}',
        "a",
        ":::",
        ":::",
        "",
        ':::details{summary="More"}',
        "hidden",
        ":::",
      ].join("\n"),
    );
    expect(r.html).toContain('<art-card title="T" subtitle="S"');
    expect(r.html).toContain('<art-callout tone="bad" title="Oops"');
    expect(r.html).toContain('<art-columns n="3"');
    expect(r.html).toContain("<art-col");
    expect(r.html).toContain('<art-tab label="First"');
    expect(r.html).toContain('<art-details summary="More"');
    expect(r.warnings).toEqual([]);
  });

  it("parses a kpis list into art-kpi tiles", () => {
    const r = renderMarkdown(
      [":::kpis", "- Files copied: 48,211", "- Failed: 3 {tone=bad}", "- Duration: 41 min (+2)", ":::"].join("\n"),
    );
    expect(r.html).toContain('<art-kpi label="Files copied" value="48,211">');
    expect(r.html).toContain('tone="bad"');
    expect(r.html).toContain('delta="+2"');
    expect(r.html).toContain('value="41 min"');
  });

  it("warns on an unknown directive without failing", () => {
    const r = renderMarkdown(":::nope\nx\n:::\n");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain("unknown directive");
    expect(r.html).toContain("art-error");
  });
});

describe("fenced blocks", () => {
  it("compiles a chart spec into data-chart", () => {
    const r = renderMarkdown(
      ["```chart", "type: bar", "x: day", "y: gigabytes", "data:", "  - { day: Mon, gigabytes: 12 }", "```"].join("\n"),
    );
    const spec = JSON.parse(attr(r.html, "data-chart"));
    expect(spec.type).toBe("bar");
    expect(spec.y).toEqual(["gigabytes"]);
    expect(spec.data).toHaveLength(1);
    expect(spec.height).toBe(280);
  });

  it("warns with a line number on a bad chart type", () => {
    const r = renderMarkdown(["intro", "", "```chart", "type: pyramid", "data: [{a: 1}]", "```"].join("\n"));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].line).toBe(3);
    expect(r.warnings[0].message).toContain("chart type must be one of");
  });

  it("compiles a CSV table", () => {
    const r = renderMarkdown(["```table", "# sortable", "source, files", "photos, 40000", "```"].join("\n"));
    const spec = JSON.parse(attr(r.html, "data-table"));
    expect(spec.columns).toEqual(["source", "files"]);
    expect(spec.rows).toEqual([["photos", 40000]]);
    expect(spec.sortable).toBe(true);
  });

  it("warns on a ragged CSV row", () => {
    const r = renderMarkdown(["```table", "a, b", "1", "```"].join("\n"));
    expect(r.warnings[0].message).toContain("expected 2");
  });

  it("registers mermaid and html blocks as embeds bound to their block", () => {
    const r = renderMarkdown(["```mermaid", "graph TD; A-->B;", "```", "", "```html", "<b>hi</b>", "```"].join("\n"));
    expect(r.embeds).toHaveLength(2);
    expect(r.embeds[0]).toMatchObject({ id: "e0", kind: "mermaid", block: "b0" });
    expect(r.embeds[1]).toMatchObject({ id: "e1", kind: "html", block: "b1" });
    expect(r.embeds[0].content).toContain("graph TD");
    expect(r.html).toContain('data-embed="e0"');
    expect(r.html).not.toContain("<b>hi</b>");
  });
});

describe("sanitizing", () => {
  it("strips script, style, handlers and javascript: urls", () => {
    const r = renderMarkdown(
      [
        "<script>alert(1)</script>",
        "",
        "<style>body{display:none}</style>",
        "",
        '<div onclick="alert(1)">x</div>',
        "",
        "[click](javascript:alert(1))",
        "",
        "<img src=x onerror=alert(1)>",
      ].join("\n"),
    );
    expect(r.html).not.toContain("<script");
    expect(r.html).not.toContain("<style");
    expect(r.html).not.toContain("onclick");
    expect(r.html).not.toContain("onerror");
    expect(r.html).not.toContain("javascript:");
  });

  it("keeps ordinary markdown and gfm tables", () => {
    const r = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n");
    expect(r.html).toContain("<table data-block=");
    expect(r.html).toContain("<td>1</td>");
    expect(r.html).toContain('type="checkbox"');
  });

  it("allows relative image sources for assets", () => {
    const r = renderMarkdown("![shot](assets/shot.png)");
    expect(r.html).toContain('src="assets/shot.png"');
  });
});

describe("container nesting", () => {
  it("nests columns and cols written with three colons at every level", () => {
    const r = renderMarkdown(
      [":::columns{n=2}", ":::col", "one", ":::", ":::col", "two", ":::", ":::"].join("\n"),
    );
    expect(r.warnings).toEqual([]);
    expect(r.html).not.toContain(":::");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ kind: "art-columns", lines: [1, 8] });
    expect(r.html.match(/<art-col>/g)).toHaveLength(2);
    // Both cols live inside the columns element, not after it.
    expect(r.html.indexOf("</art-columns>")).toBeGreaterThan(r.html.lastIndexOf("</art-col>"));
  });

  it("nests three levels deep", () => {
    const r = renderMarkdown(
      [
        ':::card{title="T"}',
        ":::columns{n=2}",
        ":::col",
        "one",
        ":::",
        ":::col",
        "two",
        ":::",
        ":::",
        ":::",
      ].join("\n"),
    );
    expect(r.warnings).toEqual([]);
    expect(r.html).not.toContain(":::");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ kind: "art-card", lines: [1, 10] });
    expect(r.html.match(/<art-col>/g)).toHaveLength(2);
    expect(r.html.indexOf("<art-columns")).toBeGreaterThan(r.html.indexOf("<art-card"));
  });

  it("nests tabs and tab the same way", () => {
    const r = renderMarkdown(
      [":::tabs", ':::tab{label="First"}', "a", ":::", ':::tab{label="Second"}', "b", ":::", ":::"].join("\n"),
    );
    expect(r.warnings).toEqual([]);
    expect(r.blocks).toHaveLength(1);
    expect(r.html.match(/<art-tab label=/g)).toHaveLength(2);
  });

  it("leaves ::: inside a fenced code block alone", () => {
    const src = ["```md", ":::columns{n=2}", ":::col", "one", ":::", ":::", "```"].join("\n");
    expect(normalizeContainers(src).source).toBe(src);
    const r = renderMarkdown(src);
    expect(r.html).toContain(":::columns{n=2}");
    expect(r.html).not.toContain("art-columns");
  });

  it("leaves a source that already counts its colons unchanged", () => {
    const src = ["::::columns{n=2}", ":::col", "one", ":::", ":::col", "two", ":::", "::::"].join("\n");
    expect(normalizeContainers(src).source).toBe(src);
    const r = renderMarkdown(src);
    expect(r.warnings).toEqual([]);
    expect(r.html.match(/<art-col>/g)).toHaveLength(2);
  });

  it("warns about an unclosed container and leaves it as written", () => {
    const src = ["intro", "", ':::card{title="T"}', "body"].join("\n");
    const out = normalizeContainers(src);
    expect(out.source).toBe(src);
    expect(out.warnings).toEqual([{ line: 3, message: 'container ":::card" opened on line 3 is never closed' }]);
    expect(renderMarkdown(src).warnings[0].message).toContain("never closed");
  });

  it("keeps the block map's line numbers where the author put them", () => {
    const src = [
      "intro",
      "",
      ":::columns{n=2}",
      ":::col",
      "one",
      ":::",
      ":::col",
      "two",
      ":::",
      ":::",
      "",
      "outro",
    ].join("\n");
    expect(normalizeContainers(src).source.split("\n")).toHaveLength(src.split("\n").length);
    const r = renderMarkdown(src);
    expect(r.blocks.map((b) => b.lines)).toEqual([
      [1, 1],
      [3, 10],
      [12, 12],
    ]);
    expect(r.html).toContain('data-lines="12-12"');
  });

  it("warns when a col or tab is outside its parent", () => {
    const col = renderMarkdown([":::col", "one", ":::"].join("\n"));
    expect(col.warnings).toHaveLength(1);
    expect(col.warnings[0].message).toBe('":::col" is only rendered inside ":::columns"');
    const tab = renderMarkdown([':::tab{label="x"}', "a", ":::"].join("\n"));
    expect(tab.warnings[0].message).toBe('":::tab" is only rendered inside ":::tabs"');
  });
});

describe("colons in prose", () => {
  it("leaves a time alone instead of reading it as a directive", () => {
    const out = renderMarkdown("Tonight at 02:00, same set.", "T");
    expect(out.warnings).toEqual([]);
    expect(out.html).toContain("02:00");
  });

  it("leaves a namespace alone", () => {
    const out = renderMarkdown("Use `std` then std::vector in prose.", "T");
    expect(out.warnings).toEqual([]);
    expect(out.html).toContain("std::vector");
  });

  it("still renders the block directives it knows", () => {
    const out = renderMarkdown(":::callout{tone=warn}\nLook here.\n:::", "T");
    expect(out.warnings).toEqual([]);
    expect(out.html).toContain("art-callout");
  });
});

describe("dossier blocks", () => {
  const TIMELINE = [
    ':::timeline{legend="good:Shipped, bad:Outage, gap:Inferred"}',
    ':::event{date="Mar 2021" title="First release" kind=good source="v1.0 notes"}',
    "Shipped to **three** teams.",
    ":::",
    ':::event{date="2021 – 2022" title="Quiet year" kind=gap}',
    "No releases on record.",
    ":::",
    ":::",
  ].join("\n");

  it("renders a timeline of events with their dates, kinds and sources", () => {
    const r = renderMarkdown(TIMELINE);
    expect(r.warnings).toEqual([]);
    expect(r.html).toContain('<art-timeline legend="good:Shipped, bad:Outage, gap:Inferred"');
    expect(r.html).toContain('<art-event date="Mar 2021" title="First release" kind="good" source="v1.0 notes">');
    expect(r.html).toContain("<strong>three</strong>");
    expect(r.html).toContain('<art-event date="2021 – 2022" title="Quiet year" kind="gap">');
    // One block: the timeline is a single top-level element.
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].kind).toBe("art-timeline");
  });

  it("keeps a timeline's attributes through the sanitizer, and nothing else", () => {
    const r = renderMarkdown(':::timeline\n:::event{date="x" title="y" onclick="alert(1)" style="color:red"}\nz\n:::\n:::');
    expect(r.html).toContain('<art-event date="x" title="y">');
    expect(r.html).not.toContain("onclick");
    expect(r.html).not.toContain("style=");
  });

  it("warns about an event outside a timeline, and other blocks inside one", () => {
    const loose = renderMarkdown(':::event{date="x"}\ny\n:::');
    expect(loose.warnings[0].message).toBe('":::event" is only rendered inside ":::timeline"');
    const stray = renderMarkdown(":::timeline\nJust text.\n:::");
    expect(stray.warnings[0].message).toContain('holds ":::event" blocks');
  });

  it("renders a badge in a heading, and leaves other inline directives as typed", () => {
    const r = renderMarkdown("### Phased works :badge[Recommended]{tone=good}\n\nAt 10:30 we met; see :badge alone and :note[x].");
    expect(r.html).toContain('>Phased works <span class="art-badge art-badge--good">Recommended</span></h3>');
    expect(r.html).toContain(":badge alone");
    expect(r.html).toContain(":note[x]");
    expect(r.warnings).toEqual([]);
  });

  it("maps badge tones to Indy's and falls back to neutral", () => {
    expect(renderMarkdown(":badge[Risky]{tone=danger}").html).toContain('class="art-badge art-badge--bad"');
    expect(renderMarkdown(":badge[Maybe]{tone=purple}").html).toContain('class="art-badge art-badge--neutral"');
    expect(renderMarkdown(':badge[<b>x</b>]{tone="good onclick=alert(1)"}').html).not.toContain("onclick");
  });

  it("marks columns with an aside", () => {
    const r = renderMarkdown(":::columns{aside}\n:::col\nMain.\n:::\n:::col\n#### Watch out\nSide.\n:::\n:::");
    expect(r.html).toContain('<art-columns n="2" aside="true"');
  });

  it("gives a counter tile a note line", () => {
    const r = renderMarkdown(':::kpis\n- Budget: 4.2M (+12%) {tone=bad note="over since March"}\n- Rooms: 14 {note=reopened}\n:::');
    expect(r.html).toContain('<art-kpi label="Budget" value="4.2M" tone="bad" delta="+12%" note="over since March">');
    expect(r.html).toContain('<art-kpi label="Rooms" value="14" note="reopened">');
  });

  it("reads a counter's options when they come in separate groups", () => {
    const r = renderMarkdown(':::kpis\n- Output tokens: 3.1x fewer {tone=good} {note="7,579 vs 23,123"}\n- Cost: -52% {note="$0.82 vs $1.72"} (-0.90) {tone=good}\n:::');
    expect(r.html).toContain('<art-kpi label="Output tokens" value="3.1x fewer" tone="good" note="7,579 vs 23,123">');
    expect(r.html).toContain('<art-kpi label="Cost" value="-52%" tone="good" delta="-0.90" note="$0.82 vs $1.72">');
    expect(r.warnings).toEqual([]);
  });

  it("warns when options would show on the page as text", () => {
    const r = renderMarkdown(["intro", "", "Shipped :badge[v2] {tone=good} today.", "", ":::kpis", "- Size: 4 {size=big}", ":::"].join("\n"));
    expect(r.warnings.map((w) => w.line)).toEqual([3, 6]);
    expect(r.warnings[0].message).toContain('"{tone=good}" shows as text on the page');
    expect(r.warnings[1].message).toContain('"{size=big}" shows as text in this counter');
  });

  it("leaves braces in code and ordinary prose alone", () => {
    const r = renderMarkdown(["Set `{a=1}` in config.", "", "A set {1, 2} and a {placeholder}.", "", "```js", "const o = {a=1}", "```"].join("\n"));
    expect(r.warnings).toEqual([]);
  });

  it("keeps a markdown table's column alignment for the stylesheet", () => {
    const r = renderMarkdown("| Item | Cost |\n|:--|--:|\n| Roof | 1,200 |\n| **Total** | **1,200** |\n");
    expect(r.html).toContain('<td align="right">1,200</td>');
    expect(r.html).toContain('<td align="left"><strong>Total</strong></td>');
  });
});

describe("plain text for search", () => {
  it("reads an event's date and source as words", async () => {
    const { plainText } = await import("@/lib/service/plaintext");
    expect(plainText(':::event{date="Mar 2021" title="First release" kind=good source="v1.0 notes"}\nBody.\n:::')).toBe(
      "Mar 2021 First release v1.0 notes\nBody.",
    );
  });

  it("stays linear on a page of blank lines", async () => {
    const { plainText } = await import("@/lib/service/plaintext");
    const started = Date.now();
    plainText("a" + "\n".repeat(400_000) + "b");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
