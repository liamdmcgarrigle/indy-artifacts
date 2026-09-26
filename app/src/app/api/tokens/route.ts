import { getContext } from "@/lib/service/context";
import { createApiToken, listApiTokens } from "@/lib/auth/accounts";
import { requireOwner } from "@/lib/auth/access";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    return json({ tokens: listApiTokens(ctx) });
  } catch (err) {
    return fail(err);
  }
}

/** The token itself is returned once, here, and never again. */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const input = await body(request);
    const { token, record } = createApiToken(ctx, String(input.name ?? ""));
    return json({ token, record }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
