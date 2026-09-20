/**
 * Build the primitives bundle.
 *
 *   src/index.ts    -> dist/primitives.js   (esm, es2022, unminified)
 *   src/*.css       -> dist/primitives.css  (concatenated in order)
 *
 * chart.js is bundled in, because this file is served raw to the browser and to
 * sandbox frames with no import map, where a bare "chart.js/auto" specifier
 * would not resolve and charts would silently fail to draw.
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");

const CSS_SOURCES = ["src/primitives.css"];

await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile: resolve(dist, "primitives.js"),
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

const js = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
console.log(`primitives: dist/primitives.js (${js.bytes} bytes), dist/primitives.css`);
