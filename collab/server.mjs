/**
 * The document server.
 *
 * One Yjs document per artifact, holding the markdown source as a shared text.
 * Browsers editing an artifact connect over websocket and see each other's
 * changes and carets. Agents type through the HTTP endpoint below rather than
 * publishing a whole new version, so the operator can watch the edit happen.
 *
 * What lives where:
 *   Y.Text  "source"   the markdown
 *   Y.Map   "typing"   who is typing right now: { name, colour, index, at }
 *
 * The document is a working copy, not the record. Versions stay immutable rows
 * in SQLite: this process seeds a document from the current version, and asks
 * the app to snapshot a new version once the typing stops.
 */
import { Server } from "@hocuspocus/server";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.COLLAB_PORT || 5175);
const DATA = process.env.INDY_DATA || process.env.ARTIFACTS_DATA || join(process.cwd(), "data");
const APP = process.env.INDY_APP_URL || process.env.ARTIFACTS_APP_URL || "http://127.0.0.1:1936";
// A fresh checkout has no data folder yet, and this can start before the app makes one.
mkdirSync(DATA, { recursive: true });
const DB_FILE = existsSync(join(DATA, "artifacts.db")) ? "artifacts.db" : "indy.db";
const SNAPSHOT_AFTER_MS = Number(process.env.COLLAB_SNAPSHOT_MS || 2500);

const db = new DatabaseSync(join(DATA, DB_FILE));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS ydocs (
  name TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  updated_at TEXT NOT NULL
) STRICT`);
// Which version each saved copy was made from, so a copy that missed a newer
// version is reseeded instead of being typed into and saved over it.
try {
  db.exec("ALTER TABLE ydocs ADD COLUMN version INTEGER");
} catch {
  // Already there.
}

const log = (...parts) => console.log(new Date().toISOString(), "collab:", ...parts);

/** An artifact's current version and its markdown, or null if there is none. */
function current(slug) {
  const row = db
    .prepare(
      `SELECT v.source AS source, a.current_version AS version FROM artifacts a
         JOIN versions v ON v.artifact_id = a.id AND v.number = a.current_version
        WHERE a.slug = ?`,
    )
    .get(slug);
  return row && typeof row.source === "string" ? { source: row.source, version: Number(row.version) } : null;
}

/** The version each open document was made from. */
const base = new Map();
/** Who last changed each document: an agent typing, or someone in a browser. */
const author = new Map();

function rememberBase(slug, version) {
  base.set(slug, version);
  db.prepare("UPDATE ydocs SET version = ? WHERE name = ?").run(version, slug);
}

function installSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'secret'").get();
  return row ? String(row.value) : "";
}
const sign = (value) => createHmac("sha256", installSecret()).update(value).digest("base64url");

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The key the app and this process share, derived from the install secret. */
function internalKey() {
  return installSecret() ? sign("internal") : "";
}

/** A browser's token for one page, minted by the app (collabToken in accounts.ts). */
function tokenAllows(token, slug) {
  const dot = String(token ?? "").indexOf(".");
  if (dot < 0 || !installSecret()) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  return same(token.slice(dot + 1), sign(`collab|${slug}|${exp}`));
}

/** Ask the app to write a new version. It owns validation, events and history. */
async function snapshot(slug, text) {
  const who = author.get(slug) ?? { kind: "human", name: "live edit" };
  try {
    const res = await fetch(`${APP}/api/artifacts/${encodeURIComponent(slug)}/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-indy-internal": internalKey() },
      body: JSON.stringify({ text, author_kind: who.kind, author_name: who.name, base_version: base.get(slug) ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // A newer version was written while this copy was being edited. It wins;
      // the copy goes back to it rather than overwriting it.
      log(`snapshot ${slug} refused, the page moved on: ${data?.error?.message ?? ""}`);
      const now = current(slug);
      if (now) await reset({ slug, text: now.source, version: now.version });
      return;
    }
    if (!res.ok) return log(`snapshot ${slug} refused: ${data?.error?.message ?? res.status}`);
    if (Number.isInteger(data.version)) rememberBase(slug, data.version);
    if (data.skipped) return;
    log(`snapshot ${slug} -> v${data.version}`);
  } catch (err) {
    log(`snapshot ${slug} failed: ${err?.message ?? err}`);
  }
}

const pending = new Map();

