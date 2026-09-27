import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const versionOf = (path: string) => (JSON.parse(read(path)) as { version: string }).version;

describe("version", () => {
  it("is the same everywhere as in VERSION (run npm run set-version)", () => {
    const version = read("VERSION").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const files = [
      "package.json",
      "app/package.json",
      "collab/package.json",
      "packages/primitives/package.json",
      "plugin/.claude-plugin/plugin.json",
      "plugin/.codex-plugin/plugin.json",
    ];
    for (const file of files) expect({ file, version: versionOf(file) }).toEqual({ file, version });
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(version);
    for (const dir of ["", "app", "collab", "packages/primitives"]) expect({ dir, version: lock.packages[dir]?.version }).toEqual({ dir, version });
  });
});
