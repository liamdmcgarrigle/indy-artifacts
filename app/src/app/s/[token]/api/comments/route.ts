import { getContext } from "@/lib/service/context";
import { createComment, listComments } from "@/lib/service/comments";
import { ForbiddenError } from "@/lib/service/errors";
import { ensureVisit, visitorRequest } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** The threads started through this link. */
export async function GET(request: Request, { params }: Params) {
  try {
    const req = visitorRequest(request, (await params).token);
    if (!req.link.allowComments) return json({ threads: [] });
    return json({ threads: listComments(getContext(), req.artifact.slug, { status: "all", audience: { linkId: req.link.id } }) });
  } catch (err) {
    return fail(err);
  }
}

/** A visitor's comment. It waits for the owner, who decides whether an agent sees it. */
export async function POST(request: Request, { params }: Params) {
  try {
    const req = visitorRequest(request, (await params).token);
    if (!req.link.allowComments) throw new ForbiddenError("comments are off on this link");
    const input = await body(request);
    const { visitor, setCookie } = ensureVisit(req);
    const name = String(input.author_name ?? "").trim().slice(0, 80) || visitor.email || "Visitor";
    const comment = createComment(getContext(), req.artifact.slug, {
      body: String(input.body ?? ""),
      authorName: name,
      anchor: input.parent_id ? null : input.anchor,
      parentId: (input.parent_id as string | null) ?? null,
      versionNumber: req.link.pinnedVersion ?? undefined,
      visitor: { linkId: req.link.id, email: visitor.email },
    });
    return json({ comment }, { status: 201, headers: setCookie ? { "set-cookie": setCookie } : {} });
  } catch (err) {
    return fail(err);
  }
}
