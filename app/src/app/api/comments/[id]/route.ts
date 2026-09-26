import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { patchComment } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import type { CommentStatus } from "@/lib/service/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMember(getContext(), request);
    const { id } = await params;
    const payload = await body(request);
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
