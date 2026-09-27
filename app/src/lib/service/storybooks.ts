import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlib, gzip } from "node:zlib";
import type { Readable } from "node:stream";
import { withTx } from "../db/index";
import { randomToken, sha256 } from "../auth/crypto";
import { readTarGz, TarError } from "../storybook/tar";
import { rewriteFile } from "../storybook/rewrite";
import { parseStoryBlock, STORYBOOK_NAME, type SchemeGlobals, type Values } from "../storybook/spec";
import type { Embed } from "../pipeline/types";
import type { ServiceContext } from "./context";
import { NotFoundError, ServiceError, UnauthorizedError, ValidationError } from "./errors";
import { assertRoom, forgetUsage, grewBy } from "./storage";

/**
 * Storybooks: a project's static Storybook build, uploaded by an agent, and
 * shown a story at a time in page frames.
 *
 * A build is a list of paths, each pointing at a file stored once by its
 * SHA-256, so a new build of a big library costs only what changed. Builds are
 * never edited; a new upload is a new build, and each page version remembers
 * which build it was written against, so a design review keeps showing what
 * was reviewed.
 */

export interface StorybookSettings {
  /** Globals applied when the page is light or dark, e.g. { theme: "night" }. */
  light?: Values;
  dark?: Values;
  /** Remote origins the stories may load images, fonts and styles from. */
  hosts?: string[];
}

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
}

export interface BuildSummary {
  id: string;
  storybook: string;
  files: number;
  bytes: number;
  stories: number;
  createdAt: string;
  createdBy: string;
}

export interface StorybookSummary {
  name: string;
  settings: StorybookSettings;
  builds: number;
  bytes: number;
  latest: BuildSummary | null;
  updatedAt: string;
}

export const STORYBOOK_LIMITS = {
  /** Compressed upload. */
  uploadBytes: 200 * 1024 * 1024,
  /** Unpacked, across all files. */
  totalBytes: 500 * 1024 * 1024,
  fileBytes: 50 * 1024 * 1024,
  files: 20_000,
  /** Builds kept per Storybook besides those a page version still points at. */
  keep: 3,
  ticketMinutes: 30,
  uploadMinutes: 15,
  hosts: 12,
};

const now = () => new Date().toISOString();

export function normaliseName(name: unknown): string {
  const value = String(name ?? "").trim();
  if (!STORYBOOK_NAME.test(value)) {
    throw new ValidationError("a Storybook name is 1 to 80 letters, digits, dots, dashes and underscores; use the project name");
  }
  return value;
}

/** Where a stored file lives. */
function blobPath(ctx: ServiceContext, hash: string): string {
  return join(ctx.dataDir, "storybooks", "blobs", hash.slice(0, 2), hash);
}

// ------------------------------------------------------------------ settings

const HOST = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

function checkGlobals(value: unknown, what: string): Values | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${what} must be an object of Storybook globals, e.g. { "theme": "dark" }`);
  const json = JSON.stringify(value);
  if (json.length > 2000) throw new ValidationError(`${what} is too large`);
  return JSON.parse(json) as Values;
}

export function checkSettings(input: Record<string, unknown>): StorybookSettings {
  const out: StorybookSettings = {};
  const light = checkGlobals(input.light, "light");
  const dark = checkGlobals(input.dark, "dark");
  if (light) out.light = light;
  if (dark) out.dark = dark;
  if (input.hosts !== undefined && input.hosts !== null) {
    if (!Array.isArray(input.hosts)) throw new ValidationError("hosts must be a list of https origins");
    const hosts = input.hosts.map((h) => String(h).trim().toLowerCase().replace(/\/+$/, ""));
    for (const h of hosts) {
      if (!HOST.test(h)) throw new ValidationError(`"${h}" is not an https origin like https://images.example.com`);
    }
    if (hosts.length > STORYBOOK_LIMITS.hosts) throw new ValidationError(`at most ${STORYBOOK_LIMITS.hosts} hosts`);
    out.hosts = [...new Set(hosts)];
  }
  return out;
}

