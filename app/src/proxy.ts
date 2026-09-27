import { NextResponse, type NextRequest } from "next/server";

/**
 * A cheap first gate for pages: no session cookie, no page. The real check is
 * in each page and route, against the database; this only saves a render and
 * remembers where you were going.
 */
export function proxy(request: NextRequest) {
  if (process.env.INDY_AUTH === "local") return NextResponse.next();
  if (request.cookies.get("indy_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: API routes answer 401 themselves, and shared links, frames,
  // sign-in, setup and static files must load without a session.
  matcher: ["/((?!api|mcp|embed|s/|login|setup|\\.well-known|oauth|_next|fonts|primitives|vendor|themes|favicon|icon|highlight\\.css).*)"],
};
