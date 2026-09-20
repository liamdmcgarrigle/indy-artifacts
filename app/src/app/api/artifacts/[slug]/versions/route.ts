import { getContext } from "@/lib/service/context";
import { listVersions, requireArtifact } from "@/lib/service/artifacts";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = getContext();
    const artifact = requireArtifact(ctx, (await params).slug);
    return json({ versions: listVersions(ctx, artifact.id) });
  } catch (err) {
    return fail(err);
  }
}
