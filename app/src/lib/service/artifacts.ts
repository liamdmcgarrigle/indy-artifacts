import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";
import { createTwoFilesPatch } from "diff";
import { bind, withTx } from "../db/index";
import { readFrontmatter, normalizeFrontmatter, renderMarkdown } from "../pipeline/index";
import { DEFAULT_THEME, THEMES } from "../pipeline/types";
import { buildArtifact } from "../build/index";
import { artifactUrl, buildDir, type ServiceContext } from "./context";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { carryAssets, copyAssets } from "./assets";
import { resetLiveDocument } from "./collab";

/** The message the document server uses when it snapshots a live edit. */
export const LIVE_EDIT_MESSAGE = "live edit";
import { recordEvent } from "./events";
import { searchableText } from "./plaintext";
import {
  KINDS,
  LIMITS,
  type Artifact,
  type AuthorKind,
  type Kind,
  type PublishInput,
  type PublishResult,
  type UpdateInput,
  type Version,
} from "./types";

const id12 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const suffix4 = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 4);

const NUL = String.fromCharCode(0);
const now = () => new Date().toISOString();

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "artifact";
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(slug);
}

function hashContent(kind: Kind, source: string | null, files: Record<string, string> | null): string {
  const h = createHash("sha256");
  h.update(kind);
  if (source !== null) h.update(source);
  if (files) for (const key of Object.keys(files).sort()) h.update(NUL + key + NUL + files[key]);
  return h.digest("hex");
}

type Row = Record<string, unknown>;

