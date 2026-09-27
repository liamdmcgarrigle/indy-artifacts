import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";
import type { ServiceContext } from "../service/context";
import { ServiceError } from "../service/errors";
import { randomToken, sha256 } from "./crypto";

/**
 * Indy as its own OAuth 2.1 authorization server, for MCP clients.
 *
 * An agent that is pointed at /mcp without a token gets a 401 naming the
 * protected-resource metadata. From there it registers itself (dynamic client
 * registration), sends the owner to /oauth/authorize in a browser, and trades
 * the code it gets back, with its PKCE verifier, for an access token and a
 * refresh token. The owner never copies a secret.
 *
 * Each grant becomes an agent connection: a row in api_tokens with kind
 * 'oauth', listed and revoked in Settings beside the hand-made tokens.
 * Revoking it ends its access and refresh tokens at once.
 */

export const ACCESS_PREFIX = "indy_at_";
export const REFRESH_PREFIX = "indy_rt_";
export const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
/** Clients register without signing in, so ones never authorized are cleared after a day. */
const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 500;
export const SCOPE = "indy";

const id12 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const iso = (ms: number) => new Date(ms).toISOString();

type Row = Record<string, unknown>;

/** An OAuth error, answered as `{error, error_description}` with the status the spec asks for. */
export class OAuthError extends ServiceError {
  constructor(
    readonly error: string,
    message: string,
    status = 400,
  ) {
    super(error, message, status);
  }
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

function toClient(row: Row): OAuthClient {
  return {
    id: String(row.id),
    name: String(row.name),
    redirectUris: JSON.parse(String(row.redirect_uris_json)) as string[],
    createdAt: String(row.created_at),
  };
}

/**
 * Loopback redirects may use any port (RFC 8252 §7.3), since a CLI picks a
 * free one each time; anything else must be https and match exactly.
 */
function loopback(uri: URL): boolean {
  return uri.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname);
}

function checkRedirect(raw: string): string {
  let uri: URL;
  try {
    uri = new URL(raw);
  } catch {
    throw new OAuthError("invalid_redirect_uri", `not a URL: ${raw}`);
  }
  if (uri.hash) throw new OAuthError("invalid_redirect_uri", "a redirect URI may not have a fragment");
  if (uri.protocol === "https:" || loopback(uri)) return raw;
  // Desktop apps register private schemes such as cursor:// or vscode://.
  if (/^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$|^[a-z][a-z0-9+.-]*:$/.test(uri.protocol) && !["http:", "javascript:", "data:", "file:"].includes(uri.protocol))
    return raw;
  throw new OAuthError("invalid_redirect_uri", `redirect URIs must be https or loopback: ${raw}`);
}

export function redirectAllowed(client: OAuthClient, raw: string): boolean {
  if (client.redirectUris.includes(raw)) return true;
  let uri: URL;
  try {
    uri = new URL(raw);
  } catch {
    return false;
  }
  if (!loopback(uri)) return false;
  // Same loopback host and path, any port.
  return client.redirectUris.some((r) => {
    try {
      const reg = new URL(r);
      return loopback(reg) && reg.hostname === uri.hostname && reg.pathname === uri.pathname;
    } catch {
      return false;
    }
  });
}

export function registerClient(ctx: ServiceContext, input: Record<string, unknown>): OAuthClient {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10)
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must list one to ten URIs");
  const redirectUris = uris.map((u) => checkRedirect(String(u)));
  const method = input.token_endpoint_auth_method ?? "none";
  if (method !== "none")
    throw new OAuthError("invalid_client_metadata", "Indy registers public clients only: token_endpoint_auth_method must be none");
  const name = (typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : "An MCP client").slice(0, 80);

  const cutoff = iso(Date.now() - UNUSED_CLIENT_TTL_MS);
  ctx.db
    .prepare(
      `DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM api_tokens WHERE client_id IS NOT NULL)`,
    )
    .run(cutoff);
  const count = (ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as Row).n as number;
  if (count >= MAX_CLIENTS) throw new OAuthError("temporarily_unavailable", "too many registered clients; try again tomorrow", 503);

  const id = "indy_client_" + id12();
  const createdAt = iso(Date.now());
  ctx.db
    .prepare("INSERT INTO oauth_clients (id, name, redirect_uris_json, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, JSON.stringify(redirectUris), createdAt);
  return { id, name, redirectUris, createdAt };
}

export function getClient(ctx: ServiceContext, id: string): OAuthClient | null {
  const row = ctx.db.prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id) as Row | undefined;
  return row ? toClient(row) : null;
}

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  challenge: string;
  resource: string | null;
  scope: string;
}

/**
 * Checks an /oauth/authorize request. Errors the client can be told about
 * come back as a redirect; a bad client or redirect URI cannot be redirected
 * to safely, so it is shown on the page instead (`fatal`).
 */
export function checkAuthorize(
  ctx: ServiceContext,
  params: URLSearchParams,
  mcpResource: string,
): { ok: AuthorizeRequest } | { fatal: string } | { redirect: string } {
  const client = getClient(ctx, params.get("client_id") ?? "");
  if (!client) return { fatal: "This agent is not registered with Indy. Start the connection again from the agent." };
  const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !redirectAllowed(client, redirectUri))
    return { fatal: "The agent asked to be sent back to an address it did not register." };
  const state = params.get("state");
  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return { redirect: url.toString() };
  };
  if (params.get("response_type") !== "code") return back("unsupported_response_type", "only response_type=code is supported");
  const challenge = params.get("code_challenge") ?? "";
  if (!challenge) return back("invalid_request", "PKCE is required: send code_challenge with method S256");
  if ((params.get("code_challenge_method") ?? "plain") !== "S256") return back("invalid_request", "code_challenge_method must be S256");
  const resource = params.get("resource");
  if (resource && !sameResource(resource, mcpResource)) return back("invalid_target", `this server only issues tokens for ${mcpResource}`);
  return { ok: { client, redirectUri, state, challenge, resource, scope: SCOPE } };
}

