/**
 * Prepare the static assets that sandbox frames and the viewer load by URL:
 *   public/vendor/mermaid.js      mermaid bundled as an IIFE that sets window.mermaid
 *   public/primitives/*           the built primitives bundle and stylesheet
 * Sandbox frames have no import map and no network, so everything they load has
 * to be a plain same-origin script.
 */
import { build } from "esbuild";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const repo = resolve(app, "..");

await mkdir(resolve(app, "public/vendor"), { recursive: true });
await mkdir(resolve(app, "public/primitives"), { recursive: true });

const entry = resolve(app, "public/vendor/.mermaid-entry.mjs");
await writeFile(entry, 'import mermaid from "mermaid";\nwindow.mermaid = mermaid;\n', "utf8");
await build({
  entryPoints: [entry],
  outfile: resolve(app, "public/vendor/mermaid.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
});
await rm(entry, { force: true });

for (const name of ["primitives.js", "primitives.css"]) {
  await copyFile(resolve(repo, "packages/primitives/dist", name), resolve(app, "public/primitives", name));
}

console.log("vendor: public/vendor/mermaid.js, public/primitives/*");