function toArtifact(row: Row): Artifact {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    kind: String(row.kind) as Kind,
    theme: String(row.theme),
    project: (row.project as string | null) ?? null,
    series: (row.series as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    tags: JSON.parse(String(row.tags_json ?? "[]")),
    agentName: (row.agent_name as string | null) ?? null,
    terminalHandle: (row.terminal_handle as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    currentVersion: Number(row.current_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    pinnedAt: (row.pinned_at as string | null) ?? null,
    archivedAt: (row.archived_at as string | null) ?? null,
    seenVersion: Number(row.seen_version ?? 0),
    seenAt: (row.seen_at as string | null) ?? null,
    liveBy: (row.live_by as string | null) ?? null,
    liveAt: (row.live_at as string | null) ?? null,
  };
}

function toVersion(row: Row): Version {
  return {
    id: Number(row.id),
    artifactId: String(row.artifact_id),
    number: Number(row.number),
    authorKind: String(row.author_kind) as AuthorKind,
    authorName: String(row.author_name),
    message: (row.message as string | null) ?? null,
    frontmatter: JSON.parse(String(row.frontmatter_json ?? "{}")),
    source: (row.source as string | null) ?? null,
    files: row.files_json ? JSON.parse(String(row.files_json)) : null,
    assets: JSON.parse(String(row.assets_json ?? "[]")),
    buildStatus: String(row.build_status) as Version["buildStatus"],
    buildLog: (row.build_log as string | null) ?? null,
    warnings: JSON.parse(String(row.warnings_json ?? "[]")),
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at),
  };
}

export function findArtifact(ctx: ServiceContext, slug: string): Artifact | null {
  const row = ctx.db.prepare("SELECT * FROM artifacts WHERE slug = ?").get(slug) as Row | undefined;
  return row ? toArtifact(row) : null;
}

export function requireArtifact(ctx: ServiceContext, slug: string): Artifact {
  const found = findArtifact(ctx, slug);
  if (!found) throw new NotFoundError(`no artifact with slug "${slug}"`);
  return found;
}

export interface ArtifactSummary extends Artifact {
  openComments: number;
  unsentComments: number;
  url: string;
  updatedBy: AuthorKind | null;
}

export function listArtifacts(
  ctx: ServiceContext,
  opts: { project?: string; limit?: number } = {},
): ArtifactSummary[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = (
    opts.project
      ? ctx.db
          .prepare("SELECT * FROM artifacts WHERE project = ? ORDER BY updated_at DESC LIMIT ?")
          .all(opts.project, limit)
      : ctx.db.prepare("SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?").all(limit)
  ) as Row[];

  const counts = ctx.db
    .prepare(
      "SELECT artifact_id, COUNT(*) AS open_count, SUM(CASE WHEN sent_at IS NULL THEN 1 ELSE 0 END) AS unsent_count FROM comments WHERE status = 'open' AND author_kind = 'human' GROUP BY artifact_id",
    )
    .all() as Row[];
  const byId = new Map(counts.map((c) => [String(c.artifact_id), c]));

  const lastAuthor = ctx.db
    .prepare(
      "SELECT artifact_id, author_kind FROM versions v WHERE number = (SELECT MAX(number) FROM versions WHERE artifact_id = v.artifact_id)",
    )
    .all() as Row[];
  const authorById = new Map(lastAuthor.map((r) => [String(r.artifact_id), String(r.author_kind) as AuthorKind]));

  return rows.map((row) => {
    const artifact = toArtifact(row);
    const c = byId.get(artifact.id);
    return {
      ...artifact,
      openComments: c ? Number(c.open_count) : 0,
      unsentComments: c ? Number(c.unsent_count ?? 0) : 0,
      url: artifactUrl(ctx, artifact.slug),
      updatedBy: authorById.get(artifact.id) ?? null,
    };
  });
}

export function listVersions(ctx: ServiceContext, artifactId: string): Version[] {
  const rows = ctx.db
    .prepare("SELECT * FROM versions WHERE artifact_id = ? ORDER BY number DESC")
    .all(artifactId) as Row[];
  return rows.map(toVersion);
}

export function getVersion(ctx: ServiceContext, artifactId: string, number: number): Version | null {
  const row = ctx.db
    .prepare("SELECT * FROM versions WHERE artifact_id = ? AND number = ?")
    .get(artifactId, number) as Row | undefined;
  return row ? toVersion(row) : null;
}

export function requireVersion(ctx: ServiceContext, artifact: Artifact, number?: number): Version {
  const n = number ?? artifact.currentVersion;
  const v = getVersion(ctx, artifact.id, n);
  if (!v) throw new NotFoundError(`artifact "${artifact.slug}" has no version ${n}`);
  return v;
}

function validateContent(kind: Kind, input: PublishInput, existing?: Version) {
  const source = input.source;
  const files = input.files;

  if (kind === "markdown" || kind === "html") {
    if (source === undefined) {
      if (!existing) throw new ValidationError(`a ${kind} artifact needs "source"`);
      return { source: existing.source, files: null };
    }
    if (typeof source !== "string") throw new ValidationError('"source" must be a string');
    if (Buffer.byteLength(source, "utf8") > LIMITS.sourceBytes)
      throw new ValidationError(`source is over the ${LIMITS.sourceBytes / 1048576} MB limit`);
    return { source, files: null };
  }

  if (files === undefined) {
    if (!existing) throw new ValidationError(`a ${kind} artifact needs "files"`);
    return { source: null, files: existing.files };
  }
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new ValidationError('"files" must be a map of filename to contents');
  const names = Object.keys(files);
  if (names.length === 0) throw new ValidationError('"files" is empty');
  if (names.length > LIMITS.fileCount)
    throw new ValidationError(`too many files: ${names.length}, the limit is ${LIMITS.fileCount}`);
  let total = 0;
  for (const name of names) {
    if (typeof files[name] !== "string") throw new ValidationError(`file "${name}" must be a string`);
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(name) || name.includes("..") || name.startsWith("/"))
      throw new ValidationError(`bad file name: ${name}`);
    total += Buffer.byteLength(files[name], "utf8");
  }
  if (total > LIMITS.filesBytes)
    throw new ValidationError(
      `files total ${(total / 1048576).toFixed(1)} MB, over the ${LIMITS.filesBytes / 1048576} MB limit`,
    );
  return { source: null, files };
}

interface Meta {
  title: string;
  theme: string;
  project: string | null;
  series: string | null;
  description: string | null;
  tags: string[];
}

