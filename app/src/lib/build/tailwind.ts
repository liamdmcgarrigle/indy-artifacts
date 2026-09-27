import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type * as esbuild from "esbuild";

/**
 * Tailwind for compiled artifacts. A CSS file in the artifact that imports
 * "tailwindcss" is compiled by Tailwind v4 after esbuild has bundled the code,
 * so the class names come from exactly the files that ended up in the bundle:
 * the artifact's own and any shadcn components it imported from Indy.
 *
 * Tailwind runs on the server, so the CSS it may read is fenced in: the
 * artifact's files, and the stylesheets of tailwindcss and tw-animate-css.
 * @plugin and @config would load JavaScript and are refused.
 */

/** Installed next to the artifact packages; used by the build, never imported by an artifact. */
export const BUILD_TOOLS = ["tailwindcss", "@tailwindcss/node", "@tailwindcss/oxide", "tw-animate-css"];

const TAILWIND_IMPORT = /@import\s+(?:url\(\s*)?["']tailwindcss["']\s*\)?[^;]*;/;

export function usesTailwind(css: string): boolean {
  return TAILWIND_IMPORT.test(css);
}

/**
 * shadcn's token names, read from the artifact's Indy theme, so a component
 * written for shadcn follows the page's theme and its light or dark scheme.
 * It goes straight after the tailwindcss import; the artifact's own rules
 * come later and win.
 */
export const SHADCN_PRESET = `
@custom-variant dark (&:where([data-scheme="dark"], [data-scheme="dark"] *));

:root {
  --background: var(--art-bg);
  --foreground: var(--art-text);
  --card: var(--art-surface);
  --card-foreground: var(--art-text);
  --popover: var(--art-surface-2);
  --popover-foreground: var(--art-text);
  --primary: var(--art-accent);
  --primary-foreground: var(--art-on-accent);
  --secondary: var(--art-surface-2);
  --secondary-foreground: var(--art-text);
  --muted: var(--art-surface-2);
  --muted-foreground: var(--art-text-muted);
  --accent: var(--art-surface-3);
  --accent-foreground: var(--art-text);
  --destructive: var(--art-bad);
  --border: var(--art-border);
  --input: var(--art-border-strong);
  --ring: var(--art-focus);
  --radius: var(--art-radius);
  --chart-1: var(--art-chart-1);
  --chart-2: var(--art-chart-2);
  --chart-3: var(--art-chart-3);
  --chart-4: var(--art-chart-4);
  --chart-5: var(--art-chart-5);
  --sidebar: var(--art-surface);
  --sidebar-foreground: var(--art-text);
  --sidebar-primary: var(--art-accent);
  --sidebar-primary-foreground: var(--art-on-accent);
  --sidebar-accent: var(--art-surface-2);
  --sidebar-accent-foreground: var(--art-text);
  --sidebar-border: var(--art-border);
  --sidebar-ring: var(--art-focus);
}

@theme inline {
  --font-sans: var(--art-font-sans);
  --font-serif: var(--art-font-serif);
  --font-mono: var(--art-font-mono);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply text-foreground;
  }
}
`;

/** The shadcn components animate with tw-animate-css, so it comes with the preset unless already imported. */
function withPreset(css: string): string {
  const animate = /@import\s+["']tw-animate-css["']/.test(css) ? "" : '@import "tw-animate-css";\n';
  return css.replace(TAILWIND_IMPORT, (m) => `${m}\n${animate}${SHADCN_PRESET}\n`);
}

interface Toolchain {
  node: typeof import("@tailwindcss/node");
  oxide: typeof import("@tailwindcss/oxide");
  tailwindDir: string;
  animateCss: string;
}

let toolchain: Toolchain | null = null;

/**
 * Loads Tailwind from the first module directory that has it. In the image
 * that is the artifact modules, installed apart from the app, because Next's
 * output tracing would not bring Tailwind's native scanner along.
 */
function loadToolchain(moduleDirs: string[]): Toolchain {
  if (toolchain) return toolchain;
  let lastError: unknown;
  for (const dir of moduleDirs) {
    if (!existsSync(join(dir, "@tailwindcss", "node"))) continue;
    try {
      // A require made in the folder above a node_modules folder looks inside it.
      const req = createRequire(join(dirname(dir), "__indy_build__.js"));
      toolchain = {
        node: req("@tailwindcss/node"),
        oxide: req("@tailwindcss/oxide"),
        tailwindDir: join(dir, "tailwindcss"),
        animateCss: join(dir, "tw-animate-css", "dist", "tw-animate.css"),
      };
      return toolchain;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Tailwind is not installed where the build looks for it (${moduleDirs.join(", ")})${lastError ? `: ${(lastError as Error).message}` : ""}`,
  );
}

const inside = (dir: string, path: string) => path === dir || path.startsWith(dir + sep);

/** A CSS file that imports tailwindcss, set aside until the bundle is known. */
export interface TailwindEntry {
  path: string;
  css: string;
}

/** Takes the artifact's Tailwind stylesheets out of esbuild's hands. */
export function tailwindPlugin(rootDir: string, entries: TailwindEntry[]): esbuild.Plugin {
  return {
    name: "artifact-tailwind",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        if (!inside(rootDir, args.path)) return undefined;
        const css = await readFile(args.path, "utf8");
        if (!usesTailwind(css)) return undefined;
        entries.push({ path: args.path, css });
        return { contents: "", loader: "css" };
      });
    },
  };
}

const SCANNED = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".svelte", ".html"]);

/**
 * Compiles the set-aside stylesheets against the class names in the bundle's
 * source files, and puts the result in front of bundle.css.
 */
export async function compileTailwind(opts: {
  rootDir: string;
  entries: TailwindEntry[];
  metafile: esbuild.Metafile;
  outDir: string;
  moduleDirs: string[];
}): Promise<void> {
  if (opts.entries.length === 0) return;
  const tw = loadToolchain(opts.moduleDirs);

  const sources = Object.keys(opts.metafile.inputs)
    .map((p) => resolve(opts.rootDir, p))
    .filter((p) => !p.split(sep).includes("node_modules") && SCANNED.has(extname(p)));
  const contents = await Promise.all(
    sources.map(async (file) => ({ content: await readFile(file, "utf8"), extension: extname(file).slice(1) })),
  );
  const candidates = new tw.oxide.Scanner({}).scanFiles(contents);

  const cssRoots = [opts.rootDir, tw.tailwindDir];
  const refuse = (id: string): never => {
    throw new Error(
      `@import "${id}" is not available in artifacts. A Tailwind stylesheet may import "tailwindcss", "tw-animate-css" and the artifact's own CSS files.`,
    );
  };
  const customCssResolver = async (id: string, base: string) => {
    if (id === "tailwindcss") return join(tw.tailwindDir, "index.css");
    if (id === "tw-animate-css") return tw.animateCss;
    if (id.startsWith("tailwindcss/")) {
      const target = resolve(tw.tailwindDir, id.slice("tailwindcss/".length));
      return inside(tw.tailwindDir, target) ? (target.endsWith(".css") ? target : `${target}.css`) : refuse(id);
    }
    if (id.startsWith(".")) {
      const target = resolve(base, id);
      if (cssRoots.some((dir) => inside(dir, base) && inside(dir, target))) return target;
    }
    return refuse(id);
  };
  const customJsResolver = async (id: string): Promise<string> => {
    throw new Error(`@plugin and @config are not available in artifacts ("${id}")`);
  };

  const parts: string[] = [];
  for (const entry of opts.entries) {
    const compiler = await tw.node.compile(withPreset(entry.css), {
      base: dirname(entry.path),
      from: entry.path,
      onDependency: () => {},
      shouldRewriteUrls: false,
      customCssResolver,
      customJsResolver,
    });
    parts.push(compiler.build(candidates));
  }
  const compiled = tw.node.optimize(parts.join("\n"), { minify: true }).code;

  const bundleCss = join(opts.outDir, "bundle.css");
  const rest = await readFile(bundleCss, "utf8").catch(() => "");
  await writeFile(bundleCss, `${compiled}\n${rest}`, "utf8");
}
