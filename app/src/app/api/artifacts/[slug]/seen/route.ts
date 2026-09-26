import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { markSeen } from "@/lib/service/library";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    markSeen(ctx, (await params).slug);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
