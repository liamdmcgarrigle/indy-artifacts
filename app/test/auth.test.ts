import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "@/lib/db/schema";

let dir: string;
type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
let setupPOST: Handler;
let loginPOST: Handler;
let listGET: Handler;
let mcpPOST: Handler;
let tokensPOST: Handler;

const req = (path: string, init: RequestInit & { cookie?: string; token?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return new Request(`http://localhost:5174${path}`, { ...init, headers });
};

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "indy-auth-"));
  process.env.INDY_DATA = dir;
  process.env.INDY_AUTH = "password";
  process.env.INDY_URL = "https://indy.example.com";
  setupPOST = (await import("@/app/api/auth/setup/route")).POST as Handler;
  loginPOST = (await import("@/app/api/auth/login/route")).POST as Handler;
  listGET = (await import("@/app/api/artifacts/route")).GET as Handler;
  mcpPOST = (await import("@/app/mcp/route")).POST as Handler;
  tokensPOST = (await import("@/app/api/tokens/route")).POST as Handler;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("owner account", () => {
  let session = "";

  it("refuses a short password at setup", async () => {
    const res = await setupPOST(req("/api/auth/setup", { method: "POST", body: JSON.stringify({ email: "me@example.com", password: "short" }) }));
    expect(res.status).toBe(400);
  });

  it("creates the one owner and signs them in", async () => {
    const res = await setupPOST(
      req("/api/auth/setup", { method: "POST", body: JSON.stringify({ email: "Me@Example.com", password: "correct horse battery" }) }),
    );
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^indy_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    session = cookieOf(res);
  });

  it("refuses a second setup", async () => {
    const res = await setupPOST(
      req("/api/auth/setup", { method: "POST", body: JSON.stringify({ email: "other@example.com", password: "another long password" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("keeps the API closed without a session", async () => {
    expect((await listGET(req("/api/artifacts"))).status).toBe(401);
    expect((await listGET(req("/api/artifacts", { cookie: "indy_session=forged" }))).status).toBe(401);
    expect((await listGET(req("/api/artifacts", { cookie: session }))).status).toBe(200);
  });

  it("signs in with the right password only, whatever the email's case", async () => {
    const bad = await loginPOST(req("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "me@example.com", password: "wrong" }) }));
    expect(bad.status).toBe(401);
    const good = await loginPOST(
      req("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "ME@example.com", password: "correct horse battery" }) }),
    );
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toMatch(/^indy_session=.+/);
  });

  it("lets an agent in with a token, and only with a live one", async () => {
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    };
    const mcpHeaders = { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
    const denied = await mcpPOST(req("/mcp", { method: "POST", headers: mcpHeaders, body: JSON.stringify(init) }));
    expect(denied.status).toBe(401);

    const made = await tokensPOST(req("/api/tokens", { method: "POST", cookie: session, body: JSON.stringify({ name: "laptop claude" }) }));
    expect(made.status).toBe(201);
    const { token } = (await made.json()) as { token: string };
    expect(token).toMatch(/^indy_tk_/);

    const allowed = await mcpPOST(req("/mcp", { method: "POST", headers: mcpHeaders, token, body: JSON.stringify(init) }));
    expect(allowed.status).toBe(200);

    // A token cannot mint more tokens: that needs the owner in a browser.
    const escalate = await tokensPOST(req("/api/tokens", { method: "POST", token, body: JSON.stringify({ name: "x" }) }));
    expect(escalate.status).toBe(401);
  });
});

describe("codes", () => {
  it("accepts the right code once, and gives up after five wrong ones", async () => {
    const { getContext } = await import("@/lib/service/context");
    const { issueCode, redeemCode } = await import("@/lib/auth/accounts");
    const ctx = getContext();

    const a = issueCode(ctx, "visitor", "link1", "v@example.com");
    expect(redeemCode(ctx, a.id, a.code)).toMatchObject({ purpose: "visitor", subject: "link1", email: "v@example.com" });
    expect(redeemCode(ctx, a.id, a.code)).toBeNull();

    const b = issueCode(ctx, "visitor", "link1", "v@example.com");
    const wrong = b.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(redeemCode(ctx, b.id, wrong)).toBeNull();
    expect(redeemCode(ctx, b.id, b.code)).toBeNull();
  });
});

describe("migration", () => {
  it("upgrades a database from before Indy without losing rows", async () => {
    const { SCHEMA } = await import("@/lib/db/schema");
    const { openDb } = await import("@/lib/db/index");
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(SCHEMA);
    old.exec(`INSERT INTO artifacts (id, slug, title, kind, current_version, created_at, updated_at)
              VALUES ('a1', 'old-one', 'Old one', 'markdown', 1, '2026-01-01', '2026-01-01')`);
    old.exec(`INSERT INTO versions (artifact_id, number, author_kind, author_name, source, content_hash, created_at)
              VALUES ('a1', 1, 'agent', 'claude', '# Scans were slow', 'h', '2026-01-01')`);
    old.exec(`INSERT INTO comments (id, artifact_id, version_number, author_kind, author_name, body, created_at, updated_at)
              VALUES ('c1', 'a1', 1, 'human', 'liam', 'keep me', '2026-01-01', '2026-01-01')`);
    old.close();

    const db = openDb(path);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT body FROM comments WHERE id = 'c1'").get()).toMatchObject({ body: "keep me" });
    expect(db.prepare("SELECT seen_version FROM artifacts WHERE id = 'a1'").get()).toMatchObject({ seen_version: 1 });
    const hit = db.prepare("SELECT artifact_id FROM search WHERE search MATCH 'scan*'").get();
    expect(hit).toMatchObject({ artifact_id: "a1" });
    // A visitor comment is now allowed.
    db.exec(`INSERT INTO comments (id, artifact_id, version_number, author_kind, author_name, body, created_at, updated_at)
             VALUES ('c2', 'a1', 1, 'visitor', 'maya', 'hi', '2026-01-02', '2026-01-02')`);
    db.close();
    // Opening again does not re-run anything.
    openDb(path).close();
  });
});
