import { config } from "../config";
import type { ServiceContext } from "../service/context";
import { ForbiddenError, UnauthorizedError } from "../service/errors";
import { checkApiToken, secret, sessionUser, type User } from "./accounts";
import { hmac, safeEqual } from "./crypto";
import { checkAccessToken } from "./oauth";

/**
 * Who is asking. The owner arrives with a session cookie, or with nothing at
 * all on an install running with INDY_AUTH=local. An agent arrives with a
 * bearer token. Share-link visitors never get a principal: every route they
 * can reach sits under /s/:token and checks the link itself.
 */
export type Principal = { kind: "owner"; user: User | null } | { kind: "agent"; tokenId: string; name: string };

export const SESSION_COOKIE = "indy_session";

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function bearer(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * The key the document server uses for its calls to the app. Both processes
 * read the same database, so both can derive it; nothing to configure.
 */
export function internalKey(ctx: ServiceContext): string {
  return hmac(secret(ctx), "internal");
}

/**
 * With no sign-in (INDY_AUTH=local) every request is the owner, so a web page
 * that rebinds its own domain to this machine could read Indy. The Host header
 * gives that away: only Indy's own name, or loopback, is accepted.
 */
export function hostAllowed(headers: Headers): boolean {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host) return true;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (["localhost", "127.0.0.1", "[::1]"].includes(name)) return true;
  try {
    return name === new URL(config().url).hostname.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * A browser request that changes something must come from Indy's own pages.
 * Browsers say where a request came from (Sec-Fetch-Site, Origin); scripts
 * and agents send neither, and cannot ride on someone's cookies anyway.
 */
export function sameSite(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function principalFrom(ctx: ServiceContext, headers: Headers): Principal | null {
  const internal = headers.get("x-indy-internal");
  if (internal && safeEqual(internal, internalKey(ctx))) return { kind: "agent", tokenId: "internal", name: "live edit" };
  const token = bearer(headers);
  if (token) {
    const found = checkApiToken(ctx, token) ?? checkAccessToken(ctx, token);
    if (found) return { kind: "agent", tokenId: found.id, name: found.name };
  }
  const user = sessionUser(ctx, parseCookies(headers.get("cookie"))[SESSION_COOKIE]);
  if (user) return { kind: "owner", user };
  if (config().auth === "local" && hostAllowed(headers)) return { kind: "owner", user: null };
  return null;
}

/** The owner or one of their agents: everything except share-link routes. */
export function requireMember(ctx: ServiceContext, request: Request): Principal {
  const who = principalFrom(ctx, request.headers);
  if (!who) throw new UnauthorizedError();
  if (who.kind === "owner" && !sameSite(request)) throw new ForbiddenError("That request came from another site.");
  return who;
}

/** Only the owner in a browser: settings, tokens, sharing. */
export function requireOwner(ctx: ServiceContext, request: Request): Principal & { kind: "owner" } {
  const who = principalFrom(ctx, request.headers);
  if (!who || who.kind !== "owner") throw new UnauthorizedError();
  if (!sameSite(request)) throw new ForbiddenError("That request came from another site.");
  return who;
}

/** The name to put on something the owner writes. */
export function ownerName(who: Principal): string {
  if (who.kind === "agent") return who.name;
  return who.user?.name ?? "you";
}
