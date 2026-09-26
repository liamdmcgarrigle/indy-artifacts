import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { createHumanVersion, LIVE_EDIT_MESSAGE, requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * Turn the live document into a version.
 *
 * The collaboration server calls this once typing has been quiet for a moment.
 * A version is only written when the text actually changed, so idle editors do
 * not fill the history with identical rows.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    const payload = await body(request);
    const text = String(payload.text ?? "");
    const ctx = getContext();
    const artifact = requireArtifact(ctx, slug);

    if (artifact.kind !== "markdown") return json({ skipped: true, reason: "not a markdown artifact" });

    const current = requireVersion(ctx, artifact);
    if ((current.source ?? "") === text) return json({ skipped: true, reason: "no change" });

    const result = await createHumanVersion(ctx, slug, {
      source: text,
      authorName: String(payload.author_name ?? payload.authorName ?? "live edit"),
      message: LIVE_EDIT_MESSAGE,
      expectedVersion: artifact.currentVersion,
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
