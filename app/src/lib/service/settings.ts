import type { ServiceContext } from "./context";
import { ValidationError } from "./errors";
import { requireTheme } from "./themes";

/**
 * The owner's settings that live in the database rather than the environment:
 * things worth changing from the browser without a restart.
 */
export interface AppSettings {
  /** The most the data folder may hold, in megabytes. 0 means no limit. */
  storageLimitMb: number;
  /** Shrink and re-encode images an agent attaches. */
  compressImages: boolean;
  /** Longest side an attached image is scaled down to, in pixels. */
  imageMaxEdge: number;
  /** Encoder quality for JPEG and WebP, and the palette budget for PNG, 1 to 100. */
  imageQuality: number;
  /** The theme a page gets when neither it nor its project names one. */
  defaultTheme: string;
}

/**
 * 5 GB holds thousands of pages with screenshots and leaves room on a small
 * VPS. 2560 px is sharper than any laptop shows a page at, and quality 80 is
 * where screenshots stop looking different from the original.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  storageLimitMb: 5120,
  compressImages: true,
  imageMaxEdge: 2560,
  imageQuality: 80,
  defaultTheme: "paper",
};

const KEY = "app_settings";

export function getSettings(ctx: ServiceContext): AppSettings {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value?: string } | undefined;
  if (!row?.value) return { ...DEFAULT_SETTINGS };
  try {
    const saved = { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<AppSettings>) };
    // "default" was the Paper preset's name before it was renamed.
    if (saved.defaultTheme === "default") saved.defaultTheme = DEFAULT_SETTINGS.defaultTheme;
    return saved;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function whole(value: unknown, name: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function updateSettings(ctx: ServiceContext, patch: Partial<Record<keyof AppSettings, unknown>>): AppSettings {
  const next = getSettings(ctx);
  if (patch.storageLimitMb !== undefined) {
    const mb = whole(patch.storageLimitMb, "the storage limit", 0, 10_000_000);
    if (mb !== 0 && mb < 100) throw new ValidationError("the storage limit must be at least 100 MB, or 0 for no limit");
    next.storageLimitMb = mb;
  }
  if (patch.compressImages !== undefined) {
    if (typeof patch.compressImages !== "boolean") throw new ValidationError("compressImages must be true or false");
    next.compressImages = patch.compressImages;
  }
  if (patch.imageMaxEdge !== undefined) next.imageMaxEdge = whole(patch.imageMaxEdge, "the largest image side", 320, 8192);
  if (patch.imageQuality !== undefined) next.imageQuality = whole(patch.imageQuality, "image quality", 30, 100);
  if (patch.defaultTheme !== undefined) next.defaultTheme = requireTheme(ctx, String(patch.defaultTheme)).name;
  ctx.db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, JSON.stringify(next));
  return next;
}
