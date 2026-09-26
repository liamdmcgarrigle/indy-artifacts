import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { markAllSeen } from "@/lib/service/library";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    markAllSeen(ctx);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