function sameResource(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** The owner said yes: a single-use code, bound to everything the token request must repeat. */
export function issueAuthCode(ctx: ServiceContext, req: AuthorizeRequest, connectionName: string): string {
  const code = randomToken(24);
  ctx.db
    .prepare(
      `INSERT INTO oauth_codes (hash, client_id, redirect_uri, challenge, resource, connection_name, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sha256(code), req.client.id, req.redirectUri, req.challenge, req.resource, connectionName.trim().slice(0, 60) || req.client.name, iso(Date.now() + CODE_TTL_MS));
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function mint(ctx: ServiceContext, connectionId: string): TokenResponse {
  const access = ACCESS_PREFIX + randomToken(24);
  const refresh = REFRESH_PREFIX + randomToken(24);
  const now = Date.now();
  const insert = ctx.db.prepare("INSERT INTO oauth_tokens (hash, connection_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)");
  insert.run(sha256(access), connectionId, "access", iso(now + ACCESS_TTL_S * 1000), iso(now));
  insert.run(sha256(refresh), connectionId, "refresh", iso(now + REFRESH_TTL_MS), iso(now));
  // Expired rows are no use to anyone.
  ctx.db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(iso(now));
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The token endpoint: an authorization code or a refresh token in, a fresh pair out. */
export function exchange(ctx: ServiceContext, form: URLSearchParams, mcpResource: string): TokenResponse {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  const resource = form.get("resource");
  if (resource && !sameResource(resource, mcpResource)) throw new OAuthError("invalid_target", `this server only issues tokens for ${mcpResource}`);

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const row = ctx.db.prepare("SELECT * FROM oauth_codes WHERE hash = ?").get(sha256(code)) as Row | undefined;
    if (!row) throw new OAuthError("invalid_grant", "unknown authorization code");
    // Single use, whatever happens next.
    ctx.db.prepare("DELETE FROM oauth_codes WHERE hash = ?").run(sha256(code));
    ctx.db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(iso(Date.now()));
    if (Date.parse(String(row.expires_at)) < Date.now()) throw new OAuthError("invalid_grant", "the authorization code has expired");
    if (String(row.client_id) !== clientId) throw new OAuthError("invalid_grant", "the code was issued to another client");
    const redirect = form.get("redirect_uri");
    if (redirect !== null && redirect !== String(row.redirect_uri)) throw new OAuthError("invalid_grant", "redirect_uri does not match");
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || pkce(verifier) !== String(row.challenge))
      throw new OAuthError("invalid_grant", "code_verifier does not match the code_challenge");

    const id = id12();
    const now = iso(Date.now());
    ctx.db
      .prepare(
        "INSERT INTO api_tokens (id, name, prefix, hash, created_at, kind, client_id) VALUES (?, ?, ?, ?, ?, 'oauth', ?)",
      )
      .run(id, String(row.connection_name), "oauth", `oauth:${id}`, now, clientId);
    return mint(ctx, id);
  }

  if (grant === "refresh_token") {
    const token = form.get("refresh_token") ?? "";
    const row = ctx.db
      .prepare(
        `SELECT t.connection_id, t.expires_at, c.client_id FROM oauth_tokens t JOIN api_tokens c ON c.id = t.connection_id
         WHERE t.hash = ? AND t.kind = 'refresh' AND c.revoked_at IS NULL`,
      )
      .get(sha256(token)) as Row | undefined;
    if (!row || Date.parse(String(row.expires_at)) < Date.now()) throw new OAuthError("invalid_grant", "the refresh token is not valid; connect again");
    if (clientId && String(row.client_id) !== clientId) throw new OAuthError("invalid_grant", "the refresh token belongs to another client");
    // Rotation: the old refresh token is spent.
    ctx.db.prepare("DELETE FROM oauth_tokens WHERE hash = ?").run(sha256(token));
    return mint(ctx, String(row.connection_id));
  }

  throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

/** Who an access token speaks for, or null if it is unknown, expired or revoked. */
export function checkAccessToken(ctx: ServiceContext, token: string): { id: string; name: string } | null {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const row = ctx.db
    .prepare(
      `SELECT c.id, c.name, c.last_used_at, t.expires_at FROM oauth_tokens t JOIN api_tokens c ON c.id = t.connection_id
       WHERE t.hash = ? AND t.kind = 'access' AND c.revoked_at IS NULL`,
    )
    .get(sha256(token)) as Row | undefined;
  if (!row || Date.parse(String(row.expires_at)) < Date.now()) return null;
  if (!row.last_used_at || Date.now() - Date.parse(String(row.last_used_at)) > 60 * 1000) {
    ctx.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(iso(Date.now()), String(row.id));
  }
  return { id: String(row.id), name: String(row.name) };
}

export function authServerMetadata(url: string) {
  return {
    issuer: url,
    authorization_endpoint: `${url}/oauth/authorize`,
    token_endpoint: `${url}/api/oauth/token`,
    registration_endpoint: `${url}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE, "offline_access"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://github.com/liamdmcgarrigle/indy-artifacts",
  };
}

export function resourceMetadata(url: string) {
  return {
    resource: `${url}/mcp`,
    authorization_servers: [url],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
    resource_name: "Indy",
  };
}

