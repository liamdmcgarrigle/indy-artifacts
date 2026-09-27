import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { createHumanVersion, LIVE_EDIT_MESSAGE, requireArtifact, requireVersion, updateArtifact } from "@/lib/service/artifacts";
import { ConflictError, ForbiddenError } from "@/lib/service/errors";
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
    const ctx = getContext();
    const who = requireMember(ctx, request);
    if (who.kind !== "agent" || who.tokenId !== "internal") throw new ForbiddenError("only the document server writes snapshots");
    const { slug } = await params;
    const payload = await body(request);
    const text = String(payload.text ?? "");
    const artifact = requireArtifact(ctx, slug);

    if (artifact.kind !== "markdown") return json({ skipped: true, reason: "not a markdown artifact" });

    // The live copy was made from one version. If another has been written
    // since (a publish over MCP, a save elsewhere), this text would undo it.
    const base = Number(payload.base_version);
    if (Number.isInteger(base) && base !== artifact.currentVersion)
      throw new ConflictError(`the live copy was made from version ${base}, and the page is now at ${artifact.currentVersion}`, artifact.currentVersion);

    const current = requireVersion(ctx, artifact);
    if ((current.source ?? "") === text) return json({ skipped: true, reason: "no change", version: artifact.currentVersion });

    // An agent typing through artifact_type writes as that agent, so its own
    // typing does not come back to it as the operator's edit.
    const agentName = payload.author_kind === "agent" ? String(payload.author_name ?? "agent").slice(0, 80) : null;
    const result = agentName
      ? await updateArtifact(ctx, slug, { source: text, message: LIVE_EDIT_MESSAGE, expectedVersion: artifact.currentVersion, agent: { name: agentName } })
      : await createHumanVersion(ctx, slug, {
          source: text,
          authorName: String(payload.author_name ?? "live edit"),
          message: LIVE_EDIT_MESSAGE,
          expectedVersion: artifact.currentVersion,
        });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
