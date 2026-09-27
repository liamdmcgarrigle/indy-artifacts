import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { config } from "../config";
import { createRequire } from "node:module";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";
import { compileTailwind, tailwindPlugin, type TailwindEntry } from "./tailwind";

export const ALLOWED_PACKAGES = [
  "react",
  "react-dom",
  "svelte",
  "chart.js",
  "d3",
  "lucide-react",
  // shadcn/ui and what its components are built on
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "radix-ui",
  "cmdk",
  "sonner",
  "react-day-picker",
  "date-fns",
];

/** radix-ui's own packages, which older shadcn components import one by one. */
const ALLOWED_SCOPES = ["@radix-ui/"];

/**
 * What "@/..." reaches when the artifact has no file of that name: Indy's copy
 * of the shadcn components and their cn() helper.
 */
const fromKit = (path: string) => /^components\/ui\/[\w-]+(\.tsx?)?$/.test(path) || /^lib\/utils(\.ts)?$/.test(path);

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
  dirs.push(...config().buildModules);
  const require = createRequire(import.meta.url);
  try {
    // .../node_modules/react/package.json -> .../node_modules
    dirs.push(dirname(dirname(require.resolve("react/package.json"))));
  } catch {
    // resolved below
  }
  // Under Next, react may resolve to Next's own compiled copy, so the
  // project's node_modules folders are added as well, nearest first.
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const modules = join(dir, "node_modules");
    if (existsSync(modules)) dirs.push(modules);
    if (dirname(dir) === dir) break;
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
        const refuse = (text: string) => ({ errors: [{ text }] });
        // `with { type: "text" }` would inline any file the server can read.
        if (args.with && Object.keys(args.with).length > 0) return refuse(`import attributes are not allowed: "${args.path}"`);
        if (args.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(args.path)) return refuse(`absolute imports are not allowed: "${args.path}"`);
        if (args.path.startsWith(".")) {
          // Relative imports reach the artifact's own files and nothing else.
          const target = resolve(args.resolveDir || rootDir, args.path);
          if (target !== rootDir && !target.startsWith(rootDir + sep)) return refuse(`import "${args.path}" reaches outside the artifact's files`);
          return undefined;
        }
        if (ALLOWED_PACKAGES.includes(packageName(args.path))) return undefined;
        if (ALLOWED_SCOPES.some((scope) => args.path.startsWith(scope))) return undefined;
        return {
          errors: [
            {
              text: `import "${args.path}" is not available in artifacts. Allowed packages: ${ALLOWED_PACKAGES.join(", ")}, @radix-ui/* (plus your own files, and shadcn components at @/components/ui/*).`,
            },
          ],
        };
      });
    },
  };
}

/**
 * "@/x" is the artifact's own file x when it has one, as in a shadcn project,
 * and otherwise Indy's shadcn component or cn() helper of that name.
 */
function aliasPlugin(rootDir: string, kitDir: string | null): esbuild.Plugin {
  return {
    name: "artifact-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, async (args) => {
        const refuse = (text: string) => ({ errors: [{ text }] });
        if (args.with && Object.keys(args.with).length > 0) return refuse(`import attributes are not allowed: "${args.path}"`);
        const rest = args.path.slice(2);
        if (rest.split(/[\\/]/).includes("..") || rest.startsWith("/")) return refuse(`import "${args.path}" reaches outside the artifact's files`);
        const own = await build.resolve(`./${rest}`, { resolveDir: rootDir, importer: join(rootDir, "__alias__"), kind: args.kind });
        if (own.errors.length === 0) return { path: own.path };
        if (kitDir && fromKit(rest)) {
          const kit = await build.resolve(`./${rest}`, { resolveDir: kitDir, importer: join(kitDir, "__alias__"), kind: args.kind });
          if (kit.errors.length === 0) return { path: kit.path };
        }
        return refuse(
          `import "${args.path}" is not one of the artifact's files, nor a shadcn component Indy has (@/components/ui/<name>, @/lib/utils)`,
        );
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

/**
 * Where to unpack artifact sources while esbuild runs. In the container /tmp is
 * a read-only mount of the host's /tmp (so artifacts can reference assets by
 * their host path), so the scratch directory has to live somewhere else.
 */
function kitDir(): string | null {
  const dir = config().artifactKit;
  return dir && existsSync(join(dir, "components", "ui")) ? resolve(dir) : null;
}

function scratchRoot(): string {
  return config().tmpDir ?? tmpdir();
}

export async function buildArtifact(input: BuildInput): Promise<BuildResult> {
  let root: string;
  try {
    await mkdir(scratchRoot(), { recursive: true });
    root = await mkdtemp(join(scratchRoot(), "artifact-build-"));
  } catch (err) {
    return {
      status: "error",
      log: `could not create a build directory under ${scratchRoot()}: ${(err as Error).message}`,
      bytes: 0,
      css: false,
    };
  }

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

    const tailwind: TailwindEntry[] = [];
    const plugins: esbuild.Plugin[] = [
      aliasPlugin(resolve(root), kitDir()),
      allowlistPlugin(resolve(root)),
      tailwindPlugin(resolve(root), tailwind),
    ];
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
      metafile: true,
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
    // A context can be cancelled: a build past its time stops, rather than
    // carrying on and writing into a folder that has moved on.
    const context = await esbuild.context(options);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void context.cancel();
        reject(new Error(`build exceeded ${BUILD_TIMEOUT_MS / 1000}s`));
      }, BUILD_TIMEOUT_MS);
    });

    try {
      const run = async () => {
        const built = await context.rebuild();
        await compileTailwind({
          rootDir: resolve(root),
          entries: tailwind,
          metafile: built.metafile!,
          outDir: input.outDir,
          moduleDirs: nodePathDirs(),
        });
        return built;
      };
      const result = (await Promise.race([run(), timeout])) as esbuild.BuildResult;
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
      await context.dispose().catch(() => {});
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
