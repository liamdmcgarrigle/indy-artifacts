import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeContext, type ServiceContext } from "@/lib/service/context";
import { publishArtifact, requireArtifact, updateArtifact } from "@/lib/service/artifacts";
import {
  deleteTheme,
  effectiveTheme,
  listProjects,
  listThemes,
  saveTheme,
  setProjectTheme,
  themeHref,
  themeStylesheet,
} from "@/lib/service/themes";
import { getSettings, updateSettings } from "@/lib/service/settings";
import { ValidationError } from "@/lib/service/errors";

let dir: string;
let ctx: ServiceContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "indy-themes-"));
  ctx = makeContext({ dataDir: dir, publicUrl: "http://indy.test", assetRoots: [dir] });
});
afterEach(() => {
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const page = (title: string, extra: Record<string, unknown> = {}) =>
  publishArtifact(ctx, { source: `---\ntitle: ${title}\n---\n\nbody\n`, ...extra });

describe("themes as data", () => {
  it("lists the three presets before any of the owner's", () => {
    saveTheme(ctx, { name: "acme", tokens: { accent: "#ff5500" } });
    expect(listThemes(ctx).map((t) => t.name)).toEqual(["paper", "graphite", "indy", "acme"]);
  });

  it("starts a theme from a base and changes only what it is given", () => {
    const t = saveTheme(ctx, { name: "acme", label: "Acme", base: "graphite", tokens: { accent: "#ff5500" }, create: true });
    expect(t.tokens.accent).toBe("#ff5500");
    expect(t.tokens.fontSans).toBe("geist");
    const again = saveTheme(ctx, { name: "acme", tokens: { radius: 4 } });
    expect(again.tokens.accent).toBe("#ff5500");
    expect(again.tokens.radius).toBe(4);
    expect(again.label).toBe("Acme");
  });

  it("will not change or delete a preset, and checks names and values", () => {
    expect(() => saveTheme(ctx, { name: "graphite", tokens: { accent: "#000000" } })).toThrow(/built-in/);
    expect(() => deleteTheme(ctx, "paper")).toThrow(ValidationError);
    expect(() => saveTheme(ctx, { name: "default" })).toThrow(ValidationError);
    expect(() => saveTheme(ctx, { name: "Bad Name" })).toThrow(ValidationError);
    expect(() => saveTheme(ctx, { name: "acme", tokens: { accent: "orange" } })).toThrow(ValidationError);
    expect(() => saveTheme(ctx, { name: "acme", base: "nope" })).toThrow(/no theme named "nope"/);
  });

  it("gives a page its own theme, else its project's, else the default", async () => {
    saveTheme(ctx, { name: "acme", tokens: { accent: "#ff5500" } });
    const plain = await page("Plain", { project: "acme-app" });
    expect(effectiveTheme(ctx, requireArtifact(ctx, plain.slug)).name).toBe("paper");

    updateSettings(ctx, { defaultTheme: "indy" });
    expect(effectiveTheme(ctx, requireArtifact(ctx, plain.slug)).name).toBe("indy");

    setProjectTheme(ctx, "acme-app", "acme");
    expect(effectiveTheme(ctx, requireArtifact(ctx, plain.slug)).name).toBe("acme");

    const own = await page("Own", { project: "acme-app", theme: "graphite" });
    expect(effectiveTheme(ctx, requireArtifact(ctx, own.slug)).name).toBe("graphite");
    expect(listProjects(ctx)).toEqual([{ name: "acme-app", theme: "acme", pages: 2 }]);
  });

  it("refuses a theme that does not exist when a page names one, and ignores a stale one in frontmatter", async () => {
    await expect(page("Wrong", { theme: "nope" })).rejects.toThrow(/no theme named "nope".*paper, graphite, indy/);
    const old = await publishArtifact(ctx, { source: `---\ntitle: Old\ntheme: picaflick\n---\n\nbody\n` });
    expect(requireArtifact(ctx, old.slug).theme).toBe("");
  });

  it("falls back when a theme is deleted, for pages, projects and the default", async () => {
    saveTheme(ctx, { name: "acme" });
    setProjectTheme(ctx, "acme-app", "acme");
    updateSettings(ctx, { defaultTheme: "acme" });
    const res = await page("P", { project: "acme-app", theme: "acme" });
    deleteTheme(ctx, "acme");
    const a = requireArtifact(ctx, res.slug);
    expect(a.theme).toBe("");
    expect(effectiveTheme(ctx, a).name).toBe("paper");
    expect(listProjects(ctx)[0].theme).toBeNull();
    expect(getSettings(ctx).defaultTheme).toBe("paper");
    // A later update keeps working and does not bring the old name back.
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: P\n---\n\nnew\n`, expectedVersion: 1 });
    expect(requireArtifact(ctx, res.slug).theme).toBe("");
  });

  it("serves a stylesheet, and changes its address when the theme changes", () => {
    const first = themeHref(saveTheme(ctx, { name: "acme", tokens: { accent: "#ff5500" } }));
    expect(themeStylesheet(ctx, "acme")!.css).toContain("--art-accent: #ff5500");
    const second = themeHref(saveTheme(ctx, { name: "acme", tokens: { accent: "#0055ff" } }));
    expect(second).not.toBe(first);
    expect(themeStylesheet(ctx, "missing")).toBeNull();
  });

  it("only takes a default theme that exists", () => {
    expect(() => updateSettings(ctx, { defaultTheme: "nope" })).toThrow(/no theme named/);
  });

  it("keeps a label out of the stylesheet, so it cannot add rules to Indy's pages", () => {
    for (const label of ["**//@import url(//evil.test/x.css);/*", "*/ * { display: none } /*", "</style><script>"]) {
      expect(() => saveTheme(ctx, { name: "evil", label })).toThrow(ValidationError);
    }
    saveTheme(ctx, { name: "fine", label: "Acme (2026) — brand & co" });
    const css = themeStylesheet(ctx, "fine")!.css;
    expect(css).not.toContain("Acme");
    expect(css.match(/\/\*/g)?.length).toBe(1);
  });

  it("caps how many themes there can be", () => {
    for (let i = 0; i < 100; i++) ctx.db.prepare("INSERT INTO themes (name, label, tokens_json, created_at, updated_at) VALUES (?, ?, '{}', '', '')").run(`t${i}`, `t${i}`);
    expect(() => saveTheme(ctx, { name: "one-more" })).toThrow(/already 100 themes/);
    expect(saveTheme(ctx, { name: "t5", tokens: { radius: 3 } }).tokens.radius).toBe(3);
  });

  it("does not let an old page's theme: default pin it on its next edit", async () => {
    saveTheme(ctx, { name: "acme" });
    // As an older Indy left it: the column cleared by the migration, the line still in the source.
    const res = await publishArtifact(ctx, { source: `---\ntitle: Old\ntheme: default\n---\n\nbody\n`, project: "acme-app" });
    setProjectTheme(ctx, "acme-app", "acme");
    expect(requireArtifact(ctx, res.slug).theme).toBe("");
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: Old\ntheme: default\n---\n\nedited\n`, expectedVersion: 1 });
    expect(effectiveTheme(ctx, requireArtifact(ctx, res.slug)).name).toBe("acme");
    // An old skill passing theme: "default" as an argument means none too.
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: Old\n---\n\nagain\n`, theme: "default", expectedVersion: 2 });
    expect(effectiveTheme(ctx, requireArtifact(ctx, res.slug)).name).toBe("acme");
  });

  it("follows a frontmatter theme when it changes, and drops it when the line goes", async () => {
    const res = await publishArtifact(ctx, { source: `---\ntitle: P\n---\n\nbody\n` });
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: P\ntheme: graphite\n---\n\nbody\n`, expectedVersion: 1 });
    expect(requireArtifact(ctx, res.slug).theme).toBe("graphite");
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: P\ntheme: graphite\n---\n\nmore\n`, expectedVersion: 2 });
    expect(requireArtifact(ctx, res.slug).theme).toBe("graphite");
    await updateArtifact(ctx, res.slug, { source: `---\ntitle: P\n---\n\nmore\n`, expectedVersion: 3 });
    expect(requireArtifact(ctx, res.slug).theme).toBe("");
  });

  it("derives dark colours for what a new theme changes, keeping the base's other overrides", () => {
    const t = saveTheme(ctx, { name: "brand", base: "graphite", tokens: { accent: "#e11d48" } });
    expect(t.dark.accent).toBeUndefined();
    expect(t.dark.background).toBe("#09090b");
  });

  it("refuses base on a theme that exists, and a create over one", () => {
    saveTheme(ctx, { name: "acme" });
    expect(() => saveTheme(ctx, { name: "acme", base: "graphite" })).toThrow(/base does not apply/);
    expect(() => saveTheme(ctx, { name: "acme", create: true })).toThrow(/already a theme/);
  });

  it("matches a project name to its pages without regard to case", async () => {
    saveTheme(ctx, { name: "acme" });
    await page("P", { project: "acme-app" });
    setProjectTheme(ctx, "Acme-App", "acme");
    expect(listProjects(ctx)).toEqual([{ name: "acme-app", theme: "acme", pages: 1 }]);
  });

  it("shows a damaged theme row as the default rather than breaking the list", () => {
    saveTheme(ctx, { name: "acme" });
    ctx.db.prepare("UPDATE themes SET tokens_json = 'nope', dark_json = 'nope' WHERE name = 'acme'").run();
    expect(listThemes(ctx).find((t) => t.name === "acme")!.tokens.accent).toBe("#2a50d6");
  });
});