function scheduleSnapshot(slug, document) {
  clearTimeout(pending.get(slug));
  pending.set(
    slug,
    setTimeout(() => {
      pending.delete(slug);
      const text = document.getText("source").toString();
      if (text.trim()) void snapshot(slug, text);
    }, SNAPSHOT_AFTER_MS),
  );
}

const server = new Server({
  port: PORT,
  address: "127.0.0.1",
  quiet: true,

  onRequest: ({ request, response }) => handle(request, response),

  // Nobody reads or writes a document without a token the app made for that page.
  async onAuthenticate({ token, documentName }) {
    if (!tokenAllows(token, documentName)) throw new Error("not allowed");
    return { slug: documentName };
  },

  async onLoadDocument({ documentName, document }) {
    const now = current(documentName);
    const row = db.prepare("SELECT state, version FROM ydocs WHERE name = ?").get(documentName);
    // A saved copy is only reused if it was made from the version that is
    // still current; otherwise a publish it missed would be overwritten.
    if (row?.state && (!now || Number(row.version) === now.version)) {
      Y.applyUpdate(document, new Uint8Array(row.state));
      if (document.getText("source").length > 0) {
        if (now) base.set(documentName, now.version);
        return document;
      }
    }
    // Seed from the stored version.
    if (now && document.getText("source").length === 0) {
      document.getText("source").insert(0, now.source);
    }
    if (now) base.set(documentName, now.version);
    log(`loaded ${documentName} (${document.getText("source").length} chars)`);
    return document;
  },

  async onStoreDocument({ documentName, document }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    db.prepare(
      `INSERT INTO ydocs (name, state, updated_at, version) VALUES (:name, :state, :at, :version)
       ON CONFLICT(name) DO UPDATE SET state = :state, updated_at = :at, version = :version`,
    ).run({ name: documentName, state, at: new Date().toISOString(), version: base.get(documentName) ?? null });
    scheduleSnapshot(documentName, document);
  },

  // A change from a browser is a person's; typing through /type is an agent's.
  async onChange({ documentName, connection }) {
    if (connection) author.set(documentName, { kind: "human", name: "live edit" });
  },

  // Indy's start.mjs stops this process first on shutdown, so the app is
  // still up to take the snapshots that were waiting.
  stopOnSignals: false,

  async onConnect({ documentName }) {
    log(`client joined ${documentName}`);
  },
});

/**
 * POST /type
 *   { slug, text, from?, to?, chunk?, delay?, agent: { name, color } }
 *
 * Replaces the whole document, or the character range [from, to), with `text`,
 * a few characters at a time so the change is legible as it happens. The typing
 * marker carries the agent's name and where its caret is.
 */
