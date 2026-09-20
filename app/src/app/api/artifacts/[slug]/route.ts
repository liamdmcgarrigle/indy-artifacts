import { getContext } from "@/lib/service/context";
import { createHumanVersion, listVersions, requireArtifact, requireVersion, updateArtifact } from "@/lib/service/artifacts";
import { countUnsent } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import type { UpdateInput } from "@/lib/service/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
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
    const { slug } = await params;
    const payload = await body(request);
    const expectedVersion = Number(payload.expected_version ?? payload.expectedVersion);
    if (payload.author_kind === "human" || payload.authorKind === "human") {
      const result = await createHumanVersion(getContext(), slug, {
        source: payload.source as string | undefined,
        files: payload.files as Record<string, string> | undefined,
        message: payload.message as string | undefined,
        authorName: String(payload.author_name ?? payload.authorName ?? "operator"),
        expectedVersion,
      });
      return json(result);
    }
    const { expected_version: _ev, expectedVersion: _ev2, ...rest } = payload;
    return json(await updateArtifact(getContext(), slug, { ...rest, expectedVersion } as UpdateInput));
  } catch (err) {
    return fail(err);
  }
}
