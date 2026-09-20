import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA } from "./schema";

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
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
