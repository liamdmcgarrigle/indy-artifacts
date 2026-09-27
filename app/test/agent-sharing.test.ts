import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import { publishArtifact, updateArtifact } from "@/lib/service/artifacts";
import { getSettings, updateSettings } from "@/lib/service/settings";
import { listEvents } from "@/lib/service/events";
import { NotFoundError, ValidationError } from "@/lib/service/errors";
import {
  activeLink,
  agentOrigin,
  agentShare,
  AgentSharingOffError,
  listAgentLinks,
  listSharedPages,
  resolveShare,
  revokeAgentLink,
  setSharing,
} from "@/lib/service/sharing";

let dir: string;
let ctx: ServiceContext;
let slug: string;
const by = { name: "laptop claude", tokenId: "tok1" };
const DAY = 24 * 60 * 60 * 1000;

const ask = (extra: Record<string, unknown> = {}) => ({
  confirm: slug,
  reason: "Liam asked to send this report to the design team",
  ...extra,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-agent-share-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://agentbox:5174", assetRoots: [dir] });
  slug = (await publishArtifact(ctx, { source: "---\ntitle: Report\n---\n\nFirst\n" })).slug;
  await updateArtifact(ctx, slug, { source: "---\ntitle: Report\n---\n\nSecond\n", expectedVersion: 1 });
});
afterEach(async () => {
  ctx.db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("agent share links", () => {
  it("is off by default and refuses while off, pointing at Settings", () => {
    expect(getSettings(ctx).agentSharing).toBe(false);
    expect(() => agentShare(ctx, slug, ask(), by)).toThrow(AgentSharingOffError);
    expect(() => agentShare(ctx, slug, ask(), by)).toThrow(/Settings › Shared links/);
    expect(activeLink(ctx, slug)).toBeNull();
  });

  it("refuses a confirm that is not the slug typed back, and a missing reason", () => {
    updateSettings(ctx, { agentSharing: true });
    expect(() => agentShare(ctx, slug, ask({ confirm: "yes" }), by)).toThrow(ValidationError);
    expect(() => agentShare(ctx, slug, ask({ confirm: slug.toUpperCase() }), by)).toThrow(/typed back exactly/);
    expect(() => agentShare(ctx, slug, ask({ reason: "  " }), by)).toThrow(/reason is required/);
    expect(activeLink(ctx, slug)).toBeNull();
  });

  it("refuses a page that does not exist", () => {
    updateSettings(ctx, { agentSharing: true });
    expect(() => agentShare(ctx, "nope", { ...ask(), confirm: "nope" }, by)).toThrow(NotFoundError);
  });

  it("makes a narrow link by default: 7 days, pinned to the current version, no comments", () => {
    updateSettings(ctx, { agentSharing: true });
    const link = agentShare(ctx, slug, ask(), by);
    expect(link.url).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
    expect(link.mode).toBe("link");
    expect(link.allowComments).toBe(false);
    expect(link.pinnedVersion).toBe(2);
    const days = (new Date(link.expiresAt!).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect(resolveShare(ctx, link.token).link.expiresAt).toBe(link.expiresAt);

    const event = listEvents(ctx, { slug }).events.find((e) => e.kind === "share.created")!;
    expect(event.payload).toMatchObject({ link_id: link.id, agent: "laptop claude", token_id: "tok1", reason: ask().reason });
  });

  it("caps expiry at 30 days and never makes a link that does not expire", () => {
    updateSettings(ctx, { agentSharing: true });
    for (const expiresDays of [31, 365, 0, -1, 2.5, Infinity])
      expect(() => agentShare(ctx, slug, ask({ expiresDays }), by)).toThrow(/from 1 to 30/);
    const link = agentShare(ctx, slug, ask({ expiresDays: 30, pin: false, allowComments: true }), by);
    expect((new Date(link.expiresAt!).getTime() - Date.now()) / DAY).toBeLessThanOrEqual(30);
    expect(link.pinnedVersion).toBeNull();
    expect(link.allowComments).toBe(true);
  });

  it("will not touch a link the owner made", () => {
    updateSettings(ctx, { agentSharing: true });
    setSharing(ctx, slug, { mode: "link" });
    expect(() => agentShare(ctx, slug, ask(), by)).toThrow(/already shared by the operator/);
    expect(() => revokeAgentLink(ctx, slug, by)).toThrow(/only they can revoke it/);
    expect(activeLink(ctx, slug)!.expiresAt).toBeNull();
  });

  it("shows in the owner's listing with the agent and reason, and revokes", () => {
    updateSettings(ctx, { agentSharing: true });
    const link = agentShare(ctx, slug, ask(), by);
    const listed = listSharedPages(ctx).find((s) => s.id === link.id)!;
    expect(listed.agent).toEqual({ agent: "laptop claude", reason: ask().reason });
    expect(agentOrigin(ctx, link.id)).toEqual(listed.agent);
    expect(listAgentLinks(ctx).map((s) => s.slug)).toEqual([slug]);

    // A second request while the first link works is refused, not stacked.
    expect(() => agentShare(ctx, slug, ask(), by)).toThrow(/already has a link, made by laptop claude/);

    revokeAgentLink(ctx, slug, by);
    expect(activeLink(ctx, slug)).toBeNull();
    expect(() => resolveShare(ctx, link.token)).toThrow(NotFoundError);
    expect(listAgentLinks(ctx)).toEqual([]);
    expect(listEvents(ctx, { slug }).events.map((e) => e.kind)).toContain("share.revoked");

    // The owner's revoke works on an agent's link too.
    const again = agentShare(ctx, slug, ask(), by);
    setSharing(ctx, slug, { mode: "private" });
    expect(() => resolveShare(ctx, again.token)).toThrow(NotFoundError);
  });

  it("only takes a boolean for the setting", () => {
    expect(() => updateSettings(ctx, { agentSharing: "yes" })).toThrow(ValidationError);
    expect(updateSettings(ctx, { agentSharing: true }).agentSharing).toBe(true);
  });
});