function resolveMeta(kind: Kind, input: PublishInput, source: string | null, existing?: Artifact): Meta {
  const fm = kind === "markdown" && source ? readFrontmatter(source) : null;
  const fmTitle = fm && typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : undefined;

  const title = fmTitle ?? input.title?.trim() ?? existing?.title;
  if (!title)
    throw new ValidationError('"title" is required (in frontmatter for markdown, or as a "title" argument)');
  if (title.length > LIMITS.titleChars) throw new ValidationError(`title is over ${LIMITS.titleChars} characters`);

  const themeRaw =
    (fm && typeof fm.theme === "string" ? fm.theme : undefined) ?? input.theme ?? existing?.theme ?? DEFAULT_THEME;
  const theme = (THEMES as readonly string[]).includes(themeRaw) ? themeRaw : DEFAULT_THEME;

  const fmProject = fm && typeof fm.project === "string" ? fm.project.trim() : undefined;
  const fmSeries = fm && typeof fm.series === "string" ? fm.series.trim() : undefined;
  const fmDescription = fm && typeof fm.description === "string" ? fm.description.trim() : undefined;
  const fmTags = fm && Array.isArray(fm.tags) ? fm.tags.map(String).slice(0, 20) : undefined;

  return {
    title,
    theme,
    project: (fmProject ?? input.project?.trim() ?? existing?.project ?? null) || null,
    series: ((fmSeries ?? input.series?.trim() ?? existing?.series ?? null) || null)?.slice(0, 80) ?? null,
    description: (fmDescription ?? input.description?.trim() ?? existing?.description ?? null) || null,
    tags: fmTags ?? input.tags ?? existing?.tags ?? [],
  };
}

function uniqueSlug(ctx: ServiceContext, wanted: string | undefined, title: string): string {
  if (wanted) {
    const slug = wanted.trim().toLowerCase();
    if (!isValidSlug(slug))
      throw new ValidationError(
        `slug must be 3-64 characters of a-z, 0-9 and dashes, starting with a letter or digit: "${wanted}"`,
      );
    if (findArtifact(ctx, slug))
      throw new ValidationError(`slug "${slug}" is taken; use artifact_update to change that artifact`);
    return slug;
  }
  const base = slugify(title);
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${suffix4()}`;
    if (!findArtifact(ctx, candidate)) return candidate;
  }
  throw new ValidationError("could not allocate a slug; pass one explicitly");
}

async function writeVersion(
  ctx: ServiceContext,
  artifact: Artifact,
  input: PublishInput,
  content: { source: string | null; files: Record<string, string> | null },
  meta: Meta,
  authorKind: AuthorKind,
  authorName: string,
  previous: Version | null,
): Promise<PublishResult> {
  const number = artifact.currentVersion + 1;
  const contentHash = hashContent(artifact.kind, content.source, content.files);

  let assets = previous?.assets ?? [];
  if (input.assets !== undefined) {
    assets = await copyAssets(ctx, artifact.id, number, input.assets);
  } else if (previous && assets.length > 0) {
    assets = await carryAssets(ctx, artifact.id, previous.number, number, assets);
  }

  let buildStatus: Version["buildStatus"] = "none";
  let buildLog: string | null = null;
  if ((artifact.kind === "react" || artifact.kind === "svelte") && content.files) {
    const built = await buildArtifact({
      kind: artifact.kind,
      files: content.files,
      outDir: buildDir(ctx, artifact.id, number),
    });
    buildStatus = built.status;
    buildLog = built.log || null;
  }

  let warnings: { line: number; message: string }[] = [];
  if (artifact.kind === "markdown" && content.source !== null) {
    warnings = renderMarkdown(content.source, meta.title).warnings;
  }

  const stamp = now();
  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO versions (artifact_id, number, author_kind, author_name, message, frontmatter_json,
           source, files_json, assets_json, build_status, build_log, warnings_json, content_hash, created_at)
         VALUES (:artifact_id, :number, :author_kind, :author_name, :message, :frontmatter_json,
           :source, :files_json, :assets_json, :build_status, :build_log, :warnings_json, :content_hash, :created_at)`,
      )
      .run(
        bind({
          artifact_id: artifact.id,
          number,
          author_kind: authorKind,
          author_name: authorName,
          message: input.message ?? null,
          frontmatter_json: JSON.stringify(meta),
          source: content.source,
          files_json: content.files ? JSON.stringify(content.files) : null,
          assets_json: JSON.stringify(assets),
          build_status: buildStatus,
          build_log: buildLog,
          warnings_json: JSON.stringify(warnings),
          content_hash: contentHash,
          created_at: stamp,
        }),
      );

    ctx.db
      .prepare(
        `UPDATE artifacts SET title = :title, theme = :theme, project = :project, series = :series, description = :description,
           tags_json = :tags_json, current_version = :current_version, updated_at = :updated_at,
           archived_at = NULL,
           seen_version = CASE WHEN :by_human = 1 THEN :current_version ELSE seen_version END,
           seen_at = CASE WHEN :by_human = 1 THEN :updated_at ELSE seen_at END,
           agent_name = COALESCE(:agent_name, agent_name),
           terminal_handle = COALESCE(:terminal_handle, terminal_handle),
           session_id = COALESCE(:session_id, session_id)
         WHERE id = :id`,
      )
      .run(
        bind({
          id: artifact.id,
          title: meta.title,
          theme: meta.theme,
          project: meta.project,
          series: meta.series,
          description: meta.description,
          tags_json: JSON.stringify(meta.tags),
          current_version: number,
          updated_at: stamp,
          by_human: authorKind === "human" ? 1 : 0,
          agent_name: input.agent?.name ?? null,
          terminal_handle: input.agent?.terminal ?? null,
          session_id: input.agent?.session ?? null,
        }),
      );

    // One row per artifact in the search index, holding its latest text.
    ctx.db.prepare("DELETE FROM search WHERE artifact_id = ?").run(artifact.id);
    ctx.db
      .prepare("INSERT INTO search (artifact_id, title, description, body) VALUES (?, ?, ?, ?)")
      .run(artifact.id, meta.title, meta.description ?? "", searchableText(content, artifact.kind));

    if (authorKind === "human") {
      recordEvent(ctx, artifact.id, "version.created", {
        version: { number, author_name: authorName, message: input.message ?? null },
      });
    }
  });

  // The live document is a working copy of the current version, so a version
  // written anywhere else has to replace it. The snapshot path is the one
  // exception: that text came from the document in the first place.
  if (artifact.kind === "markdown" && input.message !== LIVE_EDIT_MESSAGE) {
    resetLiveDocument(artifact.slug, content.source);
  }

  return {
    slug: artifact.slug,
    version: number,
    url: artifactUrl(ctx, artifact.slug),
    warnings,
    buildStatus,
    ...(buildLog ? { buildLog } : {}),
  };
}

