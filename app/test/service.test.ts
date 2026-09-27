import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import {
  createHumanVersion,
  patchLines,
  diffVersions,
  listArtifacts,
  listVersions,
  publishArtifact,
  requireArtifact,
  requireVersion,
  slugify,
  updateArtifact,
} from "@/lib/service/artifacts";
import { createComment, listComments, patchComment, sendFeedback } from "@/lib/service/comments";
import { ackEvent, listEvents } from "@/lib/service/events";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/service/errors";

let dir: string;
let ctx: ServiceContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-svc-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://agentbox:5174", assetRoots: [dir] });
});
afterEach(async () => {
  ctx.db.close();
  await rm(dir, { recursive: true, force: true });
});

const md = (title: string, body = "Hello.") => `---\ntitle: ${title}\n---\n\n${body}\n`;

describe("publish", () => {
  it("creates an artifact and its first version", async () => {
    const res = await publishArtifact(ctx, { source: md("Backup run") });
    expect(res.version).toBe(1);
    expect(res.slug).toMatch(/^backup-run-[a-z0-9]{4}$/);
    expect(res.url).toBe(`http://agentbox:5174/a/${res.slug}`);
    const artifact = requireArtifact(ctx, res.slug);
    expect(artifact.title).toBe("Backup run");
    expect(artifact.currentVersion).toBe(1);
    expect(requireVersion(ctx, artifact).source).toContain("Hello.");
  });

  it("honours an explicit slug and rejects a taken one", async () => {
    await publishArtifact(ctx, { slug: "nightly", source: md("Nightly") });
    expect(requireArtifact(ctx, "nightly").slug).toBe("nightly");
    await expect(publishArtifact(ctx, { slug: "nightly", source: md("Other") })).rejects.toThrow(ValidationError);
  });

  it("rejects a bad slug", async () => {
    await expect(publishArtifact(ctx, { slug: "No Spaces", source: md("x") })).rejects.toThrow(/slug must be/);
  });

  it("requires a title", async () => {
    await expect(publishArtifact(ctx, { source: "no frontmatter here" })).rejects.toThrow(/title.*required/i);
  });

  it("takes theme, project and tags from frontmatter", async () => {
    const res = await publishArtifact(ctx, {
      source: `---\ntitle: T\ntheme: graphite\nproject: picaflick\ntags: [a, b]\n---\n\nbody\n`,
    });
    const a = requireArtifact(ctx, res.slug);
    expect(a.theme).toBe("graphite");
    expect(a.project).toBe("picaflick");
    expect(a.tags).toEqual(["a", "b"]);
  });

  it("stores the agent identity so comments can reach it", async () => {
    const res = await publishArtifact(ctx, {
      source: md("T"),
      agent: { name: "claude", terminal: "term_abc", session: "sess_1" },
    });
    const a = requireArtifact(ctx, res.slug);
    expect(a.terminalHandle).toBe("term_abc");
    expect(a.sessionId).toBe("sess_1");
    expect(a.agentName).toBe("claude");
  });

  it("reports markdown warnings without failing", async () => {
    const res = await publishArtifact(ctx, {
      source: `---\ntitle: T\n---\n\n\`\`\`chart\ntype: pyramid\ndata: [{a: 1}]\n\`\`\`\n`,
    });
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].message).toContain("chart type");
  });

  it("rejects an unknown kind and a source over the limit", async () => {
    await expect(publishArtifact(ctx, { kind: "vue" as never, source: md("x") })).rejects.toThrow(/kind must be/);
    await expect(publishArtifact(ctx, { source: "x".repeat(1024 * 1024 + 1), title: "big" })).rejects.toThrow(/limit/);
  });
});

