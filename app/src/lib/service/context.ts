import { join, resolve } from "node:path";
import { openDb, type DatabaseSync } from "../db/index.js";

export interface ServiceContext {
  db: DatabaseSync;
  dataDir: string;
  publicUrl: string;
  assetRoots: string[];
}

let singleton: ServiceContext | null = null;

export function defaultDataDir(): string {
  return process.env.ARTIFACTS_DATA ?? resolve(process.cwd(), "data");
}

export function defaultPublicUrl(): string {
  return (process.env.ARTIFACTS_PUBLIC_URL ?? "http://agentbox:5174").replace(/\/+$/, "");
}

export function defaultAssetRoots(): string[] {
  const raw = process.env.ARTIFACTS_ASSET_ROOTS ?? "/home/liam/work:/home/liam/orca:/tmp";
  return raw
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => resolve(p));
}

export function getContext(): ServiceContext {
  if (!singleton) {
    const dataDir = defaultDataDir();
    singleton = {
      db: openDb(join(dataDir, "artifacts.db")),
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
