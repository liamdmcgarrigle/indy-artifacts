import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

export const ALLOWED_PACKAGES = [
  "react",
  "react-dom",
  "svelte",
  "chart.js",
  "d3",
  "lucide-react",
];

export const BUILD_TIMEOUT_MS = 20_000;
export const BUILD_MAX_BYTES = 5 * 1024 * 1024;

export interface BuildInput {
  kind: "react" | "svelte";
  files: Record<string, string>;
  outDir: string;
}

export interface BuildResult {
  status: "ok" | "error";
  log: string;
  bytes: number;
  css: boolean;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function nodePathDirs(): string[] {
  const dirs: string[] = [];
  // In the container the extra packages artifacts may import (chart.js, d3,
  // lucide-react) live outside the traced standalone node_modules.
  const extra = process.env.ARTIFACTS_BUILD_MODULES;
  if (extra) dirs.push(...extra.split(":").map((d) => d.trim()).filter(Boolean));
  const require = createRequire(import.meta.url);
  try {
    // .../node_modules/react/package.json -> .../node_modules
    dirs.push(dirname(dirname(require.resolve("react/package.json"))));
  } catch {
    dirs.push(join(process.cwd(), "node_modules"));
  }
  return [...new Set(dirs)];
}

/** Reject any bare import from artifact source that is not on the allowlist. */
function allowlistPlugin(rootDir: string): esbuild.Plugin {
  return {
    name: "artifact-allowlist",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const importer = args.importer || "";
        const fromArtifact = importer.startsWith(rootDir + sep) || importer === rootDir;
        if (!fromArtifact) return undefined;
        if (args.path.startsWith(".") || args.path.startsWith("/")) return undefined;
        if (ALLOWED_PACKAGES.includes(packageName(args.path))) return undefined;
        return {
          errors: [
            {
              text: `import "${args.path}" is not available in artifacts. Allowed packages: ${ALLOWED_PACKAGES.join(", ")} (plus relative imports of your own files).`,
            },
          ],
        };
      });
    },
  };
}

function entryFor(kind: "react" | "svelte", files: Record<string, string>) {
  if (kind === "react") {
    const name = ["App.tsx", "App.jsx", "App.ts", "App.js"].find((f) => f in files);
    if (!name) throw new Error("a react artifact needs an App.tsx (or App.jsx) exporting a default component");
    return {
      file: "__artifact_entry.tsx",
      code: [
        'import { createRoot } from "react-dom/client";',
        `import App from "./${name.replace(/\.(tsx|jsx|ts|js)$/, "")}";`,
        'const el = document.getElementById("root");',
        "if (el) createRoot(el).render(<App />);",
        "",
      ].join("\n"),
    };
  }
  if (!("App.svelte" in files)) throw new Error("a svelte artifact needs an App.svelte");
  return {
    file: "__artifact_entry.js",
    code: [
      'import { mount } from "svelte";',
      'import App from "./App.svelte";',
      'const el = document.getElementById("root");',
      "if (el) mount(App, { target: el });",
      "",
    ].join("\n"),
  };
}

async function loadSveltePlugin() {
  const mod = await import("esbuild-svelte");
  const factory = (mod as { default?: unknown }).default ?? mod;
  return (factory as (opts: unknown) => esbuild.Plugin)({
    compilerOptions: { css: "injected", runes: undefined },
  });
}

export async function buildArtifact(input: BuildInput): Promise<BuildResult> {
  const root = await mkdtemp(join(tmpdir(), "artifact-build-"));
  try {
    for (const [name, contents] of Object.entries(input.files)) {
      const safe = normalize(name).replace(/^(\.\.(\/|\\|$))+/, "");
      const target = join(root, safe);
      if (relative(root, target).startsWith("..")) throw new Error(`file path escapes the artifact: ${name}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }

    const entry = entryFor(input.kind, input.files);
    await writeFile(join(root, entry.file), entry.code, "utf8");
    await mkdir(input.outDir, { recursive: true });

    const plugins: esbuild.Plugin[] = [allowlistPlugin(resolve(root))];
    if (input.kind === "svelte") plugins.push(await loadSveltePlugin());

    const options: esbuild.BuildOptions = {
      entryPoints: [join(root, entry.file)],
      outfile: join(input.outDir, "bundle.js"),
      bundle: true,
      write: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      minify: true,
      sourcemap: false,
      jsx: "automatic",
      logLevel: "silent",
      nodePaths: nodePathDirs(),
      mainFields: ["svelte", "browser", "module", "main"],
      conditions: ["svelte", "browser"],
      absWorkingDir: root,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins,
    };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`build exceeded ${BUILD_TIMEOUT_MS / 1000}s`)), BUILD_TIMEOUT_MS);
    });

    try {
      const result = (await Promise.race([esbuild.build(options), timeout])) as esbuild.BuildResult;
      const warnings = result.warnings?.length
        ? (await esbuild.formatMessages(result.warnings, { kind: "warning", color: false })).join("")
        : "";
      const bundle = await stat(join(input.outDir, "bundle.js"));
      if (bundle.size > BUILD_MAX_BYTES) {
        return {
          status: "error",
          log: `bundle is ${(bundle.size / 1024 / 1024).toFixed(1)} MB, over the ${BUILD_MAX_BYTES / 1024 / 1024} MB limit`,
          bytes: bundle.size,
          css: false,
        };
      }
      let css = false;
      try {
        await stat(join(input.outDir, "bundle.css"));
        css = true;
      } catch {
        css = false;
      }
      return { status: "ok", log: warnings.trim(), bytes: bundle.size, css };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    const failure = err as { errors?: esbuild.Message[]; warnings?: esbuild.Message[]; message?: string };
    let log: string;
    if (failure.errors?.length) {
      log = (await esbuild.formatMessages(failure.errors, { kind: "error", color: false, terminalWidth: 100 })).join("");
    } else {
      log = failure.message ?? String(err);
    }
    return { status: "error", log: log.trim(), bytes: 0, css: false };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readBuildOutput(outDir: string, name: "bundle.js" | "bundle.css"): Promise<string | null> {
  try {
    return await readFile(join(outDir, name), "utf8");
  } catch {
    return null;
  }
}
