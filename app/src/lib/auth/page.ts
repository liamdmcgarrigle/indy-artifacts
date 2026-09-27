import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "../config";
import { getContext } from "../service/context";
import { owner, sessionUser, type User } from "./accounts";
import { hostAllowed, SESSION_COOKIE } from "./access";

/**
 * For server pages that only the owner sees. Sends a fresh install to setup
 * and anyone without a session to sign in.
 */
export async function pageOwner(): Promise<{ user: User | null }> {
  const ctx = getContext();
  const existing = owner(ctx);
  if (config().auth === "local") {
    if (!hostAllowed(await headers())) redirect("/login");
    return { user: existing };
  }
  if (!existing) redirect("/setup");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = sessionUser(ctx, token);
  if (!user) redirect("/login");
  return { user };
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * The service context for a page only the owner may see. Each page asks for
 * itself: a layout's check does not run when the client fetches just a page
 * segment during navigation.
 */
export async function ownerContext() {
  await pageOwner();
  return getContext();
}
