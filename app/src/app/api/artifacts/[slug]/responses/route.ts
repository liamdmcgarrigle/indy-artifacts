import { getContext } from "@/lib/service/context";
import { requireMember, requireOwner } from "@/lib/auth/access";
import { listResponses, submitResponse } from "@/lib/service/responses";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = getContext();
    const who = requireMember(ctx, request);
    return json({ responses: listResponses(ctx, (await params).slug, { agent: who.kind === "agent" }) });
  } catch (err) {
    return fail(err);
  }
}

/** The owner answering their own form; visitors answer through a share link. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const input = await body(request);
    const answers = (input.answers ?? {}) as Record<string, unknown>;
    return json({ response: submitResponse(ctx, (await params).slug, answers) }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
