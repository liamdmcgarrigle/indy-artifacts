import { requireMember, requireOwner } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { forwardComment, patchComment } from "@/lib/service/comments";
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

/** The owner forwarding a visitor's thread to the agent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireOwner(getContext(), request);
    const { id } = await params;
    const payload = await body(request);
    if (payload.action !== "forward") return json({ error: { message: 'action must be "forward"' } }, { status: 400 });
    return json({ comment: forwardComment(getContext(), id) });
  } catch (err) {
    return fail(err);
  }
}
