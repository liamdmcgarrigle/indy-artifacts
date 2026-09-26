import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { forwardResponse } from "@/lib/service/responses";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** The owner passing a visitor's answers on to agents. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const { slug, id } = await params;
    const input = await body(request);
    if (input.action !== "forward") return json({ error: { message: 'action must be "forward"' } }, { status: 400 });
    forwardResponse(ctx, slug, id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
