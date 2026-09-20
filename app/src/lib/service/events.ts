import { bind } from "../db/index.js";
import { artifactUrl, type ServiceContext } from "./context.js";
import { NotFoundError } from "./errors.js";
import type { EventKind, EventRecord } from "./types.js";

type Row = Record<string, unknown>;

/** Append to the outbox. Call inside the caller's transaction when there is one. */
export function recordEvent(
  ctx: ServiceContext,
  artifactId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
): number {
  const info = ctx.db
    .prepare(
      "INSERT INTO events (artifact_id, kind, payload_json, created_at) VALUES (:artifact_id, :kind, :payload_json, :created_at)",
    )
    .run(
      bind({
        artifact_id: artifactId,
        kind,
        payload_json: JSON.stringify(payload),
        created_at: new Date().toISOString(),
      }),
    );
  return Number(info.lastInsertRowid);
}

function toEvent(ctx: ServiceContext, row: Row): EventRecord {
  return {
    id: Number(row.id),
    kind: String(row.kind) as EventKind,
    createdAt: String(row.created_at),
    deliveredAt: (row.delivered_at as string | null) ?? null,
    deliveryNote: (row.delivery_note as string | null) ?? null,
    artifact: {
      slug: String(row.slug),
      title: String(row.title),
      url: artifactUrl(ctx, String(row.slug)),
      terminalHandle: (row.terminal_handle as string | null) ?? null,
      agentName: (row.agent_name as string | null) ?? null,
    },
    payload: JSON.parse(String(row.payload_json ?? "{}")),
  };
}

export interface ListEventsOptions {
  after?: number;
  limit?: number;
  slug?: string;
  undeliveredOnly?: boolean;
}

export function listEvents(ctx: ServiceContext, opts: ListEventsOptions = {}): { events: EventRecord[]; lastId: number } {
  const after = Math.max(opts.after ?? 0, 0);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = ["e.id > :after"];
  const params: Record<string, unknown> = { after, limit };
  if (opts.slug) {
    where.push("a.slug = :slug");
    params.slug = opts.slug;
  }
  if (opts.undeliveredOnly) where.push("e.delivered_at IS NULL");

  const rows = ctx.db
    .prepare(
      `SELECT e.*, a.slug, a.title, a.terminal_handle, a.agent_name
         FROM events e JOIN artifacts a ON a.id = e.artifact_id
        WHERE ${where.join(" AND ")}
        ORDER BY e.id ASC LIMIT :limit`,
    )
    .all(bind(params)) as Row[];

  const events = rows.map((r) => toEvent(ctx, r));
  const maxRow = ctx.db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM events").get() as Row;
  const lastId = events.length ? events[events.length - 1].id : Math.max(after, Number(maxRow.n));
  return { events, lastId };
}

export function ackEvent(ctx: ServiceContext, id: number, note = "sent"): void {
  const info = ctx.db
    .prepare("UPDATE events SET delivered_at = :at, delivery_note = :note WHERE id = :id AND delivered_at IS NULL")
    .run(bind({ id, at: new Date().toISOString(), note }));
  if (Number(info.changes) === 0) {
    const exists = ctx.db.prepare("SELECT id FROM events WHERE id = ?").get(id);
    if (!exists) throw new NotFoundError(`no event with id ${id}`);
  }
}
