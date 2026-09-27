import { getContext } from "@/lib/service/context";
import { listApiTokens } from "@/lib/auth/accounts";
import { requireOwner } from "@/lib/auth/access";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * What agents have done since a moment: which connected or made a call, and
 * the first page published. The connect page polls it to show a new agent
 * arriving, so the owner knows the setup worked.
 */
export async function GET(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const raw = new URL(request.url).searchParams.get("since") ?? "";
    const since = Number.isNaN(Date.parse(raw)) ? new Date(Date.now() - 60_000).toISOString() : new Date(raw).toISOString();
    const connections = listApiTokens(ctx).filter((t) => t.createdAt >= since || (t.lastUsedAt ?? "") >= since);
    const page = ctx.db
      .prepare("SELECT slug, title FROM artifacts WHERE created_at >= ? ORDER BY created_at ASC LIMIT 1")
      .get(since) as { slug: string; title: string } | undefined;
    return json({ connections, page: page ?? null });
  } catch (err) {
    return fail(err);
  }
}
