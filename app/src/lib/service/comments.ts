import { customAlphabet } from "nanoid";
import { bind, withTx } from "../db/index.js";
import type { ServiceContext } from "./context.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";
import { requireArtifact } from "./artifacts.js";
import { LIMITS, type Anchor, type AuthorKind, type Comment, type CommentStatus } from "./types.js";

const id12 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const now = () => new Date().toISOString();

type Row = Record<string, unknown>;

function toComment(row: Row): Comment {
  return {
    id: String(row.id),
    artifactId: String(row.artifact_id),
    versionNumber: Number(row.version_number),
    parentId: (row.parent_id as string | null) ?? null,
    authorKind: String(row.author_kind) as AuthorKind,
    authorName: String(row.author_name),
    body: String(row.body),
    anchor: row.anchor_json ? (JSON.parse(String(row.anchor_json)) as Anchor) : null,
    status: String(row.status) as CommentStatus,
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function validateAnchor(raw: unknown): Anchor | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("anchor must be an object");
  const a = raw as Record<string, unknown>;
  const type = String(a.type ?? "");
  if (!["point", "range", "element"].includes(type))
    throw new ValidationError('anchor.type must be "point", "range" or "element"');
  if (typeof a.block !== "string" || !a.block) throw new ValidationError("anchor.block is required");
  const lines = Array.isArray(a.lines) && a.lines.length === 2 ? ([Number(a.lines[0]), Number(a.lines[1])] as [number, number]) : undefined;
  const out: Anchor = { type: type as Anchor["type"], block: a.block };
  if (lines && lines.every((n) => Number.isFinite(n))) out.lines = lines;
  if (typeof a.quote === "string") out.quote = a.quote.slice(0, 2000);
  if (typeof a.context === "string") out.context = a.context.slice(0, 2000);
  if (typeof a.offset === "number") out.offset = a.offset;
  if (typeof a.start === "number") out.start = a.start;
  if (typeof a.end === "number") out.end = a.end;
  if (typeof a.selector === "string") out.selector = a.selector.slice(0, 500);
  if (typeof a.x === "number") out.x = a.x;
  if (typeof a.y === "number") out.y = a.y;
  return out;
}

export interface CreateCommentInput {
  body: string;
  authorName: string;
  authorKind?: AuthorKind;
  parentId?: string | null;
  anchor?: unknown;
  notify?: boolean;
  versionNumber?: number;
}

export function createComment(ctx: ServiceContext, slug: string, input: CreateCommentInput): Comment {
  const artifact = requireArtifact(ctx, slug);
  const body = String(input.body ?? "").trim();
  if (!body) throw new ValidationError("comment body is empty");
  if (Buffer.byteLength(body, "utf8") > LIMITS.commentBytes)
    throw new ValidationError(`comment is over the ${LIMITS.commentBytes / 1024} KB limit`);

  const authorKind: AuthorKind = input.authorKind === "agent" ? "agent" : "human";
  let anchor = validateAnchor(input.anchor);
  let versionNumber = input.versionNumber ?? artifact.currentVersion;

  if (input.parentId) {
    const parent = ctx.db.prepare("SELECT * FROM comments WHERE id = ?").get(input.parentId) as Row | undefined;
    if (!parent) throw new NotFoundError(`no comment with id ${input.parentId}`);
    if (String(parent.artifact_id) !== artifact.id)
      throw new ValidationError("the parent comment belongs to a different artifact");
    if (parent.parent_id) throw new ValidationError("replies are one level deep; reply to the thread root");
    anchor = null;
    versionNumber = Number(parent.version_number);
  }

  const id = id12();
  const stamp = now();
  const notify = input.notify === true && authorKind === "human";

  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO comments (id, artifact_id, version_number, parent_id, author_kind, author_name, body, anchor_json, status, sent_at, created_at, updated_at)
         VALUES (:id, :artifact_id, :version_number, :parent_id, :author_kind, :author_name, :body, :anchor_json, 'open', :sent_at, :created_at, :updated_at)`,
      )
      .run(
        bind({
          id,
          artifact_id: artifact.id,
          version_number: versionNumber,
          parent_id: input.parentId ?? null,
          author_kind: authorKind,
          author_name: input.authorName || (authorKind === "agent" ? "agent" : "operator"),
          body,
          anchor_json: anchor ? JSON.stringify(anchor) : null,
          sent_at: notify ? stamp : null,
          created_at: stamp,
          updated_at: stamp,
        }),
      );

    if (notify) {
      recordEvent(ctx, artifact.id, "comment.created", {
        comment: {
          id,
          body,
          author_name: input.authorName || "operator",
          anchor,
          version_number: versionNumber,
        },
      });
    }
  });

  return getComment(ctx, id);
}

export function getComment(ctx: ServiceContext, id: string): Comment {
  const row = ctx.db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new NotFoundError(`no comment with id ${id}`);
  return toComment(row);
}

export interface Thread extends Comment {
  replies: Comment[];
}

export function listComments(
  ctx: ServiceContext,
  slug: string,
  opts: { status?: CommentStatus | "all" } = {},
): Thread[] {
  const artifact = requireArtifact(ctx, slug);
  const status = opts.status ?? "open";
  const rows = ctx.db
    .prepare("SELECT * FROM comments WHERE artifact_id = ? ORDER BY created_at ASC")
    .all(artifact.id) as Row[];
  const all = rows.map(toComment);
  const roots = all.filter((c) => c.parentId === null && (status === "all" || c.status === status));
  return roots.map((root) => ({ ...root, replies: all.filter((c) => c.parentId === root.id) }));
}

export function patchComment(
  ctx: ServiceContext,
  id: string,
  patch: { status?: CommentStatus; body?: string },
): Comment {
  const existing = getComment(ctx, id);
  const fields: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: now() };

  if (patch.status) {
    if (!["open", "resolved"].includes(patch.status)) throw new ValidationError("status must be open or resolved");
    fields.push("status = :status");
    params.status = patch.status;
  }
  if (patch.body !== undefined) {
    const body = String(patch.body).trim();
    if (!body) throw new ValidationError("comment body is empty");
    if (Buffer.byteLength(body, "utf8") > LIMITS.commentBytes)
      throw new ValidationError(`comment is over the ${LIMITS.commentBytes / 1024} KB limit`);
    fields.push("body = :body");
    params.body = body;
  }
  if (fields.length === 0) return existing;

  ctx.db
    .prepare(`UPDATE comments SET ${fields.join(", ")}, updated_at = :updated_at WHERE id = :id`)
    .run(bind(params));

  if (patch.status === "resolved" && existing.parentId === null) {
    ctx.db
      .prepare("UPDATE comments SET status = 'resolved', updated_at = :updated_at WHERE parent_id = :id")
      .run(bind({ id, updated_at: params.updated_at }));
  }
  return getComment(ctx, id);
}

export interface SendResult {
  eventId: number | null;
  count: number;
}

/** Bundle every unsent open human comment into one notification for the agent. */
export function sendFeedback(
  ctx: ServiceContext,
  slug: string,
  opts: { message?: string; authorName?: string } = {},
): SendResult {
  const artifact = requireArtifact(ctx, slug);
  const rows = ctx.db
    .prepare(
      "SELECT * FROM comments WHERE artifact_id = ? AND author_kind = 'human' AND status = 'open' AND sent_at IS NULL ORDER BY created_at ASC",
    )
    .all(artifact.id) as Row[];
  const pending = rows.map(toComment);
  if (pending.length === 0) return { eventId: null, count: 0 };

  const stamp = now();
  let eventId = 0;
  withTx(ctx.db, () => {
    const mark = ctx.db.prepare("UPDATE comments SET sent_at = :at, updated_at = :at WHERE id = :id");
    for (const c of pending) mark.run(bind({ id: c.id, at: stamp }));
    eventId = recordEvent(ctx, artifact.id, "feedback.sent", {
      message: opts.message?.trim() || null,
      author_name: opts.authorName || "operator",
      version_number: artifact.currentVersion,
      comments: pending.map((c) => ({
        id: c.id,
        body: c.body,
        author_name: c.authorName,
        anchor: c.anchor,
        version_number: c.versionNumber,
      })),
    });
  });

  return { eventId, count: pending.length };
}

export function countUnsent(ctx: ServiceContext, artifactId: string): number {
  const row = ctx.db
    .prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE artifact_id = ? AND author_kind = 'human' AND status = 'open' AND sent_at IS NULL",
    )
    .get(artifactId) as Row;
  return Number(row.n);
}
