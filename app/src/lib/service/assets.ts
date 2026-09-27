import { copyFile, link, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { assetDir, type ServiceContext } from "./context";
import { ValidationError } from "./errors";
import { LIMITS, type AssetInput, type AssetRecord } from "./types";
import { compressible, compressImage } from "./images";
import { getSettings } from "./settings";
import { assertRoom, grewBy } from "./storage";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

const NAME = /^[A-Za-z0-9._-]{1,80}$/;

export function assetType(name: string): string | null {
  return TYPES[extname(name).toLowerCase()] ?? null;
}

async function underRoot(path: string, roots: string[]): Promise<string> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new ValidationError(`asset not found on this host: ${path}`);
  }
  const ok = roots.some((root) => real === root || real.startsWith(root + sep));
  if (!ok) throw new ValidationError(`asset path must be under one of ${roots.join(", ")}: ${path}`);
  return real;
}

/** Copy the listed host files into this version's asset directory. */
export async function copyAssets(
  ctx: ServiceContext,
  artifactId: string,
  version: number,
  assets: AssetInput[],
): Promise<AssetRecord[]> {
  if (assets.length > LIMITS.assetCount)
    throw new ValidationError(`too many assets: ${assets.length}, the limit is ${LIMITS.assetCount}`);
  const dir = assetDir(ctx, artifactId, version);
  const settings = getSettings(ctx);
  const out: AssetRecord[] = [];
  const seen = new Set<string>();
  const checked: { name: string; real: string; type: string }[] = [];
  let incoming = 0;
  for (const asset of assets) {
    if (!NAME.test(asset.name)) throw new ValidationError(`asset name must match [A-Za-z0-9._-]{1,80}: ${asset.name}`);
    if (seen.has(asset.name)) throw new ValidationError(`duplicate asset name: ${asset.name}`);
    seen.add(asset.name);
    const type = assetType(asset.name);
    if (!type) throw new ValidationError(`asset type not allowed: ${asset.name}`);
    const real = await underRoot(resolve(asset.path), ctx.assetRoots);
    const info = await stat(real);
    if (!info.isFile()) throw new ValidationError(`asset is not a file: ${asset.path}`);
    if (info.size > LIMITS.assetBytes)
      throw new ValidationError(`asset ${asset.name} is ${(info.size / 1048576).toFixed(1)} MB, over the 20 MB limit`);
    incoming += info.size;
    checked.push({ name: asset.name, real, type });
  }

  // Checked against what the agent sent; compression only ever makes it fit better.
  await assertRoom(ctx, incoming);
  await mkdir(dir, { recursive: true });
  for (const { name, real, type } of checked) {
    if (!settings.compressImages || !compressible(type)) {
      await copyFile(real, join(dir, name));
      out.push({ name, size: (await stat(join(dir, name))).size, type });
      continue;
    }
    const { data, changed } = await compressImage(await readFile(real), type, settings);
    if (changed) await writeFile(join(dir, name), data);
    else await copyFile(real, join(dir, name));
    out.push({ name, size: data.length, type });
  }
  grewBy("assets", out.reduce((n, a) => n + a.size, 0));
  return out;
}

/** Carry a previous version's assets forward without duplicating bytes where possible. */
export async function carryAssets(
  ctx: ServiceContext,
  artifactId: string,
  fromVersion: number,
  toVersion: number,
  records: AssetRecord[],
): Promise<AssetRecord[]> {
  if (records.length === 0) return [];
  const from = assetDir(ctx, artifactId, fromVersion);
  const to = assetDir(ctx, artifactId, toVersion);
  await mkdir(to, { recursive: true });
  let names: string[];
  try {
    names = await readdir(from);
  } catch {
    return [];
  }
  for (const name of names) {
    try {
      await link(join(from, name), join(to, name));
    } catch {
      await copyFile(join(from, name), join(to, name)).catch(() => {});
    }
  }
  return records.filter((r) => names.includes(r.name));
}
