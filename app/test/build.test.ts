import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifact } from "@/lib/build/index.js";

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
