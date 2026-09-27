import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("the image", () => {
  it("installs the same versions for compiled artifacts as the app builds against", () => {
    const extras = json("docker/extras/package.json").dependencies as Record<string, string>;
    const app = json("app/package.json").dependencies as Record<string, string>;
    const lock = json("docker/extras/package-lock.json") as { packages: Record<string, { version?: string }> };
    const appAll = { ...(json("app/package.json").devDependencies as Record<string, string>), ...app };
    const root = json("package-lock.json") as { packages: Record<string, { version?: string }> };
    for (const name of Object.keys(extras)) {
      // The app's own pin, or for Tailwind's internals the version the root lockfile resolved.
      const expected = appAll[name] ?? root.packages[`node_modules/${name}`]?.version;
      expect({ name, version: extras[name] }).toEqual({ name, version: expected });
      expect(extras[name]).toMatch(/^\d+\.\d+\.\d+$/);
      expect({ name, locked: lock.packages[`node_modules/${name}`]?.version }).toEqual({ name, locked: extras[name] });
    }
  });

  it("lists the packages the build step allows, and Tailwind, and no others", async () => {
    const { ALLOWED_PACKAGES } = await import("@/lib/build/index");
    const { BUILD_TOOLS } = await import("@/lib/build/tailwind");
    const extras = Object.keys(json("docker/extras/package.json").dependencies).sort();
    expect(extras).toEqual([...ALLOWED_PACKAGES, ...BUILD_TOOLS].sort());
  });
});
