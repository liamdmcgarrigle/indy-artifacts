import { setOrganisation } from "@/lib/service/library";
import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { createHumanVersion, listVersions, requireArtifact, requireVersion, updateArtifact } from "@/lib/service/artifacts";
import { countUnsent } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import { parsePublish } from "@/lib/api/validate";
import type { UpdateInput } from "@/lib/service/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const ctx = getContext();
    const { slug } = await params;
    const artifact = requireArtifact(ctx, slug);
    return json({
      artifact,
      version: requireVersion(ctx, artifact),
      versions: listVersions(ctx, artifact.id).map((v) => ({
        number: v.number,
        authorKind: v.authorKind,
        authorName: v.authorName,
        message: v.message,
        createdAt: v.createdAt,
        buildStatus: v.buildStatus,
      })),
      unsentComments: countUnsent(ctx, artifact.id),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const who = requireMember(getContext(), request);
    const { slug } = await params;
    const payload = await body(request);
    const expectedVersion = Number(payload.expected_version ?? payload.expectedVersion);
    // Only the owner's own edits are recorded as a person's; an agent cannot claim to be one.
    if (who.kind === "owner" && (payload.author_kind === "human" || payload.authorKind === "human")) {
      const result = await createHumanVersion(getContext(), slug, {
        source: payload.source as string | undefined,
        files: payload.files as Record<string, string> | undefined,
        message: payload.message as string | undefined,
        authorName: String(payload.author_name ?? payload.authorName ?? "operator"),
        expectedVersion,
      });
      return json(result);
    }
    const { expected_version: _ev, expectedVersion: _ev2, slug: _slug, ...rest } = payload;
    return json(await updateArtifact(getContext(), slug, { ...parsePublish(rest), expectedVersion } as UpdateInput));
  } catch (err) {
    return fail(err);
  }
}

/** Organisation only: pin, archive, move to a project or series. Never content. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const { slug } = await params;
    const input = await body(request);
    setOrganisation(ctx, slug, {
      pinned: typeof input.pinned === "boolean" ? input.pinned : undefined,
      archived: typeof input.archived === "boolean" ? input.archived : undefined,
      project: input.project === undefined ? undefined : (input.project as string | null),
      series: input.series === undefined ? undefined : (input.series as string | null),
    });
    return json({ artifact: requireArtifact(ctx, slug) });
  } catch (err) {
    return fail(err);
  }
}
