import { artifactUrl, type ServiceContext } from "./context";
import { ConflictError, ValidationError } from "./errors";
import {
  findArtifact,
  isValidSlug,
  publishArtifact,
  requireVersion,
  resolveMeta,
  resolvePlacement,
  updateArtifact,
  validateContent,
} from "./artifacts";
import { assertAgentMayMove, MAX_DEPTH, placePage } from "./tree";
import type { Artifact, Kind, PublishInput, PublishResult } from "./types";

/**
 * Publishing a whole tree in one call: a course, a report with its appendices.
 * Every page is checked before any is written (slugs, parents, depth, sizes,
 * and whether someone edited a page since the agent last read it), so a
 * mistake in page 40 does not leave 39 pages behind. Pages are then written
 * parents first. A page whose content is the same as its current version is
 * not given a new version, so a build script can publish its whole tree again
 * after changing one lesson.
 */

export const TREE_LIMITS = { pages: 200, bytes: 20 * 1048576 };

export interface TreePageInput extends PublishInput {
  slug: string;
  /** For a page that exists: the version last read. Left out, the page must not have been edited by a person since an agent wrote it. */
  expectedVersion?: number;
}

export interface TreeInput {
  pages: TreePageInput[];
  /** Applied to every page that does not set its own. */
  shared?: Pick<PublishInput, "project" | "branch" | "series" | "theme" | "message" | "agent">;
}

export interface TreePageResult {
  slug: string;
  action: "created" | "updated" | "unchanged";
  version: number;
  url: string;
  warnings: PublishResult["warnings"];
  buildStatus?: PublishResult["buildStatus"];
  droppedTicks?: PublishResult["droppedTicks"];
}

