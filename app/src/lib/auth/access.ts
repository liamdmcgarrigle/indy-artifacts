import { config } from "../config";
import type { ServiceContext } from "../service/context";
import { UnauthorizedError } from "../service/errors";
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
  if (config().auth === "local") return { kind: "owner", user: null };
  return null;
}

/** The owner or one of their agents: everything except share-link routes. */
export function requireMember(ctx: ServiceContext, request: Request): Principal {
  const who = principalFrom(ctx, request.headers);
  if (!who) throw new UnauthorizedError();
  return who;
}

/** Only the owner in a browser: settings, tokens, sharing. */
export function requireOwner(ctx: ServiceContext, request: Request): Principal & { kind: "owner" } {
  const who = principalFrom(ctx, request.headers);
  if (!who || who.kind !== "owner") throw new UnauthorizedError();
  return who;
}

/** The name to put on something the owner writes. */
export function ownerName(who: Principal): string {
  if (who.kind === "agent") return who.name;
  return who.user?.name ?? "you";
}
