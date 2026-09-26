import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { listVersions, requireArtifact } from "@/lib/service/artifacts";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireMember(getContext(), request);
    const ctx = getContext();
    const artifact = requireArtifact(ctx, (await params).slug);
    return json({ versions: listVersions(ctx, artifact.id) });
  } catch (err) {
    return fail(err);
  }
}
