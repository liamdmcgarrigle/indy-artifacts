import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let GET: (req: Request, ctx: { params: Promise<{ slug: string; version: string; block: string }> }) => Promise<Response>;

const get = (slug: string, version: number, block: string, scheme = "light") =>
  GET(new Request(`http://localhost:5174/embed/${slug}/${version}/${block}?scheme=${scheme}`), {
    params: Promise.resolve({ slug, version: String(version), block }),
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-embed-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://agentbox:5174";
  GET = (await import("@/app/embed/[slug]/[version]/[block]/route")).GET as typeof GET;

  const { publishArtifact } = await import("@/lib/service/artifacts");
  const { getContext } = await import("@/lib/service/context");
  const ctx = getContext();
  await publishArtifact(ctx, {
    slug: "embed-md",
    source: [
      "---",
      "title: Embed demo",
      "theme: picaflick",
      "---",
      "",
      "```mermaid",
      "graph TD; A-->B;",
      "```",
      "",
      "```html",
      "<b id=probe>raw</b><script>window.evil=1</script>",
      "```",
    ].join("\n"),
  });
  await publishArtifact(ctx, {
    slug: "embed-html",
    title: "Whole page",
    kind: "html",
    source: "<!doctype html><html><head><title>mine</title></head><body><h1>Page</h1></body></html>",
  });
  await publishArtifact(ctx, {
    slug: "embed-react",
    title: "React one",
    kind: "react",
    files: { "App.tsx": "export default function App(){ return <b>REACT_OK</b>; }" },
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("embed documents", () => {
  it("sends the sandbox CSP as a header and repeats it in a meta tag", async () => {
    const res = await get("embed-md", 1, "e0");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    const html = await res.text();
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves a mermaid block with the vendored bundle and the artifact theme", async () => {
    const html = await (await get("embed-md", 1, "e0", "dark")).text();
    expect(html).toContain('<pre class="mermaid">graph TD; A--&gt;B;</pre>');
    expect(html).toContain('src="/vendor/mermaid.js"');
    expect(html).toContain('href="/themes/picaflick.css"');
    expect(html).toContain('data-scheme="dark"');
    expect(html).toContain("/embed-bridge.js");
  });

  it("gives mermaid theme variables read from the --art-* tokens", async () => {
    const { MERMAID_THEME_TOKENS } = await import("@/lib/embed/document");
    const html = await (await get("embed-md", 1, "e0")).text();

    // theme "base" is the only one that honours themeVariables.
    expect(html).toContain('theme: "base"');
    expect(html).toContain("themeVariables: vars");
    expect(html).not.toContain('theme: dark ? "dark" : "default"');

    // Every variable the diagram needs is mapped to a token, and the values
    // are resolved in the frame rather than written into the document.
    for (const key of [
      "primaryColor",
      "primaryTextColor",
      "primaryBorderColor",
      "lineColor",
      "secondaryColor",
      "tertiaryColor",
      "background",
      "mainBkg",
      "fontFamily",
      "fontSize",
    ]) {
      expect(MERMAID_THEME_TOKENS[key], `${key} has no token`).toMatch(/^--art-/);
      expect(html).toContain(`"${key}":"${MERMAID_THEME_TOKENS[key]}"`);
    }
    expect(html).toContain("getComputedStyle(document.documentElement)");
    // No literal colour survives into the document: the tokens carry them.
    expect(html).not.toMatch(/themeVariables[\s\S]{0,400}#[0-9a-fA-F]{3,8}/);
  });

  it("scales the rendered diagram to the frame width", async () => {
    const html = await (await get("embed-md", 1, "e0")).text();
    expect(html).toContain("#root .mermaid svg { display: block; width: 100%; max-width: 100%; height: auto; }");
    // mermaid stamps a natural size on the svg; the frame takes it back off.
    expect(html).toContain('svg.removeAttribute("height")');
    expect(html).toContain('svg.setAttribute("width", "100%")');
    expect(html).toContain("startOnLoad: false");
  });

  it("serves a raw html block verbatim inside the frame", async () => {
    const html = await (await get("embed-md", 1, "e1")).text();
    expect(html).toContain('<b id=probe>raw</b>');
    expect(html).toContain("window.evil=1");
  });

  it("keeps a whole-page html artifact but adds the theme and bridge", async () => {
    const html = await (await get("embed-html", 1, "page")).text();
    expect(html).toContain("<h1>Page</h1>");
    expect(html).toContain("<title>mine</title>");
    expect(html).toContain('href="/themes/default.css"');
    expect(html).toContain("/embed-bridge.js");
    expect(html).toContain('data-scheme="light"');
  });

  it("points a compiled artifact at its bundle", async () => {
    const html = await (await get("embed-react", 1, "page")).text();
    expect(html).toContain('src="/api/bundle/embed-react/1/bundle.js"');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("/primitives/primitives.js");
  });

  it("shows the build log instead of a blank frame when a build failed", async () => {
    const { publishArtifact } = await import("@/lib/service/artifacts");
    const { getContext } = await import("@/lib/service/context");
    await publishArtifact(getContext(), {
      slug: "embed-broken",
      title: "Broken",
      kind: "react",
      files: { "App.tsx": 'import x from "left-pad";\nexport default function App(){return <b>{String(x)}</b>}' },
    });
    const html = await (await get("embed-broken", 1, "page")).text();
    expect(html).toContain("did not build");
    expect(html).toContain("left-pad");
  });

  it("404s an unknown block and an unknown artifact", async () => {
    expect((await get("embed-md", 1, "e99")).status).toBe(404);
    expect((await get("nope", 1, "e0")).status).toBe(404);
  });
});
