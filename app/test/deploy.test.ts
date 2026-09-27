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
    for (const name of ["react", "react-dom", "svelte", "chart.js", "d3", "lucide-react"]) {
      expect({ name, version: extras[name] }).toEqual({ name, version: app[name] });
      expect(extras[name]).toMatch(/^\d+\.\d+\.\d+$/);
      expect({ name, locked: lock.packages[`node_modules/${name}`]?.version }).toEqual({ name, locked: extras[name] });
    }
  });

  it("lists the packages the build step allows, and no others", async () => {
    const { ALLOWED_PACKAGES } = await import("@/lib/build/index");
    const extras = Object.keys(json("docker/extras/package.json").dependencies).sort();
    expect(extras).toEqual([...ALLOWED_PACKAGES].sort());
  });
});