export async function publishTree(ctx: ServiceContext, input: TreeInput): Promise<TreePageResult[]> {
  const pages = input.pages ?? [];
  if (!Array.isArray(pages) || pages.length === 0) throw new ValidationError('"pages" needs at least one page');
  if (pages.length > TREE_LIMITS.pages) throw new ValidationError(`at most ${TREE_LIMITS.pages} pages in one call`);
  const bytes = pages.reduce(
    (n, p) => n + Buffer.byteLength(typeof p.source === "string" ? p.source : "") + Object.values(p.files ?? {}).reduce((m, f) => m + Buffer.byteLength(String(f)), 0),
    0,
  );
  if (bytes > TREE_LIMITS.bytes) throw new ValidationError(`the pages come to ${Math.ceil(bytes / 1048576)} MB; one call takes at most ${TREE_LIMITS.bytes / 1048576} MB`);

  // ---- check everything first
  type Planned = {
    slug: string;
    input: PublishInput;
    existing: Artifact | undefined;
    /** The version checked against, written on top of. */
    checked: number | undefined;
    unchanged: boolean;
    parentSlug: string | null | undefined;
  };
  const bySlug = new Map<string, Planned>();
  for (const raw of pages) {
    const slug = String(raw.slug ?? "").trim().toLowerCase();
    if (!isValidSlug(slug)) throw new ValidationError(`every page needs a slug of 3-64 characters of a-z, 0-9 and dashes: "${raw.slug ?? ""}"`);
    if (bySlug.has(slug)) throw new ValidationError(`"${slug}" is in the list twice`);
    const existing = findArtifact(ctx, slug) ?? undefined;
    const kind = (existing?.kind ?? raw.kind ?? "markdown") as Kind;
    if (existing && raw.kind && raw.kind !== existing.kind)
      throw new ValidationError(`"${slug}" is a ${existing.kind} page and its kind cannot change`);
    if (!existing && (kind === "markdown" || kind === "html") && typeof raw.source !== "string")
      throw new ValidationError(`"${slug}" is new and needs a source`);
    const { expectedVersion, ...rest } = raw;
    const merged: PublishInput = { ...input.shared, ...rest, slug, agent: raw.agent ?? input.shared?.agent };
    const previous = existing ? requireVersion(ctx, existing) : undefined;
    // The same checks a single publish makes, so a bad page 40 stops the call before page 1 is written.
    let content: ReturnType<typeof validateContent>;
    let meta: ReturnType<typeof resolveMeta>;
    try {
      content = validateContent(kind, merged, previous);
      meta = resolveMeta(ctx, kind, merged, content.source, existing, previous?.source);
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(`"${slug}": ${err.message}`);
      throw err;
    }
    const place = resolvePlacement(kind, merged, content.source, previous?.source);
    if (place.position !== undefined && (!Number.isInteger(place.position) || place.position < 0))
      throw new ValidationError(`"${slug}": position must be a whole number from 0`);
    const parentSlug = place.parent === undefined ? undefined : place.parent ? place.parent.trim().toLowerCase() : null;
    const unchanged =
      !!existing &&
      !!previous &&
      merged.assets === undefined &&
      content.source === previous.source &&
      JSON.stringify(content.files ?? null) === JSON.stringify(previous.files ?? null) &&
      meta.title === existing.title &&
      (meta.description ?? null) === (existing.description ?? null) &&
      meta.theme === existing.theme &&
      (meta.branch ?? null) === (existing.branch ?? null) &&
      (meta.series ?? null) === (existing.series ?? null) &&
      JSON.stringify(meta.tags) === JSON.stringify(existing.tags) &&
      // A subpage takes its tree's project, so only a top page's project counts.
      ((parentSlug === undefined ? !!existing.parentId : !!parentSlug) || (meta.project ?? null) === (existing.project ?? null));
    bySlug.set(slug, {
      slug,
      input: { ...merged, ...(place.group !== undefined ? { group: place.group } : {}), position: place.position },
      existing,
      checked: existing ? (expectedVersion ?? existing.currentVersion) : undefined,
      unchanged,
      parentSlug,
    });
  }

  // The tree as it will be: each page's parent, from this call or as published.
  const slugOfId = (id: string | null) =>
    id ? ((ctx.db.prepare("SELECT slug FROM artifacts WHERE id = ?").get(id) as { slug: string } | undefined)?.slug ?? null) : null;
  const parentOf = (slug: string): string | null => {
    const page = bySlug.get(slug);
    if (page && page.parentSlug !== undefined) return page.parentSlug;
    return slugOfId((page?.existing ?? findArtifact(ctx, slug))?.parentId ?? null);
  };
  const childrenOf = (slug: string): string[] => {
    const out = new Set<string>();
    for (const s of bySlug.keys()) if (parentOf(s) === slug) out.add(s);
    const found = bySlug.get(slug)?.existing ?? findArtifact(ctx, slug);
    if (found) {
      const rows = ctx.db.prepare("SELECT slug FROM artifacts WHERE parent_id = ?").all(found.id) as { slug: string }[];
      for (const r of rows) if (parentOf(r.slug) === slug) out.add(r.slug);
    }
    return [...out];
  };
  const depthOf = (slug: string): number => {
    const seen = [slug];
    for (let parent = parentOf(slug); parent; parent = parentOf(parent)) {
      if (seen.includes(parent)) throw new ValidationError(`the pages go round in a loop: ${[...seen, parent].join(" → ")}`);
      if (!bySlug.has(parent) && !findArtifact(ctx, parent))
        throw new ValidationError(`"${seen[seen.length - 1]}" goes under "${parent}", which is neither in this call nor published`);
      seen.push(parent);
    }
    return seen.length - 1;
  };
  const heightOf = (slug: string, d = 0): number =>
    d > MAX_DEPTH + 2 ? d : Math.max(0, ...childrenOf(slug).map((c) => 1 + heightOf(c, d + 1)));
  for (const slug of bySlug.keys()) {
    const depth = depthOf(slug);
    const below = heightOf(slug);
    if (depth + below > MAX_DEPTH)
      throw new ValidationError(
        `"${slug}" would be ${depth} level${depth === 1 ? "" : "s"} below its top page${below ? `, with ${below} more under it` : ""}; a tree goes at most ${MAX_DEPTH}`,
      );
  }

  for (const page of bySlug.values()) if (page.existing) assertAgentMayMove(ctx, page.existing, { parent: page.parentSlug });

  // Someone may have edited a page since the agent read it: stop before writing anything.
  const conflicts: string[] = [];
  for (const page of bySlug.values()) {
    const existing = page.existing;
    if (!existing) continue;
    const expected = pages.find((p) => String(p.slug ?? "").trim().toLowerCase() === page.slug)?.expectedVersion;
    if (expected !== undefined) {
      if (expected !== existing.currentVersion)
        conflicts.push(`"${page.slug}" is at version ${existing.currentVersion}, not ${expected}`);
    } else if (!page.unchanged && requireVersion(ctx, existing).authorKind === "human") {
      conflicts.push(`"${page.slug}" was last edited by a person (version ${existing.currentVersion}); read it and pass its expected_version`);
    }
  }
  if (conflicts.length)
    throw new ConflictError(`nothing was published, because some pages changed since you read them:\n  ${conflicts.join("\n  ")}`, 0);

  // ---- where each page goes among its siblings
  // When the call lists every page under a parent, they take the order of the call.
  // Otherwise the pages already there keep their places and the new ones go at the end,
  // so publishing one lesson again does not reorder the module.
  const position = new Map<string, number | undefined>();
  const parents = new Set([...bySlug.keys()].map(parentOf).filter((p): p is string => !!p));
  for (const parent of parents) {
    const all = childrenOf(parent);
    const listed = [...bySlug.keys()].filter((s) => parentOf(s) === parent);
    const whole = all.every((s) => bySlug.has(s));
    listed.forEach((s, i) => position.set(s, bySlug.get(s)!.input.position ?? (whole ? i : undefined)));
  }

  // ---- parents first
  const order: string[] = [];
  const visit = (slug: string) => {
    if (order.includes(slug)) return;
    const parent = parentOf(slug);
    if (parent && bySlug.has(parent)) visit(parent);
    order.push(slug);
  };
  for (const slug of bySlug.keys()) visit(slug);

  const results: TreePageResult[] = [];
  for (const slug of order) {
    const page = bySlug.get(slug)!;
    const at = position.get(slug);
    const merged: PublishInput = {
      ...page.input,
      ...(page.parentSlug !== undefined ? { parent: page.parentSlug } : {}),
      position: at !== undefined && parentOf(slug) ? at : undefined,
    };
    const existing = findArtifact(ctx, slug);
    if (!existing) {
      const r = await publishArtifact(ctx, merged);
      results.push({ slug, action: "created", version: r.version, url: r.url, warnings: r.warnings, buildStatus: r.buildStatus });
      continue;
    }
    if (page.unchanged) {
      assertAgentMayMove(ctx, existing, { parent: merged.parent });
      placePage(ctx, existing, { parent: merged.parent, position: merged.position, group: merged.group });
      results.push({ slug, action: "unchanged", version: existing.currentVersion, url: artifactUrl(ctx, slug), warnings: [] });
      continue;
    }
    // Written on top of the version that was checked: an edit made since then is a conflict, not overwritten.
    const r2 = await updateArtifact(ctx, slug, { ...merged, expectedVersion: page.checked ?? existing.currentVersion });
    results.push({
      slug,
      action: "updated",
      version: r2.version,
      url: r2.url,
      warnings: r2.warnings,
      buildStatus: r2.buildStatus,
      ...(r2.droppedTicks ? { droppedTicks: r2.droppedTicks } : {}),
    });
  }
  return results;
}
