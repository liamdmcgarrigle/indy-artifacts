import {
  contrast,
  ensureContrast,
  fromOklch,
  mix,
  normaliseHex,
  rgba,
  shiftLightness,
  toOklch,
  withLightness,
} from "./color";

/**
 * A theme is twenty values. Everything else the --art-* contract needs
 * (hovers, washes, strong borders, extra surfaces, links, focus, selection,
 * shadows, the chart palette and the whole dark scheme) is derived from them,
 * so a theme can be written by hand, in Settings or by an agent reading a
 * project's own design tokens. Any colour can be set for dark as well, where
 * the derived one is not right.
 *
 * Pure functions only: Settings runs the same derivation for its preview.
 */

export const COLOR_KEYS = ["background", "surface", "text", "muted", "border", "accent", "info", "good", "warn", "bad"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const FONT_KEYS = ["fontSans", "fontDisplay", "fontBody", "fontMono"] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export type Shadow = "none" | "soft" | "lifted";
export type Density = "compact" | "normal" | "airy";

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  info: string;
  good: string;
  warn: string;
  bad: string;
  fontSans: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  /** Body text size in px. */
  fontSize: number;
  lineHeight: number;
  /** Corner radius in px; the smaller and larger radii follow from it. */
  radius: number;
  shadow: Shadow;
  density: Density;
  /** Reading width, in ch. */
  measure: number;
}

export type DarkOverrides = Partial<Record<ColorKey, string>>;

export interface ThemeSpec {
  tokens: ThemeTokens;
  dark: DarkOverrides;
}

/**
 * The typefaces a theme can use. Artifact frames have no network, so these
 * are the ones Indy serves itself (app/public/fonts) plus system stacks.
 */
