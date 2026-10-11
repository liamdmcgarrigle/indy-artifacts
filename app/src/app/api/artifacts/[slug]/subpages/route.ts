import { ownerName, requireOwner } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { publishArtifact, requireArtifact } from "@/lib/service/artifacts";
import { ValidationError } from "@/lib/service/errors";
import { body, fail, json } from "@/lib/api/respond";
import { LIMITS } from "@/lib/service/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * A new, empty page under this one, made by the owner from the contents list.
 * It opens for editing next; its first version is theirs.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    const who = requireOwner(ctx, request);
    const { slug } = await params;
    const parent = requireArtifact(ctx, slug);
    const input = await body(request);
    const title = String(input.title ?? "").trim();
    if (!title) throw new ValidationError("a new page needs a title");
    if (title.length > LIMITS.titleChars) throw new ValidationError(`the title is over ${LIMITS.titleChars} characters`);
    const result = await publishArtifact(
      ctx,
      {
        kind: "markdown",
        title,
        source: "",
        parent: parent.slug,
        project: parent.project ?? undefined,
        branch: parent.branch ?? undefined,
        message: "new page",
      },
      { kind: "human", name: ownerName(who) },
    );
    return json(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
