import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const themesDir = resolve(repoRoot, "themes");
const primitivesCss = resolve(repoRoot, "packages/primitives/src/primitives.css");

/** The token contract every theme has to define, in both schemes. */
const TOKENS = [
  "--art-bg",
  "--art-surface",
  "--art-surface-2",
  "--art-border",
  "--art-border-strong",
  "--art-text",
  "--art-text-muted",
  "--art-text-faint",
  "--art-accent",
  "--art-accent-hover",
  "--art-accent-wash",
  "--art-on-accent",
  "--art-link",
  "--art-good",
  "--art-good-wash",
  "--art-warn",
  "--art-warn-wash",
  "--art-bad",
  "--art-bad-wash",
  "--art-info",
  "--art-info-wash",
  "--art-font-sans",
  "--art-font-mono",
  "--art-font-size",
  "--art-radius",
  "--art-radius-lg",
  "--art-shadow",
  "--art-chart-1",
  "--art-chart-2",
  "--art-chart-3",
  "--art-chart-4",
  "--art-chart-5",
  "--art-chart-6",
];

/** Tokens the primitives set themselves rather than taking from a theme. */
const LOCAL_TOKENS = ["--art-cols"];

const themeFiles = readdirSync(themesDir)
  .filter((name) => name.endsWith(".css"))
  .sort();

/** The body of the first rule whose selector matches, brace-balanced. */
function ruleBody(css: string, selector: RegExp): string | null {
  const match = selector.exec(css);
  if (!match) return null;
  const open = css.indexOf("{", match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

/** Every custom property declared in a rule body. */
function declared(body: string): Set<string> {
  const names = new Set<string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) names.add(m[1]);
  return names;
}

describe("themes", () => {
  it("ships the three themes the pipeline knows about", () => {
    expect(themeFiles).toEqual(["backup-studio.css", "default.css", "picaflick.css"]);
  });

  describe.each(themeFiles)("%s", (file) => {
    const css = readFileSync(resolve(themesDir, file), "utf8");
    const light = ruleBody(css, /:root\s*\{/);
    const dark = ruleBody(css, /:root\[data-scheme="dark"\]\s*\{/);

    it("has a light :root block and a dark [data-scheme] block", () => {
      expect(light, "no :root { … } block").not.toBeNull();
      expect(dark, 'no :root[data-scheme="dark"] { … } block').not.toBeNull();
    });

    it("defines the full token contract in the light block", () => {
      const names = declared(light ?? "");
      expect([...TOKENS].filter((t) => !names.has(t))).toEqual([]);
    });

    it("defines the full token contract in the dark block", () => {
      const names = declared(dark ?? "");
      expect([...TOKENS].filter((t) => !names.has(t))).toEqual([]);
    });

    it("declares color-scheme in both blocks", () => {
      expect(light).toMatch(/color-scheme:\s*light/);
      expect(dark).toMatch(/color-scheme:\s*dark/);
    });

    it("leaves scheme switching to data-scheme, not a media query", () => {
      expect(css).not.toContain("prefers-color-scheme");
    });

    it("names fonts without loading any", () => {
      expect(css).not.toContain("@font-face");
      expect(css).not.toContain("@import");
    });
  });
});

describe("primitives stylesheet", () => {
  const css = readFileSync(primitivesCss, "utf8");

  it("contains no literal colour of its own", () => {
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = css.match(/\brgba?\(/g) ?? [];
    expect(hex).toEqual([]);
    expect(rgb).toEqual([]);
  });

  it("only uses tokens the contract defines", () => {
    const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]);
    const known = new Set([...TOKENS, ...LOCAL_TOKENS]);
    expect([...new Set(used)].filter((name) => !known.has(name))).toEqual([]);
  });

  it("actually reaches for the theme", () => {
    expect(css).toContain("var(--art-text)");
    expect(css).toContain("var(--art-surface)");
  });
});