describe("update", () => {
  it("bumps the version and keeps history", async () => {
    const first = await publishArtifact(ctx, { slug: "run", source: md("Run", "one") });
    const second = await updateArtifact(ctx, "run", { expectedVersion: first.version, source: md("Run", "two") });
    expect(second.version).toBe(2);
    const artifact = requireArtifact(ctx, "run");
    expect(listVersions(ctx, artifact.id).map((v) => v.number)).toEqual([2, 1]);
    expect(requireVersion(ctx, artifact, 1).source).toContain("one");
    expect(requireVersion(ctx, artifact, 2).source).toContain("two");
  });

  it("refuses a stale expected_version and names the current one", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run") });
    await updateArtifact(ctx, "run", { expectedVersion: 1, source: md("Run", "two") });
    const err = await updateArtifact(ctx, "run", { expectedVersion: 1, source: md("Run", "three") }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.currentVersion).toBe(2);
    expect(err.message).toContain("is at version 2");
  });

  it("will not change the kind", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run") });
    await expect(
      updateArtifact(ctx, "run", { expectedVersion: 1, kind: "react", files: { "App.tsx": "x" } }),
    ).rejects.toThrow(/kind cannot change/);
  });

  it("404s on an unknown slug", async () => {
    await expect(updateArtifact(ctx, "nope", { expectedVersion: 1, source: md("x") })).rejects.toThrow(NotFoundError);
  });
});

describe("assets", () => {
  it("copies a listed host file and carries it to the next version", async () => {
    const shot = join(dir, "shot.png");
    await writeFile(shot, "not really a png");
    const first = await publishArtifact(ctx, {
      slug: "withasset",
      source: md("With asset", "![shot](assets/shot.png)"),
      assets: [{ name: "shot.png", path: shot }],
    });
    const a = requireArtifact(ctx, "withasset");
    expect(requireVersion(ctx, a, 1).assets).toEqual([{ name: "shot.png", size: 16, type: "image/png" }]);
    await updateArtifact(ctx, "withasset", { expectedVersion: first.version, source: md("With asset", "again") });
    expect(requireVersion(ctx, a, 2).assets.map((x) => x.name)).toEqual(["shot.png"]);
  });

  it("refuses a path outside the allowed roots and a disallowed type", async () => {
    await publishArtifact(ctx, { slug: "asset-one", source: md("A") });
    await expect(
      publishArtifact(ctx, { slug: "asset-two", source: md("A"), assets: [{ name: "x.png", path: "/etc/hostname" }] }),
    ).rejects.toThrow(/must be under/);
    const sh = join(dir, "x.sh");
    await writeFile(sh, "echo");
    await expect(
      publishArtifact(ctx, { slug: "asset-three", source: md("A"), assets: [{ name: "x.sh", path: sh }] }),
    ).rejects.toThrow(/type not allowed/);
  });
});

