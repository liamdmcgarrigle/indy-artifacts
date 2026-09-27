/**
 * Build the primitives bundle.
 *
 *   src/index.ts    -> dist/primitives.js   (esm, es2022, minified)
 *                   -> dist/chunks/*.js     (loaded on first use)
 *   src/*.css       -> dist/primitives.css  (concatenated in order)
 *
 * chart.js and its chart-type plugins are bundled, because these files are
 * served raw to the browser and to sandbox frames with no import map, where a
 * bare "chart.js/auto" specifier would not resolve and charts would silently
 * fail to draw. They are split into chunks that primitives.js imports by
 * relative path when a page first draws a chart, so a page without one never
 * downloads Chart.js, and a page without a sankey never downloads the sankey.
 * Chunk names carry a content hash, so a browser's copy is never stale.
 */
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");

const CSS_SOURCES = ["src/primitives.css"];

await rm(resolve(dist, "chunks"), { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: { primitives: resolve(here, "src/index.ts") },
  outdir: dist,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});

const parts = [];
for (const rel of CSS_SOURCES) {
  parts.push(`/* ${rel} */`, await readFile(resolve(here, rel), "utf8"));
}
await writeFile(resolve(dist, "primitives.css"), `${parts.join("\n")}\n`);

const outputs = Object.entries(result.metafile.outputs);
const entry = outputs.find(([path]) => path.endsWith("primitives.js"))?.[1];
const chunks = outputs.filter(([path]) => path.includes("/chunks/"));
const chunkBytes = chunks.reduce((sum, [, out]) => sum + out.bytes, 0);
console.log(`primitives: dist/primitives.js (${entry?.bytes} bytes), ${chunks.length} chunks (${chunkBytes} bytes), dist/primitives.css`);
