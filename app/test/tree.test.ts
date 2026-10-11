import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import { createHumanVersion, publishArtifact, requireArtifact, updateArtifact } from "@/lib/service/artifacts";
import { ancestorsOf, childrenOf, placePage, treeOf } from "@/lib/service/tree";
import { publishTree } from "@/lib/service/publish-tree";
import { listLibrary, needsYou, search, setOrganisation, sidebarCounts, sweepArchive } from "@/lib/service/library";
import { ConflictError, ValidationError } from "@/lib/service/errors";
import { resolveShare, setSharing, sharedPage } from "@/lib/service/sharing";

let dir: string;
let ctx: ServiceContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-tree-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://agentbox:5174", assetRoots: [dir] });
});
afterEach(async () => {
  ctx.db.close();
  await rm(dir, { recursive: true, force: true });
});

const md = (title: string, extra = "", body = "Hello.") => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const slugs = (s: string) => treeOf(ctx, requireArtifact(ctx, s))?.nodes.map((n) => `${"  ".repeat(n.depth)}${n.slug}`) ?? [];

describe("placing pages", () => {
  it("puts a page under another by argument, in order, and inherits the project", async () => {
    await publishArtifact(ctx, { slug: "course", source: md("Course"), project: "school" });
    await publishArtifact(ctx, { slug: "mod1", source: md("Module 1"), parent: "course" });
    await publishArtifact(ctx, { slug: "mod2", source: md("Module 2"), parent: "course" });
    await publishArtifact(ctx, { slug: "mod0", source: md("Intro"), parent: "course", position: 0 });
    expect(slugs("mod1")).toEqual(["course", "  mod0", "  mod1", "  mod2"]);
    expect(requireArtifact(ctx, "mod1").project).toBe("school");
    expect(ancestorsOf(ctx, requireArtifact(ctx, "mod1")).map((a) => a.slug)).toEqual(["course"]);
  });

  it("reads parent, position and group from frontmatter", async () => {
    await publishArtifact(ctx, { slug: "report", source: md("Report") });
    await publishArtifact(ctx, { slug: "notes", source: md("Notes", "parent: report\ngroup: For authors\n") });
    await publishArtifact(ctx, { slug: "summary", source: md("Summary", "parent: report\n") });
    // Ungrouped pages come before groups, whatever their positions.
    expect(childrenOf(ctx, requireArtifact(ctx, "report")).map((n) => [n.slug, n.group])).toEqual([
      ["summary", null],
      ["notes", "For authors"],
    ]);
  });

  it("does not move a page back when an update leaves its frontmatter alone", async () => {
    await publishArtifact(ctx, { slug: "a-top", source: md("A") });
    await publishArtifact(ctx, { slug: "b-top", source: md("B") });
    await publishArtifact(ctx, { slug: "kid", source: md("Kid", "parent: a-top\n") });
    placePage(ctx, requireArtifact(ctx, "kid"), { parent: "b-top" });
    await updateArtifact(ctx, "kid", { expectedVersion: 1, source: md("Kid", "parent: a-top\n", "Changed.") });
    expect(ancestorsOf(ctx, requireArtifact(ctx, "kid"))[0].slug).toBe("b-top");
    // A person's edit that changes the line does move it.
    await createHumanVersion(ctx, "kid", { expectedVersion: 2, authorName: "Liam", source: md("Kid", "parent: a-top\nposition: 0\n", "Changed.") });
    expect(requireArtifact(ctx, "kid").parentId).toBe(requireArtifact(ctx, "b-top").id);
  });

  it("refuses loops, missing parents and trees deeper than three levels", async () => {
    await publishArtifact(ctx, { slug: "lvl0", source: md("L0") });
    await publishArtifact(ctx, { slug: "lvl1", source: md("L1"), parent: "lvl0" });
    await publishArtifact(ctx, { slug: "lvl2", source: md("L2"), parent: "lvl1" });
    await publishArtifact(ctx, { slug: "lvl3", source: md("L3"), parent: "lvl2" });
    await expect(publishArtifact(ctx, { slug: "lvl4", source: md("L4"), parent: "lvl3" })).rejects.toThrow(/at most 3 levels/);
    expect(() => placePage(ctx, requireArtifact(ctx, "lvl0"), { parent: "lvl2" })).toThrow(ValidationError);
    expect(() => placePage(ctx, requireArtifact(ctx, "lvl1"), { parent: "lvl1" })).toThrow(/under itself/);
    await expect(publishArtifact(ctx, { slug: "lost", source: md("Lost"), parent: "nowhere" })).rejects.toThrow(/no page/);
    // A refused publish leaves no page behind.
    expect(() => requireArtifact(ctx, "lvl4")).toThrow();
    // Moving a page with subpages counts their levels too.
    await publishArtifact(ctx, { slug: "other", source: md("Other") });
    await publishArtifact(ctx, { slug: "oth1", source: md("O1"), parent: "other" });
    expect(() => placePage(ctx, requireArtifact(ctx, "other"), { parent: "lvl2" })).toThrow(/at most 3 levels/);
  });

  it("takes a page out of its tree with a null parent", async () => {
    await publishArtifact(ctx, { slug: "top", source: md("Top") });
    await publishArtifact(ctx, { slug: "sub", source: md("Sub"), parent: "top" });
    placePage(ctx, requireArtifact(ctx, "sub"), { parent: null });
    expect(treeOf(ctx, requireArtifact(ctx, "top"))).toBeNull();
  });

  it("reorders siblings", async () => {
    await publishArtifact(ctx, { slug: "top", source: md("Top") });
    for (const s of ["one", "two", "three"]) await publishArtifact(ctx, { slug: s, source: md(s), parent: "top" });
    placePage(ctx, requireArtifact(ctx, "three"), { position: 0 });
    expect(slugs("top")).toEqual(["top", "  three", "  one", "  two"]);
    placePage(ctx, requireArtifact(ctx, "three"), { position: 2 });
    expect(slugs("top")).toEqual(["top", "  one", "  two", "  three"]);
  });
});