export async function publishArtifact(ctx: ServiceContext, input: PublishInput): Promise<PublishResult> {
  const kind = (input.kind ?? "markdown") as Kind;
  if (!KINDS.includes(kind)) throw new ValidationError(`kind must be one of ${KINDS.join(", ")}`);
  const content = validateContent(kind, input);
  const meta = resolveMeta(kind, input, content.source);
  const slug = uniqueSlug(ctx, input.slug, meta.title);

  const stamp = now();
  ctx.db
    .prepare(
      `INSERT INTO artifacts (id, slug, title, kind, theme, project, description, tags_json,
         agent_name, terminal_handle, session_id, current_version, created_at, updated_at)
       VALUES (:id, :slug, :title, :kind, :theme, :project, :description, :tags_json,
         :agent_name, :terminal_handle, :session_id, 0, :created_at, :updated_at)`,
    )
    .run(
      bind({
        id: id12(),
        slug,
        title: meta.title,
        kind,
        theme: meta.theme,
        project: meta.project,
        description: meta.description,
        tags_json: JSON.stringify(meta.tags),
        agent_name: input.agent?.name ?? null,
        terminal_handle: input.agent?.terminal ?? null,
        session_id: input.agent?.session ?? null,
        created_at: stamp,
        updated_at: stamp,
      }),
    );

  const artifact = requireArtifact(ctx, slug);
  try {
    return await writeVersion(ctx, artifact, input, content, meta, "agent", input.agent?.name ?? "agent", null);
  } catch (err) {
    // A first version that never lands would leave an artifact with no content
    // and its slug taken, so undo the row before reporting the failure.
    ctx.db.prepare("DELETE FROM artifacts WHERE id = ? AND current_version = 0").run(artifact.id);
    throw err;
  }
}

