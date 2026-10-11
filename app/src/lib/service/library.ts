import { bind } from "../db/index";
import type { ServiceContext } from "./context";
import { requireArtifact } from "./artifacts";
import { ancestorsOf, restoreWithParents, rootIdOf, setTreeArchived, subtreeIds, treeCounts } from "./tree";
import type { Kind } from "./types";
import { MARK_CLOSE, MARK_OPEN } from "./search-marks";

export { MARK_CLOSE, MARK_OPEN };

/**
 * How the library is organised: what needs the owner, what is recent, pinned,
 * live or archived, and the projects and series that group everything.
 *
 * "Needs you" is worked out from state rather than stored: an agent replied
 * since you last looked, you have comments you have not sent, an agent is
 * typing into a page right now, or a page has a version you have not seen.
 */

type Row = Record<string, unknown>;

/** How long an idle, unpinned page stays in Recent before it moves to the archive. */
export const ARCHIVE_AFTER_DAYS = 30;
/** A typing marker older than this is stale: the agent went away mid-sentence. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;

export type Reason =
  | { kind: "reply"; who: string; excerpt: string }
  | { kind: "live"; who: string }
  | { kind: "unsent"; count: number }
  /** `pages`: new versions across this many pages of one tree, folded into the newest. */
  | { kind: "new"; who: string; version: number; message: string | null; pages?: number }
  | { kind: "visitors"; count: number };

export interface LibraryRow {
  slug: string;
  title: string;
  kind: Kind;
  project: string | null;
  series: string | null;
  branch: string | null;
  agentName: string | null;
  lastAuthor: string | null;
  lastAuthorKind: "agent" | "human" | null;
  currentVersion: number;
  openThreads: number;
  unsent: number;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  unseen: boolean;
  live: string | null;
  shape: ShapeToken[];
  /** In a collapsed list, how many pages of this series the row stands for. */
  seriesCount: number;
  /** For a top page with subpages: how many pages are under it, and how many of them you have not seen. */
  subpages: number;
  subpagesUnseen: number;
  /** For a subpage shown on its own (pinned, needs you, search): the titles above it, top page first. */
  path: string[];
}

export interface NeedsYouRow extends LibraryRow {
  reason: Reason;
  at: string;
}

export interface SidebarCounts {
  needsYou: number;
  recent: number;
  pinned: number;
  live: number;
  archived: number;
  projects: { name: string; count: number; branches: { name: string; count: number }[] }[];
  series: { name: string; count: number; project: string | null }[];
}

export type LibraryFilter =
  | { view: "recent" }
  | { view: "pinned" }
  | { view: "live" }
  | { view: "archive" }
  | { view: "project"; name: string; branch?: string }
  | { view: "series"; name: string };

const isLive = (row: Row) =>
  Boolean(row.live_by) && Date.now() - Date.parse(String(row.live_at ?? 0)) < LIVE_WINDOW_MS;

// ------------------------------------------------------------ the shape
//
// A row in the library shows a tiny drawing of the page: a heading bar, lines
// of text, a row of counters, bars for a chart. It is read off the markdown
// with a few patterns rather than rendered, so the list stays cheap.

export type ShapeToken = "heading" | "text" | "kpis" | "chart" | "table" | "callout" | "form" | "code" | "app" | "image";