describe("publishing a tree", () => {
  const course = (body = "Lesson.") => [
    { slug: "course", source: md("Course") },
    { slug: "mod-1", parent: "course", source: md("Module 1") },
    { slug: "les-1-1", parent: "mod-1", source: md("Lesson 1.1", "", body) },
    { slug: "les-1-2", parent: "mod-1", source: md("Lesson 1.2") },
    { slug: "mod-2", parent: "course", source: md("Module 2") },
    { slug: "plan", parent: "course", group: "For authors", source: md("Plan") },
  ];

  it("writes parents first and keeps siblings in the order given", async () => {
    // Children listed before their parent still land under it.
    const pages = course();
    const results = await publishTree(ctx, { pages: [pages[2], ...pages.filter((_, i) => i !== 2)], shared: { project: "school" } });
    expect(results.every((r) => r.action === "created")).toBe(true);
    expect(slugs("course")).toEqual(["course", "  mod-1", "    les-1-1", "    les-1-2", "  mod-2", "  plan"]);
    expect(requireArtifact(ctx, "les-1-2").project).toBe("school");
  });

  it("leaves unchanged pages at their version and updates the rest", async () => {
    await publishTree(ctx, { pages: course() });
    const again = await publishTree(ctx, { pages: course("Lesson, rewritten.") });
    expect(again.find((r) => r.slug === "les-1-1")).toMatchObject({ action: "updated", version: 2 });
    expect(again.filter((r) => r.action === "unchanged")).toHaveLength(5);
  });

  it("writes nothing when a person edited a page the call does not name a version for", async () => {
    await publishTree(ctx, { pages: course() });
    await createHumanVersion(ctx, "les-1-2", { expectedVersion: 1, authorName: "Liam", source: md("Lesson 1.2", "", "Mine.") });
    await expect(publishTree(ctx, { pages: course("New.") })).rejects.toThrow(ConflictError);
    expect(requireArtifact(ctx, "les-1-1").currentVersion).toBe(1);
    const pages = course("New.").map((p) => (p.slug === "les-1-2" ? { ...p, expectedVersion: 2 } : p));
    await publishTree(ctx, { pages });
    expect(requireArtifact(ctx, "les-1-2").currentVersion).toBe(3);
  });

  it("checks depth, loops and missing parents before writing anything", async () => {
    await expect(
      publishTree(ctx, {
        pages: [
          { slug: "aa-1", source: md("A") },
          { slug: "bb-1", parent: "aa-1", source: md("B") },
          { slug: "cc-1", parent: "bb-1", source: md("C") },
          { slug: "dd-1", parent: "cc-1", source: md("D") },
          { slug: "ee-1", parent: "dd-1", source: md("E") },
        ],
      }),
    ).rejects.toThrow(/at most 3/);
    await expect(
      publishTree(ctx, { pages: [{ slug: "xx-1", parent: "yy-1", source: md("X") }, { slug: "yy-1", parent: "xx-1", source: md("Y") }] }),
    ).rejects.toThrow(/loop/);
    await expect(publishTree(ctx, { pages: [{ slug: "zz-1", parent: "gone", source: md("Z") }] })).rejects.toThrow(/neither/);
    expect(() => requireArtifact(ctx, "aa-1")).toThrow();
  });
});

