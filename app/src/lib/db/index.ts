import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function schemaSql(): string {
  for (const candidate of [
    join(here, "schema.sql"),
    join(process.cwd(), "src/lib/db/schema.sql"),
    join(process.cwd(), "app/src/lib/db/schema.sql"),
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      /* try the next one */
    }
  }
  throw new Error("schema.sql not found");
}

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(schemaSql());
  return db;
}

export function withTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/** node:sqlite rejects undefined bindings; normalise them to null. */
export function bind<T extends Record<string, unknown>>(params: T): Record<string, null | number | string> {
  const out: Record<string, null | number | string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v === "boolean") out[k] = v ? 1 : 0;
    else if (typeof v === "number") out[k] = v;
    else out[k] = String(v);
  }
  return out;
}

export type { DatabaseSync };
