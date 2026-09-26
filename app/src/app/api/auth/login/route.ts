import { getContext } from "@/lib/service/context";
import { checkPassword, createSession, issueCode, SESSION_DAYS } from "@/lib/auth/accounts";
import { sessionCookie } from "@/lib/auth/page";
import { emailEnabled, secureCookies } from "@/lib/config";
import { codeEmail, sendEmail } from "@/lib/email";
import { body, fail, json } from "@/lib/api/respond";

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
    const user = await checkPassword(ctx, String(input.email ?? ""), String(input.password ?? ""));
    if (!user) return json({ error: { code: "unauthorized", message: "That email and password do not match." } }, { status: 401 });

    if (user.twoStep && emailEnabled()) {
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
