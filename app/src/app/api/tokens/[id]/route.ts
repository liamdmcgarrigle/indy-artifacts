import { getContext } from "@/lib/service/context";
import { revokeApiToken } from "@/lib/auth/accounts";
import { requireOwner } from "@/lib/auth/access";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    revokeApiToken(ctx, (await params).id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
