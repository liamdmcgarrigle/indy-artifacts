import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceContext } from "@/lib/service/context";

let dir: string;
let ctx: ServiceContext;
let lib: typeof import("@/lib/service/library");
let svc: typeof import("@/lib/service/artifacts");
let comments: typeof import("@/lib/service/comments");

const page = (title: string, extra = "") => `---\ntitle: ${title}\n---\n\n${extra || "Some words."}\n`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "indy-library-"));
  const { makeContext } = await import("@/lib/service/context");
  ctx = makeContext({ dataDir: dir });
  lib = await import("@/lib/service/library");
  svc = await import("@/lib/service/artifacts");
  comments = await import("@/lib/service/comments");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the shape of a page", () => {
  it("reads headings, counters, charts and forms off the markdown", () => {
    const md = "---\ntitle: x\n---\n# Title\n\n:::kpis\n- A: 1\n:::\n\n```chart\ntype: bar\n```\n\n::field{name=a type=text}\n";
    expect(lib.shapeOf("markdown", md)).toEqual(["heading", "kpis", "chart", "form"]);
    expect(lib.shapeOf("react", null)).toEqual(["app"]);
  });
});

describe("needs you", () => {
  it("lists a new page, then drops it once seen", async () => {
    await svc.publishArtifact(ctx, { slug: "fresh-one", source: page("Fresh"), agent: { name: "claude" } });
    const row = lib.needsYou(ctx).find((r) => r.slug === "fresh-one");
    expect(row?.reason).toMatchObject({ kind: "new", who: "claude", version: 1 });
    lib.markSeen(ctx, "fresh-one");
    expect(lib.needsYou(ctx).find((r) => r.slug === "fresh-one")).toBeUndefined();
  });

  it("puts an agent reply ahead of unsent comments", async () => {
    await svc.publishArtifact(ctx, { slug: "talked-about", source: page("Talked about") });
    lib.markSeen(ctx, "talked-about");
    // Looked at a moment ago, so a reply in the same millisecond still counts as after.
    ctx.db.prepare("UPDATE artifacts SET seen_at = '2020-01-01T00:00:00Z' WHERE slug = 'talked-about'").run();
    const root = comments.createComment(ctx, "talked-about", { body: "why?", authorName: "liam", notify: true });
    comments.createComment(ctx, "talked-about", { body: "because", authorName: "claude", authorKind: "agent", parentId: root.id });
    await svc.publishArtifact(ctx, { slug: "draft-notes", source: page("Draft notes") });
    lib.markSeen(ctx, "draft-notes");
    comments.createComment(ctx, "draft-notes", { body: "not sent", authorName: "liam" });

    const rows = lib.needsYou(ctx);
    const reply = rows.findIndex((r) => r.slug === "talked-about");
    const unsent = rows.findIndex((r) => r.slug === "draft-notes");
    expect(rows[reply].reason).toMatchObject({ kind: "reply", who: "claude" });
    expect(rows[unsent].reason).toMatchObject({ kind: "unsent", count: 1 });
    expect(reply).toBeLessThan(unsent);
  });

  it("folds new runs of a series into the newest one", async () => {
    for (const day of ["01", "02", "03"]) {
      await svc.publishArtifact(ctx, { source: page(`Run ${day}`), series: "Nightly", agent: { name: "claude" } });
    }
    const runs = lib.needsYou(ctx).filter((r) => r.series === "Nightly");
    expect(runs).toHaveLength(1);
    expect(runs[0].title).toBe("Run 03");
    expect(runs[0].seriesCount).toBe(3);
    expect(lib.listLibrary(ctx, { view: "recent" }).filter((r) => r.series === "Nightly")).toHaveLength(1);
    expect(lib.listLibrary(ctx, { view: "series", name: "Nightly" })).toHaveLength(3);
  });
});

