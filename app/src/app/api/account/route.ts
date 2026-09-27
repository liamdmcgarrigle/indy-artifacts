import { getContext } from "@/lib/service/context";
import {
  changePassword,
  checkPassword,
  createSession,
  endAllSessions,
  normaliseEmail,
  SESSION_DAYS,
  setTwoStep,
  updateProfile,
  userById,
  validEmail,
} from "@/lib/auth/accounts";
import { requireOwner } from "@/lib/auth/access";
import { sessionCookie } from "@/lib/auth/page";
import { emailEnabled, secureCookies } from "@/lib/config";
import { ValidationError } from "@/lib/service/errors";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * Changes to the owner's account. Everything is checked before anything is
 * written, so a wrong password leaves the account as it was. Changing the
 * email or turning off sign-in codes asks for the password, since both would
 * let someone holding a stolen session keep the account.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = getContext();
    const who = requireOwner(ctx, request);
    if (!who.user) throw new ValidationError("this install runs without accounts (INDY_AUTH=local)");
    const user = who.user;
    const input = await body(request);

    const email = input.email === undefined ? undefined : normaliseEmail(String(input.email));
    if (email !== undefined && !validEmail(email)) throw new ValidationError("that email address does not look right");
    const twoStep = input.two_step === undefined ? undefined : input.two_step === true || input.two_step === "true";
    if (twoStep && !emailEnabled()) throw new ValidationError("a sign-in code needs email: set RESEND_API_KEY first");
    const newPassword = input.new_password === undefined ? undefined : String(input.new_password);
    const current = String(input.current_password ?? "");

    const sensitive = (email !== undefined && email !== user.email) || (twoStep === false && user.twoStep);
    if (sensitive && !(await checkPassword(ctx, user.email, current)))
      throw new ValidationError("enter your current password to change that");

    if (newPassword !== undefined) await changePassword(ctx, user.id, current, newPassword);
    if (input.name !== undefined || email !== undefined) {
      updateProfile(ctx, user.id, { name: input.name === undefined ? undefined : String(input.name), email });
    }
    if (twoStep !== undefined) setTwoStep(ctx, user.id, twoStep);

    // A new password ends every other session; this browser gets a fresh one.
    if (newPassword !== undefined || input.sign_out_everywhere) endAllSessions(ctx, user.id);
    if (newPassword !== undefined && !input.sign_out_everywhere) {
      const session = createSession(ctx, user.id);
      return json(
        { user: userById(ctx, user.id) },
        { headers: { "set-cookie": sessionCookie(session.token, SESSION_DAYS * 86400, secureCookies()) } },
      );
    }
    return json({ user: userById(ctx, user.id) });
  } catch (err) {
    return fail(err);
  }
}
