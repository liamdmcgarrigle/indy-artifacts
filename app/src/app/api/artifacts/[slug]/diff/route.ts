import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { diffVersions, requireArtifact } from "@/lib/service/artifacts";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireMember(getContext(), request);
    const ctx = getContext();
    const { slug } = await params;
    const url = new URL(request.url);
    const artifact = requireArtifact(ctx, slug);
    const to = Number(url.searchParams.get("to") ?? artifact.currentVersion);
    const from = Number(url.searchParams.get("from") ?? Math.max(to - 1, 1));
    return json({ from, to, patch: diffVersions(ctx, slug, from, to) });
  } catch (err) {
    return fail(err);
  }
}
