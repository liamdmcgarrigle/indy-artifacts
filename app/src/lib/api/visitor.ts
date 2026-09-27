import { parseCookies, sameSite } from "../auth/access";
import { secureCookies } from "../config";
import { getContext } from "../service/context";
import { ForbiddenError, ServiceError } from "../service/errors";
import { identityFor, openVisit, resolveShare, visitCookieName, visitorOf, type Identity, type Share, type Visitor } from "../service/sharing";

/**
 * A request under /s/:token. The link is the only credential a visitor has:
 * every route resolves it first, and an email link also wants the visitor's
 * confirmed session.
 */
export interface VisitorRequest extends Share {
  visitor: Visitor | null;
  /** The visit cookie as sent, when there is one. */
  cookie: string | null;
}

export function visitorRequest(request: Request, token: string): VisitorRequest {
  const ctx = getContext();
  const share = resolveShare(ctx, token);
  // A visitor's writes come from the shared page itself, never another site.
  if (!sameSite(request)) throw new ForbiddenError("That request came from another site.");
  const cookie = parseCookies(request.headers.get("cookie"))[visitCookieName(share.link)] ?? null;
  const visitor = visitorOf(ctx, share.link, cookie ?? undefined);
  if (share.link.mode === "email" && !visitor) throw new ForbiddenError("confirm your email to open this page");
  return { ...share, visitor, cookie: visitor ? cookie : null };
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
export function ensureVisit(req: VisitorRequest): { visitor: Visitor; cookie: string; setCookie: string | null } {
  if (req.visitor && req.cookie) return { visitor: req.visitor, cookie: req.cookie, setCookie: null };
  const { cookie, maxAge } = openVisit(getContext(), req.link, null);
  return { visitor: { email: null }, cookie, setCookie: visitCookie(req, cookie, maxAge) };
}

/** Raised when a visitor tries to comment or tick before saying who they are; the page asks, then tries again. */
export class IdentifyFirstError extends ServiceError {
  constructor() {
    super("identify", "tell us your name first", 403);
  }
}

/** The header a visitor's browser sends its signed identity in. */
export const IDENTITY_HEADER = "x-indy-identity";

/**
 * Anything a visitor does beyond reading and answering a form goes under the
 * identity their browser carries. Names and emails in the request body are
 * never used: only what the signed token says.
 */
export function requireIdentity(req: VisitorRequest, request: Request): Identity {
  const identity = identityFor(getContext(), req.link, req.visitor, request.headers.get(IDENTITY_HEADER));
  if (!identity) throw new IdentifyFirstError();
  return identity;
}
