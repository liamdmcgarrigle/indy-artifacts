import { issueCode, normaliseEmail, owner, redeemCode, validEmail } from "../auth/accounts";
import { randomToken, sha256 } from "../auth/crypto";
import { config, emailEnabled } from "../config";
import { codeEmail, sendEmail } from "../email";
import { bind, withTx } from "../db/index";
import type { ServiceContext } from "./context";
import { NotFoundError, ServiceError, ValidationError } from "./errors";
import { requireArtifact } from "./artifacts";
import { recordEvent } from "./events";
import { getSettings } from "./settings";
import type { Artifact } from "./types";

/**
 * Sharing, one link per page. A page is private until the owner turns a link
 * on; the link is either open to anyone who has it, or asks for an emailed
 * code first. Turning it off revokes the link, and a new link retires the
 * old token while keeping its settings.
 */

export type ShareMode = "private" | "link" | "email";
export type Expiry = "never" | "7d" | "30d";

export interface ShareLink {
  id: string;
  token: string;
  mode: "link" | "email";
  allowComments: boolean;
  /** A version the link is held to; null follows the latest. */
  pinnedVersion: number | null;
  expiresAt: string | null;
  opens: number;
  lastOpenedAt: string | null;
  lastOpenedBy: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

const VISIT_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString();
const now = () => iso(new Date());

function toLink(row: Row): ShareLink {
  return {
    id: String(row.id),
    token: String(row.token),
    mode: row.mode as "link" | "email",
    allowComments: Number(row.allow_comments) === 1,
    pinnedVersion: row.pinned_version === null ? null : Number(row.pinned_version),
    expiresAt: (row.expires_at as string | null) ?? null,
    opens: Number(row.opens),
    lastOpenedAt: (row.last_opened_at as string | null) ?? null,
    lastOpenedBy: (row.last_opened_by as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

const live = (link: ShareLink) => link.expiresAt === null || link.expiresAt > now();

/**
 * Whether a link can ask for an emailed code. Needs Resend; a development
 * server stands in by printing the code, so the gate can be tried locally.
 */
export function emailGateAvailable(): boolean {
  return emailEnabled() || process.env.NODE_ENV !== "production";
}

/** The page's link that works right now, if it has one. */
export function activeLink(ctx: ServiceContext, slug: string): ShareLink | null {
  const artifact = requireArtifact(ctx, slug);
  const rows = ctx.db
    .prepare("SELECT * FROM share_links WHERE artifact_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
    .all(artifact.id) as Row[];
  return rows.map(toLink).find(live) ?? null;
}

export function shareUrl(link: ShareLink): string {
  return `${config().url}/s/${link.token}`;
}

function expiryFor(expiry: Expiry | undefined, current: string | null): string | null {
  if (expiry === undefined) return current;
  if (!["never", "7d", "30d"].includes(expiry)) throw new ValidationError('expiry must be "never", "7d" or "30d"');
  if (expiry === "never") return null;
  return iso(new Date(Date.now() + (expiry === "7d" ? 7 : 30) * DAY));
}

export interface SharingInput {
  mode: ShareMode;
  allowComments?: boolean;
  expiry?: Expiry;
  pinnedVersion?: number | null;
}

/** Set who can open a page. Returns the link, or null when it is private. */
export function setSharing(ctx: ServiceContext, slug: string, input: SharingInput): ShareLink | null {
  const artifact = requireArtifact(ctx, slug);
  if (!["private", "link", "email"].includes(input.mode)) throw new ValidationError('mode must be "private", "link" or "email"');
  if (input.mode === "email" && !emailGateAvailable())
    throw new ValidationError("email-confirmed links need email: set RESEND_API_KEY");
  if (input.pinnedVersion != null && (input.pinnedVersion < 1 || input.pinnedVersion > artifact.currentVersion))
    throw new ValidationError(`there is no version ${input.pinnedVersion}`);

  const current = activeLink(ctx, slug);
  if (input.mode === "private") {
    if (current) ctx.db.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ?").run(now(), current.id);
    return null;
  }
  if (!current) return createLink(ctx, artifact, input);

  ctx.db
    .prepare(
      `UPDATE share_links SET mode = :mode, allow_comments = :comments, pinned_version = :pinned, expires_at = :expires
       WHERE id = :id`,
    )
    .run(
      bind({
        id: current.id,
        mode: input.mode,
        comments: (input.allowComments ?? current.allowComments) ? 1 : 0,
        pinned: input.pinnedVersion === undefined ? current.pinnedVersion : input.pinnedVersion,
        expires: expiryFor(input.expiry, current.expiresAt),
      }),
    );
  // Visits begun while the link was open never confirmed an email, so a
  // switch to email-only starts everyone over at the gate.
  if (input.mode === "email" && current.mode !== "email") {
    ctx.db.prepare("DELETE FROM visitor_sessions WHERE link_id = ?").run(current.id);
  }
  return activeLink(ctx, slug);
}

function createLink(ctx: ServiceContext, artifact: Artifact, input: SharingInput): ShareLink {
  const id = randomToken(9);
  ctx.db
    .prepare(
      `INSERT INTO share_links (id, artifact_id, token, mode, allow_comments, pinned_version, expires_at, created_at)
       VALUES (:id, :artifact_id, :token, :mode, :comments, :pinned, :expires, :created_at)`,
    )
    .run(
      bind({
        id,
        artifact_id: artifact.id,
        token: randomToken(12),
        mode: input.mode,
        comments: input.allowComments ? 1 : 0,
        pinned: input.pinnedVersion ?? null,
        expires: expiryFor(input.expiry ?? "never", null),
        created_at: now(),
      }),
    );
  return toLink(ctx.db.prepare("SELECT * FROM share_links WHERE id = ?").get(id) as Row);
}

/** Retire the current token and issue a new one with the same settings. */
export function renewLink(ctx: ServiceContext, slug: string): ShareLink {
  const artifact = requireArtifact(ctx, slug);
  const current = activeLink(ctx, slug);
  if (!current) throw new ValidationError("this page has no link to replace");
  ctx.db.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ?").run(now(), current.id);
  const next = createLink(ctx, artifact, {
    mode: current.mode,
    allowComments: current.allowComments,
    pinnedVersion: current.pinnedVersion,
  });
  if (current.expiresAt) ctx.db.prepare("UPDATE share_links SET expires_at = ? WHERE id = ?").run(current.expiresAt, next.id);
  return activeLink(ctx, slug)!;
}

// ---------------------------------------------------------------- visitors

export interface Share {
  link: ShareLink;
  artifact: Artifact;
}

/** The link behind a token, while it still works. */
export function resolveShare(ctx: ServiceContext, token: string): Share {
  const row = ctx.db.prepare("SELECT * FROM share_links WHERE token = ?").get(token) as Row | undefined;
  if (!row || row.revoked_at) throw new NotFoundError("this link is not shared any more");
  const link = toLink(row);
  if (!live(link)) throw new NotFoundError("this link has expired");
  const artifact = ctx.db.prepare("SELECT slug FROM artifacts WHERE id = ?").get(String(row.artifact_id)) as Row | undefined;
  if (!artifact) throw new NotFoundError("this page is gone");
  return { link, artifact: requireArtifact(ctx, String(artifact.slug)) };
}

export function recordOpen(ctx: ServiceContext, link: ShareLink, who: string | null): void {
  ctx.db
    .prepare("UPDATE share_links SET opens = opens + 1, last_opened_at = ?, last_opened_by = ? WHERE id = ?")
    .run(now(), who, link.id);
}

/** The cookie a visitor carries, one per link, scoped to the link's path. */
export function visitCookieName(link: ShareLink): string {
  return `indy_visit_${link.id}`;
}

/** Who a visit cookie belongs to on this link, if it is still good. */
export function visitorOf(ctx: ServiceContext, link: ShareLink, cookie: string | undefined): { email: string | null } | null {
  if (!cookie) return null;
  const row = ctx.db
    .prepare("SELECT * FROM visitor_sessions WHERE id_hash = ? AND link_id = ?")
    .get(sha256(cookie), link.id) as Row | undefined;
  if (!row || String(row.expires_at) < now()) return null;
  return { email: (row.email as string | null) ?? null };
}

/** Email a visitor a code for this link. Returns the id the code is checked against. */
export async function startVisit(ctx: ServiceContext, link: ShareLink, rawEmail: string): Promise<{ codeId: string; email: string }> {
  if (link.mode !== "email") throw new ValidationError("this link does not ask for an email");
  const email = normaliseEmail(rawEmail);
  if (!validEmail(email)) throw new ValidationError("that does not look like an email address");
  const { id, code } = issueCode(ctx, "visitor", link.id, email);
  if (emailEnabled()) {
    const mail = codeEmail(code, "open a page shared with you");
    await sendEmail({ to: email, ...mail });
  } else {
    // Development only: emailGateAvailable() keeps this path out of production.
    console.log(`[indy dev] visitor code for ${email}: ${code}`);
  }
  return { codeId: id, email };
}

/** Check a visitor's code and open a visit. Returns the cookie value. */
export function finishVisit(ctx: ServiceContext, link: ShareLink, codeId: string, code: string): { cookie: string; maxAge: number } {
  const found = redeemCode(ctx, codeId, code);
  if (!found || found.purpose !== "visitor" || found.subject !== link.id) throw new ValidationError("that code is not right, or it has expired");
  return openVisit(ctx, link, found.email);
}

/** A visit on an open link: no email, only a cookie to keep the visitor's own comments theirs. */
export function openVisit(ctx: ServiceContext, link: ShareLink, email: string | null): { cookie: string; maxAge: number } {
  const cookie = randomToken(24);
  ctx.db
    .prepare("INSERT INTO visitor_sessions (id_hash, link_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(cookie), link.id, email, now(), iso(new Date(Date.now() + VISIT_DAYS * DAY)));
  return { cookie, maxAge: VISIT_DAYS * 24 * 60 * 60 };
}

/** The owner's name, for "Liam shared this with you". */
export function sharedBy(ctx: ServiceContext): string | null {
  return owner(ctx)?.name ?? null;
}

/** Every page that someone besides the owner can open right now, newest link first. */
export function listSharedPages(
  ctx: ServiceContext,
): (ShareLink & { slug: string; title: string; url: string; agent: AgentOrigin | null })[] {
  const rows = ctx.db
    .prepare(
      `SELECT s.*, a.slug AS slug, a.title AS title FROM share_links s JOIN artifacts a ON a.id = s.artifact_id
       WHERE s.revoked_at IS NULL ORDER BY s.created_at DESC`,
    )
    .all() as Row[];
  return rows
    .map((row) => ({ link: toLink(row), slug: String(row.slug), title: String(row.title) }))
    .filter(({ link }) => live(link))
    .map(({ link, slug, title }) => ({ ...link, slug, title, url: shareUrl(link), agent: agentOrigin(ctx, link.id) }));
}

// ---------------------------------------------------------------- agents

/**
 * An agent may make a link only when the owner has allowed it in Settings,
 * and only a narrow one: it expires within AGENT_SHARE_MAX_DAYS, and the
 * agent has to type the slug back and say why. The link row is the same as
 * the owner's; the share.created event records which agent made it and why,
 * so no column is needed for it.
 */
export const AGENT_SHARE_MAX_DAYS = 30;
export const AGENT_SHARE_DEFAULT_DAYS = 7;

export interface AgentOrigin {
  /** The API token or OAuth connection the agent signed in with. */
  agent: string;
  reason: string;
}

export interface AgentCaller {
  name: string;
  tokenId: string | null;
}

export interface AgentShareInput {
  confirm: string;
  reason: string;
  mode?: "link" | "email";
  allowComments?: boolean;
  expiresDays?: number;
  /** Hold the link to the current version (default), or follow the latest. */
  pin?: boolean;
}

export class AgentSharingOffError extends ServiceError {
  constructor() {
    super(
      "agent_sharing_off",
      "The operator has not allowed agents to create share links. Only the operator can allow it, in Settings › Shared links › Agents may create share links, or they can share the page themselves from its Share button. Tell the operator this and stop: do not try any other way to make the page public.",
      403,
    );
  }
}

/** Which agent made a link, and why, when an agent made it. */
export function agentOrigin(ctx: ServiceContext, linkId: string): AgentOrigin | null {
  const row = ctx.db
    .prepare(
      `SELECT json_extract(payload_json, '$.agent') AS agent, json_extract(payload_json, '$.reason') AS reason
         FROM events WHERE kind = 'share.created' AND json_extract(payload_json, '$.link_id') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(linkId) as Row | undefined;
  return row ? { agent: String(row.agent ?? "agent"), reason: String(row.reason ?? "") } : null;
}

/** Make a share link on an agent's behalf. Refused unless the owner allowed it. */
export function agentShare(
  ctx: ServiceContext,
  slug: string,
  input: AgentShareInput,
  by: AgentCaller,
): ShareLink & { url: string; agent: AgentOrigin } {
  if (!getSettings(ctx).agentSharing) throw new AgentSharingOffError();
  const artifact = requireArtifact(ctx, slug);
  if (input.confirm !== artifact.slug)
    throw new ValidationError(
      `confirm must be the page's slug typed back exactly ("${artifact.slug}"), to show this is the page the operator asked to share`,
    );
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 10 || reason.length > 500)
    throw new ValidationError("reason is required (10 to 500 characters): quote or paraphrase the operator's request to share this page");
  if (artifact.archivedAt) throw new ValidationError("this page is archived; the operator has to restore it before it can be shared");
  const mode = input.mode ?? "link";
  if (mode !== "link" && mode !== "email") throw new ValidationError('mode must be "link" or "email"');
  if (mode === "email" && !emailGateAvailable()) throw new ValidationError("email-confirmed links need email set up on this server");
  const days = input.expiresDays ?? AGENT_SHARE_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > AGENT_SHARE_MAX_DAYS)
    throw new ValidationError(
      `expires_days must be a whole number from 1 to ${AGENT_SHARE_MAX_DAYS}; an agent cannot make a link that lasts longer or never expires`,
    );

  const current = activeLink(ctx, slug);
  if (current) {
    const origin = agentOrigin(ctx, current.id);
    if (origin)
      throw new ValidationError(
        `"${slug}" already has a link, made by ${origin.agent}${current.expiresAt ? ` and open until ${current.expiresAt}` : ""}: ${shareUrl(current)}. To change it, revoke it with artifact_share_revoke and make a new one.`,
      );
    throw new ValidationError(`"${slug}" is already shared by the operator. Only they can change that link, from the page's Share button.`);
  }

  const expiresAt = iso(new Date(Date.now() + days * DAY));
  const link = withTx(ctx.db, () => {
    const made = createLink(ctx, artifact, {
      mode,
      allowComments: input.allowComments === true,
      pinnedVersion: input.pin === false ? null : artifact.currentVersion,
    });
    ctx.db.prepare("UPDATE share_links SET expires_at = ? WHERE id = ?").run(expiresAt, made.id);
    recordEvent(ctx, artifact.id, "share.created", {
      link_id: made.id,
      agent: by.name,
      token_id: by.tokenId,
      reason,
      mode,
      allow_comments: made.allowComments,
      pinned_version: made.pinnedVersion,
      expires_at: expiresAt,
    });
    return { ...made, expiresAt };
  });
  return { ...link, url: shareUrl(link), agent: { agent: by.name, reason } };
}

/** Links agents made that still work, newest first. */
export function listAgentLinks(ctx: ServiceContext) {
  return listSharedPages(ctx).filter((s) => s.agent !== null);
}

/** Revoke the page's link, when an agent made it. The owner's own links are theirs to revoke. */
export function revokeAgentLink(ctx: ServiceContext, slug: string, by: AgentCaller): ShareLink {
  const artifact = requireArtifact(ctx, slug);
  const current = activeLink(ctx, slug);
  if (!current) throw new NotFoundError(`"${slug}" has no working share link`);
  if (!agentOrigin(ctx, current.id))
    throw new ValidationError(`the operator made the link on "${slug}"; only they can revoke it, from the page's Share button`);
  withTx(ctx.db, () => {
    ctx.db.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ?").run(now(), current.id);
    recordEvent(ctx, artifact.id, "share.revoked", { link_id: current.id, agent: by.name, token_id: by.tokenId });
  });
  return current;
}