export async function updateArtifact(
  ctx: ServiceContext,
  slug: string,
  input: UpdateInput,
): Promise<PublishResult> {
  const artifact = requireArtifact(ctx, slug);
  if (typeof input.expectedVersion !== "number")
    throw new ValidationError('"expected_version" is required; pass the version you last saw');
  if (input.expectedVersion !== artifact.currentVersion)
    throw new ConflictError(
      `artifact "${slug}" is at version ${artifact.currentVersion}, not ${input.expectedVersion}; read it again with artifact_get before updating`,
      artifact.currentVersion,
    );
  if (input.kind && input.kind !== artifact.kind)
    throw new ValidationError(`artifact "${slug}" is a ${artifact.kind} artifact and its kind cannot change`);

  const previous = requireVersion(ctx, artifact);
  const content = validateContent(artifact.kind, input, previous);
  const meta = resolveMeta(artifact.kind, input, content.source, artifact);
  return writeVersion(
    ctx,
    artifact,
    input,
    content,
    meta,
    "agent",
    input.agent?.name ?? artifact.agentName ?? "agent",
    previous,
  );
}

export async function createHumanVersion(
  ctx: ServiceContext,
  slug: string,
  input: {
    source?: string;
    files?: Record<string, string>;
    message?: string;
    authorName: string;
    expectedVersion: number;
  },
): Promise<PublishResult> {
  const artifact = requireArtifact(ctx, slug);
  if (input.expectedVersion !== artifact.currentVersion)
    throw new ConflictError(
      `this artifact moved to version ${artifact.currentVersion} while you were editing; reload before saving`,
      artifact.currentVersion,
    );
  const previous = requireVersion(ctx, artifact);
  const content = validateContent(artifact.kind, input, previous);
  const meta = resolveMeta(artifact.kind, { title: artifact.title }, content.source, artifact);
  return writeVersion(
    ctx,
    artifact,
    { message: input.message },
    content,
    meta,
    "human",
    input.authorName || "operator",
    previous,
  );
}

/**
 * Replace one run of source lines and publish the result as a new version.
 *
 * This is what editing a single block on the page does. Only the lines the
 * block occupies are rewritten, so the rest of the document keeps its exact
 * bytes and a diff shows the one change rather than a reformat.
 */
export async function patchLines(
  ctx: ServiceContext,
  slug: string,
  input: { from: number; to: number; text: string; authorName: string; expectedVersion: number },
): Promise<PublishResult> {
  const artifact = requireArtifact(ctx, slug);
  if (artifact.kind !== "markdown")
    throw new ValidationError("only markdown artifacts can be edited a block at a time");

  const previous = requireVersion(ctx, artifact);
  const source = previous.source ?? "";
  const lines = source.split("\n");

  const from = Math.floor(input.from);
  const to = Math.floor(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from)
    throw new ValidationError("line range must be two positive line numbers, low to high");
  if (from > lines.length)
    throw new ValidationError(`this artifact has ${lines.length} lines; line ${from} is past the end`);

  const replacement = input.text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const next = [...lines.slice(0, from - 1), ...replacement, ...lines.slice(Math.min(to, lines.length))];

  return createHumanVersion(ctx, slug, {
    source: next.join("\n"),
    message: from === to ? `edited line ${from}` : `edited lines ${from}-${to}`,
    authorName: input.authorName,
    expectedVersion: input.expectedVersion,
  });
}

export function versionText(version: Version): string {
  if (version.source !== null) return version.source;
  if (!version.files) return "";
  const files = version.files;
  return Object.keys(files)
    .sort()
    .map((name) => `/* ==== ${name} ==== */\n${files[name]}`)
    .join("\n\n");
}

export function diffVersions(ctx: ServiceContext, slug: string, from: number, to: number): string {
  const artifact = requireArtifact(ctx, slug);
  const a = requireVersion(ctx, artifact, from);
  const b = requireVersion(ctx, artifact, to);
  return createTwoFilesPatch(
    `v${a.number}`,
    `v${b.number}`,
    versionText(a),
    versionText(b),
    a.createdAt,
    b.createdAt,
    { context: 3 },
  );
}
