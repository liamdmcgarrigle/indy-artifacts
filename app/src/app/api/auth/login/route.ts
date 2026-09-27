import { getContext } from "@/lib/service/context";
import { checkPassword, createSession, issueCode, SESSION_DAYS } from "@/lib/auth/accounts";
import { sessionCookie } from "@/lib/auth/page";
import { emailEnabled, secureCookies } from "@/lib/config";
import { codeEmail, sendEmail } from "@/lib/email";
import { body, fail, json } from "@/lib/api/respond";
import { clearLimit, clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/**
 * Email and password. With the second step on and email configured, a
 * correct password only earns a code by email; the session comes from
 * /api/auth/verify.
 */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    const input = await body(request);
    const email = String(input.email ?? "").trim().toLowerCase();
    // Each guess costs a slow hash, so guessing is limited per address and per account.
    limit(`login:ip:${clientAddress(request.headers)}`, 30, 15 * 60_000);
    limit(`login:email:${email}`, 10, 15 * 60_000);
    const user = await checkPassword(ctx, email, String(input.password ?? ""));
    if (!user) return json({ error: { code: "unauthorized", message: "That email and password do not match." } }, { status: 401 });

    clearLimit(`login:email:${email}`);
    if (user.twoStep && emailEnabled()) {
      // A fresh code per sign-in would otherwise reset the five tries a code allows.
      limit(`code:user:${user.id}`, 6, 60 * 60_000);
      const { id, code } = issueCode(ctx, "sign_in", user.id, user.email);
      await sendEmail({ to: user.email, ...codeEmail(code, "sign in to Indy") });
      return json({ challenge: id, email: user.email });
    }

    const session = createSession(ctx, user.id);
    return json(
      { ok: true },
      { headers: { "set-cookie": sessionCookie(session.token, SESSION_DAYS * 86400, secureCookies()) } },
    );
  } catch (err) {
    return fail(err);
  }
}
