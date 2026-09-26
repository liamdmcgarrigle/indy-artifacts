import { getContext } from "@/lib/service/context";
import { changePassword, endAllSessions, setTwoStep, updateProfile, userById } from "@/lib/auth/accounts";
import { requireOwner } from "@/lib/auth/access";
import { emailEnabled } from "@/lib/config";
import { ValidationError } from "@/lib/service/errors";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const ctx = getContext();
    const who = requireOwner(ctx, request);
    if (!who.user) throw new ValidationError("this install runs without accounts (INDY_AUTH=local)");
    const input = await body(request);
    if (input.name !== undefined || input.email !== undefined) {
      updateProfile(ctx, who.user.id, {
        name: input.name === undefined ? undefined : String(input.name),
        email: input.email === undefined ? undefined : String(input.email),
      });
    }
    if (input.new_password !== undefined) {
      await changePassword(ctx, who.user.id, String(input.current_password ?? ""), String(input.new_password));
    }
    if (input.two_step !== undefined) {
      if (input.two_step && !emailEnabled())
        throw new ValidationError("a sign-in code needs email: set RESEND_API_KEY first");
      setTwoStep(ctx, who.user.id, Boolean(input.two_step));
    }
    if (input.sign_out_everywhere) endAllSessions(ctx, who.user.id);
    return json({ user: userById(ctx, who.user.id) });
  } catch (err) {
    return fail(err);
  }
}
