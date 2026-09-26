import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDb, type DatabaseSync } from "../db/index";
import { config } from "../config";
import { searchableText } from "./plaintext";
import type { Kind } from "./types";

export interface ServiceContext {
  db: DatabaseSync;
  dataDir: string;
  publicUrl: string;
  assetRoots: string[];
}

let singleton: ServiceContext | null = null;

/** An install from before the rename keeps its database file name. */
export function dbFile(dataDir: string): string {
  return existsSync(join(dataDir, "artifacts.db")) ? "artifacts.db" : "indy.db";
}

export function defaultDataDir(): string {
  return config().dataDir;
}

export function defaultPublicUrl(): string {
  return config().url;
}

export function defaultAssetRoots(): string[] {
  return config().assetRoots;
}

export function getContext(): ServiceContext {
  if (!singleton) {
    const dataDir = defaultDataDir();
    const created: ServiceContext = {
      db: openDb(join(dataDir, dbFile(dataDir))),
      dataDir,
      publicUrl: defaultPublicUrl(),
      assetRoots: defaultAssetRoots(),
    };
    reindexIfStale(created);
    singleton = created;
  }
  return singleton;
}

/** Bump when what the search index holds changes; the next start rebuilds it. */
const SEARCH_FORMAT = "3";

function reindexIfStale(ctx: ServiceContext): void {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'search_format'").get() as { value?: string } | undefined;
  if (row?.value === SEARCH_FORMAT) return;
  const rows = ctx.db
    .prepare(
      `SELECT a.id, a.title, a.kind, COALESCE(a.description, '') AS description, v.source, v.files_json
         FROM artifacts a LEFT JOIN versions v ON v.artifact_id = a.id AND v.number = a.current_version`,
    )
    .all() as Record<string, unknown>[];
  ctx.db.exec("DELETE FROM search");
  const insert = ctx.db.prepare("INSERT INTO search (artifact_id, title, description, body) VALUES (?, ?, ?, ?)");
  for (const r of rows) {
    const body = searchableText(
      { source: (r.source as string | null) ?? null, files: r.files_json ? JSON.parse(String(r.files_json)) : null },
      String(r.kind) as Kind,
    );
    insert.run(String(r.id), String(r.title), String(r.description), body);
  }
  ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('search_format', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SEARCH_FORMAT);
}

export function makeContext(overrides: Partial<ServiceContext> & { dataDir: string }): ServiceContext {
  return {
    db: overrides.db ?? openDb(join(overrides.dataDir, "artifacts.db")),
    dataDir: overrides.dataDir,
    publicUrl: overrides.publicUrl ?? "http://artifacts.test",
    assetRoots: overrides.assetRoots ?? [overrides.dataDir],
  };
}

export function resetContextForTesting(): void {
  singleton = null;
}

export function artifactUrl(ctx: ServiceContext, slug: string, version?: number): string {
  return version === undefined ? `${ctx.publicUrl}/a/${slug}` : `${ctx.publicUrl}/a/${slug}/v/${version}`;
}

export function buildDir(ctx: ServiceContext, artifactId: string, version: number): string {
  return join(ctx.dataDir, "builds", artifactId, String(version));
}

export function assetDir(ctx: ServiceContext, artifactId: string, version: number): string {
  return join(ctx.dataDir, "assets", artifactId, String(version));
}
