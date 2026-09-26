import { getContext } from "@/lib/service/context";
import { submitResponse } from "@/lib/service/responses";
import { ensureVisit, visitorRequest } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** A visitor answering the form. Their answers wait for the owner before any agent sees them. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const req = visitorRequest(request, (await params).token);
    const input = await body(request);
    const { visitor, setCookie } = ensureVisit(req);
    const response = submitResponse(getContext(), req.artifact.slug, (input.answers ?? {}) as Record<string, unknown>, {
      kind: "visitor",
      email: visitor.email,
      linkId: req.link.id,
    });
    return json({ response: { id: response.id } }, { status: 201, headers: setCookie ? { "set-cookie": setCookie } : {} });
  } catch (err) {
    return fail(err);
  }
}
