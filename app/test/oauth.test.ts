import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContext } from "@/lib/service/context";
import { resetConfigForTesting } from "@/lib/config";
import { principalFrom } from "@/lib/auth/access";
import { listApiTokens } from "@/lib/auth/accounts";
import { checkAuthorize, exchange, issueAuthCode, OAuthError, registerClient, type AuthorizeRequest } from "@/lib/auth/oauth";

const URL_ = "http://indy.test:1936";
const MCP = `${URL_}/mcp`;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "indy-oauth-"));
  process.env.INDY_DATA = dir;
  process.env.INDY_URL = URL_;
  process.env.INDY_AUTH = "password";
  resetConfigForTesting();
});
afterAll(async () => {
  process.env.INDY_AUTH = "local";
  await rm(dir, { recursive: true, force: true });
});

const pair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

function authorize(clientId: string, redirect: string, challenge: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st8",
    resource: MCP,
    ...extra,
  });
  return checkAuthorize(getContext(), params, MCP);
}

const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` });

describe("oauth", () => {
  it("runs the whole flow: register, consent, code for tokens, use, refresh, revoke", () => {
    const ctx = getContext();
    const client = registerClient(ctx, { client_name: "Codex", redirect_uris: ["http://127.0.0.1:40111/callback"], token_endpoint_auth_method: "none" });
    const { verifier, challenge } = pair();
    // A CLI listens on a new port each time; loopback redirects match on any port.
    const checked = authorize(client.id, "http://127.0.0.1:52999/callback", challenge);
    expect("ok" in checked).toBe(true);
    const req = (checked as { ok: AuthorizeRequest }).ok;
    const code = issueAuthCode(ctx, req, "laptop · codex");

    const form = new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.id, redirect_uri: req.redirectUri, code_verifier: verifier, resource: MCP });
    const tokens = exchange(ctx, form, MCP);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token.startsWith("indy_at_")).toBe(true);

    // The code is spent.
    expect(() => exchange(ctx, form, MCP)).toThrow(OAuthError);

    const who = principalFrom(ctx, bearerHeaders(tokens.access_token));
    expect(who).toMatchObject({ kind: "agent", name: "laptop · codex" });
    const connection = listApiTokens(ctx).find((t) => t.name === "laptop · codex")!;
    expect(connection.kind).toBe("oauth");

    const refreshed = exchange(ctx, new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.id }), MCP);
    expect(principalFrom(ctx, bearerHeaders(refreshed.access_token))).toMatchObject({ kind: "agent" });
    // Rotation: the old refresh token no longer works, and using it again
    // means a copy is loose, so the whole connection ends.
    expect(() => exchange(ctx, new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }), MCP)).toThrow(OAuthError);
    expect(principalFrom(ctx, bearerHeaders(refreshed.access_token))).toBeNull();
    expect(() => exchange(ctx, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token }), MCP)).toThrow(OAuthError);
    expect(listApiTokens(ctx).find((t) => t.id === connection.id)).toBeUndefined();
  });

  it("refuses a wrong PKCE verifier, another client's code and a foreign resource", () => {
    const ctx = getContext();
    const a = registerClient(ctx, { client_name: "A", redirect_uris: ["http://localhost:1/callback"] });
    const b = registerClient(ctx, { client_name: "B", redirect_uris: ["http://localhost:1/callback"] });
    const { verifier, challenge } = pair();
    const req = (authorize(a.id, "http://localhost:1/callback", challenge) as { ok: AuthorizeRequest }).ok;

    const code1 = issueAuthCode(ctx, req, "x");
    expect(() => exchange(ctx, new URLSearchParams({ grant_type: "authorization_code", code: code1, client_id: a.id, code_verifier: pair().verifier }), MCP)).toThrow(/code_verifier/);
    const code2 = issueAuthCode(ctx, req, "x");
    expect(() => exchange(ctx, new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: b.id, code_verifier: verifier }), MCP)).toThrow(/another client/);
    expect(authorize(a.id, "http://localhost:1/callback", challenge, { resource: "https://elsewhere.test/mcp" })).toHaveProperty("redirect");
  });

  it("checks redirect URIs and PKCE before anything is issued", () => {
    const ctx = getContext();
    expect(() => registerClient(ctx, { redirect_uris: ["http://evil.test/cb"] })).toThrow(/https or loopback/);
    expect(() => registerClient(ctx, { redirect_uris: ["https://ok.test/cb"], token_endpoint_auth_method: "client_secret_basic" })).toThrow(/public clients/);
    const web = registerClient(ctx, { client_name: "claude.ai", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    const { challenge } = pair();
    expect(authorize(web.id, "https://claude.ai/api/mcp/auth_callback", challenge)).toHaveProperty("ok");
    // An https redirect must match exactly; a lookalike is never redirected to.
    expect(authorize(web.id, "https://claude.ai/api/mcp/other", challenge)).toHaveProperty("fatal");
    expect(authorize("nope", "https://claude.ai/api/mcp/auth_callback", challenge)).toHaveProperty("fatal");
    const noPkce = authorize(web.id, "https://claude.ai/api/mcp/auth_callback", "", { code_challenge: "" });
    expect(noPkce).toHaveProperty("redirect");
    expect((noPkce as { redirect: string }).redirect).toContain("error=invalid_request");
  });

  it("answers an unauthenticated MCP call with a challenge pointing at the metadata", async () => {
    const mod = await import("@/app/mcp/route");
    const res = await (mod.GET as (r: Request) => Promise<Response>)(new Request(MCP));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${URL_}/.well-known/oauth-protected-resource/mcp"`);
    const bad = await (mod.POST as (r: Request) => Promise<Response>)(new Request(MCP, { method: "POST", headers: { authorization: "Bearer indy_at_nope" } }));
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const meta = await (await import("@/app/api/oauth/metadata/route")).GET(new Request(`${URL_}/.well-known/oauth-authorization-server`)).json();
    expect(meta).toMatchObject({ issuer: URL_, registration_endpoint: `${URL_}/api/oauth/register`, code_challenge_methods_supported: ["S256"] });
    const prm = await (await import("@/app/api/oauth/resource/route")).GET(new Request(`${URL_}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm).toMatchObject({ resource: MCP, authorization_servers: [URL_] });
    // Reached by another name, Indy answers with that name, as MCP clients require.
    const byIp = await (await import("@/app/api/oauth/resource/route"))
      .GET(new Request("http://10.0.0.5:1936/.well-known/oauth-protected-resource/mcp", { headers: { "x-forwarded-host": "10.0.0.5:1936", "x-forwarded-proto": "http" } }))
      .json();
    expect(byIp).toMatchObject({ resource: "http://10.0.0.5:1936/mcp", authorization_servers: ["http://10.0.0.5:1936"] });
  });
});
