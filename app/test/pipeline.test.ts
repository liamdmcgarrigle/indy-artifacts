import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/pipeline/index";

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
  it("defaults theme and falls back on an unknown one", () => {
    expect(renderMarkdown("---\ntitle: A\n---\n").frontmatter.theme).toBe("default");
    expect(renderMarkdown("---\ntitle: A\ntheme: nope\n---\n").frontmatter.theme).toBe("default");
    expect(renderMarkdown("---\ntitle: A\ntheme: picaflick\n---\n").frontmatter.theme).toBe("picaflick");
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
