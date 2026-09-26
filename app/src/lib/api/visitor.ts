import { parseCookies } from "../auth/access";
import { secureCookies } from "../config";
import { getContext } from "../service/context";
import { ForbiddenError } from "../service/errors";
import { openVisit, resolveShare, visitCookieName, visitorOf, type Share } from "../service/sharing";

/**
 * A request under /s/:token. The link is the only credential a visitor has:
 * every route resolves it first, and an email link also wants the visitor's
 * confirmed session.
 */
export interface VisitorRequest extends Share {
  visitor: { email: string | null } | null;
}

export function visitorRequest(request: Request, token: string): VisitorRequest {
  const ctx = getContext();
  const share = resolveShare(ctx, token);
  const cookie = parseCookies(request.headers.get("cookie"))[visitCookieName(share.link)];
  const visitor = visitorOf(ctx, share.link, cookie);
  if (share.link.mode === "email" && !visitor) throw new ForbiddenError("confirm your email to open this page");
  return { ...share, visitor };
}

export function visitCookie(share: Share, value: string, maxAge: number): string {
  return [
    `${visitCookieName(share.link)}=${value}`,
    `Path=/s/${share.link.token}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secureCookies() ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * The visitor's session, starting one on an open link the first time they
 * write something, so their own threads stay theirs. Returns the cookie to
 * set, when a new one was made.
 */
export function ensureVisit(req: VisitorRequest): { visitor: { email: string | null }; setCookie: string | null } {
  if (req.visitor) return { visitor: req.visitor, setCookie: null };
  const { cookie, maxAge } = openVisit(getContext(), req.link, null);
  return { visitor: { email: null }, setCookie: visitCookie(req, cookie, maxAge) };
}
