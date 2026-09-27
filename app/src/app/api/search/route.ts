import { getContext } from "@/lib/service/context";
import { requireMember } from "@/lib/auth/access";
import { search } from "@/lib/service/library";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const url = new URL(request.url);
    return json(search(ctx, url.searchParams.get("q") ?? "", { project: url.searchParams.get("project") ?? undefined }));
  } catch (err) {
    return fail(err);
  }
}
