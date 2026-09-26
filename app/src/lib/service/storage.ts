import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";
import { getSettings } from "./settings";

/**
 * How much of the disk Indy uses, and the line it will not cross.
 *
 * The limit applies to new content only: publishing, updating and attaching
 * files are refused once the data folder is full, with a message that says
 * so. Reading, commenting and sharing keep working, so a full install is
 * never a broken one.
 */

export interface Usage {
  total: number;
  database: number;
  assets: number;
  builds: number;
  other: number;
}

export class StorageFullError extends ServiceError {
  constructor(message: string) {
    super("storage_full", message, 507);
  }
}

/**
 * Bytes under a path, counting each file once: a version's unchanged assets
 * are hard links to the previous version's, and take no more space.
 */
async function sizeOf(path: string, seen: Set<string>): Promise<number> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) {
    const id = `${info.dev}:${info.ino}`;
    if (seen.has(id)) return 0;
    seen.add(id);
    return info.size;
  }
  let total = 0;
  const entries = await readdir(path).catch(() => [] as string[]);
  for (const name of entries) total += await sizeOf(join(path, name), seen);
  return total;
}

// Walking the folder on every publish would be slow on a big install, so the
// answer is kept for a short while and dropped whenever something is written.
let cached: { at: number; dir: string; usage: Usage } | null = null;
const FRESH_MS = 30_000;

export function forgetUsage(): void {
  cached = null;
}

export async function dataUsage(ctx: ServiceContext): Promise<Usage> {
  if (cached && cached.dir === ctx.dataDir && Date.now() - cached.at < FRESH_MS) return cached.usage;
  const names = await readdir(ctx.dataDir).catch(() => [] as string[]);
  const usage: Usage = { total: 0, database: 0, assets: 0, builds: 0, other: 0 };
  const seen = new Set<string>();
  for (const name of names) {
    const size = await sizeOf(join(ctx.dataDir, name), seen);
    usage.total += size;
    if (/\.db(-wal|-shm)?$/.test(name)) usage.database += size;
    else if (name === "assets") usage.assets += size;
    else if (name === "builds") usage.builds += size;
    else usage.other += size;
  }
  cached = { at: Date.now(), dir: ctx.dataDir, usage };
  return usage;
}

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(bytes >= 10 * 1024 * MB ? 0 : 1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Refuse a write of about `incoming` bytes that would take the data folder past its limit. */
export async function assertRoom(ctx: ServiceContext, incoming: number): Promise<void> {
  const { storageLimitMb } = getSettings(ctx);
  if (!storageLimitMb) return;
  const limit = storageLimitMb * MB;
  const { total } = await dataUsage(ctx);
  if (total + incoming > limit) {
    throw new StorageFullError(
      `Indy is at its storage limit: ${formatBytes(total)} of ${formatBytes(limit)} used. ` +
        "Archive or delete pages you no longer need, or raise the limit in Settings › Data.",
    );
  }
}
