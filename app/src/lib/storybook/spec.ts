import { parse as parseYaml } from "yaml";

/**
 * A ```story block: one story from an uploaded Storybook, drawn in a frame.
 *
 *     ```story
 *     id: activity-picaactivitycard--kinds
 *     args: { kind: movie, expanded: true }
 *     width: 402
 *     height: 874
 *     ```
 *
 * Shared by the server (rendering, publishing) and the browser (the editor),
 * so it imports nothing that needs Node.
 */

export class StoryBlockError extends Error {}

export type Values = Record<string, unknown>;

export interface StorySpec {
  id: string;
  /** Which uploaded Storybook; the page's project when left out. */
  storybook?: string;
  args: Values;
  globals: Values;
  /** Globals for the page's light and dark schemes, over the Storybook's own. */
  light: Values;
  dark: Values;
  /** A fixed frame size in CSS pixels. Without a height the frame fits the story. */
  width?: number;
  height?: number;
  title?: string;
}

/** Storybook's own story id shape: the kebab-cased title, "--", the kebab-cased name. */
export const STORY_ID = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/;
export const STORYBOOK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const KEYS = new Set(["id", "story", "storybook", "args", "globals", "light", "dark", "width", "height", "title"]);

/** A pasted Storybook address works as well as the bare id. */
function idFrom(value: string): string {
  const v = value.trim();
  const query = /[?&]id=([^&#]+)/.exec(v);
  if (query) return decodeURIComponent(query[1]);
  const path = /\/(?:story|docs)\/([^?&#/]+)/.exec(v);
  if (path) return decodeURIComponent(path[1]);
  return v;
}

function mapping(value: unknown, what: string): Values {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new StoryBlockError(`${what} must be a mapping, e.g. ${what}: { key: value }`);
  return value as Values;
}

function size(value: unknown, what: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/px$/, ""));
  if (!Number.isFinite(n)) throw new StoryBlockError(`${what} must be a number of pixels`);
  return Math.round(Math.min(Math.max(n, min), max));
}

export function parseStoryBlock(body: string): StorySpec {
  let doc: unknown;
  const trimmed = body.trim();
  if (!trimmed) throw new StoryBlockError("story block is empty; it needs at least id: <story id>");
  try {
    // A block holding only an id (or a pasted link) is allowed.
    doc = /^[^\s:]+$/.test(trimmed) || /^https?:\/\//.test(trimmed) ? { id: trimmed } : parseYaml(trimmed);
  } catch (err) {
    throw new StoryBlockError(`story YAML is invalid: ${(err as Error).message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new StoryBlockError("story block must be a YAML mapping with an id");
  const o = doc as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !KEYS.has(k));
  if (unknown.length) throw new StoryBlockError(`story block has unknown key${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; it takes ${[...KEYS].filter((k) => k !== "story").join(", ")}`);

  const rawId = o.id ?? o.story;
  if (typeof rawId !== "string" || !rawId.trim()) throw new StoryBlockError("story block needs an id, e.g. id: button--primary");
  const id = idFrom(rawId);
  if (!STORY_ID.test(id)) throw new StoryBlockError(`"${id}" is not a story id; ids look like button--primary (artifact_stories lists them)`);

  let storybook: string | undefined;
  if (o.storybook !== undefined && o.storybook !== null && o.storybook !== "") {
    storybook = String(o.storybook).trim();
    if (!STORYBOOK_NAME.test(storybook)) throw new StoryBlockError(`storybook "${storybook}" is not a valid name`);
  }

  return {
    id,
    storybook,
    args: mapping(o.args, "args"),
    globals: mapping(o.globals, "globals"),
    light: mapping(o.light, "light"),
    dark: mapping(o.dark, "dark"),
    width: size(o.width, "width", 120, 2560),
    height: size(o.height, "height", 40, 4000),
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 120) : undefined,
  };
}

// ------------------------------------------------------------ URL encoding

/*
 * Storybook reads args and globals from its URL as `key:value;key:value`,
 * with dots into objects and [n] into arrays, and quietly drops any value it
 * does not trust: only letters, digits, spaces, _ and -, plus numbers,
 * colours, booleans, null and dates. These are its rules, so a value that
 * would be dropped is reported when the page is saved instead.
 */
const SAFE = /^[a-zA-Z0-9 _-]*$/;
const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;
const HEX = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;
const COLOR = /^(rgba?|hsla?)\(([0-9]{1,3}),\s?([0-9]{1,3})%?,\s?([0-9]{1,3})%?,?\s?([0-9](\.[0-9]{1,2})?)?\)$/i;

function leaf(value: unknown): string | null {
  if (value === null) return "!null";
  if (value === undefined) return "!undefined";
  if (typeof value === "boolean") return `!${value}`;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (value instanceof Date) return `!date(${value.toISOString()})`;
  if (typeof value === "string") {
    if (HEX.test(value)) return `!hex(${value.slice(1)})`;
    if (COLOR.test(value)) return `!${value.replace(/[\s%]/g, "")}`;
    if (SAFE.test(value) || NUMBER.test(value)) return value.replace(/ /g, "+");
  }
  return null;
}

/**
 * Values as Storybook's URL form, and the paths of any it would not accept.
 * Those are left out of the address rather than sent to be dropped.
 */
export function encodeValues(values: Values, what = "args"): { param: string; rejected: string[] } {
  const parts: string[] = [];
  const rejected: string[] = [];
  const walk = (value: unknown, path: string, shown: string) => {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
      for (const [k, v] of entries) {
        if (!Array.isArray(value) && !SAFE.test(k)) {
          rejected.push(`${shown}.${k}`);
          continue;
        }
        walk(v, Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`, Array.isArray(value) ? `${shown}[${k}]` : `${shown}.${k}`);
      }
      return;
    }
    const encoded = leaf(value);
    if (encoded === null) rejected.push(shown);
    else parts.push(`${path}:${encoded}`);
  };
  for (const [key, value] of Object.entries(values)) {
    if (!key || !SAFE.test(key)) {
      rejected.push(`${what}.${key}`);
      continue;
    }
    walk(value, key, `${what}.${key}`);
  }
  return { param: parts.join(";"), rejected };
}

/** Deep enough for globals: one level of objects merged, the rest replaced. */
function merged(...layers: Values[]): Values {
  const out: Values = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      const prev = out[k];
      out[k] =
        prev && v && typeof prev === "object" && typeof v === "object" && !Array.isArray(prev) && !Array.isArray(v)
          ? { ...(prev as Values), ...(v as Values) }
          : v;
    }
  }
  return out;
}

export interface SchemeGlobals {
  light?: Values;
  dark?: Values;
}

/** The query for a story's frame: iframe.html?<this>. */
export function storyQuery(spec: StorySpec, scheme: "light" | "dark", defaults: SchemeGlobals = {}): string {
  const globals = merged(defaults[scheme] ?? {}, spec.globals, spec[scheme]);
  const args = encodeValues(spec.args, "args").param;
  const g = encodeValues(globals, "globals").param;
  const q = [`id=${encodeURIComponent(spec.id)}`, "viewMode=story"];
  if (args) q.push(`args=${args}`);
  if (g) q.push(`globals=${g}`);
  return q.join("&");
}

/** What would be lost from a story's address, as warnings for the author. */
export function storyWarnings(spec: StorySpec): string[] {
  const out: string[] = [];
  for (const [what, values] of [["args", spec.args], ["globals", spec.globals], ["light", spec.light], ["dark", spec.dark]] as const) {
    const { rejected } = encodeValues(values, what);
    if (rejected.length) {
      out.push(
        `${rejected.join(", ")} cannot go in a Storybook link (only letters, digits, spaces, _ and -, numbers, colours, true/false and null do). Write a story with that value in the repo instead.`,
      );
    }
  }
  return out;
}