export const FONTS: Record<string, { label: string; stack: string; kind: "sans" | "serif" | "mono" }> = {
  inter: { label: "Inter", stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', kind: "sans" },
  geist: { label: "Geist", stack: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif', kind: "sans" },
  manrope: { label: "Manrope", stack: '"Manrope", system-ui, "Helvetica Neue", Arial, sans-serif', kind: "sans" },
  "nunito-sans": { label: "Nunito Sans", stack: '"Nunito Sans", system-ui, -apple-system, sans-serif', kind: "sans" },
  bricolage: { label: "Bricolage Grotesque", stack: '"Bricolage Grotesque", "Geist", system-ui, sans-serif', kind: "sans" },
  "system-sans": { label: "System sans", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', kind: "sans" },
  "source-serif": { label: "Source Serif 4", stack: '"Source Serif 4", "Iowan Old Style", Georgia, serif', kind: "serif" },
  "system-serif": { label: "System serif", stack: '"Iowan Old Style", Georgia, "Times New Roman", serif', kind: "serif" },
  "jetbrains-mono": { label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace', kind: "mono" },
  "geist-mono": { label: "Geist Mono", stack: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace', kind: "mono" },
  "system-mono": { label: "System mono", stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", kind: "mono" },
};

export const SHADOWS: Shadow[] = ["none", "soft", "lifted"];
export const DENSITIES: Density[] = ["compact", "normal", "airy"];

/** Which theme settings mean what, for Settings, the MCP tool and validation messages. */
export const TOKEN_HELP: Record<keyof ThemeTokens, string> = {
  background: "the page behind everything",
  surface: "cards, tables and panels",
  text: "body text",
  muted: "secondary text: captions, labels, metadata",
  border: "lines around cards and between rows",
  accent: "links, buttons, focus, the first chart series",
  info: "informational callouts",
  good: "success and positive numbers",
  warn: "warnings",
  bad: "errors and negative numbers",
  fontSans: "interface text: labels, tables, buttons",
  fontDisplay: "titles and headings",
  fontBody: "long-form paragraphs",
  fontMono: "code and figures",
  fontSize: "body size in px, 12 to 22",
  lineHeight: "body line height, 1.2 to 2",
  radius: "corner radius in px, 0 to 24",
  shadow: "none, soft or lifted",
  density: "compact, normal or airy spacing",
  measure: "reading width in characters, 50 to 110",
};

export interface Preset {
  name: string;
  label: string;
  description: string;
  spec: ThemeSpec;
}

/** Three starting points. "paper" is also what a page gets when nothing else applies. */
export const PRESETS: Preset[] = [
  {
    name: "paper",
    label: "Paper",
    description: "Warm paper, ink-blue accent, serif paragraphs. Made for reading.",
    spec: {
      tokens: {
        background: "#faf9f7",
        surface: "#ffffff",
        text: "#191814",
        muted: "#666158",
        border: "#e6e2da",
        accent: "#2a50d6",
        info: "#2148cc",
        good: "#1d7a4c",
        warn: "#9a5b04",
        bad: "#b3251d",
        fontSans: "inter",
        fontDisplay: "inter",
        fontBody: "source-serif",
        fontMono: "jetbrains-mono",
        fontSize: 16.5,
        lineHeight: 1.62,
        radius: 10,
        shadow: "soft",
        density: "normal",
        measure: 68,
      },
      dark: {
        background: "#0e0e10",
        surface: "#151518",
        text: "#eceae6",
        muted: "#a19c94",
        border: "#28282f",
        accent: "#7e9cff",
        info: "#94acff",
        good: "#4fce8a",
        warn: "#f0b34a",
        bad: "#f08078",
      },
    },
  },
  {
    name: "graphite",
    label: "Graphite",
    description: "Neutral greys and a near-black accent, sans throughout, tighter spacing. A product dashboard.",
    spec: {
      tokens: {
        background: "#ffffff",
        surface: "#fafafa",
        text: "#18181b",
        muted: "#71717a",
        border: "#e4e4e7",
        accent: "#18181b",
        info: "#2563eb",
        good: "#16a34a",
        warn: "#ca8a04",
        bad: "#dc2626",
        fontSans: "geist",
        fontDisplay: "geist",
        fontBody: "geist",
        fontMono: "geist-mono",
        fontSize: 15,
        lineHeight: 1.55,
        radius: 8,
        shadow: "none",
        density: "compact",
        measure: 76,
      },
      dark: {
        background: "#09090b",
        surface: "#111113",
        text: "#fafafa",
        muted: "#a1a1aa",
        border: "#27272a",
        accent: "#fafafa",
      },
    },
  },
  {
    name: "indy",
    label: "Sand",
    description: "Indy's own look: warm neutrals, a sand accent, grotesque headings, generous spacing.",
    spec: {
      tokens: {
        background: "#f7f6f2",
        surface: "#ffffff",
        text: "#1a1a18",
        muted: "#6d6b64",
        border: "#e2dfd6",
        accent: "#b8873a",
        info: "#3b6fb6",
        good: "#1f9d55",
        warn: "#b26b00",
        bad: "#c2412d",
        fontSans: "geist",
        fontDisplay: "bricolage",
        fontBody: "geist",
        fontMono: "geist-mono",
        fontSize: 16,
        lineHeight: 1.6,
        radius: 12,
        shadow: "lifted",
        density: "airy",
        measure: 70,
      },
      dark: {
        background: "#0e0f11",
        surface: "#16171a",
        text: "#ededeb",
        muted: "#9c9da3",
        border: "#25272c",
        accent: "#d9b26f",
      },
    },
  },
];

export const DEFAULT_THEME = "paper";

/**
 * Theme names from before themes were data. Pages published then carry them
 * in their frontmatter ("default" on nearly all of them), and agents with an
 * older skill still write them; they mean "no theme of its own".
 */
export const LEGACY_THEMES = ["default", "picaflick", "backup-studio"];

export function presetNamed(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}

export class ThemeError extends Error {}

function num(value: unknown, key: string, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
    throw new ThemeError(`${key} must be a number from ${min} to ${max}`);
  }
  return Math.round(n * 100) / 100;
}

/**
 * Checks a partial set of tokens and lays it over a base. Unknown keys are an
 * error, so a typo does not silently do nothing.
 */
export function applyTokens(base: ThemeTokens, patch: Record<string, unknown> | undefined): ThemeTokens {
  const next: ThemeTokens = { ...base };
  if (!patch) return next;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if ((COLOR_KEYS as readonly string[]).includes(key)) {
      const hex = normaliseHex(value);
      if (!hex) throw new ThemeError(`${key} must be a hex colour such as #2a50d6, not ${JSON.stringify(value)}`);
      next[key as ColorKey] = hex;
    } else if ((FONT_KEYS as readonly string[]).includes(key)) {
      const font = String(value).toLowerCase();
      if (!FONTS[font]) throw new ThemeError(`${key} must be one of ${Object.keys(FONTS).join(", ")}, not ${JSON.stringify(value)}`);
      next[key as FontKey] = font;
    } else if (key === "fontSize") next.fontSize = num(value, key, 12, 22);
    else if (key === "lineHeight") next.lineHeight = num(value, key, 1.2, 2);
    else if (key === "radius") next.radius = num(value, key, 0, 24);
    else if (key === "measure") next.measure = Math.round(num(value, key, 50, 110));
    else if (key === "shadow") {
      if (!SHADOWS.includes(value as Shadow)) throw new ThemeError(`shadow must be one of ${SHADOWS.join(", ")}`);
      next.shadow = value as Shadow;
    } else if (key === "density") {
      if (!DENSITIES.includes(value as Density)) throw new ThemeError(`density must be one of ${DENSITIES.join(", ")}`);
      next.density = value as Density;
    } else {
      throw new ThemeError(`${key} is not a theme setting. The settings are: ${Object.keys(TOKEN_HELP).join(", ")}`);
    }
  }
  return next;
}

/** Checks dark overrides and lays them over a base; null removes one. */
export function applyDark(base: DarkOverrides, patch: Record<string, unknown> | undefined): DarkOverrides {
  const next: DarkOverrides = { ...base };
  if (!patch) return next;
  for (const [key, value] of Object.entries(patch)) {
    if (!(COLOR_KEYS as readonly string[]).includes(key)) {
      throw new ThemeError(`dark.${key} is not a colour setting. Dark can set: ${COLOR_KEYS.join(", ")}`);
    }
    if (value === null || value === "") {
      delete next[key as ColorKey];
      continue;
    }
    const hex = normaliseHex(value);
    if (!hex) throw new ThemeError(`dark.${key} must be a hex colour, not ${JSON.stringify(value)}`);
    next[key as ColorKey] = hex;
  }
  return next;
}

/**
 * The dark counterpart of each colour, where the theme does not say: the same
 * hues at the lightness a dark page needs.
 */
export function darkColors(tokens: ThemeTokens, overrides: DarkOverrides): Record<ColorKey, string> {
  const hue = (hex: string, l: number, maxC: number) => {
    const c = toOklch(hex);
    return fromOklch({ l, c: Math.min(c.c, maxC), h: c.h });
  };
  const lift = (hex: string, min: number) => {
    const c = toOklch(hex);
    return fromOklch({ l: Math.min(0.88, Math.max(c.l, min)), c: Math.min(c.c, 0.2), h: c.h });
  };
  const derived: Record<ColorKey, string> = {
    background: hue(tokens.background, 0.16, 0.012),
    surface: hue(tokens.surface === tokens.background ? tokens.background : tokens.surface, 0.2, 0.014),
    text: hue(tokens.text, 0.93, 0.012),
    muted: hue(tokens.muted, 0.7, 0.02),
    border: hue(tokens.border, 0.29, 0.015),
    accent: toOklch(tokens.accent).c < 0.03 ? hue(tokens.accent, 0.93, 0.02) : lift(tokens.accent, 0.72),
    info: lift(tokens.info, 0.74),
    good: lift(tokens.good, 0.74),
    warn: lift(tokens.warn, 0.78),
    bad: lift(tokens.bad, 0.72),
  };
  return { ...derived, ...overrides };
}

const SPACE: Record<Density, number[]> = {
  compact: [3, 6, 10, 14, 20, 32],
  normal: [4, 8, 12, 16, 24, 40],
  airy: [5, 10, 15, 20, 30, 50],
};

function shadows(level: Shadow, dark: boolean, ink: string): Record<string, string> {
  if (level === "none") {
    const line = dark ? "0 0 0 1px rgba(255, 255, 255, 0.04)" : "none";
    return { "--art-shadow-sm": "none", "--art-shadow": line, "--art-shadow-md": line, "--art-shadow-lg": line };
  }
  const k = level === "lifted" ? 1.6 : 1;
  const c = (a: number) => (dark ? `rgba(0, 0, 0, ${Math.min(0.9, a * 5 * k).toFixed(2)})` : rgba(ink, Number(Math.min(0.4, a * k).toFixed(3))));
  return {
    "--art-shadow-sm": `0 1px 2px ${c(0.06)}`,
    "--art-shadow": `0 1px 2px ${c(0.05)}, 0 2px 6px -2px ${c(0.08)}`,
    "--art-shadow-md": `0 2px 4px -2px ${c(0.06)}, 0 10px 24px -8px ${c(0.12)}`,
    "--art-shadow-lg": `0 6px 12px -6px ${c(0.1)}, 0 28px 56px -16px ${c(0.2)}`,
  };
}

/** Six chart colours that sit together: the accent, then hues spaced around it. */
function charts(colors: Record<ColorKey, string>, dark: boolean): string[] {
  const a = toOklch(colors.accent);
  const neutralAccent = a.c < 0.04;
  const base = neutralAccent ? toOklch(colors.info) : a;
  const l = dark ? Math.max(base.l, 0.72) : Math.min(Math.max(base.l, 0.5), 0.62);
  const c = Math.max(0.1, Math.min(base.c, 0.17));
  // The spacing of the hand-made palette this replaced (teal, amber, violet,
  // pink around a blue), turned to start from the accent. Warm hues sit higher
  // so an amber reads as amber rather than brown.
  const series = [0, 280, 165, 35, 85].map((offset) => {
    const h = (base.h + offset) % 360;
    const warm = h >= 45 && h <= 120;
    return fromOklch({ l: Math.min(0.9, warm && !dark ? l + 0.12 : l), c, h });
  });
  if (!neutralAccent) series[0] = colors.accent;
  return [...series, mix(colors.muted, colors.background, 0.15)];
}

function schemeVars(colors: Record<ColorKey, string>, tokens: ThemeTokens, dark: boolean): Record<string, string> {
  const { background: bg, surface, text, muted, border, accent } = colors;
  const wash = (c: string) => mix(bg, c, dark ? 0.2 : 0.11);
  const onAccent =
    contrast("#ffffff", accent) >= contrast("#111111", accent) ? "#ffffff" : withLightness(accent, 0.17);
  const vars: Record<string, string> = {
    "color-scheme": dark ? "dark" : "light",
    "--art-bg": bg,
    "--art-surface": surface,
    "--art-surface-2": mix(surface, text, dark ? 0.06 : 0.045),
    "--art-surface-3": mix(surface, text, dark ? 0.11 : 0.085),
    "--art-border": border,
    "--art-border-strong": mix(border, text, dark ? 0.14 : 0.16),
    "--art-hairline": rgba(dark ? "#ffffff" : text, 0.07),
    "--art-text": text,
    "--art-text-muted": ensureContrast(muted, bg, 4.5),
    "--art-text-faint": mix(muted, bg, 0.35),
    "--art-accent": accent,
    "--art-accent-hover": shiftLightness(accent, dark ? 0.06 : -0.07),
    "--art-accent-wash": wash(accent),
    "--art-on-accent": onAccent,
    "--art-link": ensureContrast(accent, bg, 4.5),
    "--art-focus": accent,
    "--art-selection": mix(bg, accent, dark ? 0.3 : 0.2),
  };
  for (const key of ["good", "warn", "bad", "info"] as const) {
    vars[`--art-${key}`] = ensureContrast(colors[key], bg, 3);
    vars[`--art-${key}-wash`] = wash(colors[key]);
  }
  Object.assign(vars, shadows(tokens.shadow, dark, text));
  charts(colors, dark).forEach((c, i) => (vars[`--art-chart-${i + 1}`] = c));
  return vars;
}

function shapeVars(tokens: ThemeTokens): Record<string, string> {
  const font = (key: string) => FONTS[key]?.stack ?? FONTS.inter.stack;
  const r = tokens.radius;
  const vars: Record<string, string> = {
    "--art-font-sans": font(tokens.fontSans),
    "--art-font-serif": FONTS[FONTS[tokens.fontBody]?.kind === "serif" ? tokens.fontBody : "source-serif"].stack,
    "--art-font-mono": font(tokens.fontMono),
    "--art-font-display": font(tokens.fontDisplay),
    "--art-font-body": font(tokens.fontBody),
    "--art-font-size": `${tokens.fontSize}px`,
    "--art-line-height": String(tokens.lineHeight),
    "--art-measure": `${tokens.measure}ch`,
    "--art-radius-sm": `${Math.round(r * 0.6)}px`,
    "--art-radius": `${r}px`,
    "--art-radius-lg": `${Math.round(r * 1.4)}px`,
    "--art-radius-xl": `${Math.round(r * 2)}px`,
  };
  SPACE[tokens.density].forEach((px, i) => (vars[`--art-space-${i + 1}`] = `${px}px`));
  return vars;
}

/** Every custom property, light and dark, that a theme resolves to. */
export function deriveTheme(spec: ThemeSpec): { shape: Record<string, string>; light: Record<string, string>; dark: Record<string, string> } {
  const light = Object.fromEntries(COLOR_KEYS.map((k) => [k, spec.tokens[k]])) as Record<ColorKey, string>;
  return {
    shape: shapeVars(spec.tokens),
    light: schemeVars(light, spec.tokens, false),
    dark: schemeVars(darkColors(spec.tokens, spec.dark), spec.tokens, true),
  };
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`;

/**
 * The stylesheet a theme is served as: light on :root, dark under
 * [data-scheme="dark"], and Indy's fonts, which frames cannot fetch from
 * anywhere else.
 */
export function themeCss(name: string, spec: ThemeSpec): string {
  // Only the name, which is [a-z0-9-], goes into the comment. A label could
  // close it and put rules of its own into Indy's pages.
  const safe = name.replace(/[^a-z0-9-]/g, "");
  const vars = deriveTheme(spec);
  return [
    `/* Indy theme: ${safe}. Generated from its settings; edit it in Settings > Themes. */`,
    `@import url("/fonts/fonts.css");`,
    block(":root", { ...vars.light, ...vars.shape }),
    block(':root[data-scheme="dark"]', vars.dark),
    "",
  ].join("\n\n");
}
