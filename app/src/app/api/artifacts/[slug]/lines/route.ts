import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { patchLines } from "@/lib/service/artifacts";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * Rewrite one run of source lines. This is what editing a single block on the
 * page posts to, so the operator can fix a sentence without opening the whole
 * document in an editor and hunting for it.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    const payload = await body(request);
    const result = await patchLines(getContext(), slug, {
      from: Number(payload.from),
      to: Number(payload.to),
      text: String(payload.text ?? ""),
      authorName: String(payload.author_name ?? payload.authorName ?? "operator"),
      expectedVersion: Number(payload.expected_version ?? payload.expectedVersion),
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
