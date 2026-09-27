import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { listArtifacts, publishArtifact } from "@/lib/service/artifacts";
import { body, fail, json } from "@/lib/api/respond";
import { parsePublish } from "@/lib/api/validate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireMember(getContext(), request);
    const url = new URL(request.url);
    const project = url.searchParams.get("project") ?? undefined;
    const limit = url.searchParams.get("limit");
    return json({ artifacts: listArtifacts(getContext(), { project, limit: limit ? Number(limit) : undefined }) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    requireMember(getContext(), request);
    const result = await publishArtifact(getContext(), parsePublish(await body(request)) as never);
    return json(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
