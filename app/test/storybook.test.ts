import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { cleanPath, readTarGz, TarError } from "@/lib/storybook/tar";
import { rewriteCss, rewriteHtml, rewriteJs } from "@/lib/storybook/rewrite";
import { encodeValues, parseStoryBlock, StoryBlockError, storyQuery, storyWarnings } from "@/lib/storybook/spec";

// ------------------------------------------------------------------ a tar

interface Entry {
  name: string;
  data?: string | Buffer;
  type?: string;
  link?: string;
}

function header(name: string, size: number, type: string, link = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(link, 157);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

function pad(buf: Buffer): Buffer {
  const rest = buf.length % 512;
  return rest ? Buffer.concat([buf, Buffer.alloc(512 - rest)]) : buf;
}

function tar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    if (e.name.length > 100) {
      const long = Buffer.from(e.name + "\0");
      parts.push(header("././@LongLink", long.length, "L"), pad(long));
    }
    parts.push(header(e.name, e.type && e.type !== "0" ? 0 : data.length, e.type ?? "0", e.link));
    if (!e.type || e.type === "0") parts.push(pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const LIMITS = { totalBytes: 10_000_000, fileBytes: 1_000_000, files: 100 };

async function read(archive: Buffer, limits = LIMITS) {
  const files: Record<string, string> = {};
  const result = await readTarGz(Readable.from([archive]), limits, async (f) => {
    files[f.path] = f.data.toString("utf8");
  });
  return { files, skipped: result.skipped };
}

describe("reading a build archive", () => {
  it("reads the files of `tar -czf - -C dir .`, relative to the archive", async () => {
    const { files } = await read(
      tar([
        { name: "./", type: "5" },
        { name: "./iframe.html", data: "<html></html>" },
        { name: "./assets/", type: "5" },
        { name: "./assets/a.js", data: "export {}" },
        { name: `./${"deep/".repeat(30)}file.txt`, data: "long" },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual(["assets/a.js", `${"deep/".repeat(30)}file.txt`, "iframe.html"]);
    expect(files["iframe.html"]).toBe("<html></html>");
  });

  it("refuses a path that leaves the archive or is absolute", async () => {
    await expect(read(tar([{ name: "../evil.js", data: "x" }]))).rejects.toThrow(TarError);
    await expect(read(tar([{ name: "a/../../evil.js", data: "x" }]))).rejects.toThrow(/leaves/);
    await expect(read(tar([{ name: "/etc/passwd", data: "x" }]))).rejects.toThrow(/absolute/);
    expect(() => cleanPath("a\\..\\b")).toThrow(TarError);
  });

  it("skips links and macOS metadata instead of storing them", async () => {
    const { files, skipped } = await read(
      tar([
        { name: "iframe.html", data: "ok" },
        { name: "link.js", type: "2", link: "/etc/passwd" },
        { name: "hard.js", type: "1", link: "iframe.html" },
        { name: "._iframe.html", data: "junk" },
      ]),
    );
    expect(Object.keys(files)).toEqual(["iframe.html"]);
    expect(skipped).toEqual(["link.js", "hard.js"]);
  });

  it("stops at its limits", async () => {
    const big = tar([{ name: "a.bin", data: Buffer.alloc(2000) }]);
    await expect(read(big, { ...LIMITS, fileBytes: 1000 })).rejects.toThrow(/over/);
    await expect(read(big, { ...LIMITS, totalBytes: 1500 })).rejects.toThrow(/over/);
    const many = tar(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: "x" })));
    await expect(read(many, { ...LIMITS, files: 3 })).rejects.toThrow(/more than 3/);
  });

  it("refuses data hidden in entries that should have none, without buffering it", async () => {
    const h = header("evil", 5_000_000, "Z");
    const archive = gzipSync(Buffer.concat([h, Buffer.alloc(5_000_000), Buffer.alloc(1024)]));
    const started = Date.now();
    await expect(read(archive, { ...LIMITS, totalBytes: 50_000_000 })).rejects.toThrow(/entry with data/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reads a large file in linear time", async () => {
    const archive = tar([{ name: "big.bin", data: Buffer.alloc(30_000_000, 7) }]);
    const started = Date.now();
    const sizes: number[] = [];
    await readTarGz(Readable.from([archive]), { totalBytes: 100_000_000, fileBytes: 40_000_000, files: 10 }, async (f) => {
      sizes.push(f.data.length);
    });
    expect(sizes).toEqual([30_000_000]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("says so when it is not a tar at all", async () => {
    await expect(read(gzipSync(Buffer.from("hello world, not a tar".repeat(40))))).rejects.toThrow(/not a tar/);
    await expect(read(Buffer.from("plain text"))).rejects.toThrow();
  });
});

describe("root-relative references", () => {
  const exists = (p: string) => ["fonts/Rubik[wght].ttf", "avatar.jpg", "img/a b.png"].includes(p);

  it("makes url(/x) in CSS relative to the stylesheet, when x is in the build", () => {
    const css = "@font-face{src:url(/fonts/Rubik[wght].ttf) format('truetype')} a{background:url('/missing.png')} b{background:url(//cdn.test/x.png)}";
    const out = rewriteCss(css, "assets/app.css", exists);
    expect(out.count).toBe(1);
    expect(out.text).toContain("url(../fonts/Rubik[wght].ttf)");
    expect(out.text).toContain("url('/missing.png')");
    expect(out.text).toContain("url(//cdn.test/x.png)");
  });

  it('makes "/x.jpg" in scripts relative to the page, and leaves app routes alone', () => {
    const js = `const a="/avatar.jpg",b='/settings',c=\`/avatar.jpg?w=2\`,d="/nope.jpg",e="/img/a%20b.png";`;
    const out = rewriteJs(js, exists);
    expect(out.text).toBe(`const a="./avatar.jpg",b='/settings',c=\`./avatar.jpg?w=2\`,d="/nope.jpg",e="./img/a%20b.png";`);
    expect(out.count).toBe(3);
  });

  it("does not backtrack on hostile input", () => {
    const started = Date.now();
    rewriteJs('"/' + "a.a?".repeat(200_000), exists);
    rewriteCss("url(/".repeat(200_000), "a.css", exists);
    rewriteHtml(' src="/' + "x".repeat(400_000), "a.html", exists);
    rewriteJs("'/a".repeat(200_000), exists);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("rewrites src and href in HTML", () => {
    const out = rewriteHtml(`<link href="/avatar.jpg"><img src='/avatar.jpg'><a href="/about">`, "iframe.html", exists);
    expect(out.text).toBe(`<link href="./avatar.jpg"><img src='./avatar.jpg'><a href="/about">`);
  });
});

describe("story blocks", () => {
  it("reads an id, args, globals and a size", () => {
    const spec = parseStoryBlock("id: button--primary\nargs: { label: Save now, count: 3, on: true, tone: '#ff0000' }\nwidth: 402px\nheight: 874\ndark: { theme: night }");
    expect(spec).toMatchObject({ id: "button--primary", width: 402, height: 874, args: { label: "Save now", count: 3, on: true } });
    expect(storyQuery(spec, "light")).toBe("id=button--primary&viewMode=story&args=label:Save+now;count:3;on:!true;tone:!hex(ff0000)");
    expect(storyQuery(spec, "dark", { dark: { theme: "dim" }, light: { theme: "day" } })).toContain("globals=theme:night");
    expect(storyQuery(spec, "light", { light: { theme: "day" } })).toContain("globals=theme:day");
  });

  it("takes a bare id or a pasted Storybook link", () => {
    expect(parseStoryBlock("button--primary").id).toBe("button--primary");
    expect(parseStoryBlock("http://localhost:6006/?path=/story/button--primary").id).toBe("button--primary");
    expect(parseStoryBlock("id: http://localhost:6006/iframe.html?id=card--kinds&viewMode=story").id).toBe("card--kinds");
  });

  it("refuses what is not a story", () => {
    expect(() => parseStoryBlock("")).toThrow(StoryBlockError);
    expect(() => parseStoryBlock("id: Button Primary")).toThrow(/not a story id/);
    expect(() => parseStoryBlock("id: a--b\nzoom: 2")).toThrow(/unknown key zoom/);
    expect(() => parseStoryBlock("id: a--b\nargs: [1]")).toThrow(/mapping/);
    expect(() => parseStoryBlock('id: a--b\nstorybook: "../x"')).toThrow(/not a valid name/);
  });

  it("encodes nested args Storybook's way and reports values it would drop", () => {
    const { param, rejected } = encodeValues({ user: { name: "Ana", tags: ["a", "b"] }, nothing: null, text: "Hi, there!" });
    expect(param).toBe("user.name:Ana;user.tags[0]:a;user.tags[1]:b;nothing:!null");
    expect(rejected).toEqual(["args.text"]);
    expect(storyWarnings(parseStoryBlock("id: a--b\nargs: { text: 'Hi, there!' }"))[0]).toMatch(/args.text cannot go in a Storybook link/);
    // Nothing that could break out of the query string gets through.
    expect(encodeValues({ a: "x&globals=evil", b: "y#z", c: "</script>" }).param).toBe("");
  });
});

// --------------------------------------------------------------- service

let dir: string;

function build(extra: Entry[] = [], stories = ["button--primary", "button--secondary", "card--kinds"]): Buffer {
  const index = {
    v: 5,
    entries: Object.fromEntries([
      ...stories.map((id) => [id, { type: "story", id, title: id.split("--")[0], name: id.split("--")[1], importPath: "./x" }]),
      ["button--docs", { type: "docs", id: "button--docs", title: "Button", name: "Docs" }],
    ]),
  };
  return tar([
    { name: "./iframe.html", data: "<!doctype html><html><head><link href=\"/fonts/a.woff2\"></head><body><div id=storybook-root></div></body></html>" },
    { name: "./index.json", data: JSON.stringify(index) },
    { name: "./assets/app.css", data: "@font-face{src:url(/fonts/a.woff2)}" },
    { name: "./fonts/a.woff2", data: "FONT" },
    ...extra,
  ]);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "indy-storybook-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://indy.test";
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function ctx() {
  return (await import("@/lib/service/context")).getContext();
}

async function upload(name: string, archive: Buffer, settings?: Record<string, unknown>) {
  const sb = await import("@/lib/service/storybooks");
  const c = await ctx();
  return sb.receiveUpload(c, { storybook: name, settings: settings ? sb.checkSettings(settings) : null, by: "test", body: Readable.from([archive]), length: archive.length });
}

describe("uploading a build", () => {
  it("stores it, lists its stories and fixes root paths", async () => {
    const sb = await import("@/lib/service/storybooks");
    const c = await ctx();
    const result = await upload("Picaflick", build(), { dark: { theme: "night" }, hosts: ["https://image.tmdb.org"] });
    expect(result.build.stories).toBe(3);
    expect(result.storybook.name).toBe("Picaflick");
    expect(result.storybook.settings).toEqual({ dark: { theme: "night" }, hosts: ["https://image.tmdb.org"] });
    expect(result.notes.join(" ")).toMatch(/2 root-relative references/);
    expect(sb.buildStories(c, result.build.id).map((s) => s.id)).toEqual(["button--primary", "button--secondary", "card--kinds"]);
    const css = sb.buildFile(c, result.build.id, "assets/app.css")!;
    expect(await readFile(css.file, "utf8")).toBe("@font-face{src:url(../fonts/a.woff2)}");
    expect(css.type).toMatch(/text\/css/);
    // Names are matched without regard to case.
    expect(sb.latestBuild(c, "picaflick")!.id).toBe(result.build.id);
    expect(sb.buildFile(c, result.build.id, "../index.json")).toBeNull();
  });

  it("accepts a build tarred from its parent folder", async () => {
    const nested = tar([
      { name: "storybook-static/iframe.html", data: "<html><body></body></html>" },
      { name: "storybook-static/index.json", data: JSON.stringify({ v: 5, entries: { "a--b": { type: "story", id: "a--b", title: "A", name: "B" } } }) },
    ]);
    const result = await upload("nested", nested);
    expect(result.build.stories).toBe(1);
  });

  it("leaves Storybook's own browsing UI out, and removes what a failed upload wrote", async () => {
    const sb = await import("@/lib/service/storybooks");
    const c = await ctx();
    const { build: b, notes } = await upload("manager", build([{ name: "index.html", data: "<html>manager</html>" }, { name: "sb-manager/runtime.js", data: "x" }]));
    expect(sb.buildFile(c, b.id, "index.html")).toBeNull();
    expect(sb.buildFile(c, b.id, "sb-manager/runtime.js")).toBeNull();
    expect(notes.join(" ")).toMatch(/Left out Storybook's own browsing UI \(2 files\)/);

    const blobs = async () => (await readdir(join(dir, "storybooks", "blobs"), { recursive: true })).filter((p) => /[0-9a-f]{64}$/.test(p)).length;
    const before = await blobs();
    await expect(upload("broken", tar([{ name: "only-here.txt", data: "UNIQUE-" + Date.now() }, { name: "index.json", data: "{}" }]))).rejects.toThrow(/iframe.html/);
    expect(await blobs()).toBe(before);
  });

  it("refuses an archive that is not a Storybook build", async () => {
    await expect(upload("x", tar([{ name: "index.html", data: "hi" }]))).rejects.toThrow(/no iframe.html/);
    await expect(upload("x", tar([{ name: "iframe.html", data: "hi" }]))).rejects.toThrow(/no index.json/);
    await expect(upload("x", tar([{ name: "iframe.html", data: "hi" }, { name: "index.json", data: "{" }]))).rejects.toThrow(/not valid JSON/);
    await expect(upload("../x", build())).rejects.toThrow(/Storybook name/);
    await expect(upload("x", Buffer.from("nope"))).rejects.toThrow(/gzipped tar/);
  });

  it("refuses settings that could reach anywhere", async () => {
    // Wildcards would let any subdomain in; name each host.
    const sb = await import("@/lib/service/storybooks");
    expect(() => sb.checkSettings({ hosts: ["http://plain.test"] })).toThrow(/https origin/);
    expect(() => sb.checkSettings({ hosts: ["https://a.test/path"] })).toThrow(/https origin/);
    expect(() => sb.checkSettings({ hosts: ["https://*"] })).toThrow(/https origin/);
    expect(() => sb.checkSettings({ hosts: ["https://a.test; script-src *"] })).toThrow(/https origin/);
    expect(() => sb.checkSettings({ hosts: ["https://*.tmdb.org"] })).toThrow(/https origin/);
    expect(sb.checkSettings({ hosts: ["https://image.tmdb.org/", "HTTPS://Image.TMDB.org"] }).hosts).toEqual(["https://image.tmdb.org"]);
  });

  it("gives out an upload address that works once and expires", async () => {
    const sb = await import("@/lib/service/storybooks");
    const c = await ctx();
    const { url } = sb.createUpload(c, { storybook: "once", by: "test" });
    expect(url).toMatch(/^http:\/\/indy\.test\/api\/storybooks\/uploads\/[\w-]+$/);
    const token = url.split("/").pop()!;
    expect(sb.claimUpload(c, token).storybook).toBe("once");
    expect(() => sb.claimUpload(c, token)).toThrow(/expired or was already used/);
    expect(() => sb.claimUpload(c, "made-up")).toThrow(/expired/);
    const late = sb.createUpload(c, { storybook: "late", by: "test" }).url.split("/").pop()!;
    c.db.prepare("UPDATE storybook_uploads SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
    expect(() => sb.claimUpload(c, late)).toThrow(/expired/);
  });

  it("keeps the newest builds and any a page points at, and sweeps unused files", async () => {
    const sb = await import("@/lib/service/storybooks");
    const { publishArtifact } = await import("@/lib/service/artifacts");
    const c = await ctx();
    const first = await upload("prune", build([{ name: "only-in-first.txt", data: "FIRST" }]));
    await publishArtifact(c, { slug: "pins-first", title: "Pins", project: "prune", source: "```story\nid: button--primary\n```" });
    for (let i = 0; i < 4; i++) await upload("prune", build([{ name: `n${i}.txt`, data: `N${i}` }]));
    const ids = sb.listBuilds(c, "prune").map((b) => b.id);
    expect(ids.length).toBe(4); // three newest and the pinned one
    expect(ids).toContain(first.build.id);

    // Unpinned and old: its own file goes once nothing uses it.
    const file = sb.buildFile(c, first.build.id, "only-in-first.txt")!.file;
    c.db.prepare("UPDATE versions SET storybooks_json = '{}'").run();
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(file, old, old);
    await sb.pruneBuilds(c, "prune");
    expect(sb.getBuild(c, first.build.id)).toBeNull();
    await expect(readFile(file)).rejects.toThrow();
  });

  it("deletes a Storybook with its builds", async () => {
    const sb = await import("@/lib/service/storybooks");
    const c = await ctx();
    const { build: b } = await upload("gone", build([{ name: "gone.txt", data: "GONE-ONLY" }]));
    const file = sb.buildFile(c, b.id, "gone.txt")!.file;
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(file, old, old);
    await sb.deleteStorybook(c, "GONE");
    expect(sb.findStorybook(c, "gone")).toBeNull();
    expect(sb.buildFile(c, b.id, "iframe.html")).toBeNull();
    await expect(readFile(file)).rejects.toThrow();
    expect((await readdir(join(dir, "storybooks", "blobs"))).length).toBeGreaterThan(0);
  });
});

describe("pages that show stories", () => {
  it("pins the build an agent wrote against and warns about stories that will not draw", async () => {
    const sb = await import("@/lib/service/storybooks");
    const { publishArtifact, updateArtifact, createHumanVersion, requireArtifact, requireVersion } = await import("@/lib/service/artifacts");
    const c = await ctx();
    const one = await upload("design", build());
    const source = [
      "---",
      "title: Review",
      "project: design",
      "---",
      "",
      "```story",
      "id: button--primary",
      "```",
      "",
      "```story",
      "id: button--primray",
      "```",
      "",
      "```story",
      "id: card--kinds",
      "storybook: nothing-here",
      "```",
    ].join("\n");
    const published = await publishArtifact(c, { slug: "review", source });
    const messages = published.warnings.map((w) => w.message).join("\n");
    expect(messages).toMatch(/no story "button--primray"; similar: button--primary/);
    expect(messages).toMatch(/no Storybook named "nothing-here"/);
    expect(published.warnings.find((w) => /primray/.test(w.message))!.line).toBe(10);
    const artifact = requireArtifact(c, "review");
    expect(requireVersion(c, artifact, 1).storybooks).toEqual({ design: one.build.id });

    // A new build: the agent's next version takes it, a person's edit does not.
    const two = await upload("design", build());
    await createHumanVersion(c, "review", { source: source.replace("Review", "Review!"), expectedVersion: 1 } as never);
    expect(requireVersion(c, requireArtifact(c, "review"), 2).storybooks).toEqual({ design: one.build.id });
    await updateArtifact(c, "review", { source, expectedVersion: 2 });
    expect(requireVersion(c, requireArtifact(c, "review"), 3).storybooks).toEqual({ design: two.build.id });
    expect(sb.buildForVersion(c, { design: "gone" }, "design")!.id).toBe(two.build.id);
  });

  it("renders a story fence as a frame with its size, and a bad one as an error", async () => {
    const { renderMarkdown } = await import("@/lib/pipeline/index");
    const out = renderMarkdown("```story\nid: card--kinds\nwidth: 402\nheight: 874\n```\n\n```story\nnot a story\n```\n\n```html\n<b>x</b>\n```");
    expect(out.html).toContain('data-embed="e0" data-kind="story" data-width="402" data-height="874" data-title="card--kinds">');
    expect(out.html).toMatch(/<art-error[^>]*>story block must be a YAML mapping/);
    // The bad block still takes a number, so the html block is e2 here and in the editor.
    expect(out.embeds.map((e) => `${e.id}:${e.kind}`)).toEqual(["e0:story", "e2:html"]);
    const { markdownToDoc } = await import("@/lib/doc/parse");
    const doc = markdownToDoc("```story\nid: card--kinds\n```\n\n```story\nnot a story\n```\n\n```html\n<b>x</b>\n```");
    expect(doc.content!.map((n) => n.attrs?.embedId)).toEqual(["e0", "e1", "e2"]);
  });
});

describe("compact layouts", () => {
  it("keeps columns side by side on a phone when asked, and writes the switch back as it was", async () => {
    const { renderMarkdown } = await import("@/lib/pipeline/index");
    const { markdownToDoc } = await import("@/lib/doc/parse");
    const { docToMarkdown } = await import("@/lib/doc/serialize");
    const source = ":::columns{n=2 compact}\n::::col\nA\n::::\n::::col\nB\n::::\n:::";
    expect(renderMarkdown(source).html).toContain('<art-columns n="2" compact="true"');
    expect(renderMarkdown(source.replace(" compact", "")).html).not.toContain("compact");
    expect(renderMarkdown(source.replace("compact", 'compact="false"')).html).not.toContain("compact");
    const doc = markdownToDoc(source);
    expect(doc.content![0].attrs!.attributes).toMatchObject({ n: "2", compact: "" });
    expect(docToMarkdown(doc)).toBe(source);
  });
});

describe("serving a story", () => {
  it("sends the page frame on to the build, with a capability for that build only", async () => {
    const { GET } = await import("@/app/embed/[cap]/[slug]/[version]/[block]/route");
    const { capability } = await import("@/lib/auth/accounts");
    const { publishArtifact } = await import("@/lib/service/artifacts");
    const c = await ctx();
    await upload("frames", build(), { dark: { theme: "night" } });
    await publishArtifact(c, {
      slug: "frames",
      title: "Frames",
      project: "frames",
      source: "```story\nid: button--primary\nargs: { label: Go }\n```\n\n```story\nid: button--nope\n```\n\n```story\nid: a--b\nstorybook: absent\n```",
    });
    const cap = capability(c, "frames", 1);
    const get = (block: string, scheme = "light") =>
      GET(new Request(`http://indy.test/embed/${cap}/frames/1/${block}?scheme=${scheme}`), {
        params: Promise.resolve({ cap, slug: "frames", version: "1", block }),
      });

    const ok = await get("e0", "dark");
    expect(ok.status).toBe(302);
    const location = ok.headers.get("location")!;
    expect(location).toMatch(/^\/sb\/\d+\.[\w-]+\/[\w-]+\/iframe\.html\?id=button--primary&viewMode=story&args=label:Go&globals=theme:night$/);

    const missing = await get("e1");
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("has no story");
    expect(await (await get("e2")).text()).toContain("No Storybook named");
  });

  it("serves the build's files under a sandbox, and nothing without its capability", async () => {
    const { GET } = await import("@/app/sb/[cap]/[build]/[...path]/route");
    const { storybookCapability } = await import("@/lib/auth/accounts");
    const c = await ctx();
    const { build: b } = await upload("served", build([{ name: "icon.svg", data: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" }, { name: "assets/big.js", data: "export const x = 1;\n".repeat(400) }]), {
      hosts: ["https://image.tmdb.org"],
    });
    const cap = storybookCapability(c, b.id);
    const get = (path: string, token = cap, id = b.id, headers: Record<string, string> = {}) =>
      GET(new Request(`http://indy.test/sb/${token}/${id}/${path}`, { headers }), {
        params: Promise.resolve({ cap: token, build: id, path: path.split("/") }),
      });

    const page = await get("iframe.html", cap, b.id, { "x-forwarded-proto": "https", "x-forwarded-host": "indy.test" });
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts allow-forms");
    expect(csp).toContain(`connect-src https://indy.test/sb/${cap}/${b.id}/`);
    expect(csp).toContain("img-src https://indy.test/sb/");
    expect(csp).toContain("https://image.tmdb.org");
    expect(csp).not.toMatch(/script-src[^;]*tmdb/);
    expect(csp).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('<script src="/embed-bridge.js"></script>\n</body>');
    expect(html).toContain("overscroll-behavior:auto");
    expect(html).toContain('href="./fonts/a.woff2"');
    expect(page.headers.get("access-control-allow-origin")).toBe("*");

    // A Host header Indy does not know cannot put its own origin in the policy.
    const forged = await get("iframe.html", cap, b.id, { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" });
    expect(forged.headers.get("content-security-policy")).not.toContain("evil.example");
    expect(forged.headers.get("content-security-policy")).toContain(`connect-src http://indy.test/sb/`);
    const local = await get("iframe.html", cap, b.id, { "x-forwarded-proto": "http", host: "127.0.0.1:5178" });
    expect(local.headers.get("content-security-policy")).toContain("connect-src http://127.0.0.1:5178/sb/");
    const six = await get("iframe.html", cap, b.id, { "x-forwarded-proto": "http", host: "[::1]:5178" });
    expect(six.headers.get("content-security-policy")).toContain("connect-src http://[::1]:5178/sb/");

    // Text goes out compressed, as the browser asks.
    const css = await get("assets/app.css", cap, b.id, { "accept-encoding": "gzip, deflate, br" });
    const plain = await get("assets/app.css", cap, b.id);
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toContain("../fonts/a.woff2");
    const big = await get("assets/big.js", cap, b.id, { "accept-encoding": "gzip" });
    expect(big.headers.get("content-encoding")).toBe("gzip");
    expect(Number(big.headers.get("content-length"))).toBeLessThan(400);
    const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
    expect(gunzipSync(Buffer.from(await big.arrayBuffer())).toString()).toBe("export const x = 1;\n".repeat(400));
    const br = await get("assets/big.js", cap, b.id, { "accept-encoding": "gzip, br" });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).length).toBe(8000);
    expect((await get("assets/big.js", cap, b.id, { "accept-encoding": "br;q=0, gzip" })).headers.get("content-encoding")).toBe("gzip");
    expect(css.headers.get("vary")).toContain("Accept-Encoding");

    const svg = await get("icon.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");

    expect((await get("iframe.html", "1.forged")).status).toBe(403);
    const other = await upload("other", build());
    expect((await get("iframe.html", cap, other.build.id)).status).toBe(403);
    expect((await get("../index.json")).status).toBe(404);
    expect((await get("nothing.js")).status).toBe(404);
    expect((await get("fonts/a.woff2")).headers.get("cache-control")).toContain("immutable");
  });
});
