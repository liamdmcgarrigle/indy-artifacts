import { getContext } from "@/lib/service/context";
import { createSession, redeemCode, SESSION_DAYS } from "@/lib/auth/accounts";
import { sessionCookie } from "@/lib/auth/page";
import { secureCookies } from "@/lib/config";
import { body, fail, json } from "@/lib/api/respond";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = getContext();
    const input = await body(request);
    limit(`verify:ip:${clientAddress(request.headers)}`, 30, 15 * 60_000);
    const redeemed = redeemCode(ctx, String(input.challenge ?? ""), String(input.code ?? ""));
    if (!redeemed || redeemed.purpose !== "sign_in")
      return json({ error: { code: "unauthorized", message: "That code is wrong or has expired." } }, { status: 401 });
    const session = createSession(ctx, redeemed.subject);
    return json(
      { ok: true },
      { headers: { "set-cookie": sessionCookie(session.token, SESSION_DAYS * 86400, secureCookies()) } },
    );
  } catch (err) {
    return fail(err);
  }
}
