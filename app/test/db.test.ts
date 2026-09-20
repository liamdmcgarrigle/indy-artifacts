import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bind, openDb, withTx } from "@/lib/db/index.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function dbPath() {
  const d = await mkdtemp(join(tmpdir(), "artifact-db-"));
  dirs.push(d);
  return join(d, "nested", "artifacts.db");
}

describe("openDb", () => {
  it("creates the schema, makes the directory, and is idempotent", async () => {
    const path = await dbPath();
    const db = openDb(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => String((r as Record<string, unknown>).name));
    expect(tables).toEqual(expect.arrayContaining(["artifacts", "comments", "events", "versions"]));
    db.close();
    const again = openDb(path);
    expect(again.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 0 });
    again.close();
  });

  it("enforces foreign keys and check constraints", async () => {
    const db = openDb(await dbPath());
    expect(() =>
      db.prepare("INSERT INTO versions (artifact_id, number, author_kind, author_name, content_hash, created_at) VALUES ('nope', 1, 'agent', 'a', 'h', 'now')").run(),
    ).toThrow();
    db.prepare(
      "INSERT INTO artifacts (id, slug, title, kind, theme, created_at, updated_at) VALUES ('a', 's1', 't', 'markdown', 'default', 'now', 'now')",
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO artifacts (id, slug, title, kind, theme, created_at, updated_at) VALUES ('b', 's2', 't', 'vue', 'default', 'now', 'now')",
      ).run(),
    ).toThrow();
    db.close();
  });

  it("rolls a failed transaction back", async () => {
    const db = openDb(await dbPath());
    expect(() =>
      withTx(db, () => {
        db.prepare(
          "INSERT INTO artifacts (id, slug, title, kind, theme, created_at, updated_at) VALUES ('a', 's1', 't', 'markdown', 'default', 'now', 'now')",
        ).run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("bind", () => {
  it("normalises undefined, null and booleans", () => {
    expect(bind({ a: undefined, b: null, c: true, d: false, e: 3, f: "x" })).toEqual({
      a: null,
      b: null,
      c: 1,
      d: 0,
      e: 3,
      f: "x",
    });
  });
});