async function type(body) {
  const slug = String(body.slug ?? "");
  if (!slug) throw new Error("slug is required");
  const text = String(body.text ?? "");
  const chunk = Math.min(Math.max(Number(body.chunk) || 3, 1), 200);
  const delay = Math.min(Math.max(Number.isFinite(Number(body.delay)) ? Number(body.delay) : 28, 0), 500);
  const name = String(body.agent?.name ?? "agent").slice(0, 40);
  const color = /^#[0-9a-f]{6}$/i.test(body.agent?.color ?? "") ? body.agent.color : "#7A45D0";

  const connection = await server.hocuspocus.openDirectConnection(slug);
  author.set(slug, { kind: "agent", name });
  let typed = 0;
  // Where typing starts, clamped to the text: a huge `from` means the end.
  let at = 0;
  try {
    await connection.transact((document) => {
      const source = document.getText("source");
      const from = Math.min(Number.isFinite(Number(body.from)) ? Math.max(0, Math.floor(Number(body.from))) : 0, source.length);
      const to = Number.isFinite(Number(body.to)) ? Math.floor(Number(body.to)) : source.length;
      const end = Math.min(Math.max(to, from), source.length);
      if (end > from) source.delete(from, end - from);
      at = from;
      document.getMap("typing").set("who", { name, color, index: from, at: Date.now() });
    });

    // Each chunk is its own transaction, so every connected client sees the
    // text arrive progressively instead of in one jump at the end.
    for (let i = 0; i < text.length; i += chunk) {
      const piece = text.slice(i, i + chunk);
      await connection.transact((document) => {
        document.getText("source").insert(at, piece);
        document.getMap("typing").set("who", { name, color, index: at + piece.length, at: Date.now() });
      });
      at += piece.length;
      typed += piece.length;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return { slug, typed };
  } finally {
    // The caret marker goes even when typing stops partway.
    await connection.transact((document) => document.getMap("typing").delete("who")).catch(() => {});
    await connection.disconnect();
  }
}

/**
 * Replace a document with the text of a version written elsewhere.
 *
 * Publishing over MCP or saving in the block editor does not pass through this
 * process, so without this the shared copy would still hold the old text and
 * the next editor to open the page would save it back over the new version.
 */
async function reset(body) {
  const slug = String(body.slug ?? "");
  if (!slug) throw new Error("slug is required");
  const text = String(body.text ?? "");

  const connection = await server.hocuspocus.openDirectConnection(slug);
  try {
    let changed = false;
    await connection.transact((document) => {
      const source = document.getText("source");
      if (source.toString() === text) return;
      changed = true;
      if (source.length) source.delete(0, source.length);
      if (text) source.insert(0, text);
      document.getMap("typing").delete("who");
    });
    // The text now matches the version it came from, so drop the pending
    // snapshot this edit would otherwise trigger.
    clearTimeout(pending.get(slug));
    pending.delete(slug);
    author.delete(slug);
    if (Number.isInteger(Number(body.version))) rememberBase(slug, Number(body.version));
    return { slug, changed };
  } finally {
    await connection.disconnect();
  }
}

/** The current text of a document, so an agent can read before it writes. */
async function read(slug) {
  const connection = await server.hocuspocus.openDirectConnection(slug);
  try {
    let text = "";
    await connection.transact((document) => {
      text = document.getText("source").toString();
    });
    return { slug, text };
  } finally {
    await connection.disconnect();
  }
}

/**
 * Hocuspocus already runs an HTTP server for the websocket upgrade, so the
 * agent endpoints hang off its onRequest hook. Rejecting with no error is how
 * that hook says "handled, stop here".
 */
function handle(request, response) {
  const send = (status, payload) => {
    const json = JSON.stringify(payload);
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
    response.end(json);
  };

  if (request.method === "GET" && request.url === "/health") {
    send(200, { ok: true, port: PORT });
    return Promise.reject();
  }

  // Everything else here is for the app and its agents' tools, which send the
  // internal key. The public proxy does not forward these paths at all.
  if (!internalKey() || !same(request.headers["x-indy-internal"] ?? "", internalKey())) {
    send(403, { error: { message: "forbidden" } });
    return Promise.reject();
  }

  if (request.method === "GET" && request.url?.startsWith("/read/")) {
    const slug = decodeURIComponent(request.url.slice("/read/".length));
    return read(slug).then(
      (result) => {
        send(200, result);
        return Promise.reject();
      },
      (err) => {
        send(400, { error: { message: String(err?.message ?? err) } });
        return Promise.reject();
      },
    );
  }

  if (request.method === "POST" && (request.url === "/type" || request.url === "/reset")) {
    const run = request.url === "/reset" ? reset : type;
    return new Promise((resolve, reject) => {
      let raw = "";
      request.on("data", (part) => {
        raw += part;
        if (raw.length > 2_000_000) request.destroy();
      });
      request.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          send(400, { error: { message: "body must be JSON" } });
          return reject();
        }
        run(body).then(
          (result) => {
            send(200, result);
            reject();
          },
          (err) => {
            send(400, { error: { message: String(err?.message ?? err) } });
            reject();
          },
        );
      });
    });
  }

  send(404, { error: { message: "not found" } });
  return Promise.reject();
}

await server.listen();

// Snapshots waiting on their quiet period are taken now, then the server
// closes: an edit made just before a restart still becomes a version.
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const waiting = [...pending.keys()];
  for (const slug of waiting) clearTimeout(pending.get(slug));
  pending.clear();
  await Promise.all(
    waiting.map(async (slug) => {
      const connection = await server.hocuspocus.openDirectConnection(slug);
      let text = "";
      await connection.transact((document) => {
        text = document.getText("source").toString();
      });
      await connection.disconnect();
      if (text.trim()) await snapshot(slug, text);
    }),
  ).catch((err) => log(`flush failed: ${err?.message ?? err}`));
  await server.destroy().catch(() => {});
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT"]) process.on(signal, () => void stop());
log(`listening on ${PORT}, data ${DATA}, app ${APP}`);
