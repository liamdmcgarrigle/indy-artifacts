import { withTx } from "../db/index";
import type { ServiceContext } from "./context";
import { NotFoundError, ServiceError, ValidationError } from "./errors";
import { getSettings } from "./settings";
import type { Artifact, Kind } from "./types";

/**
 * Subpages. A page can sit under another page, which makes a tree: a course
 * and its modules and lessons, or a report and its appendices. Every page in
 * a tree is still a page of its own, with its own versions, comments, ticks
 * and answers; the tree only adds what is around them: the way through it,
 * one row in the library, and a share link that covers a page and everything
 * under it.
 *
 * Siblings are kept in `position` order, renumbered from 0 whenever one moves.
 * A sibling can also carry a `group`, a heading it is listed under ("For
 * authors"). Pages without a group come first, then each group in the order
 * of its first page.
 */

/** How many levels a tree goes below its top page: course, module, lesson, unit. */
export const MAX_DEPTH = 3;
const GROUP_CHARS = 60;

type Row = Record<string, unknown>;

export interface TreeNode {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: Kind;
  /** 0 for the top page. */
  depth: number;
  parentSlug: string | null;
  group: string | null;
  position: number;
  currentVersion: number;
  unseen: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface Tree {
  root: TreeNode;
  /** Every page, the top page first, in reading order. */
  nodes: TreeNode[];
}

/** The ids of a page and everything under it. */
export function subtreeIds(ctx: ServiceContext, id: string): string[] {
  return (
    ctx.db
      .prepare(
        `WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT a.id FROM artifacts a JOIN t ON a.parent_id = t.id)
         SELECT id FROM t`,
      )
      .all(id) as Row[]
  ).map((r) => String(r.id));
}

/** A page's parents, the top page first. Empty for a page with no parent. */
export function ancestorsOf(ctx: ServiceContext, artifact: Pick<Artifact, "parentId">): { id: string; slug: string; title: string }[] {
  const out: { id: string; slug: string; title: string }[] = [];
  let next = artifact.parentId;
  // The depth limit keeps chains short; the bound guards against a loop written by hand.
  for (let i = 0; next && i <= MAX_DEPTH + 2; i++) {
    const row = ctx.db.prepare("SELECT id, slug, title, parent_id FROM artifacts WHERE id = ?").get(next) as Row | undefined;
    if (!row) break;
    out.unshift({ id: String(row.id), slug: String(row.slug), title: String(row.title) });
    next = (row.parent_id as string | null) ?? null;
  }
  return out;
}

export function rootIdOf(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId">): string {
  return ancestorsOf(ctx, artifact)[0]?.id ?? artifact.id;
}

/** How many levels a page's own subpages go below it: 0 when it has none. */
function heightOf(ctx: ServiceContext, id: string): number {
  const row = ctx.db
    .prepare(
      `WITH RECURSIVE t(id, d) AS (SELECT ?, 0 UNION ALL SELECT a.id, t.d + 1 FROM artifacts a JOIN t ON a.parent_id = t.id WHERE t.d < 10)
       SELECT MAX(d) AS h FROM t`,
    )
    .get(id) as Row;
  return Number(row.h ?? 0);
}

/** Siblings in reading order: ungrouped first, then each group where its first page stands. */
export function orderSiblings<T extends { group: string | null; position: number; slug: string }>(pages: T[]): T[] {
  const byPos = [...pages].sort((a, b) => a.position - b.position || (a.slug < b.slug ? -1 : 1));
  const groups: string[] = [];
  for (const p of byPos) if (p.group && !groups.includes(p.group)) groups.push(p.group);
  return [...byPos.filter((p) => !p.group), ...groups.flatMap((g) => byPos.filter((p) => p.group === g))];
}

function toNode(row: Row): TreeNode {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    kind: String(row.kind) as Kind,
    depth: Number(row.depth),
    parentSlug: (row.parent_slug as string | null) ?? null,
    group: (row.nav_group as string | null) ?? null,
    position: Number(row.position ?? 0),
    currentVersion: Number(row.current_version),
    unseen: Number(row.seen_version ?? 0) < Number(row.current_version),
    archived: Boolean(row.archived_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * The tree a page belongs to, or null when it stands alone. Archived pages
 * under a live parent are left out unless `includeArchived`: archiving a
 * subpage takes it out of the way through.
 */
export function treeOf(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId">, opts: { includeArchived?: boolean } = {}): Tree | null {
  const rootId = rootIdOf(ctx, artifact);
  const rows = ctx.db
    .prepare(
      `WITH RECURSIVE t(id, depth) AS (
         SELECT ?, 0
         UNION ALL SELECT a.id, t.depth + 1 FROM artifacts a JOIN t ON a.parent_id = t.id WHERE t.depth < 10
       )
       SELECT a.id, a.slug, a.title, a.description, a.kind, a.nav_group, a.position, a.current_version, a.seen_version,
              a.archived_at, a.updated_at, a.parent_id, p.slug AS parent_slug, t.depth
         FROM t JOIN artifacts a ON a.id = t.id LEFT JOIN artifacts p ON p.id = a.parent_id`,
    )
    .all(rootId) as Row[];
  if (rows.length <= 1) return null;
  const nodes = rows.map(toNode);
  const root = nodes.find((n) => n.id === rootId)!;
  const children = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.id === rootId || !n.parentSlug) continue;
    const list = children.get(n.parentSlug) ?? [];
    list.push(n);
    children.set(n.parentSlug, list);
  }
  const ordered: TreeNode[] = [];
  const walk = (node: TreeNode) => {
    ordered.push(node);
    for (const child of orderSiblings(children.get(node.slug) ?? [])) {
      // An archived page and everything under it drop out, unless the whole tree is archived.
      if (child.archived && !root.archived && !opts.includeArchived) continue;
      walk(child);
    }
  };
  walk(root);
  return ordered.length > 1 ? { root, nodes: ordered } : null;
}

/** The pages directly under a page, in reading order. */
export function childrenOf(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId" | "slug">): TreeNode[] {
  const tree = treeOf(ctx, artifact);
  return tree ? tree.nodes.filter((n) => n.parentSlug === artifact.slug) : [];
}

/** For each top page, how many pages sit under it and how many of all its pages you have not seen. */
export function treeCounts(ctx: ServiceContext, rootIds: string[]): Map<string, { pages: number; unseen: number }> {
  const out = new Map<string, { pages: number; unseen: number }>();
  if (!rootIds.length) return out;
  const rows = ctx.db
    .prepare(
      // Archived pages under a live top page drop out, as they do from the contents list.
      `WITH RECURSIVE t(root, id, d, gone) AS (
         SELECT id, id, 0, archived_at IS NOT NULL FROM artifacts WHERE id IN (SELECT value FROM json_each(?))
         UNION ALL SELECT t.root, a.id, t.d + 1, t.gone FROM artifacts a JOIN t ON a.parent_id = t.id
          WHERE t.d < 10 AND (t.gone OR a.archived_at IS NULL)
       )
       SELECT t.root, COUNT(*) - 1 AS pages,
              SUM(CASE WHEN t.d > 0 AND a.archived_at IS NULL AND a.seen_version < a.current_version THEN 1 ELSE 0 END) AS unseen
         FROM t JOIN artifacts a ON a.id = t.id GROUP BY t.root`,
    )
    .all(JSON.stringify(rootIds)) as Row[];
  for (const r of rows) out.set(String(r.root), { pages: Number(r.pages), unseen: Number(r.unseen ?? 0) });
  return out;
}

export interface Placement {
  /** The parent's slug; null makes it a top page; undefined keeps the parent it has. */
  parent?: string | null;
  position?: number;
  group?: string | null;
}

function cleanGroup(group: string | null | undefined): string | null | undefined {
  if (group === undefined) return undefined;
  const g = (group ?? "").trim().slice(0, GROUP_CHARS);
  return g || null;
}

/**
 * Check a placement before anything is written: the parent exists, is not the
 * page or one of its own subpages, and the tree stays within MAX_DEPTH.
 * Returns the parent's id (null for a top page), or undefined when the
 * placement leaves the parent alone.
 */
export function checkPlacement(ctx: ServiceContext, artifact: Pick<Artifact, "id"> | null, place: Placement): string | null | undefined {
  if (place.position !== undefined && (!Number.isInteger(place.position) || place.position < 0))
    throw new ValidationError("position must be a whole number from 0");
  if (place.parent === undefined) return undefined;
  if (place.parent === null || place.parent === "") return null;
  const parent = ctx.db.prepare("SELECT id, parent_id FROM artifacts WHERE slug = ?").get(place.parent.trim().toLowerCase()) as Row | undefined;
  if (!parent) throw new NotFoundError(`no page with slug "${place.parent}" to put this under`);
  const parentId = String(parent.id);
  if (artifact) {
    if (parentId === artifact.id) throw new ValidationError("a page cannot sit under itself");
    if (subtreeIds(ctx, artifact.id).includes(parentId))
      throw new ValidationError(`"${place.parent}" is under this page already, so this page cannot go under it`);
  }
  const parentDepth = ancestorsOf(ctx, { parentId: (parent.parent_id as string | null) ?? null }).length;
  const below = artifact ? heightOf(ctx, artifact.id) : 0;
  if (parentDepth + 1 + below > MAX_DEPTH)
    throw new ValidationError(
      `a tree goes at most ${MAX_DEPTH} levels below its top page; "${place.parent}" is ${parentDepth} level${parentDepth === 1 ? "" : "s"} down${below ? ` and this page has ${below} level${below === 1 ? "" : "s"} of its own under it` : ""}`,
    );
  return parentId;
}

/**
 * Put a page in its place: under a parent (or at the top), at a position among
 * its siblings, in a group. Siblings are renumbered so positions stay 0..n-1.
 * Runs inside the caller's transaction when there is one.
 */
export function placePage(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId" | "group">, place: Placement): void {
  const parentId = checkPlacement(ctx, artifact, place);
  const group = cleanGroup(place.group);
  if (parentId === undefined && place.position === undefined && group === undefined) return;
  const newParent = parentId === undefined ? artifact.parentId : parentId;
  const moved = newParent !== artifact.parentId;

  const write = () => {
    const finalGroup = group === undefined ? (moved ? null : artifact.group) : group;
    // Top pages have no order or group of their own; the library sorts them.
    if (!newParent) {
      ctx.db.prepare("UPDATE artifacts SET parent_id = NULL, position = 0, nav_group = NULL WHERE id = ?").run(artifact.id);
      return;
    }
    const siblings = (
      ctx.db.prepare("SELECT id, slug, position, nav_group FROM artifacts WHERE parent_id = ? AND id != ?").all(newParent, artifact.id) as Row[]
    ).map((r) => ({ id: String(r.id), slug: String(r.slug), position: Number(r.position), group: (r.nav_group as string | null) ?? null }));
    const ordered = orderSiblings(siblings);
    const at = place.position === undefined ? (moved ? ordered.length : currentIndex(ctx, artifact.id, ordered)) : Math.min(place.position, ordered.length);
    ordered.splice(at, 0, { id: artifact.id, slug: "", position: 0, group: finalGroup });
    const set = ctx.db.prepare("UPDATE artifacts SET position = ? WHERE id = ?");
    ordered.forEach((s, i) => set.run(i, s.id));
    ctx.db.prepare("UPDATE artifacts SET parent_id = ?, nav_group = ? WHERE id = ?").run(newParent, finalGroup, artifact.id);
    // A tree is in one project, its top page's: a page moved into one takes it, with everything under it.
    if (moved) {
      const top = ancestorsOf(ctx, { parentId: newParent })[0];
      const project = (ctx.db.prepare("SELECT project FROM artifacts WHERE id = ?").get(top.id) as Row).project ?? null;
      const set = ctx.db.prepare("UPDATE artifacts SET project = ? WHERE id = ?");
      for (const id of subtreeIds(ctx, artifact.id)) set.run(project as string | null, id);
    }
  };
  if (ctx.db.isTransaction) write();
  else withTx(ctx.db, write);
}

/** Where a page stood among its siblings before it was taken out of the list. */
function currentIndex(ctx: ServiceContext, id: string, others: { position: number }[]): number {
  const row = ctx.db.prepare("SELECT position FROM artifacts WHERE id = ?").get(id) as Row | undefined;
  const pos = Number(row?.position ?? 0);
  const i = others.findIndex((s) => s.position > pos);
  return i === -1 ? others.length : i;
}

/** Archive or restore a page together with everything under it. */
export function setTreeArchived(ctx: ServiceContext, artifact: Pick<Artifact, "id">, archived: boolean): void {
  const ids = subtreeIds(ctx, artifact.id);
  const stamp = archived ? new Date().toISOString() : null;
  const set = ctx.db.prepare("UPDATE artifacts SET archived_at = ? WHERE id = ?");
  const run = () => ids.forEach((id) => set.run(stamp, id));
  if (ctx.db.isTransaction) run();
  else withTx(ctx.db, run);
}

/**
 * Bring a page back from the archive without leaving it under an archived
 * page: the pages above it come back too, and when its top page was archived,
 * the whole tree does (the sweep archives trees whole).
 */
export function restoreWithParents(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId">): void {
  const chain = ancestorsOf(ctx, artifact);
  const archived = (id: string) => Boolean((ctx.db.prepare("SELECT archived_at FROM artifacts WHERE id = ?").get(id) as Row | undefined)?.archived_at);
  const run = () => {
    if (chain[0] && archived(chain[0].id)) return setTreeArchived(ctx, chain[0], false);
    const set = ctx.db.prepare("UPDATE artifacts SET archived_at = NULL WHERE id = ?");
    for (const page of chain) if (archived(page.id)) set.run(page.id);
  };
  if (ctx.db.isTransaction) run();
  else withTx(ctx.db, run);
}

/** The project a page's tree is in: its top page's. Undefined for a top page. */
export function treeProject(ctx: ServiceContext, artifact: Pick<Artifact, "parentId">): string | null | undefined {
  const top = ancestorsOf(ctx, artifact)[0];
  if (!top) return undefined;
  return ((ctx.db.prepare("SELECT project FROM artifacts WHERE id = ?").get(top.id) as Row).project as string | null) ?? null;
}

/**
 * An agent moving a page into a tree that has a share link would make the
 * page public. When the operator has not let agents share, that is refused
 * the same way a share link is. A page an agent writes new under a shared
 * page is like an edit to the shared page, and is allowed.
 */
export function assertAgentMayMove(ctx: ServiceContext, artifact: Pick<Artifact, "id" | "parentId">, place: Placement): void {
  if (!place.parent || getSettings(ctx).agentSharing) return;
  const parent = ctx.db.prepare("SELECT id, slug, parent_id FROM artifacts WHERE slug = ?").get(place.parent.trim().toLowerCase()) as Row | undefined;
  if (!parent) return;
  const stamp = new Date().toISOString();
  const shared = (id: string) =>
    !!ctx.db
      .prepare("SELECT 1 FROM share_links WHERE artifact_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .get(id, stamp);
  const now = new Set([artifact.id, ...ancestorsOf(ctx, artifact).map((a) => a.id)]);
  const after = [String(parent.id), ...ancestorsOf(ctx, { parentId: (parent.parent_id as string | null) ?? null }).map((a) => a.id)];
  if (after.some((id) => !now.has(id) && shared(id)))
    throw new ServiceError(
      "agent_sharing_off",
      `"${parent.slug}" is shared with a link, so moving this page under it would make the page public, and the operator has not allowed agents to share pages. Tell the operator; they can move it themselves from the contents list.`,
      403,
    );
}
