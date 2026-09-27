import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { link, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import { publishArtifact, requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "@/lib/service/settings";
import { assertRoom, dataUsage, forgetUsage, StorageFullError } from "@/lib/service/storage";
import { compressImage } from "@/lib/service/images";
import { ValidationError } from "@/lib/service/errors";

let dir: string;
let ctx: ServiceContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-settings-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://agentbox:1936", assetRoots: [dir] });
  forgetUsage();
});
afterEach(async () => {
  ctx.db.close();
  forgetUsage();
  await rm(dir, { recursive: true, force: true });
});

/** A noisy photo-like PNG: many colours, so it is big and compresses well. */
async function photo(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

describe("settings", () => {
  it("has sensible defaults and keeps what is saved", () => {
    expect(getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ storageLimitMb: 5120, compressImages: true, imageMaxEdge: 2560, imageQuality: 80 });
    updateSettings(ctx, { storageLimitMb: 0, imageQuality: 60 });
    expect(getSettings(ctx)).toMatchObject({ storageLimitMb: 0, imageQuality: 60, compressImages: true });
  });

  it("refuses values outside their range", () => {
    expect(() => updateSettings(ctx, { storageLimitMb: 5 })).toThrow(ValidationError);
    expect(() => updateSettings(ctx, { imageMaxEdge: 100 })).toThrow(ValidationError);
    expect(() => updateSettings(ctx, { imageQuality: 101 })).toThrow(ValidationError);
    expect(() => updateSettings(ctx, { compressImages: "yes" })).toThrow(ValidationError);
    expect(getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("storage", () => {
  it("counts a hard-linked file once", async () => {
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "a.bin"), Buffer.alloc(200_000));
    await link(join(dir, "assets", "a.bin"), join(dir, "assets", "b.bin"));
    const usage = await dataUsage(ctx);
    expect(usage.assets).toBe(200_000);
    expect(usage.database).toBeGreaterThan(0);
  });

  it("refuses a write past the limit, and has no limit at 0", async () => {
    updateSettings(ctx, { storageLimitMb: 100 });
    await expect(assertRoom(ctx, 1024)).resolves.toBeUndefined();
    await expect(assertRoom(ctx, 101 * 1024 * 1024)).rejects.toThrow(StorageFullError);
    await expect(assertRoom(ctx, 101 * 1024 * 1024)).rejects.toThrow(/storage limit/);
    updateSettings(ctx, { storageLimitMb: 0 });
    await expect(assertRoom(ctx, 101 * 1024 * 1024)).resolves.toBeUndefined();
  });
});

describe("image compression", () => {
  it("shrinks a large PNG, keeps it a PNG and fits the longest side", async () => {
    const input = await photo(3000, 1500);
    const { data, changed } = await compressImage(input, "image/png", DEFAULT_SETTINGS);
    expect(changed).toBe(true);
    expect(data.length).toBeLessThan(input.length);
    const meta = await sharp(data).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([2560, 1280]);
  });

  it("keeps the original when compression is off, the type is not an image it handles, or it would not shrink", async () => {
    const input = await photo(400, 300);
    expect((await compressImage(input, "image/png", { ...DEFAULT_SETTINGS, compressImages: false })).changed).toBe(false);
    expect((await compressImage(input, "image/gif", DEFAULT_SETTINGS)).changed).toBe(false);
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c9a26a" } })
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer();
    const kept = await compressImage(tiny, "image/png", DEFAULT_SETTINGS);
    expect(kept.changed).toBe(false);
    expect(kept.data).toBe(tiny);
    const junk = Buffer.from("not really a png");
    expect((await compressImage(junk, "image/png", DEFAULT_SETTINGS)).data).toBe(junk);
  });

  it("stores the compressed image when an agent attaches one", async () => {
    const shot = join(dir, "shot.png");
    const input = await photo(3000, 1500);
    await writeFile(shot, input);
    await publishArtifact(ctx, { slug: "big-shot", source: "---\ntitle: Shot\n---\n\n![shot](assets/shot.png)\n", assets: [{ name: "shot.png", path: shot }] });
    const a = requireArtifact(ctx, "big-shot");
    const [record] = requireVersion(ctx, a, 1).assets;
    expect(record.size).toBeLessThan(input.length);
    expect((await stat(join(dir, "assets", a.id, "1", "shot.png"))).size).toBe(record.size);
  });
});
