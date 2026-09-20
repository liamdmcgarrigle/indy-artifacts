/**
 * Build the primitives bundle.
 *
 *   src/index.ts    -> dist/primitives.js   (esm, es2022, unminified)
 *   src/*.css       -> dist/primitives.css  (concatenated in order)
 *
 * chart.js stays external: the element loads it with a dynamic import, and the
 * host page (or its bundler) supplies the module. Inlining it here would ship a
 * second copy of Chart.js to every artifact page whether or not it draws one.
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
  minify: false,
  sourcemap: false,
  legalComments: "none",
  external: ["chart.js", "chart.js/auto"],
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