export function shapeOf(kind: Kind, source: string | null): ShapeToken[] {
  if (kind !== "markdown") return ["app"];
  const out: ShapeToken[] = [];
  const push = (t: ShapeToken) => {
    if (out[out.length - 1] !== t) out.push(t);
  };
  let inFence = false;
  let inBlock = false; // the body of a kpis or callout block is part of it
  for (const line of (source ?? "").replace(/^---[\s\S]*?\n---\n/, "").split("\n")) {
    if (out.length >= 5) break;
    const trimmed = line.trim();
    const fence = trimmed.match(/^(```|~~~)\s*(\w+)?/);
    if (fence) {
      if (!inFence) {
        const lang = (fence[2] ?? "").toLowerCase();
        push(lang === "chart" ? "chart" : lang === "table" ? "table" : "code");
      }
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    if (inBlock) {
      if (/^:{3,}\s*$/.test(trimmed)) inBlock = false;
      continue;
    }
    if (/^:{3}\s*kpis/.test(trimmed)) {
      push("kpis");
      inBlock = true;
    } else if (/^:{3}\s*callout/.test(trimmed)) {
      push("callout");
      inBlock = true;
    } else if (/^:{2,}\s*kpis/.test(trimmed)) push("kpis");
    else if (/^:{2,}\s*callout/.test(trimmed)) push("callout");
    else if (/^:{2,}\s*(field|choice)/.test(trimmed)) push("form");
    else if (/^:{2,}/.test(trimmed)) continue;
    else if (/^#{1,3}\s/.test(trimmed)) push("heading");
    else if (/^\|/.test(trimmed)) push("table");
    else if (/^!\[/.test(trimmed)) push("image");
    else push("text");
  }
  return out.length ? out : ["text"];
}

// ------------------------------------------------------------ rows

/** `source` is only read when the rows are drawn; counting them needs none of it. */
function baseQuery(where: string, withSource = true): string {
  return `
    SELECT a.*, ${withSource ? "v.source" : "NULL"} AS source, v.message AS version_message, v.author_kind AS last_kind, v.author_name AS last_name,
      (SELECT COUNT(*) FROM comments c WHERE c.artifact_id = a.id AND c.parent_id IS NULL AND c.status = 'open') AS open_threads,
      (SELECT COUNT(*) FROM comments c WHERE c.artifact_id = a.id AND c.status = 'open' AND c.sent_at IS NULL
        AND c.author_kind IN ('human', 'visitor')) AS unsent
    FROM artifacts a
    LEFT JOIN versions v ON v.artifact_id = a.id AND v.number = a.current_version
    ${where}`;
}

function toRow(row: Row): LibraryRow {
  return {
    slug: String(row.slug),
    title: String(row.title),
    kind: String(row.kind) as Kind,
    project: (row.project as string | null) ?? null,
    series: (row.series as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    agentName: (row.agent_name as string | null) ?? null,
    lastAuthor: (row.last_name as string | null) ?? null,
    lastAuthorKind: (row.last_kind as "agent" | "human" | null) ?? null,
    currentVersion: Number(row.current_version),
    openThreads: Number(row.open_threads ?? 0),
    unsent: Number(row.unsent ?? 0),
    updatedAt: String(row.updated_at),
    pinned: Boolean(row.pinned_at),
    archived: Boolean(row.archived_at),
    unseen: Number(row.seen_version ?? 0) < Number(row.current_version),
    live: isLive(row) ? String(row.live_by) : null,
    shape: shapeOf(String(row.kind) as Kind, (row.source as string | null) ?? null),
    seriesCount: 1,
    subpages: 0,
    subpagesUnseen: 0,
    path: [],
  };
}

/**
 * Fill in what the tree adds to rows: a top page's count of subpages (and
 * whether any is new to you), and a subpage's path. Rows carry their ids.
 */
function withTrees<T extends LibraryRow>(ctx: ServiceContext, rows: (T & { _id: string; _parent: string | null })[]): T[] {
  const counts = treeCounts(ctx, rows.filter((r) => !r._parent).map((r) => r._id));
  return rows.map(({ _id, _parent, ...rest }) => {
    const row = rest as unknown as T;
    const c = counts.get(_id);
    if (c && c.pages) {
      row.subpages = c.pages;
      row.subpagesUnseen = c.unseen;
      row.unseen = row.unseen || c.unseen > 0;
    }
    if (_parent) row.path = ancestorsOf(ctx, { parentId: _parent }).map((a) => a.title);
    return row;
  });
}

function withIds(row: Row): LibraryRow & { _id: string; _parent: string | null } {
  return { ...toRow(row), _id: String(row.id), _parent: (row.parent_id as string | null) ?? null };
}

/**
 * Keep the newest page of each series and fold the rest into it, so a nightly
 * report is one row, not thirty. Rows arrive newest first.
 */
export function collapseSeries<T extends LibraryRow>(rows: T[]): T[] {
  const kept = new Map<string, T>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row.series) {
      out.push(row);
      continue;
    }
    const first = kept.get(row.series);
    if (first) {
      first.seriesCount += 1;
      continue;
    }
    const copy = { ...row, seriesCount: 1 };
    kept.set(row.series, copy);
    out.push(copy);
  }
  return out;
}

export function listLibrary(ctx: ServiceContext, filter: LibraryFilter, limit = 300): LibraryRow[] {
  sweepArchive(ctx);
  const cap = Math.min(Math.max(limit, 1), 1000);
  let where = "";
  const params: Record<string, unknown> = { limit: cap };
  switch (filter.view) {
    // A tree is one row, its top page; the page counts what is under it.
    case "recent":
      where = "WHERE a.archived_at IS NULL AND a.parent_id IS NULL ORDER BY a.updated_at DESC";
      break;
    case "pinned":
      where = "WHERE a.pinned_at IS NOT NULL ORDER BY a.pinned_at DESC";
      break;
    case "live":
      where = "WHERE a.live_by IS NOT NULL AND a.live_at > :since ORDER BY a.live_at DESC";
      params.since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
      break;
    case "archive":
      // A tree archived together shows as its top page; a subpage archived on its own shows itself.
      where = `WHERE a.archived_at IS NOT NULL AND (a.parent_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM artifacts p WHERE p.id = a.parent_id AND p.archived_at IS NOT NULL)) ORDER BY a.updated_at DESC`;
      break;
    case "project":
      where = `WHERE a.project = :name AND a.parent_id IS NULL${filter.branch ? " AND a.branch = :branch" : ""} ORDER BY a.archived_at IS NOT NULL, a.updated_at DESC`;
      params.name = filter.name;
      if (filter.branch) params.branch = filter.branch;
      break;
    case "series":
      where = "WHERE a.series = :name ORDER BY a.created_at DESC";
      params.name = filter.name;
      break;
  }
  const rows = withTrees(ctx, (ctx.db.prepare(`${baseQuery(where)} LIMIT :limit`).all(bind(params)) as Row[]).map(withIds));
  return filter.view === "recent" || filter.view === "project" ? collapseSeries(rows) : rows;
}

/** Every page with a reason to look at it, most urgent first, newest within that. */
export function needsYou(ctx: ServiceContext, opts: { countOnly?: boolean } = {}): NeedsYouRow[] {
  const rows = ctx.db.prepare(baseQuery("WHERE a.archived_at IS NULL OR a.pinned_at IS NOT NULL", !opts.countOnly)).all() as Row[];

  // The newest agent comment per artifact, to compare with when you last looked.
  const replies = ctx.db
    .prepare(
      `SELECT c.artifact_id, c.author_name, c.body, c.created_at FROM comments c
        WHERE c.author_kind = 'agent' AND c.created_at = (
          SELECT MAX(created_at) FROM comments d WHERE d.artifact_id = c.artifact_id AND d.author_kind = 'agent')`,
    )
    .all() as Row[];
  const replyBy = new Map(replies.map((r) => [String(r.artifact_id), r]));

  const visitors = ctx.db
    .prepare(
      `SELECT artifact_id, COUNT(*) AS n FROM (
         SELECT artifact_id FROM comments WHERE author_kind = 'visitor' AND parent_id IS NULL AND endorsed_at IS NULL AND status = 'open'
         UNION ALL
         SELECT artifact_id FROM responses WHERE respondent_kind = 'visitor' AND approved_at IS NULL
       ) GROUP BY artifact_id`,
    )
    .all() as Row[];
  const visitorsBy = new Map(visitors.map((r) => [String(r.artifact_id), Number(r.n)]));

  const out: (NeedsYouRow & { rank: number; _id: string; _parent: string | null })[] = [];
  for (const row of rows) {
    const base = withIds(row);
    const seenAt = String(row.seen_at ?? "");
    const reply = replyBy.get(String(row.id));
    const waiting = visitorsBy.get(String(row.id)) ?? 0;

    let reason: Reason | null = null;
    let at = base.updatedAt;
    let rank = 9;
    if (base.live) {
      reason = { kind: "live", who: base.live };
      at = String(row.live_at);
      rank = 0;
    } else if (reply && String(reply.created_at) > seenAt) {
      reason = { kind: "reply", who: String(reply.author_name), excerpt: String(reply.body).slice(0, 160) };
      at = String(reply.created_at);
      rank = 1;
    } else if (waiting > 0) {
      reason = { kind: "visitors", count: waiting };
      rank = 2;
    } else if (base.unsent > 0) {
      reason = { kind: "unsent", count: base.unsent };
      rank = 3;
    } else if (base.unseen && base.lastAuthorKind === "agent") {
      reason = {
        kind: "new",
        who: base.lastAuthor ?? "agent",
        version: base.currentVersion,
        message: (row.version_message as string | null) ?? null,
      };
      rank = 4;
    }
    if (reason) out.push({ ...base, reason, at, rank });
  }
  out.sort((a, b) => a.rank - b.rank || (a.at < b.at ? 1 : -1));
  // New runs of a series fold into the newest one: "Nightly backup, 3 new".
  // So do new versions across one tree: a course published at once is one row.
  const newest = new Map<string, NeedsYouRow & { rank: number }>();
  const treeOfRow = new Map<string, string>();
  const rootOf = (row: { _id: string; _parent: string | null }) => {
    if (!row._parent) return row._id;
    let root = treeOfRow.get(row._id);
    if (!root) {
      root = ancestorsOf(ctx, { parentId: row._parent })[0]?.id ?? row._id;
      treeOfRow.set(row._id, root);
    }
    return root;
  };
  const folded = out.filter((row) => {
    if (row.reason.kind !== "new") return true;
    const key = row.series ? `series:${row.series}` : row._parent || subtreeIds(ctx, row._id).length > 1 ? `tree:${rootOf(row)}` : null;
    if (!key) return true;
    const first = newest.get(key);
    if (!first) {
      newest.set(key, row);
      return true;
    }
    if (key.startsWith("series:")) first.seriesCount += 1;
    else if (first.reason.kind === "new") first.reason = { ...first.reason, pages: (first.reason.pages ?? 1) + 1 };
    return false;
  });
  // Several pages of one tree new at once: the row opens the tree at its top page.
  const pageOf = new Map(rows.map((r) => [String(r.id), r]));
  for (const row of folded) {
    if (row.reason.kind !== "new" || !row.reason.pages || row.reason.pages < 2 || !row._parent) continue;
    const top = pageOf.get(rootOf(row));
    if (!top) continue;
    Object.assign(row, { slug: String(top.slug), title: String(top.title), _id: String(top.id), _parent: null });
  }
  return withTrees(ctx, folded.map(({ rank: _rank, ...rest }) => rest));
}

/** A project's branches, busiest first; the default branches sort to the top. */
export function branchesOf(ctx: ServiceContext, project: string): { name: string; count: number }[] {
  return (
    ctx.db
      .prepare(
        `SELECT branch AS name, COUNT(*) AS count FROM artifacts WHERE project = ? AND branch IS NOT NULL AND parent_id IS NULL
          GROUP BY branch ORDER BY branch IN ('main', 'master') DESC, MAX(updated_at) DESC`,
      )
      .all(project) as Row[]
  ).map((r) => ({ name: String(r.name), count: Number(r.count) }));
}

export function sidebarCounts(ctx: ServiceContext): SidebarCounts {
  sweepArchive(ctx);
  const one = (sql: string, params: unknown[] = []) =>
    Number((ctx.db.prepare(sql).get(...(params as never[])) as Row).n);
  const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
  return {
    needsYou: needsYou(ctx, { countOnly: true }).length,
    recent: one("SELECT COUNT(*) AS n FROM artifacts WHERE archived_at IS NULL AND parent_id IS NULL"),
    pinned: one("SELECT COUNT(*) AS n FROM artifacts WHERE pinned_at IS NOT NULL"),
    live: one("SELECT COUNT(*) AS n FROM artifacts WHERE live_by IS NOT NULL AND live_at > ?", [since]),
    archived: one(
      `SELECT COUNT(*) AS n FROM artifacts a WHERE a.archived_at IS NOT NULL AND (a.parent_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM artifacts p WHERE p.id = a.parent_id AND p.archived_at IS NOT NULL))`,
    ),
    projects: (
      ctx.db
        .prepare(
          "SELECT project AS name, COUNT(*) AS count FROM artifacts WHERE project IS NOT NULL AND parent_id IS NULL GROUP BY project ORDER BY MAX(updated_at) DESC",
        )
        .all() as Row[]
    ).map((r) => ({ name: String(r.name), count: Number(r.count), branches: branchesOf(ctx, String(r.name)) })),
    series: (
      ctx.db
        .prepare(
          `SELECT series AS name, COUNT(*) AS count, MAX(project) AS project FROM artifacts
            WHERE series IS NOT NULL GROUP BY series ORDER BY MAX(updated_at) DESC`,
        )
        .all() as Row[]
    ).map((r) => ({ name: String(r.name), count: Number(r.count), project: (r.project as string | null) ?? null })),
  };
}

// ------------------------------------------------------------ changes

let lastSweep = 0;

/**
 * Move idle pages to the archive: untouched for ARCHIVE_AFTER_DAYS, not pinned,
 * with no open thread. Runs at most once an hour, on the next library read.
 * Nothing is deleted, and a new version brings a page back.
 */
export function sweepArchive(ctx: ServiceContext, force = false): number {
  if (!force && Date.now() - lastSweep < 60 * 60 * 1000) return 0;
  lastSweep = Date.now();
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 86400_000).toISOString();
  // A tree goes as one: its top page, when nothing anywhere in the tree moved
  // or is pinned or has an open thread, and then everything under it.
  const idle = ctx.db
    .prepare(
      `WITH RECURSIVE t(root, id, d) AS (
         SELECT id, id, 0 FROM artifacts WHERE parent_id IS NULL AND archived_at IS NULL
         UNION ALL SELECT t.root, a.id, t.d + 1 FROM artifacts a JOIN t ON a.parent_id = t.id WHERE t.d < 10
       )
       SELECT t.root FROM t JOIN artifacts a ON a.id = t.id
        GROUP BY t.root
       HAVING MAX(a.updated_at) < :cutoff AND MAX(a.pinned_at IS NOT NULL) = 0
          AND NOT EXISTS (SELECT 1 FROM comments c JOIN t u ON u.id = c.artifact_id WHERE u.root = t.root AND c.status = 'open')`,
    )
    .all(bind({ cutoff })) as Row[];
  for (const r of idle) setTreeArchived(ctx, { id: String(r.root) }, true);
  return idle.length;
}

export function markSeen(ctx: ServiceContext, slug: string): void {
  ctx.db
    .prepare("UPDATE artifacts SET seen_version = current_version, seen_at = ? WHERE slug = ?")
    .run(new Date().toISOString(), slug);
}

export function markAllSeen(ctx: ServiceContext): void {
  ctx.db.prepare("UPDATE artifacts SET seen_version = current_version, seen_at = ?").run(new Date().toISOString());
}

export function setOrganisation(
  ctx: ServiceContext,
  slug: string,
  input: { pinned?: boolean; archived?: boolean; project?: string | null; series?: string | null },
): void {
  const artifact = requireArtifact(ctx, slug);
  const stamp = new Date().toISOString();
  if (input.pinned !== undefined)
    ctx.db.prepare("UPDATE artifacts SET pinned_at = ? WHERE slug = ?").run(input.pinned ? stamp : null, slug);
  // Archiving, restoring and moving to a project take everything under the page along.
  if (input.archived !== undefined) setTreeArchived(ctx, artifact, input.archived);
  if (input.archived === false) restoreWithParents(ctx, artifact);
  // A tree is in one project, so a project set on any page of it moves the whole tree.
  if (input.project !== undefined) {
    const set = ctx.db.prepare("UPDATE artifacts SET project = ? WHERE id = ?");
    for (const id of subtreeIds(ctx, rootIdOf(ctx, artifact))) set.run(input.project?.trim().slice(0, 80) || null, id);
  }
  if (input.series !== undefined)
    ctx.db.prepare("UPDATE artifacts SET series = ? WHERE slug = ?").run(input.series?.trim().slice(0, 80) || null, slug);
}

// ------------------------------------------------------------ search

export interface SearchResult {
  /** `path`: for a subpage, the titles above it, top page first. */
  pages: { slug: string; title: string; project: string | null; series: string | null; updatedAt: string; kind: Kind; path: string[] }[];
  hits: { slug: string; title: string; project: string | null; snippet: string; version: number; path: string[] }[];
}


/** Turn what someone typed into an FTS5 query: every word must match, as a prefix. */
export function ftsQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

export function search(ctx: ServiceContext, input: string, opts: { project?: string; limit?: number } = {}): SearchResult {
  const query = ftsQuery(input);
  if (!query) return { pages: [], hits: [] };
  const limit = Math.min(opts.limit ?? 8, 30);
  const projectClause = opts.project ? "AND a.project = :project" : "";
  // node:sqlite refuses a named parameter the statement does not use.
  const base = { q: query, limit, ...(opts.project ? { project: opts.project } : {}) };

  const pages = ctx.db
    .prepare(
      `SELECT a.slug, a.title, a.project, a.series, a.updated_at, a.kind, a.parent_id FROM search s
         JOIN artifacts a ON a.id = s.artifact_id
        WHERE search MATCH '{title description} : (' || :q || ')' ${projectClause}
        ORDER BY bm25(search), a.updated_at DESC LIMIT :limit`,
    )
    .all(bind(base)) as Row[];

  const hits = ctx.db
    .prepare(
      `SELECT a.slug, a.title, a.project, a.current_version, a.parent_id,
              snippet(search, 3, :open, :close, '…', 14) AS snippet
         FROM search s JOIN artifacts a ON a.id = s.artifact_id
        WHERE search MATCH 'body : (' || :q || ')' ${projectClause}
        ORDER BY bm25(search) LIMIT :limit`,
    )
    .all(bind({ ...base, open: MARK_OPEN, close: MARK_CLOSE })) as Row[];

  const pathOf = (r: Row) => (r.parent_id ? ancestorsOf(ctx, { parentId: String(r.parent_id) }).map((a) => a.title) : []);
  return {
    pages: pages.map((r) => ({
      slug: String(r.slug),
      title: String(r.title),
      project: (r.project as string | null) ?? null,
      series: (r.series as string | null) ?? null,
      updatedAt: String(r.updated_at),
      kind: String(r.kind) as Kind,
      path: pathOf(r),
    })),
    hits: hits.map((r) => ({
      slug: String(r.slug),
      title: String(r.title),
      project: (r.project as string | null) ?? null,
      snippet: String(r.snippet).replace(/\s+/g, " ").trim(),
      version: Number(r.current_version),
      path: pathOf(r),
    })),
  };
}
