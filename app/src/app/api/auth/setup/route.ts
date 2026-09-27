import { getContext } from "@/lib/service/context";
import { createOwner, createSession, SESSION_DAYS } from "@/lib/auth/accounts";
import { sessionCookie } from "@/lib/auth/page";
import { secureCookies } from "@/lib/config";
import { body, fail, json } from "@/lib/api/respond";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/** First run: make the one account. Refused once an owner exists. */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    limit(`setup:${clientAddress(request.headers)}`, 20, 15 * 60_000);
    const input = await body(request);
    const user = await createOwner(ctx, {
      email: String(input.email ?? ""),
      password: String(input.password ?? ""),
      name: input.name ? String(input.name) : undefined,
    });
    const session = createSession(ctx, user.id);
    return json(
      { user: { email: user.email, name: user.name } },
      { status: 201, headers: { "set-cookie": sessionCookie(session.token, SESSION_DAYS * 86400, secureCookies()) } },
    );
  } catch (err) {
    return fail(err);
  }
}
