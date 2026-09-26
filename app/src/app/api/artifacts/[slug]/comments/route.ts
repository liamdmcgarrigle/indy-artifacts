import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { createComment, listComments } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import type { CommentStatus } from "@/lib/service/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    const status = (new URL(request.url).searchParams.get("status") ?? "open") as CommentStatus | "all";
    return json({ threads: listComments(getContext(), slug, { status }) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    const payload = await body(request);
    const comment = createComment(getContext(), slug, {
      body: String(payload.body ?? ""),
      authorName: String(payload.author_name ?? payload.authorName ?? "operator"),
      authorKind: "human",
      parentId: (payload.parent_id ?? payload.parentId ?? null) as string | null,
      anchor: payload.anchor,
      notify: payload.notify === true,
      versionNumber: payload.version_number ? Number(payload.version_number) : undefined,
    });
    return json({ comment }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
