import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; n: string }> }) {
  try {
    requireMember(getContext(), request);
    const ctx = getContext();
    const { slug, n } = await params;
    const artifact = requireArtifact(ctx, slug);
    return json({ artifact, version: requireVersion(ctx, artifact, Number(n)) });
  } catch (err) {
    return fail(err);
  }
}
