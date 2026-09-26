import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDb, type DatabaseSync } from "../db/index";
import { config } from "../config";

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
    singleton = {
      db: openDb(join(dataDir, dbFile(dataDir))),
      dataDir,
      publicUrl: defaultPublicUrl(),
      assetRoots: defaultAssetRoots(),
    };
  }
  return singleton;
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