describe("human edits", () => {
  it("creates a human version and emits an event", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run", "agent text"), agent: { terminal: "term_x" } });
    const res = await createHumanVersion(ctx, "run", {
      source: md("Run", "human text"),
      authorName: "liam",
      expectedVersion: 1,
      message: "fixed a number",
    });
    expect(res.version).toBe(2);
    const v = requireVersion(ctx, requireArtifact(ctx, "run"), 2);
    expect(v.authorKind).toBe("human");
    expect(v.authorName).toBe("liam");
    const { events } = listEvents(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("version.created");
    expect(events[0].artifact.terminalHandle).toBe("term_x");
  });

  it("refuses to save over a newer version", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run") });
    await updateArtifact(ctx, "run", { expectedVersion: 1, source: md("Run", "agent moved on") });
    await expect(
      createHumanVersion(ctx, "run", { source: md("Run", "stale"), authorName: "liam", expectedVersion: 1 }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("editing one block", () => {
  // Four lines of frontmatter, a blank, then the body starts at line 6.
  const doc = ["---", "title: Run", "---", "", "First paragraph.", "", "Second paragraph.", ""].join("\n");

  it("replaces only the lines the block occupies", async () => {
    await publishArtifact(ctx, { slug: "run", source: doc });
    const res = await patchLines(ctx, "run", {
      from: 7,
      to: 7,
      text: "Rewritten paragraph.",
      authorName: "liam",
      expectedVersion: 1,
    });
    expect(res.version).toBe(2);
    const v = requireVersion(ctx, requireArtifact(ctx, "run"), 2);
    expect(v.source).toContain("First paragraph.");
    expect(v.source).toContain("Rewritten paragraph.");
    expect(v.source).not.toContain("Second paragraph.");
    expect(v.authorKind).toBe("human");
    expect(v.message).toBe("edited line 7");
  });

  it("can grow a block from one line to several", async () => {
    await publishArtifact(ctx, { slug: "run", source: doc });
    await patchLines(ctx, "run", {
      from: 5,
      to: 5,
      text: "One.\n\nTwo.",
      authorName: "liam",
      expectedVersion: 1,
    });
    const v = requireVersion(ctx, requireArtifact(ctx, "run"), 2);
    expect(v.source?.split("\n").length).toBe(doc.split("\n").length + 2);
    expect(v.source).toContain("Second paragraph.");
  });

  it("refuses a range that starts past the end of the document", async () => {
    await publishArtifact(ctx, { slug: "run", source: doc });
    await expect(
      patchLines(ctx, "run", { from: 99, to: 99, text: "x", authorName: "liam", expectedVersion: 1 }),
    ).rejects.toThrow(/past the end/);
  });

  it("refuses an upside down range", async () => {
    await publishArtifact(ctx, { slug: "run", source: doc });
    await expect(
      patchLines(ctx, "run", { from: 7, to: 2, text: "x", authorName: "liam", expectedVersion: 1 }),
    ).rejects.toThrow(/low to high/);
  });

  it("refuses to patch a compiled artifact", async () => {
    await publishArtifact(ctx, { slug: "app", kind: "react", title: "App", files: { "App.tsx": "export default () => null;" } });
    await expect(
      patchLines(ctx, "app", { from: 1, to: 1, text: "x", authorName: "liam", expectedVersion: 1 }),
    ).rejects.toThrow(/markdown/);
  });

  it("refuses to save over a newer version", async () => {
    await publishArtifact(ctx, { slug: "run", source: doc });
    await updateArtifact(ctx, "run", { expectedVersion: 1, source: doc + "\nmore\n" });
    await expect(
      patchLines(ctx, "run", { from: 5, to: 5, text: "x", authorName: "liam", expectedVersion: 1 }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("diff", () => {
  it("produces a unified patch between two versions", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run", "line one") });
    await updateArtifact(ctx, "run", { expectedVersion: 1, source: md("Run", "line two") });
    const patch = diffVersions(ctx, "run", 1, 2);
    expect(patch).toContain("-line one");
    expect(patch).toContain("+line two");
  });
});

describe("comments", () => {
  beforeEach(async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run"), agent: { terminal: "term_x", name: "claude" } });
  });

  it("saves an unsent comment by default and emits nothing", () => {
    const c = createComment(ctx, "run", {
      body: "this number looks wrong",
      authorName: "liam",
      anchor: { type: "range", block: "b1", lines: [5, 5], quote: "Hello." },
    });
    expect(c.sentAt).toBeNull();
    expect(c.status).toBe("open");
    expect(c.anchor?.quote).toBe("Hello.");
    expect(listEvents(ctx).events).toHaveLength(0);
  });

  it("emits an event immediately when notify is set", () => {
    createComment(ctx, "run", { body: "urgent", authorName: "liam", notify: true });
    const { events } = listEvents(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("comment.created");
    expect((events[0].payload.comment as Record<string, unknown>).body).toBe("urgent");
  });

  it("bundles unsent comments into one feedback event", () => {
    createComment(ctx, "run", { body: "one", authorName: "liam" });
    createComment(ctx, "run", { body: "two", authorName: "liam" });
    createComment(ctx, "run", { body: "already sent", authorName: "liam", notify: true });
    const res = sendFeedback(ctx, "run", { message: "done reviewing", authorName: "liam" });
    expect(res.count).toBe(2);
    const { events } = listEvents(ctx);
    const batch = events.find((e) => e.kind === "feedback.sent")!;
    expect(batch.payload.message).toBe("done reviewing");
    expect((batch.payload.comments as unknown[]).length).toBe(2);
    expect(sendFeedback(ctx, "run").count).toBe(0);
  });

  it("threads replies and resolves a whole thread", () => {
    const root = createComment(ctx, "run", { body: "question", authorName: "liam" });
    createComment(ctx, "run", { body: "answer", authorName: "claude", authorKind: "agent", parentId: root.id });
    const threads = listComments(ctx, "run");
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].authorKind).toBe("agent");
    patchComment(ctx, root.id, { status: "resolved" });
    expect(listComments(ctx, "run")).toHaveLength(0);
    expect(listComments(ctx, "run", { status: "all" })[0].replies[0].status).toBe("resolved");
  });

  it("never notifies for agent comments", () => {
    createComment(ctx, "run", { body: "from the agent", authorName: "claude", authorKind: "agent", notify: true });
    expect(listEvents(ctx).events).toHaveLength(0);
  });

  it("rejects an empty body and a bad anchor", () => {
    expect(() => createComment(ctx, "run", { body: "   ", authorName: "liam" })).toThrow(/empty/);
    expect(() => createComment(ctx, "run", { body: "x", authorName: "liam", anchor: { type: "wat", block: "b1" } })).toThrow(
      /anchor.type/,
    );
  });
});

describe("events feed", () => {
  it("pages with after and acks once", async () => {
    await publishArtifact(ctx, { slug: "run", source: md("Run"), agent: { terminal: "t" } });
    createComment(ctx, "run", { body: "one", authorName: "liam", notify: true });
    createComment(ctx, "run", { body: "two", authorName: "liam", notify: true });
    const first = listEvents(ctx, { after: 0, limit: 1 });
    expect(first.events).toHaveLength(1);
    const second = listEvents(ctx, { after: first.lastId });
    expect(second.events).toHaveLength(1);
    expect(second.events[0].id).toBeGreaterThan(first.events[0].id);
    ackEvent(ctx, first.events[0].id, "sent");
    expect(listEvents(ctx, { undeliveredOnly: true }).events.map((e) => e.id)).toEqual([second.events[0].id]);
    expect(() => ackEvent(ctx, 9999)).toThrow(NotFoundError);
  });
});

describe("listing", () => {
  it("summarises artifacts with open and unsent comment counts", async () => {
    await publishArtifact(ctx, { slug: "one", source: md("One"), project: "p" });
    await publishArtifact(ctx, { slug: "two", source: md("Two") });
    createComment(ctx, "one", { body: "a", authorName: "liam" });
    createComment(ctx, "one", { body: "b", authorName: "liam", notify: true });
    const all = listArtifacts(ctx);
    expect(all).toHaveLength(2);
    const one = all.find((a) => a.slug === "one")!;
    expect(one.openComments).toBe(2);
    expect(one.unsentComments).toBe(1);
    expect(one.updatedBy).toBe("agent");
    expect(listArtifacts(ctx, { project: "p" }).map((a) => a.slug)).toEqual(["one"]);
  });
});

describe("slugify", () => {
  it("makes url-safe bases", () => {
    expect(slugify("Backup run 2026-09-20")).toBe("backup-run-2026-09-20");
    expect(slugify("  !!!  ")).toBe("artifact");
  });
});

describe("failed first publish", () => {
  it("leaves no artifact behind, so the slug stays free", async () => {
    const bad = makeContext({ dataDir: dir, assetRoots: [dir] });
    await expect(
      publishArtifact(bad, {
        slug: "never-lands",
        source: md("Nope"),
        assets: [{ name: "missing.png", path: join(dir, "does-not-exist.png") }],
      }),
    ).rejects.toThrow(/not found on this host/);
    expect(() => requireArtifact(bad, "never-lands")).toThrow(NotFoundError);
    const second = await publishArtifact(bad, { slug: "never-lands", source: md("Second try") });
    expect(second.version).toBe(1);
    bad.db.close();
  });
});

describe("two updates at once", () => {
  it("lets one win and gives the other a conflict, never a crash", async () => {
    await publishArtifact(ctx, { slug: "race", source: md("Race") });
    const results = await Promise.allSettled([
      updateArtifact(ctx, "race", { expectedVersion: 1, source: md("Race", "one") }),
      updateArtifact(ctx, "race", { expectedVersion: 1, source: md("Race", "two") }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(requireArtifact(ctx, "race").currentVersion).toBe(2);
  });

  it("refuses a missing expected_version as a bad request", async () => {
    await publishArtifact(ctx, { slug: "noversion", source: md("No version") });
    await expect(updateArtifact(ctx, "noversion", { expectedVersion: Number(undefined), source: md("x") })).rejects.toThrow(ValidationError);
  });
});
