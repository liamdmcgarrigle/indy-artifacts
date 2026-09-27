import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { buildArtifact } from "@/lib/build/index";

const dirs: string[] = [];
async function outDir() {
  const d = await mkdtemp(join(tmpdir(), "artifact-out-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("buildArtifact", () => {
  it("bundles a react artifact", async () => {
    const out = await outDir();
    const res = await buildArtifact({
      kind: "react",
      outDir: out,
      files: {
        "App.tsx": `import { useState } from "react";
export default function App() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>count {n}</button>;
}`,
      },
    });
    expect(res.status).toBe("ok");
    const js = await readFile(join(out, "bundle.js"), "utf8");
    expect(js).toContain("count ");
    expect(res.bytes).toBeGreaterThan(1000);
  }, 60000);

  it("bundles a svelte artifact", async () => {
    const out = await outDir();
    const res = await buildArtifact({
      kind: "svelte",
      outDir: out,
      files: {
        "App.svelte": `<script>let n = $state(0);</script>
<button onclick={() => n++}>count {n}</button>
<style>button { color: var(--art-accent); }</style>`,
      },
    });
    expect(res.status).toBe("ok");
    const js = await readFile(join(out, "bundle.js"), "utf8");
    expect(js).toContain("count ");
  }, 60000);

  it("supports relative imports between artifact files", async () => {
    const out = await outDir();
    const res = await buildArtifact({
      kind: "react",
      outDir: out,
      files: {
        "App.tsx": `import { Badge } from "./Badge";
export default function App() { return <Badge />; }`,
        "Badge.tsx": `export function Badge() { return <span>BADGE_MARKER</span>; }`,
      },
    });
    expect(res.status).toBe("ok");
    expect(await readFile(join(out, "bundle.js"), "utf8")).toContain("BADGE_MARKER");
  }, 60000);

  it("rejects an import that is not on the allowlist", async () => {
    const out = await outDir();
    const res = await buildArtifact({
      kind: "react",
      outDir: out,
      files: { "App.tsx": `import fs from "node:fs";\nexport default function App() { return <b>{String(fs)}</b>; }` },
    });
    expect(res.status).toBe("error");
    expect(res.log).toContain("is not available in artifacts");
    expect(res.log).toContain("Allowed packages");
  }, 60000);

  it("cannot read files outside the artifact, by path or as text", async () => {
    const secret = join(await outDir(), "secret.txt");
    await writeFile(secret, "TOP-SECRET-VALUE");
    for (const source of [
      `import s from "${secret}" with { type: "text" };\nexport default function App() { return <b>{s}</b>; }`,
      `import s from "${secret}";\nexport default function App() { return <b>{String(s)}</b>; }`,
      `import s from "../../../../../../../../..${secret}";\nexport default function App() { return <b>{String(s)}</b>; }`,
      `import s from "./data.txt" with { type: "text" };\nexport default function App() { return <b>{s}</b>; }`,
    ]) {
      const out = await outDir();
      const res = await buildArtifact({ kind: "react", outDir: out, files: { "App.tsx": source, "data.txt": "fine" } });
      expect(res.status).toBe("error");
      const js = await readFile(join(out, "bundle.js"), "utf8").catch(() => "");
      expect(js).not.toContain("TOP-SECRET-VALUE");
    }
  }, 60000);

  it("reports a syntax error with file and line", async () => {
    const out = await outDir();
    const res = await buildArtifact({
      kind: "react",
      outDir: out,
      files: { "App.tsx": `export default function App() { return <b>oops</b>` },
    });
    expect(res.status).toBe("error");
    expect(res.log.toLowerCase()).toContain("error");
  }, 60000);

  it("fails clearly when the entry file is missing", async () => {
    const out = await outDir();
    const res = await buildArtifact({ kind: "react", outDir: out, files: { "Other.tsx": "export default 1;" } });
    expect(res.status).toBe("error");
    expect(res.log).toContain("App.tsx");
  }, 60000);
});

describe("Tailwind and shadcn in artifacts", () => {
  const css = `@import "tailwindcss";\n`;
  const build = async (files: Record<string, string>) => {
    const out = await outDir();
    const res = await buildArtifact({ kind: "react", outDir: out, files });
    const bundleCss = await readFile(join(out, "bundle.css"), "utf8").catch(() => "");
    const js = await readFile(join(out, "bundle.js"), "utf8").catch(() => "");
    return { res, css: bundleCss, js };
  };

  it("compiles the Tailwind classes an artifact uses, and only those", async () => {
    const { res, css: out } = await build({
      "App.tsx": `import "./index.css";\nexport default function App() { return <div className="p-4 text-lg bg-primary dark:bg-muted">hi</div>; }`,
      "index.css": css,
    });
    expect(res.status, res.log).toBe("ok");
    expect(out).toContain(".p-4");
    expect(out).toContain(".bg-primary");
    expect(out).not.toContain(".p-96");
    // shadcn's names read the artifact's theme, and dark: follows the page's scheme.
    expect(out).toContain("var(--art-accent)");
    expect(out).toMatch(/data-scheme="?dark/);
  }, 60000);

  it("gives @/components/ui to an artifact, with the classes its components use", async () => {
    const { res, css: out, js } = await build({
      "App.tsx": `import "./index.css";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export default function App() { return <Button className={cn("mt-2", "mt-4")}>Go</Button>; }`,
      "index.css": css,
    });
    expect(res.status, res.log).toBe("ok");
    expect(js).toContain("data-slot");
    expect(out).toContain(".inline-flex");
    expect(out).toContain(".mt-4");
  }, 60000);

  it("prefers the artifact's own file over Indy's copy", async () => {
    const { res, js } = await build({
      "App.tsx": `import { cn } from "@/lib/utils";\nexport default function App() { return <b>{cn("a")}</b>; }`,
      "lib/utils.ts": `export function cn(..._: string[]) { return "OWN_CN_MARKER"; }`,
    });
    expect(res.status, res.log).toBe("ok");
    expect(js).toContain("OWN_CN_MARKER");
  }, 60000);

  it("reaches nothing else of Indy's through @/", async () => {
    for (const path of ["@/lib/config", "@/lib/auth/accounts", "@/components/ui/../../lib/config", "@/components/ui/button/../../../lib/config"]) {
      const { res, js } = await build({ "App.tsx": `import * as m from "${path}";\nexport default function App() { return <b>{Object.keys(m).length}</b>; }` });
      expect(res.status, path).toBe("error");
      expect(js).toBe("");
    }
  }, 60000);

  it("keeps Tailwind from reading files or running code on the server", async () => {
    const secret = join(await outDir(), "secret.css");
    await writeFile(secret, ".leak { content: 'TOP-SECRET-VALUE' }");
    for (const sheet of [
      `@import "tailwindcss";\n@import "${secret}";`,
      `@import "tailwindcss";\n@import "../../../../../../../..${secret}";`,
      `@import "tailwindcss";\n@import "some-package/styles.css";`,
      `@import "tailwindcss";\n@plugin "./plugin.js";`,
      `@import "tailwindcss";\n@config "./tailwind.config.js";`,
    ]) {
      const { res, css: out } = await build({
        "App.tsx": `import "./index.css";\nexport default function App() { return <b className="leak">x</b>; }`,
        "index.css": sheet,
        "plugin.js": `throw new Error("PLUGIN_RAN")`,
        "tailwind.config.js": `throw new Error("CONFIG_RAN")`,
      });
      expect(res.status, sheet).toBe("error");
      expect(res.log).not.toContain("PLUGIN_RAN");
      expect(res.log).not.toContain("CONFIG_RAN");
      expect(out).not.toContain("TOP-SECRET-VALUE");
    }
  }, 60000);

  it("allows tw-animate-css and the artifact's own stylesheets", async () => {
    const { res, css: out } = await build({
      "App.tsx": `import "./index.css";\nexport default function App() { return <b className="animate-in fade-in brand">x</b>; }`,
      "index.css": `@import "tailwindcss";\n@import "tw-animate-css";\n@import "./brand.css";`,
      "brand.css": `.brand { color: rebeccapurple; }`,
    });
    expect(res.status, res.log).toBe("ok");
    expect(out).toContain(".brand{color:#639}");
    expect(out).toContain("enter");
  }, 60000);

  it("leaves plain CSS to esbuild, without Tailwind", async () => {
    const { res, css: out } = await build({
      "App.tsx": `import "./plain.css";\nexport default function App() { return <b className="p-4">x</b>; }`,
      "plain.css": `b { color: tomato; }`,
    });
    expect(res.status, res.log).toBe("ok");
    expect(out).toContain("tomato");
    expect(out).not.toContain(".p-4");
  }, 60000);

  const kit = readdirSync(join(__dirname, "../src/components/ui"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();

  it("builds every shadcn component Indy offers", async () => {
    const imports = kit.map((name, i) => `import * as C${i} from "@/components/ui/${name}";`).join("\n");
    const { res } = await build({
      "App.tsx": `import "./index.css";\n${imports}\nexport default function App() { return <b>{[${kit.map((_, i) => `C${i}`).join(", ")}].length}</b>; }`,
      "index.css": css,
    });
    expect(res.status, res.log).toBe("ok");
  }, 120000);

  it("documents exactly the shadcn components Indy offers", () => {
    const reference = readFileSync(join(__dirname, "../../plugin/skills/publish/reference.md"), "utf8");
    const listed = reference
      .slice(reference.indexOf("with `cn` from `@/lib/utils`:"), reference.indexOf("A file of that name"))
      .replace("with `cn` from `@/lib/utils`:", "")
      .replace(/\band\b/g, ",")
      .split(/[,.\s]+/)
      .filter(Boolean)
      .sort();
    expect(listed).toEqual(kit);
  });
});

