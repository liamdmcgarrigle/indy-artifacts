import { getContext } from "@/lib/service/context";
import { requireMember, ownerName } from "@/lib/auth/access";
import { normaliseName } from "@/lib/service/storybooks";
import { uploadFrom } from "@/lib/api/storybooks";
import { fail } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** A build sent with an API token, for CI: POST a gzipped tar of the build folder. */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const ctx = getContext();
    const who = requireMember(ctx, request);
    return await uploadFrom(ctx, request, { storybook: normaliseName((await params).name), by: ownerName(who) });
  } catch (err) {
    return fail(err);
  }
}
