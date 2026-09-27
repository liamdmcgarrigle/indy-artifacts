import { requireMember, requireOwner } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { endorseComment, forwardComment, patchComment } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import { ForbiddenError } from "@/lib/service/errors";
import type { CommentStatus } from "@/lib/service/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const who = requireMember(getContext(), request);
    const { id } = await params;
    const payload = await body(request);
    // Agents open and resolve threads; only the owner rewrites what was said.
    if (who.kind !== "owner" && payload.body !== undefined) throw new ForbiddenError("an agent cannot rewrite a comment; reply instead");
    return json({
      comment: patchComment(getContext(), id, {
        status: payload.status as CommentStatus | undefined,
        body: payload.body as string | undefined,
      }),
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * The owner passing a visitor's thread on. "forward" lets the agent read it,
 * flagged so it asks the owner before acting; "endorse" asks the agent to
 * address it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireOwner(getContext(), request);
    const { id } = await params;
    const payload = await body(request);
    if (payload.action === "endorse") return json({ comment: endorseComment(getContext(), id) });
    if (payload.action !== "forward") return json({ error: { message: 'action must be "forward" or "endorse"' } }, { status: 400 });
    return json({ comment: forwardComment(getContext(), id) });
  } catch (err) {
    return fail(err);
  }
}