describe("publishing part of a tree", () => {
  const base = [
    { slug: "unit", source: md("Unit") },
    { slug: "les-a", parent: "unit", source: md("A") },
    { slug: "les-b", parent: "unit", source: md("B") },
    { slug: "les-c", parent: "unit", source: md("C") },
  ];
  const order = () => childrenOf(ctx, requireArtifact(ctx, "unit")).map((n) => n.slug);

  it("leaves the order alone when one page is sent again, and puts a new one at the end", async () => {
    await publishTree(ctx, { pages: base });
    await publishTree(ctx, { pages: [{ slug: "les-c", parent: "unit", source: md("C", "", "Fixed.") }] });
    expect(order()).toEqual(["les-a", "les-b", "les-c"]);
    await publishTree(ctx, { pages: [{ slug: "les-d", parent: "unit", source: md("D") }] });
    expect(order()).toEqual(["les-a", "les-b", "les-c", "les-d"]);
    // Sending every page under a parent sets their order.
    await publishTree(ctx, { pages: ["les-d", "les-c", "les-b", "les-a"].map((slug) => ({ slug, parent: "unit" })) });
    expect(order()).toEqual(["les-d", "les-c", "les-b", "les-a"]);
  });

  it("counts pages already under a moved page towards the depth, and writes nothing", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "deep-1", source: md("One") },
        { slug: "deep-2", parent: "deep-1", source: md("Two") },
        { slug: "deep-3", parent: "deep-2", source: md("Three") },
      ],
    });
    await expect(
      publishTree(ctx, {
        pages: [
          { slug: "new-top", source: md("New") },
          { slug: "new-mid", parent: "new-top", source: md("Mid") },
          { slug: "deep-1", parent: "new-mid" },
        ],
      }),
    ).rejects.toThrow(/at most 3/);
    expect(() => requireArtifact(ctx, "new-top")).toThrow();
    // A loop through pages already published is caught too.
    await expect(publishTree(ctx, { pages: [{ slug: "deep-1", parent: "deep-3" }] })).rejects.toThrow(/loop/);
  });

  it("checks every page's content before writing any", async () => {
    await expect(
      publishTree(ctx, { pages: [{ slug: "ok-page", source: md("Fine") }, { slug: "bad-page", kind: "html", source: "" }] }),
    ).rejects.toThrow(/bad-page/);
    expect(() => requireArtifact(ctx, "ok-page")).toThrow();
  });

  it("gives a page a new version when only its details change", async () => {
    await publishTree(ctx, { pages: base });
    const again = await publishTree(ctx, { pages: [{ slug: "unit", series: "term-1" }] });
    expect(again[0]).toMatchObject({ action: "updated", version: 2 });
  });

  it("keeps a tree in one project, its top page's", async () => {
    await publishTree(ctx, { pages: base, shared: { project: "school" } });
    await publishArtifact(ctx, { slug: "other", source: md("Other"), project: "work" });
    placePage(ctx, requireArtifact(ctx, "other"), { parent: "unit" });
    expect(requireArtifact(ctx, "other").project).toBe("school");
    setOrganisation(ctx, "les-a", { project: "college" });
    expect(["unit", "les-b", "other"].map((s) => requireArtifact(ctx, s).project)).toEqual(["college", "college", "college"]);
  });
});

