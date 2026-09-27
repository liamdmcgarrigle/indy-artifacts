import { OAuthError } from "../auth/oauth";
import { ServiceError } from "../service/errors";
import { config } from "../config";

/**
 * OAuth endpoints are read by MCP clients, some of which run in a browser
 * (claude.ai), so they answer any origin. None of them reads a cookie.
 */
export const OPEN = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function oauthJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", pragma: "no-cache", ...OPEN },
  });
}

/** Errors in the shape RFC 6749 §5.2 asks for. */
export function oauthFail(err: unknown): Response {
  if (err instanceof OAuthError) return oauthJson({ error: err.error, error_description: err.message }, err.status);
  if (err instanceof ServiceError) return oauthJson({ error: "invalid_request", error_description: err.message }, err.status);
  console.error("[indy] oauth:", err);
  return oauthJson({ error: "server_error", error_description: "something went wrong on the server" }, 500);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: OPEN });
}

/** A token request may come as a form (the spec) or as JSON (some clients). */
export async function formOf(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (type.includes("application/json")) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)]));
    } catch {
      throw new OAuthError("invalid_request", "the body is not valid JSON");
    }
  }
  return new URLSearchParams(text);
}

/**
 * The address this request came in on, which is the address the agent was
 * given. MCP clients insist that the resource and issuer they discover match
 * the URL they were pointed at, so an install reached by IP, by a short name
 * or through a proxy has to answer with that address, not only with INDY_URL.
 */
export function requestBase(headers: Headers): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"));
  if (!host || !/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) return config().url;
  const configured = new URL(config().url);
  const proto = first(headers.get("x-forwarded-proto")) ?? (host === configured.host ? configured.protocol.replace(":", "") : "http");
  if (proto !== "http" && proto !== "https") return config().url;
  return `${proto}://${host}`;
}
