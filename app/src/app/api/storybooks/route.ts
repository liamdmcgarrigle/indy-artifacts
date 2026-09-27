import { getContext } from "@/lib/service/context";
import { requireMember } from "@/lib/auth/access";
import { storybooksState } from "@/lib/api/storybooks";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    return json(storybooksState(ctx));
  } catch (err) {
    return fail(err);
  }
}
