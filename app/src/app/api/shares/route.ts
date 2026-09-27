import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { listSharedPages } from "@/lib/service/sharing";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** Every page with a working share link, for the settings list. */
export async function GET(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    return json({ shares: listSharedPages(ctx) });
  } catch (err) {
    return fail(err);
  }
}