function parseSettings(json: unknown): StorybookSettings {
  try {
    const value = JSON.parse(String(json ?? "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as StorybookSettings) : {};
  } catch {
    return {};
  }
}

/** Changes a Storybook's settings; only the keys given change. */
export function setStorybookSettings(ctx: ServiceContext, name: string, input: Record<string, unknown>): StorybookSummary {
  const storybook = requireStorybook(ctx, name);
  const next = { ...storybook.settings, ...checkSettings(input) };
  ctx.db.prepare("UPDATE storybooks SET settings_json = ?, updated_at = ? WHERE name = ?").run(JSON.stringify(next), now(), storybook.name);
  return requireStorybook(ctx, storybook.name);
}

// ------------------------------------------------------------------- reading

type Row = Record<string, unknown>;

function toBuild(row: Row): BuildSummary {
  return {
    id: String(row.id),
    storybook: String(row.storybook),
    files: Number(row.files),
    bytes: Number(row.bytes),
    stories: Number(row.story_count ?? 0),
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
  };
}

const BUILD_COLUMNS = "id, storybook, files, bytes, json_array_length(stories_json) AS story_count, created_at, created_by";

export function listStorybooks(ctx: ServiceContext): StorybookSummary[] {
  const rows = ctx.db.prepare("SELECT * FROM storybooks ORDER BY name COLLATE NOCASE").all() as Row[];
  return rows.map((r) => summary(ctx, r));
}

function summary(ctx: ServiceContext, row: Row): StorybookSummary {
  const name = String(row.name);
  const latest = ctx.db
    .prepare(`SELECT ${BUILD_COLUMNS} FROM storybook_builds WHERE storybook = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(name) as Row | undefined;
  const counts = ctx.db
    .prepare(
      `SELECT COUNT(*) AS builds,
         (SELECT COALESCE(SUM(size), 0) FROM (SELECT DISTINCT f.hash, f.size FROM storybook_files f
            JOIN storybook_builds b ON b.id = f.build_id WHERE b.storybook = :name)) AS bytes
       FROM storybook_builds WHERE storybook = :name`,
    )
    .get({ name }) as Row;
  return {
    name,
    settings: parseSettings(row.settings_json),
    builds: Number(counts.builds),
    bytes: Number(counts.bytes),
    latest: latest ? toBuild(latest) : null,
    updatedAt: String(row.updated_at),
  };
}

export function findStorybook(ctx: ServiceContext, name: string): StorybookSummary | null {
  const row = ctx.db.prepare("SELECT * FROM storybooks WHERE name = ?").get(name.trim()) as Row | undefined;
  return row ? summary(ctx, row) : null;
}

export function requireStorybook(ctx: ServiceContext, name: string): StorybookSummary {
  const found = findStorybook(ctx, name);
  if (!found) {
    const names = listStorybooks(ctx).map((s) => s.name);
    throw new NotFoundError(
      `no Storybook named "${name}" has been uploaded${names.length ? `; there are: ${names.join(", ")}` : ""}. Upload one with artifact_storybook_upload.`,
    );
  }
  return found;
}

export function getBuild(ctx: ServiceContext, id: string): BuildSummary | null {
  const row = ctx.db.prepare(`SELECT ${BUILD_COLUMNS} FROM storybook_builds WHERE id = ?`).get(id) as Row | undefined;
  return row ? toBuild(row) : null;
}

export function latestBuild(ctx: ServiceContext, storybook: string): BuildSummary | null {
  const row = ctx.db
    .prepare(`SELECT ${BUILD_COLUMNS} FROM storybook_builds WHERE storybook = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(storybook.trim()) as Row | undefined;
  return row ? toBuild(row) : null;
}

export function listBuilds(ctx: ServiceContext, storybook: string): BuildSummary[] {
  return (
    ctx.db.prepare(`SELECT ${BUILD_COLUMNS} FROM storybook_builds WHERE storybook = ? ORDER BY created_at DESC, rowid DESC`).all(storybook.trim()) as Row[]
  ).map(toBuild);
}

export function buildStories(ctx: ServiceContext, buildId: string): StoryEntry[] {
  const row = ctx.db.prepare("SELECT stories_json FROM storybook_builds WHERE id = ?").get(buildId) as Row | undefined;
  if (!row) return [];
  try {
    return JSON.parse(String(row.stories_json)) as StoryEntry[];
  } catch {
    return [];
  }
}

export function buildNotes(ctx: ServiceContext, buildId: string): string[] {
  const row = ctx.db.prepare("SELECT notes_json FROM storybook_builds WHERE id = ?").get(buildId) as Row | undefined;
  try {
    return row ? (JSON.parse(String(row.notes_json)) as string[]) : [];
  } catch {
    return [];
  }
}

/** Stories whose id, title or name contain every word of the query. */
export function findStories(stories: StoryEntry[], query?: string): StoryEntry[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return stories;
  return stories.filter((s) => {
    const hay = `${s.id} ${s.title} ${s.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Near misses for an id that is not in the build, best first. */
export function similarStories(stories: StoryEntry[], id: string, limit = 3): string[] {
  const [component, story] = id.split("--");
  const score = (s: StoryEntry) => {
    const [c, n] = s.id.split("--");
    let points = 0;
    if (c === component) points += 3;
    else if (c.includes(component) || component.includes(c)) points += 2;
    if (n === story) points += 2;
    else if (story && (n.includes(story) || story.includes(n))) points += 1;
    return points;
  };
  return stories
    .map((s) => [score(s), s.id] as const)
    .filter(([p]) => p > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([, id]) => id);
}

// --------------------------------------------------------------- one file

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  wasm: "application/wasm",
};

export function storybookFileType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (path.includes(".") && TYPES[ext]) || "application/octet-stream";
}

export function isHtml(path: string): boolean {
  return /\.html?$/i.test(path);
}

// A build's file list is read on every file request; the few builds in use
// at once are kept in memory.
const manifests = new Map<string, Map<string, { hash: string; size: number }>>();
const MAX_MANIFESTS = 12;

function manifest(ctx: ServiceContext, buildId: string): Map<string, { hash: string; size: number }> | null {
  const hit = manifests.get(buildId);
  if (hit) {
    manifests.delete(buildId);
    manifests.set(buildId, hit);
    return hit;
  }
  if (!getBuild(ctx, buildId)) return null;
  const rows = ctx.db.prepare("SELECT path, hash, size FROM storybook_files WHERE build_id = ?").all(buildId) as Row[];
  const map = new Map(rows.map((r) => [String(r.path), { hash: String(r.hash), size: Number(r.size) }]));
  manifests.set(buildId, map);
  if (manifests.size > MAX_MANIFESTS) manifests.delete(manifests.keys().next().value as string);
  return map;
}

/** A file of a build, or null. `path` is the decoded path under the build. */
export function buildFile(ctx: ServiceContext, buildId: string, path: string): { file: string; size: number; type: string } | null {
  const entry = manifest(ctx, buildId)?.get(path);
  if (!entry) return null;
  return { file: blobPath(ctx, entry.hash), size: entry.size, type: storybookFileType(path) };
}

/**
 * The stored copy to send for what the browser accepts: brotli, then gzip,
 * then the file itself. Compressed copies exist only for text and fonts.
 */
export async function encodedFile(file: string, acceptEncoding: string | null): Promise<{ path: string; size: number; encoding: string | null }> {
  const accepts = (acceptEncoding ?? "").toLowerCase();
  for (const [token, ext] of [["br", ".br"], ["gzip", ".gz"]] as const) {
    if (!new RegExp(`(^|[\\s,])${token}(?![\\w-])(?!\\s*;\\s*q=0(\\.0*)?(\\s|,|$))`).test(accepts)) continue;
    const info = await stat(`${file}${ext}`).catch(() => null);
    if (info) return { path: `${file}${ext}`, size: info.size, encoding: token };
  }
  const info = await stat(file);
  return { path: file, size: info.size, encoding: null };
}

// ----------------------------------------------------------------- uploading

/**
 * A single-use address an agent can send a build to with curl. The agent is
 * already signed in over MCP; this hands that on to a shell command without
 * a token in it, and it is worth nothing after one upload or half an hour.
 */
export function createUpload(
  ctx: ServiceContext,
  input: { storybook: string; settings?: Record<string, unknown>; by: string },
): { url: string; expiresAt: string } {
  const storybook = normaliseName(input.storybook);
  const settings = input.settings ? checkSettings(input.settings) : null;
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + STORYBOOK_LIMITS.ticketMinutes * 60_000).toISOString();
  withTx(ctx.db, () => {
    ctx.db.prepare("DELETE FROM storybook_uploads WHERE expires_at < ? OR used_at IS NOT NULL").run(now());
    ctx.db
      .prepare("INSERT INTO storybook_uploads (hash, storybook, settings_json, created_by, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(sha256(token), storybook, settings ? JSON.stringify(settings) : null, input.by, expiresAt);
  });
  return { url: `${ctx.publicUrl}/api/storybooks/uploads/${token}`, expiresAt };
}

/** Takes an upload address; after this it cannot be used again, whatever happens next. */
export function claimUpload(ctx: ServiceContext, token: string): { storybook: string; settings: StorybookSettings | null; by: string } {
  const hash = sha256(token);
  return withTx(ctx.db, () => {
    const row = ctx.db.prepare("SELECT * FROM storybook_uploads WHERE hash = ?").get(hash) as Row | undefined;
    if (!row || row.used_at || String(row.expires_at) < now()) {
      throw new UnauthorizedError("this upload address has expired or was already used; ask for a new one with artifact_storybook_upload");
    }
    ctx.db.prepare("UPDATE storybook_uploads SET used_at = ? WHERE hash = ?").run(now(), hash);
    return {
      storybook: String(row.storybook),
      settings: row.settings_json ? parseSettings(row.settings_json) : null,
      by: String(row.created_by),
    };
  });
}

export class UploadError extends ServiceError {
  constructor(message: string) {
    super("invalid_upload", message, 400);
  }
}

async function writeAtomically(path: string, data: Buffer): Promise<void> {
  const temp = `${path}.${randomToken(6)}.part`;
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Files worth sending compressed: text, and fonts that are not already. */
// Not HTML: a story page is read and sent as it is, with the bridge added.
const COMPRESSIBLE = /\.(js|mjs|cjs|css|json|map|svg|txt|md|ttf|otf|eot|wasm|xml|ico)$/i;

/**
 * Each frame on a page runs its own copy of the Storybook: a sandboxed frame
 * has no origin to share a browser cache under, so the same files are sent
 * once per story. Sent compressed, that is a third of the bytes or less.
 * Both encodings are made once, when the file arrives: brotli where the
 * browser takes it (HTTPS), gzip otherwise.
 */
async function storeCompressed(path: string, data: Buffer): Promise<number> {
  let added = 0;
  const variants: [string, () => Promise<Buffer>][] = [
    [`${path}.br`, () => brotli(data, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9, [zlib.BROTLI_PARAM_SIZE_HINT]: data.length } })],
    [`${path}.gz`, () => gzipAsync(data, { level: 9 })],
  ];
  for (const [file, make] of variants) {
    if (await stat(file).then(() => true, () => false)) continue;
    const packed = await make();
    // Not worth a second copy unless it saves a tenth.
    if (packed.length > data.length * 0.9) continue;
    await writeAtomically(file, packed);
    added += packed.length;
  }
  return added;
}

async function storeBlob(ctx: ServiceContext, data: Buffer, name = ""): Promise<{ hash: string; added: number }> {
  const hash = createHash("sha256").update(data).digest("hex");
  const path = blobPath(ctx, hash);
  const compress = data.length > 1024 && COMPRESSIBLE.test(name);
  const there = await stat(path).then((s) => s.size === data.length, () => false);
  if (there) {
    // Fresh again, so a sweep running alongside this upload leaves it be.
    const moment = new Date();
    await utimes(path, moment, moment).catch(() => {});
    return { hash, added: compress ? await storeCompressed(path, data) : 0 };
  }
  await mkdir(join(path, ".."), { recursive: true });
  await writeAtomically(path, data);
  return { hash, added: data.length + (compress ? await storeCompressed(path, data) : 0) };
}

interface IndexEntry {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  type?: unknown;
}

/** The stories in a build's index.json (v4 or v5), or the older stories.json. */
export function readIndex(json: string): StoryEntry[] {
  let parsed: { entries?: Record<string, IndexEntry>; stories?: Record<string, IndexEntry> };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new UploadError("the build's index.json is not valid JSON");
  }
  const entries = parsed.entries ?? parsed.stories;
  if (!entries || typeof entries !== "object") throw new UploadError("the build's index.json has no entries");
  const out: StoryEntry[] = [];
  for (const e of Object.values(entries)) {
    if (!e || typeof e !== "object" || (e.type !== undefined && e.type !== "story")) continue;
    if (typeof e.id !== "string" || typeof e.title !== "string") continue;
    out.push({ id: e.id.slice(0, 200), title: e.title.slice(0, 200), name: String(e.name ?? "").slice(0, 200) });
  }
  return out;
}

const REWRITTEN = /\.(css|js|mjs|cjs|html?)$/i;

export interface UploadResult {
  build: BuildSummary;
  storybook: StorybookSummary;
  notes: string[];
  added: number;
}

/**
 * Stores a build from a gzipped tar of the Storybook output folder
 * (`tar -czf - -C storybook-static .`). The build must have iframe.html and
 * index.json at its root.
 */
type UploadInput = { storybook: string; settings?: StorybookSettings | null; by: string; body: Readable | AsyncIterable<Uint8Array>; length?: number | null };

// Uploads, prunes and sweeps take turns. A sweep that ran beside an upload
// could delete a file the upload had just decided to reuse, and two big
// uploads at once could take more memory and disk than one.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export function receiveUpload(ctx: ServiceContext, input: UploadInput): Promise<UploadResult> {
  return exclusive(async () => {
    const created: string[] = [];
    let result: UploadResult;
    try {
      result = await receiveNow(ctx, input, created);
    } catch (err) {
      // Files this upload added and no build points at: gone with it.
      await Promise.all(
        created.flatMap((hash) => ["", ".br", ".gz"].map((ext) => rm(`${blobPath(ctx, hash)}${ext}`, { force: true }))),
      );
      throw err;
    }
    try {
      await pruneNow(ctx, result.storybook.name);
    } catch (err) {
      console.error("[indy] pruning Storybook builds failed:", err);
    }
    return { ...result, storybook: findStorybook(ctx, result.storybook.name)! };
  });
}

async function receiveNow(ctx: ServiceContext, input: UploadInput, created: string[]): Promise<UploadResult> {
  const storybook = normaliseName(input.storybook);
  if (input.length && input.length > STORYBOOK_LIMITS.uploadBytes) {
    throw new UploadError(`the upload is over ${STORYBOOK_LIMITS.uploadBytes / 1024 / 1024} MB; build with --preview-only, or leave out large static files`);
  }
  await assertRoom(ctx, (input.length ?? 0) * 2);

  const files = new Map<string, { hash: string; size: number }>();
  let added = 0;
  let received = 0;
  const started = Date.now();
  const body = (async function* () {
    for await (const chunk of input.body as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > STORYBOOK_LIMITS.uploadBytes) throw new UploadError(`the upload is over ${STORYBOOK_LIMITS.uploadBytes / 1024 / 1024} MB`);
      if (Date.now() - started > STORYBOOK_LIMITS.uploadMinutes * 60_000) throw new UploadError(`the upload took over ${STORYBOOK_LIMITS.uploadMinutes} minutes`);
      yield chunk;
    }
  })();
  const store = async (data: Buffer, name: string) => {
    const stored = await storeBlob(ctx, data, name);
    if (stored.added) {
      created.push(stored.hash);
      added += stored.added;
      // What the archive unpacks to, not what was sent, is what fills the disk.
      if (added - checked > 25 * 1024 * 1024) {
        checked = added;
        await assertRoom(ctx, added);
      }
    }
    return stored;
  };
  let checked = 0;

  let skipped: string[] = [];
  try {
    const result = await readTarGz(body, STORYBOOK_LIMITS, async ({ path, data }) => {
      const stored = await store(data, path);
      files.set(path, { hash: stored.hash, size: data.length });
    });
    skipped = result.skipped;
  } catch (err) {
    if (err instanceof TarError || err instanceof UploadError) throw new UploadError(err.message);
    if (err instanceof ServiceError) throw err;
    if (err && typeof err === "object" && "code" in err && String((err as { code: unknown }).code).startsWith("Z_")) {
      throw new UploadError("that is not a gzipped tar; send `tar -czf - -C <build folder> .`");
    }
    throw err;
  }

  // A build tarred from its parent folder has everything one level down.
  const roots = new Set([...files.keys()].map((p) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "")));
  if (!files.has("iframe.html") && roots.size === 1) {
    const [only] = [...roots];
    if (only && files.has(`${only}/iframe.html`)) {
      for (const [path, entry] of [...files]) {
        files.delete(path);
        files.set(path.slice(only.length + 1), entry);
      }
    }
  }
  // Storybook's own browsing UI is never shown in a page. Left out, a page's
  // viewers get the stories, not a ready-made catalogue of the whole library.
  let manager = 0;
  for (const path of [...files.keys()]) {
    if (path === "index.html" || path.startsWith("sb-manager/") || path.startsWith("sb-addons/")) {
      files.delete(path);
      manager++;
    }
  }
  if (!files.has("iframe.html")) {
    throw new UploadError("there is no iframe.html at the top of the archive. Run `storybook build`, then tar the output folder's contents: tar -czf - -C storybook-static .");
  }
  const indexFile = files.get("index.json") ?? files.get("stories.json");
  if (!indexFile) throw new UploadError("there is no index.json at the top of the archive; is this a Storybook 7 or later build?");
  const stories = readIndex(await readFile(blobPath(ctx, indexFile.hash), "utf8"));
  if (!stories.length) throw new UploadError("the build has no stories in its index.json");

  // Root-relative references to files in the build, made relative.
  const notes: string[] = [];
  const exists = (p: string) => files.has(p);
  let rewrites = 0;
  for (const [path, entry] of [...files]) {
    if (entry.size > 10 * 1024 * 1024 || !REWRITTEN.test(path)) continue;
    const text = await readFile(blobPath(ctx, entry.hash), "utf8");
    const out = rewriteFile(path, text, exists);
    if (!out || !out.count) continue;
    const data = Buffer.from(out.text, "utf8");
    const stored = await store(data, path);
    files.set(path, { hash: stored.hash, size: data.length });
    rewrites += out.count;
  }
  if (rewrites) notes.push(`${rewrites} root-relative reference${rewrites === 1 ? "" : "s"} (like url(/fonts/…)) pointed at files in the build and now work under Indy.`);
  if (skipped.length) notes.push(`${skipped.length} link${skipped.length === 1 ? "" : "s"} or special file${skipped.length === 1 ? " was" : "s were"} left out: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}`);
  if (manager) {
    notes.push(`Left out Storybook's own browsing UI (${manager} files), which pages do not use; \`storybook build --preview-only\` makes uploads smaller.`);
  }

  const id = randomToken(12);
  const bytes = [...files.values()].reduce((n, f) => n + f.size, 0);
  const stamp = now();
  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO storybooks (name, settings_json, created_at, updated_at) VALUES (?, '{}', ?, ?)
         ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(storybook, stamp, stamp);
    const canonical = String((ctx.db.prepare("SELECT name FROM storybooks WHERE name = ?").get(storybook) as Row).name);
    if (input.settings && Object.keys(input.settings).length) {
      const current = parseSettings((ctx.db.prepare("SELECT settings_json FROM storybooks WHERE name = ?").get(canonical) as Row).settings_json);
      ctx.db.prepare("UPDATE storybooks SET settings_json = ? WHERE name = ?").run(JSON.stringify({ ...current, ...input.settings }), canonical);
    }
    ctx.db
      .prepare(
        `INSERT INTO storybook_builds (id, storybook, files, bytes, stories_json, notes_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, canonical, files.size, bytes, JSON.stringify(stories), JSON.stringify(notes), input.by.slice(0, 80), stamp);
    const insert = ctx.db.prepare("INSERT INTO storybook_files (build_id, path, hash, size) VALUES (?, ?, ?, ?)");
    for (const [path, entry] of files) insert.run(id, path, entry.hash, entry.size);
  });
  grewBy("other", added);

  const name = findStorybook(ctx, storybook)!.name;
  return { build: getBuild(ctx, id)!, storybook: findStorybook(ctx, name)!, notes, added };
}

// -------------------------------------------------------------------- pruning

/** Builds some page version still shows. */
function pinnedBuilds(ctx: ServiceContext): Set<string> {
  const out = new Set<string>();
  const rows = ctx.db.prepare("SELECT storybooks_json FROM versions WHERE storybooks_json != '{}'").all() as Row[];
  for (const r of rows) {
    try {
      for (const id of Object.values(JSON.parse(String(r.storybooks_json)) as Record<string, string>)) out.add(String(id));
    } catch {
      /* a damaged row pins nothing */
    }
  }
  return out;
}

/**
 * Keeps the newest few builds of a Storybook and every build a page version
 * points at; the rest go, and so do stored files no build uses any more.
 */
export function pruneBuilds(ctx: ServiceContext, storybook: string): Promise<number> {
  return exclusive(() => pruneNow(ctx, storybook));
}

async function pruneNow(ctx: ServiceContext, storybook: string): Promise<number> {
  const pinned = pinnedBuilds(ctx);
  const builds = listBuilds(ctx, storybook);
  const drop = builds.slice(STORYBOOK_LIMITS.keep).filter((b) => !pinned.has(b.id));
  if (drop.length) {
    withTx(ctx.db, () => {
      const del = ctx.db.prepare("DELETE FROM storybook_builds WHERE id = ?");
      for (const b of drop) {
        del.run(b.id);
        manifests.delete(b.id);
      }
    });
  }
  await sweepBlobs(ctx);
  return drop.length;
}

async function sweepBlobs(ctx: ServiceContext): Promise<void> {
  const root = join(ctx.dataDir, "storybooks", "blobs");
  const used = new Set((ctx.db.prepare("SELECT DISTINCT hash FROM storybook_files").all() as Row[]).map((r) => String(r.hash)));
  const dirs = await readdir(root).catch(() => [] as string[]);
  const cutoff = Date.now() - 60 * 60_000;
  let removed = false;
  for (const dir of dirs) {
    const names = await readdir(join(root, dir)).catch(() => [] as string[]);
    for (const name of names) {
      // A blob in use is kept as name, name.br and name.gz. Anything else,
      // such as a name.<random>.part left by a crash, goes once it is old.
      const hash = name.slice(0, 64);
      if (used.has(hash) && (name === hash || name === `${hash}.br` || name === `${hash}.gz`)) continue;
      const path = join(root, dir, name);
      // A file another upload is writing right now is not in a build yet.
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs > cutoff) continue;
      await rm(path, { force: true });
      removed = true;
    }
  }
  if (removed) forgetUsage();
}

/** Deletes a Storybook and every build of it. Pages that showed it say it is gone. */
export function deleteStorybook(ctx: ServiceContext, name: string): Promise<void> {
  const storybook = requireStorybook(ctx, name);
  return exclusive(async () => {
    for (const b of listBuilds(ctx, storybook.name)) manifests.delete(b.id);
    ctx.db.prepare("DELETE FROM storybooks WHERE name = ?").run(storybook.name);
    await sweepBlobs(ctx);
  });
}

// ------------------------------------------------------------------ versions

/**
 * The build each Storybook a page shows is at, for a new version. An agent's
 * version takes the latest build, since the agent is the one that uploads. A
 * person's edit keeps the builds the previous version had, so fixing a typo
 * never swaps the designs under a review.
 */
export function pinsFor(
  ctx: ServiceContext,
  names: string[],
  opts: { previous?: Record<string, string>; keepPrevious: boolean },
): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const name of names) {
    const key = name.toLowerCase();
    if (pins[key]) continue;
    const kept = opts.keepPrevious ? opts.previous?.[key] : undefined;
    if (kept && getBuild(ctx, kept)) {
      pins[key] = kept;
      continue;
    }
    const latest = latestBuild(ctx, name);
    if (latest) pins[key] = latest.id;
  }
  return pins;
}

/**
 * The stories a markdown version shows, checked against what has been
 * uploaded: the builds to pin, and warnings for the author about anything
 * that will not draw.
 */
export function checkStories(
  ctx: ServiceContext,
  embeds: Embed[],
  project: string | null | undefined,
  opts: { previous?: Record<string, string>; keepPrevious: boolean },
): { pins: Record<string, string>; warnings: { line: number; message: string }[] } {
  const warnings: { line: number; message: string }[] = [];
  const wanted: { name: string; id: string; line: number }[] = [];
  for (const embed of embeds) {
    if (embed.kind !== "story") continue;
    const line = embed.line ?? 0;
    let spec;
    try {
      spec = parseStoryBlock(embed.content);
    } catch {
      continue; // the pipeline has already said why
    }
    const name = spec.storybook ?? project ?? null;
    if (!name) {
      warnings.push({ line, message: "this story does not say which Storybook it is from: give the page a project, or the block a storybook: line" });
      continue;
    }
    wanted.push({ name, id: spec.id, line });
  }
  const pins = pinsFor(ctx, wanted.map((w) => w.name), opts);
  for (const w of wanted) {
    const build = pins[w.name.toLowerCase()];
    if (!build) {
      warnings.push({ line: w.line, message: `no Storybook named "${w.name}" has been uploaded; upload it with artifact_storybook_upload, then update the page` });
      continue;
    }
    const stories = buildStories(ctx, build);
    if (!stories.some((s) => s.id === w.id)) {
      const near = similarStories(stories, w.id);
      warnings.push({ line: w.line, message: `the "${w.name}" Storybook has no story "${w.id}"${near.length ? `; similar: ${near.join(", ")}` : ""}` });
    }
  }
  return { pins, warnings };
}

/** The build a story in a version is drawn from: its pin while that exists, else the latest. */
export function buildForVersion(ctx: ServiceContext, pins: Record<string, string>, storybook: string): BuildSummary | null {
  const pinned = pins[storybook.toLowerCase()];
  const build = pinned ? getBuild(ctx, pinned) : null;
  return build ?? latestBuild(ctx, storybook);
}

export function storybookSettings(ctx: ServiceContext, name: string): StorybookSettings {
  return findStorybook(ctx, name)?.settings ?? {};
}

export type { SchemeGlobals };
