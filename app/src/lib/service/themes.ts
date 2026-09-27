import { createHash } from "node:crypto";
import type { ServiceContext } from "./context";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { getSettings, updateSettings } from "./settings";
import {
  applyDark,
  applyTokens,
  DEFAULT_THEME,
  LEGACY_THEMES,
  PRESETS,
  presetNamed,
  ThemeError,
  themeCss,
  type DarkOverrides,
  type ThemeSpec,
  type ThemeTokens,
} from "../themes/tokens";

/**
 * Themes as data. The three presets live in code; everything else is a row
 * the owner or an agent made. A page's theme is, in order: the one it names,
 * its project's, the default chosen in Settings, then the "paper" preset.
 */

export interface Theme {
  name: string;
  label: string;
  preset: boolean;
  description: string | null;
  tokens: ThemeTokens;
  dark: DarkOverrides;
  updatedAt: string | null;
}

/** Bumped when the derivation in lib/themes/tokens.ts changes, so cached stylesheets refresh. */
const DERIVATION = 2;

const MAX_THEMES = 100;
const MAX_PROJECT_THEMES = 500;

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ThemeError) throw new ValidationError(err.message);
    throw err;
  }
}

interface Row {
  name: string;
  label: string;
  tokens_json: string;
  dark_json: string;
  updated_at: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    const value = JSON.parse(json) as T;
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function fromRow(row: Row): Theme {
  const base = PRESETS[0].spec.tokens;
  // Laid over the default so a theme saved before a setting existed still has
  // it, and a damaged row shows as the default rather than breaking every list.
  const tokens = { ...base, ...parse<Partial<ThemeTokens>>(row.tokens_json, {}) };
  return { name: row.name, label: row.label, preset: false, description: null, tokens, dark: parse(row.dark_json, {}), updatedAt: row.updated_at };
}

function fromPreset(name: string): Theme | null {
  const p = presetNamed(name);
  return p ? { name: p.name, label: p.label, preset: true, description: p.description, ...p.spec, updatedAt: null } : null;
}

export function getTheme(ctx: ServiceContext, name: string): Theme | null {
  const preset = fromPreset(name);
  if (preset) return preset;
  const row = ctx.db.prepare("SELECT * FROM themes WHERE name = ?").get(name) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function requireTheme(ctx: ServiceContext, name: string): Theme {
  const theme = getTheme(ctx, name);
  if (!theme) throw new NotFoundError(`no theme named "${name}". ${available(ctx)}`);
  return theme;
}

function available(ctx: ServiceContext): string {
  return `Themes: ${listThemes(ctx)
    .map((t) => t.name)
    .join(", ")}.`;
}

export function listThemes(ctx: ServiceContext): Theme[] {
  const rows = ctx.db.prepare("SELECT * FROM themes ORDER BY label COLLATE NOCASE").all() as unknown as Row[];
  return [...PRESETS.map((p) => fromPreset(p.name)!), ...rows.map(fromRow)];
}

export function themeExists(ctx: ServiceContext, name: string): boolean {
  return getTheme(ctx, name) !== null;
}

/**
 * The theme a page names, checked. An empty name means none, so the page
 * follows its project and the default.
 */
export function checkThemeName(ctx: ServiceContext, name: string | undefined | null): string {
  const value = (name ?? "").trim();
  if (!value || LEGACY_THEMES.includes(value)) return "";
  if (!themeExists(ctx, value)) throw new ValidationError(`there is no theme named "${value}". ${available(ctx)}`);
  return value;
}

export interface SaveThemeInput {
  name: string;
  label?: string;
  /** A theme to start from when creating one. */
  base?: string;
  /** Refuse, rather than change, a theme that exists. */
  create?: boolean;
  tokens?: Record<string, unknown>;
  dark?: Record<string, unknown>;
}

/** Creates a theme, or changes one that exists. Presets cannot be changed. */
export function saveTheme(ctx: ServiceContext, input: SaveThemeInput): Theme {
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new ValidationError("a theme name is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit");
  if (presetNamed(name) || LEGACY_THEMES.includes(name)) {
    throw new ValidationError(`"${name}" is a built-in theme and cannot be changed. Save it under a new name, with base: "${name}".`);
  }
  const existing = getTheme(ctx, name);
  if (existing && input.create) throw new ConflictError(`there is already a theme named "${name}"`, 0);
  if (existing && input.base) {
    throw new ValidationError(`"${name}" already exists, so base does not apply; pass the settings to change instead`);
  }
  const start = existing ?? (input.base ? requireTheme(ctx, input.base) : fromPreset(DEFAULT_THEME)!);
  // A dark colour the base set by hand is kept only where the light colour it
  // pairs with stays the same; a new light colour gets its dark one derived.
  const changed = new Set(Object.keys(input.tokens ?? {}));
  const startDark = existing
    ? start.dark
    : Object.fromEntries(Object.entries(input.base ? start.dark : {}).filter(([key]) => !changed.has(key)));
  const spec: ThemeSpec = checked(() => ({
    tokens: applyTokens(start.tokens, input.tokens),
    dark: applyDark(startDark, input.dark),
  }));
  const label = (input.label?.trim() || existing?.label || name).slice(0, 60);
  if (/[<>*/\\\u0000-\u001f]/.test(label)) throw new ValidationError("a theme label cannot contain < > * / \\ or control characters");
  if (!existing) {
    const count = Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM themes").get() as { n: number }).n);
    if (count >= MAX_THEMES) throw new ValidationError(`there are already ${MAX_THEMES} themes; delete one first`);
  }
  const now = new Date().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO themes (name, label, tokens_json, dark_json, created_at, updated_at)
       VALUES (:name, :label, :tokens, :dark, :now, :now)
       ON CONFLICT(name) DO UPDATE SET label = excluded.label, tokens_json = excluded.tokens_json,
         dark_json = excluded.dark_json, updated_at = excluded.updated_at`,
    )
    .run({ name, label, tokens: JSON.stringify(spec.tokens), dark: JSON.stringify(spec.dark), now });
  return getTheme(ctx, name)!;
}

/**
 * Removes a theme. Projects and pages that used it fall back to the default,
 * and so does the default itself if it was this one.
 */
export function deleteTheme(ctx: ServiceContext, name: string): void {
  if (presetNamed(name)) throw new ValidationError(`"${name}" is built in and cannot be deleted`);
  const gone = ctx.db.prepare("DELETE FROM themes WHERE name = ?").run(name);
  if (Number(gone.changes) === 0) throw new NotFoundError(`no theme named "${name}"`);
  ctx.db.prepare("DELETE FROM project_themes WHERE theme = ?").run(name);
  ctx.db.prepare("UPDATE artifacts SET theme = '' WHERE theme = ?").run(name);
  if (getSettings(ctx).defaultTheme === name) updateSettings(ctx, { defaultTheme: DEFAULT_THEME });
}

/** Every project that has pages, with the theme it is set to, if any. */
export function listProjects(ctx: ServiceContext): { name: string; theme: string | null; pages: number }[] {
  const rows = ctx.db
    .prepare(
      `SELECT p.name AS name, pt.theme AS theme, p.pages AS pages FROM (
         SELECT project AS name, COUNT(*) AS pages FROM artifacts WHERE project IS NOT NULL AND project != '' GROUP BY project
         UNION ALL
         SELECT project AS name, 0 AS pages FROM project_themes WHERE project NOT IN (SELECT project FROM artifacts WHERE project IS NOT NULL)
       ) p LEFT JOIN project_themes pt ON pt.project = p.name
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as { name: string; theme: string | null; pages: number }[];
  return rows.map((r) => ({ name: String(r.name), theme: r.theme ? String(r.theme) : null, pages: Number(r.pages) }));
}

export function projectTheme(ctx: ServiceContext, project: string | null | undefined): string | null {
  if (!project) return null;
  const row = ctx.db.prepare("SELECT theme FROM project_themes WHERE project = ?").get(project) as { theme?: string } | undefined;
  return row?.theme ?? null;
}

/**
 * Gives a project a theme, or with null takes it away. The name is matched to
 * the project's pages without regard to case, so "Acme" reaches "acme".
 */
export function setProjectTheme(ctx: ServiceContext, project: string, theme: string | null): void {
  const typed = project.trim();
  const known = ctx.db
    .prepare("SELECT project FROM artifacts WHERE project = ? COLLATE NOCASE ORDER BY project = ? DESC LIMIT 1")
    .get(typed, typed) as { project?: string } | undefined;
  const name = known?.project ? String(known.project) : typed;
  if (!name || name.length > 80) throw new ValidationError("a project name is 1 to 80 characters");
  if (theme === null || theme === "") {
    ctx.db.prepare("DELETE FROM project_themes WHERE project = ?").run(name);
    return;
  }
  requireTheme(ctx, theme);
  const assigned = ctx.db.prepare("SELECT 1 FROM project_themes WHERE project = ?").get(name);
  const count = Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM project_themes").get() as { n: number }).n);
  if (!assigned && count >= MAX_PROJECT_THEMES) throw new ValidationError(`${MAX_PROJECT_THEMES} projects already have a theme`);
  ctx.db
    .prepare("INSERT INTO project_themes (project, theme) VALUES (?, ?) ON CONFLICT(project) DO UPDATE SET theme = excluded.theme")
    .run(name, theme);
}

/** The theme a page is shown in. */
export function effectiveTheme(ctx: ServiceContext, artifact: { theme?: string | null; project?: string | null }): Theme {
  for (const name of [artifact.theme, projectTheme(ctx, artifact.project), getSettings(ctx).defaultTheme]) {
    if (!name) continue;
    const theme = getTheme(ctx, name);
    if (theme) return theme;
  }
  return fromPreset(DEFAULT_THEME)!;
}

/**
 * The stylesheet's address. The version changes whenever the theme does, so
 * a page never shows a stale copy and an unchanged one can be cached.
 */
export function themeVersion(theme: Theme): string {
  return createHash("sha256")
    .update(JSON.stringify([DERIVATION, theme.name, theme.tokens, theme.dark]))
    .digest("hex")
    .slice(0, 10);
}

export function themeHref(theme: Theme): string {
  return `/themes/${encodeURIComponent(theme.name)}.css?v=${themeVersion(theme)}`;
}

export function themeStylesheet(ctx: ServiceContext, name: string): { css: string; version: string } | null {
  const theme = getTheme(ctx, name);
  return theme ? { css: themeCss(theme.name, theme), version: themeVersion(theme) } : null;
}
