import type { AppSettings } from "./settings";

/**
 * Attached images, made smaller before they are stored.
 *
 * An agent's screenshots are usually full-resolution PNGs, often several
 * megabytes each, and a page shows them at a fraction of that. Each image is
 * scaled down to the longest side the owner allows and re-encoded in its own
 * format, so a .png stays a PNG and every reference to it keeps working.
 * Photos lose their EXIF data on the way, location included.
 *
 * GIFs (which may be animated) and SVGs are left as they are, and so is any
 * image the re-encode would make bigger.
 */

const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export function compressible(type: string): boolean {
  return COMPRESSIBLE.has(type);
}

/** Refuse to decode anything bigger than 50 megapixels: a small file can unpack to gigabytes. */
const MAX_PIXELS = 50_000_000;
let tuned = false;

export interface Compressed {
  data: Buffer;
  /** True when the stored bytes differ from what the agent sent. */
  changed: boolean;
}

export async function compressImage(input: Buffer, type: string, settings: Pick<AppSettings, "compressImages" | "imageMaxEdge" | "imageQuality">): Promise<Compressed> {
  if (!settings.compressImages || !COMPRESSIBLE.has(type)) return { data: input, changed: false };
  try {
    const sharp = (await import("sharp")).default;
    if (!tuned) {
      // One image at a time and no cache: Indy runs in a small container.
      sharp.cache(false);
      sharp.concurrency(1);
      tuned = true;
    }
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    if ((meta.pages ?? 1) > 1) return { data: input, changed: false };

    let image = sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: settings.imageMaxEdge, height: settings.imageMaxEdge, fit: "inside", withoutEnlargement: true });
    const quality = settings.imageQuality;
    if (type === "image/jpeg") image = image.jpeg({ quality, mozjpeg: true });
    else if (type === "image/webp") image = image.webp({ quality, effort: 5 });
    // A screenshot has few colours, so a palette PNG is a fraction of the size
    // and looks the same; quality sets how many colours it may keep. Effort 5
    // is as small as 8 on screenshots and several times faster on photos.
    else image = image.png({ palette: true, quality, effort: 5, compressionLevel: 9 });

    const data = await image.toBuffer();
    const resized = Math.max(meta.width ?? 0, meta.height ?? 0) > settings.imageMaxEdge;
    if (!resized && data.length >= input.length) return { data: input, changed: false };
    return { data, changed: true };
  } catch {
    // An image sharp cannot read is stored untouched; the page shows what it can.
    return { data: input, changed: false };
  }
}
