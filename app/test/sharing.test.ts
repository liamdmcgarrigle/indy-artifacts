import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import { publishArtifact } from "@/lib/service/artifacts";
import { createComment, forwardComment, listComments, sendFeedback } from "@/lib/service/comments";
import { forwardResponse, listResponses, submitResponse } from "@/lib/service/responses";
import { issueCode } from "@/lib/auth/accounts";
import { NotFoundError, ValidationError } from "@/lib/service/errors";
import {
  activeLink,
  finishVisit,
  openVisit,
  recordOpen,
  renewLink,
  resolveShare,
  setSharing,
  visitorOf,
} from "@/lib/service/sharing";

let dir: string;
let ctx: ServiceContext;
let slug: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-share-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://agentbox:5174", assetRoots: [dir] });
  slug = (await publishArtifact(ctx, { source: "---\ntitle: Shared\n---\n\n::field{name=why label=Why required}\n" })).slug;
});
afterEach(async () => {
  ctx.db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("share links", () => {
  it("is private until a link is turned on, and private again when revoked", () => {
    expect(activeLink(ctx, slug)).toBeNull();
    const link = setSharing(ctx, slug, { mode: "link", allowComments: true })!;
    expect(link.mode).toBe("link");
    expect(link.allowComments).toBe(true);
    expect(resolveShare(ctx, link.token).artifact.slug).toBe(slug);

    // Changing the mode keeps the address.
    expect(setSharing(ctx, slug, { mode: "email" })!.token).toBe(link.token);

    expect(setSharing(ctx, slug, { mode: "private" })).toBeNull();
    expect(() => resolveShare(ctx, link.token)).toThrow(NotFoundError);
  });

  it("retires the old address on a new link and keeps the settings", () => {
    const first = setSharing(ctx, slug, { mode: "link", allowComments: true, pinnedVersion: 1 })!;
    const second = renewLink(ctx, slug);
    expect(second.token).not.toBe(first.token);
    expect(second.allowComments).toBe(true);
    expect(second.pinnedVersion).toBe(1);
    expect(() => resolveShare(ctx, first.token)).toThrow(NotFoundError);
  });

  it("refuses a version that does not exist and an unknown expiry", () => {
    expect(() => setSharing(ctx, slug, { mode: "link", pinnedVersion: 9 })).toThrow(ValidationError);
    expect(() => setSharing(ctx, slug, { mode: "link", expiry: "1y" as never })).toThrow(ValidationError);
  });

  it("stops working when it expires", () => {
    const link = setSharing(ctx, slug, { mode: "link", expiry: "7d" })!;
    ctx.db.prepare("UPDATE share_links SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", link.id);
    expect(() => resolveShare(ctx, link.token)).toThrow(/expired/);
    expect(activeLink(ctx, slug)).toBeNull();
  });

  it("counts opens and remembers the last visitor", () => {
    const link = setSharing(ctx, slug, { mode: "link" })!;
    recordOpen(ctx, link, "maya@studio.io");
    recordOpen(ctx, link, null);
    const now = activeLink(ctx, slug)!;
    expect(now.opens).toBe(2);
    expect(now.lastOpenedBy).toBeNull();
  });
});

describe("visitors", () => {
  it("lets a visitor in with the emailed code, only on that link", () => {
    const link = setSharing(ctx, slug, { mode: "email" })!;
    const { id, code } = issueCode(ctx, "visitor", link.id, "maya@studio.io");
    expect(() => finishVisit(ctx, link, id, "000000" === code ? "111111" : "000000")).toThrow(ValidationError);
    const again = issueCode(ctx, "visitor", link.id, "maya@studio.io");
    const { cookie } = finishVisit(ctx, link, again.id, again.code);
    expect(visitorOf(ctx, link, cookie)).toEqual({ email: "maya@studio.io" });

    const other = renewLink(ctx, slug);
    expect(visitorOf(ctx, other, cookie)).toBeNull();
  });

  it("keeps a visitor's comment from the agent until the owner forwards it", () => {
    const link = setSharing(ctx, slug, { mode: "link", allowComments: true })!;
    openVisit(ctx, link, null);
    const thread = createComment(ctx, slug, { body: "Option B, please", authorName: "Maya", visitor: { linkId: link.id, email: null } });
    createComment(ctx, slug, { body: "Owner note to the agent", authorName: "Liam" });

    expect(thread.authorKind).toBe("visitor");
    expect(listComments(ctx, slug, { audience: "owner" }).map((t) => t.body)).toContain("Option B, please");
    expect(listComments(ctx, slug, { audience: "agent" }).map((t) => t.body)).toEqual(["Owner note to the agent"]);
    // The visitor sees their link's threads, never the owner's notes.
    expect(listComments(ctx, slug, { audience: { linkId: link.id } }).map((t) => t.body)).toEqual(["Option B, please"]);

    const first = sendFeedback(ctx, slug);
    expect(first.count).toBe(1);

    forwardComment(ctx, thread.id);
    expect(listComments(ctx, slug, { audience: "agent" }).map((t) => t.body)).toContain("Option B, please");
    expect(sendFeedback(ctx, slug).count).toBe(1);
  });

  it("will not let a visitor reply on a thread from somewhere else", () => {
    const link = setSharing(ctx, slug, { mode: "link", allowComments: true })!;
    const owners = createComment(ctx, slug, { body: "Private", authorName: "Liam" });
    expect(() =>
      createComment(ctx, slug, { body: "hi", authorName: "Maya", parentId: owners.id, visitor: { linkId: link.id, email: null } }),
    ).toThrow(NotFoundError);
  });

  it("holds a visitor's answers back from agents until forwarded", () => {
    const link = setSharing(ctx, slug, { mode: "link" })!;
    const response = submitResponse(ctx, slug, { why: "Because" }, { kind: "visitor", email: null, linkId: link.id });
    expect(listResponses(ctx, slug)).toHaveLength(1);
    expect(listResponses(ctx, slug, { agent: true })).toHaveLength(0);
    forwardResponse(ctx, slug, response.id);
    expect(listResponses(ctx, slug, { agent: true })).toHaveLength(1);
  });
});