describe("organising", () => {
  it("pins, archives, and brings a page back when a new version lands", async () => {
    await svc.publishArtifact(ctx, { slug: "keep-me", source: page("Keep me") });
    lib.setOrganisation(ctx, "keep-me", { pinned: true, archived: true, project: "  picaflick  " });
    expect(lib.listLibrary(ctx, { view: "pinned" }).map((r) => r.slug)).toContain("keep-me");
    expect(lib.listLibrary(ctx, { view: "archive" }).map((r) => r.slug)).toContain("keep-me");
    expect(lib.listLibrary(ctx, { view: "project", name: "picaflick" }).map((r) => r.slug)).toContain("keep-me");

    await svc.updateArtifact(ctx, "keep-me", { source: page("Keep me", "More."), expectedVersion: 1 });
    expect(lib.listLibrary(ctx, { view: "archive" }).map((r) => r.slug)).not.toContain("keep-me");
  });

  it("archives idle pages, but not pinned ones or ones with an open thread", async () => {
    await svc.publishArtifact(ctx, { slug: "idle-page", source: page("Idle") });
    await svc.publishArtifact(ctx, { slug: "idle-pinned", source: page("Idle pinned") });
    await svc.publishArtifact(ctx, { slug: "idle-discussed", source: page("Idle discussed") });
    lib.setOrganisation(ctx, "idle-pinned", { pinned: true });
    comments.createComment(ctx, "idle-discussed", { body: "open question", authorName: "liam" });
    ctx.db.prepare("UPDATE artifacts SET updated_at = '2020-01-01T00:00:00Z' WHERE slug LIKE 'idle-%'").run();

    lib.sweepArchive(ctx, true);
    const archived = lib.listLibrary(ctx, { view: "archive" }).map((r) => r.slug);
    expect(archived).toContain("idle-page");
    expect(archived).not.toContain("idle-pinned");
    expect(archived).not.toContain("idle-discussed");
  });
});

describe("branches", () => {
  it("records the branch a page was published from, and filters a project by it", async () => {
    await svc.publishArtifact(ctx, { slug: "on-main", source: page("On main"), project: "branchy", branch: "main" });
    await svc.publishArtifact(ctx, { slug: "on-feature", source: page("On a feature"), project: "branchy", branch: "feat/share" });
    await svc.publishArtifact(ctx, { slug: "no-branch", source: page("Nowhere"), project: "branchy" });

    expect(lib.listLibrary(ctx, { view: "project", name: "branchy", branch: "feat/share" }).map((r) => r.slug)).toEqual(["on-feature"]);
    expect(lib.listLibrary(ctx, { view: "project", name: "branchy" })).toHaveLength(3);
    expect(lib.branchesOf(ctx, "branchy").map((b) => b.name)).toEqual(["main", "feat/share"]);

    // An update without a branch keeps it; one from another branch moves the page there.
    await svc.updateArtifact(ctx, "on-feature", { source: page("On a feature", "More."), expectedVersion: 1 });
    expect(svc.requireArtifact(ctx, "on-feature").branch).toBe("feat/share");
    await svc.updateArtifact(ctx, "on-feature", { source: page("On a feature", "Merged."), expectedVersion: 2, branch: "main" });
    expect(svc.requireArtifact(ctx, "on-feature").branch).toBe("main");
  });
});

describe("search", () => {
  it("finds words in titles and in the text, without the markdown around them", async () => {
    await svc.publishArtifact(ctx, {
      slug: "scanner-report",
      source: page("Office scans", ':::callout{tone=warn title="Needs a look"}\nThe document set picked up 2,100 new scans.\n:::'),
    });
    expect(lib.search(ctx, "look").hits.map((h) => h.slug)).toContain("scanner-report");
    const found = lib.search(ctx, "scan");
    expect(found.pages.map((p) => p.slug)).toContain("scanner-report");
    const hit = found.hits.find((h) => h.slug === "scanner-report");
    expect(hit?.snippet).toContain(`${lib.MARK_OPEN}scans${lib.MARK_CLOSE}`);
    expect(hit?.snippet).not.toContain(":::");
    expect(hit?.snippet).not.toContain("warn");
  });

  it("narrows to a project and ignores punctuation that would break the query", () => {
    expect(lib.search(ctx, 'scan" OR *', { project: "nope" })).toEqual({ pages: [], hits: [] });
    expect(lib.ftsQuery("  ")).toBeNull();
    expect(lib.ftsQuery('a "b" c-d')).toBe('"a"* "b"* "c"* "d"*');
  });
});
