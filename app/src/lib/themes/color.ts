/**
 * The colour arithmetic themes are derived with. Colours are #rrggbb; the
 * working space is OKLab/OKLCH, where a lightness change looks the same across
 * hues and a mix between two colours does not go muddy in the middle.
 */

export type Rgb = [number, number, number];
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** #abc and #aabbcc, any case, to #aabbcc; anything else to null. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const long = /^#?([0-9a-f]{6})$/i.exec(v);
  return long ? `#${long[1].toLowerCase()}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);

function rgbToOklab([r8, g8, b8]: Rgb): [number, number, number] {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function toOklch(hex: string): Oklch {
  const [l, a, b] = rgbToOklab(hexToRgb(hex));
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/**
 * Back to hex. A colour outside sRGB loses chroma until it fits, rather than
 * being clipped channel by channel, which would shift its hue.
 */
export function fromOklch({ l, c, h }: Oklch): string {
  const L = Math.min(1, Math.max(0, l));
  let chroma = Math.max(0, c);
  for (let i = 0; i < 24; i++) {
    const rad = (h * Math.PI) / 180;
    const rgb = oklabToRgb([L, chroma * Math.cos(rad), chroma * Math.sin(rad)]);
    if (rgb.every((v) => v >= -0.5 && v <= 255.5) || chroma < 1e-3) return rgbToHex(rgb);
    chroma *= 0.85;
  }
  return rgbToHex(oklabToRgb([L, 0, 0]));
}

/** `amount` of the way from a to b, in OKLab. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  const t = Math.min(1, Math.max(0, amount));
  return rgbToHex(oklabToRgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]));
}

export function withLightness(hex: string, l: number): string {
  return fromOklch({ ...toOklch(hex), l });
}

export function shiftLightness(hex: string, by: number): string {
  const c = toOklch(hex);
  return fromOklch({ ...c, l: c.l + by });
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The colour moved toward black or white, whichever the background is not,
 * until it reaches the ratio, keeping its hue.
 */
export function ensureContrast(hex: string, background: string, ratio: number): string {
  if (contrast(hex, background) >= ratio) return hex;
  const darker = luminance(background) > 0.18;
  const c = toOklch(hex);
  for (let step = 1; step <= 40; step++) {
    const next = fromOklch({ ...c, l: c.l + (darker ? -0.02 : 0.02) * step });
    if (contrast(next, background) >= ratio) return next;
  }
  return darker ? "#000000" : "#ffffff";
}