describe("archived pages in a live tree", () => {
  it("brings back the pages above a subpage that gets a new version", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "top-x", source: md("Top") },
        { slug: "mid-x", parent: "top-x", source: md("Mid") },
        { slug: "leaf-x", parent: "mid-x", source: md("Leaf") },
      ],
    });
    setOrganisation(ctx, "mid-x", { archived: true });
    await updateArtifact(ctx, "leaf-x", { expectedVersion: 1, source: md("Leaf", "", "Again.") });
    expect(requireArtifact(ctx, "mid-x").archivedAt).toBeNull();
    expect(slugs("top-x")).toEqual(["top-x", "  mid-x", "    leaf-x"]);
  });

  it("does not open a page under an archived page through a link", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "top-y", source: md("Top") },
        { slug: "mid-y", parent: "top-y", source: md("Mid") },
        { slug: "leaf-y", parent: "mid-y", source: md("Leaf") },
      ],
    });
    const link = setSharing(ctx, "top-y", { mode: "link" })!;
    setOrganisation(ctx, "mid-y", { archived: true });
    ctx.db.prepare("UPDATE artifacts SET archived_at = NULL WHERE slug = 'leaf-y'").run();
    expect(() => sharedPage(ctx, resolveShare(ctx, link.token), "leaf-y")).toThrow(/does not open/);
  });
});

describe("agents and share links", () => {
  it("will not let an agent move a page under a shared page, but lets it add one", async () => {
    await publishArtifact(ctx, { slug: "public", source: md("Public") });
    await publishArtifact(ctx, { slug: "private", source: md("Private") });
    setSharing(ctx, "public", { mode: "link" });
    await expect(updateArtifact(ctx, "private", { expectedVersion: 1, parent: "public" })).rejects.toThrow(/make the page public/);
    await expect(publishTree(ctx, { pages: [{ slug: "private", parent: "public" }] })).rejects.toThrow(/make the page public/);
    await publishArtifact(ctx, { slug: "added", source: md("Added"), parent: "public" });
    expect(requireArtifact(ctx, "private").parentId).toBeNull();
  });
});

describe("the library", () => {
  it("lists a tree as its top page, with a count of what is under it", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
        { slug: "les-1", parent: "mod-1", source: md("Lesson 1") },
      ],
      shared: { project: "school" },
    });
    await publishArtifact(ctx, { slug: "loose", source: md("Loose"), project: "school" });
    for (const view of [{ view: "recent" as const }, { view: "project" as const, name: "school" }]) {
      const rows = listLibrary(ctx, view);
      expect(rows.map((r) => r.slug).sort()).toEqual(["course", "loose"]);
      expect(rows.find((r) => r.slug === "course")).toMatchObject({ subpages: 2, subpagesUnseen: 2 });
    }
    expect(sidebarCounts(ctx).recent).toBe(2);
    expect(sidebarCounts(ctx).projects[0]).toMatchObject({ name: "school", count: 2 });
  });

  it("folds new versions across a tree into one row needing you", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
        { slug: "mod-2", parent: "course", source: md("Module 2") },
      ],
    });
    const rows = needsYou(ctx).filter((r) => r.reason.kind === "new");
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toMatchObject({ kind: "new", pages: 3 });
  });

  it("archives and restores a tree together, and a new version brings it back", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
      ],
    });
    setOrganisation(ctx, "course", { archived: true });
    expect(requireArtifact(ctx, "mod-1").archivedAt).not.toBeNull();
    expect(listLibrary(ctx, { view: "archive" }).map((r) => r.slug)).toEqual(["course"]);
    await updateArtifact(ctx, "mod-1", { expectedVersion: 1, source: md("Module 1", "", "Again.") });
    expect(requireArtifact(ctx, "course").archivedAt).toBeNull();
  });

  it("archives idle trees as one, and leaves a tree alone while any page in it is busy", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
      ],
    });
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    ctx.db.prepare("UPDATE artifacts SET updated_at = ? WHERE slug = 'course'").run(old);
    expect(sweepArchive(ctx, true)).toBe(0);
    ctx.db.prepare("UPDATE artifacts SET updated_at = ?").run(old);
    expect(sweepArchive(ctx, true)).toBe(1);
    expect(requireArtifact(ctx, "mod-1").archivedAt).not.toBeNull();
  });

  it("drops an archived subpage from the way through", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
        { slug: "mod-2", parent: "course", source: md("Module 2") },
      ],
    });
    setOrganisation(ctx, "mod-2", { archived: true });
    expect(slugs("course")).toEqual(["course", "  mod-1"]);
  });

  it("gives search results on subpages their path", async () => {
    await publishTree(ctx, {
      pages: [
        { slug: "course", source: md("Course") },
        { slug: "mod-1", parent: "course", source: md("Module 1") },
        { slug: "les-1", parent: "mod-1", source: md("Lesson zebra") },
      ],
    });
    expect(search(ctx, "zebra").pages[0]).toMatchObject({ slug: "les-1", path: ["Course", "Module 1"] });
  });
});
