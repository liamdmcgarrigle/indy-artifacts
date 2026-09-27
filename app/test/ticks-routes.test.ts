import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The share-link routes a visitor ticks and comments through: the link is
 * checked on every call, and nothing is written until the visitor carries an
 * identity Indy signed, whose name and email the request cannot change.
 */

type Handler = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;

let dir: string;
let ticks: { GET: Handler; POST: Handler };
let identity: { POST: Handler };
let comments: { GET: Handler; POST: Handler };
let link: string;
let otherLink: string;
let key: string;
let otherKey: string;
let slug: string;
let services: {
  setSharing: typeof import("@/lib/service/sharing").setSharing;
  getContext: typeof import("@/lib/service/context").getContext;
};

const base = "http://localhost:5174";

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; id?: string; headers?: Record<string, string>; on?: string } = {}) {
  const token = opts.on ?? link;
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.id) headers["x-indy-identity"] = opts.id;
  return handler(new Request(`${base}/s/${token}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve({ token }),
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-ticks-routes-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://agentbox:5174";
  ticks = (await import("@/app/s/[token]/api/ticks/route")) as unknown as typeof ticks;
  identity = (await import("@/app/s/[token]/api/identity/route")) as unknown as typeof identity;
  comments = (await import("@/app/s/[token]/api/comments/route")) as unknown as typeof comments;
  const { publishArtifact } = await import("@/lib/service/artifacts");
  const { getContext } = await import("@/lib/service/context");
  const { setSharing } = await import("@/lib/service/sharing");
  const { taskItemsOf } = await import("@/lib/doc/parse");
  services = { setSharing, getContext };
  const source = "---\ntitle: Visitor checklist\n---\n\n- [ ] Check the numbers\n- [ ] Sign off\n";
  slug = (await publishArtifact(getContext(), { source })).slug;
  link = setSharing(getContext(), slug, { mode: "link", allowComments: true })!.token;
  key = taskItemsOf(source)[0].key;
  const second = "---\ntitle: Another page\n---\n\n- [ ] Read it\n";
  const other = (await publishArtifact(getContext(), { source: second })).slug;
  otherLink = setSharing(getContext(), other, { mode: "link", allowComments: true })!.token;
  otherKey = taskItemsOf(second)[0].key;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("visitor ticks and comments", () => {
  let maya = "";
  let sam = "";

  it("asks who they are before a tick lands", async () => {
    const res = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: true } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("identify");
  });

  it("refuses a request from another site", async () => {
    const res = await call(identity.POST, "POST", "/api/identity", {
      body: { name: "Maya", email: "maya@studio.io" },
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("wants both a name and an email", async () => {
    expect((await call(identity.POST, "POST", "/api/identity", { body: { name: "Maya", email: "not an email" } })).status).toBe(400);
    expect((await call(identity.POST, "POST", "/api/identity", { body: { name: "Maya" } })).status).toBe(400);
    expect((await call(identity.POST, "POST", "/api/identity", { body: { name: " ", email: "maya@studio.io" } })).status).toBe(400);
  });

  it("signs the identity once; showing it again cannot change the name or email", async () => {
    const res = await call(identity.POST, "POST", "/api/identity", { body: { name: "  Maya\u0007 ", email: "maya@studio.io" } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { identity: unknown; token: string };
    expect(data.identity).toEqual({ name: "Maya", email: "maya@studio.io", verified: false });
    maya = data.token;

    const again = (await (await call(identity.POST, "POST", "/api/identity", { body: { token: maya, name: "Liam", email: "liam@x.io" } })).json()) as {
      identity: unknown;
    };
    expect(again.identity).toEqual({ name: "Maya", email: "maya@studio.io", verified: false });

    sam = ((await (await call(identity.POST, "POST", "/api/identity", { body: { name: "Sam", email: "sam@secret.io" } })).json()) as { token: string }).token;
  });

  it("ticks under the signed name, never one from the request", async () => {
    const tick = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: true, name: "Liam" }, id: maya });
    expect(tick.status).toBe(200);
    const data = (await tick.json()) as { ticks: { key: string; byName: string; byKind: string }[] };
    expect(data.ticks).toEqual([expect.objectContaining({ key, byName: "Maya", byKind: "visitor" })]);
  });

  it("refuses a forged identity", async () => {
    const [body, sig] = maya.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), n: "Liam" })).toString("base64url");
    const res = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: false }, id: `${forged}.${sig}` });
    expect(res.status).toBe(403);
    const madeUp = await call(comments.POST, "POST", "/api/comments", { body: { body: "hi" }, id: "e30.abc" });
    expect(madeUp.status).toBe(403);
  });

  it("puts a comment under the signed name, and never shows another visitor's email", async () => {
    const res = await call(comments.POST, "POST", "/api/comments", { body: { body: "Numbers look off", author_name: "Liam" }, id: maya });
    expect(res.status).toBe(201);
    const { comment } = (await res.json()) as { comment: { authorName: string; authorKind: string } };
    expect(comment).toMatchObject({ authorName: "Maya", authorKind: "visitor" });

    // Sam reads the page: Maya's name, never her email.
    const threads = await (await call(comments.GET, "GET", "/api/comments", { id: sam })).text();
    const ticked = await (await call(ticks.GET, "GET", "/api/ticks", { id: sam })).text();
    expect(threads).toContain("Maya");
    expect(ticked).toContain("Maya");
    for (const body of [threads, ticked]) expect(body).not.toContain("maya@studio.io");
  });

  it("uses the same identity on another page's link", async () => {
    const res = await call(ticks.POST, "POST", "/api/ticks", { body: { key: otherKey, checked: true }, id: maya, on: otherLink });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ticks: { byName: string }[] }).ticks[0].byName).toBe("Maya");
  });

  it("will not tick an item that is not on the page", async () => {
    const res = await call(ticks.POST, "POST", "/api/ticks", { body: { key: otherKey, checked: true }, id: maya });
    expect(res.status).toBe(404);
  });

  it("is read-only when the link does not let people take part", async () => {
    services.setSharing(services.getContext(), slug, { mode: "link", allowComments: false });
    const res = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: false }, id: maya });
    expect(res.status).toBe(403);
    services.setSharing(services.getContext(), slug, { mode: "link", allowComments: true });
  });

  it("stops at an expired or revoked link", async () => {
    const ctx = services.getContext();
    ctx.db.prepare("UPDATE share_links SET expires_at = ? WHERE token = ?").run("2000-01-01T00:00:00.000Z", link);
    const expired = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: false }, id: maya });
    expect(expired.status).toBe(404);
    ctx.db.prepare("UPDATE share_links SET expires_at = NULL WHERE token = ?").run(link);

    services.setSharing(ctx, slug, { mode: "private" });
    const revoked = await call(ticks.POST, "POST", "/api/ticks", { body: { key, checked: false }, id: maya });
    expect(revoked.status).toBe(404);
  });
});
