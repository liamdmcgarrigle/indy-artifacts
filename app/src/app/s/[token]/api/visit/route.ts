import { getContext } from "@/lib/service/context";
import { finishVisit, resolveShare, startVisit } from "@/lib/service/sharing";
import { visitCookie } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/**
 * The email gate: send an email to get a code, then send the code back.
 * { email } -> { code_id }; { code_id, code } -> a visit cookie.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const ctx = getContext();
    const share = resolveShare(ctx, (await params).token);
    const input = await body(request);
    const from = clientAddress(request.headers);
    if (typeof input.code === "string") {
      limit(`visit-code:${share.link.id}:${from}`, 20, 15 * 60_000);
      const { cookie, maxAge } = finishVisit(ctx, share.link, String(input.code_id ?? ""), input.code);
      return json({ ok: true }, { headers: { "set-cookie": visitCookie(share, cookie, maxAge) } });
    }
    // Every request sends an email from the owner's account, so they are few.
    const address = String(input.email ?? "").trim().toLowerCase();
    limit(`visit-email:${share.link.id}:${address}`, 3, 60 * 60_000);
    limit(`visit-email:${share.link.id}:${from}`, 10, 60 * 60_000);
    limit(`visit-email:${share.link.id}`, 50, 60 * 60_000);
    const { codeId, email } = await startVisit(ctx, share.link, String(input.email ?? ""));
    return json({ code_id: codeId, email });
  } catch (err) {
    return fail(err);
  }
}
