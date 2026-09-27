import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE_MD } from "@/lib/mcp/reference";

describe("authoring reference", () => {
  it("serves the plugin's reference.md unchanged (run npm run sync:reference)", () => {
    const md = readFileSync(join(__dirname, "../../plugin/skills/publish/reference.md"), "utf8");
    expect(REFERENCE_MD).toBe(md);
  });
});
