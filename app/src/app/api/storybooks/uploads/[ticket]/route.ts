import { getContext } from "@/lib/service/context";
import { claimUpload } from "@/lib/service/storybooks";
import { uploadFrom } from "@/lib/api/storybooks";
import { fail } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * A build sent to a single-use address from artifact_storybook_upload. The
 * address is the whole of the permission, so it is taken before the body is
 * read and cannot be used twice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ticket: string }> }) {
  try {
    const ctx = getContext();
    const ticket = claimUpload(ctx, (await params).ticket);
    return await uploadFrom(ctx, request, ticket);
  } catch (err) {
    return fail(err);
  }
}
