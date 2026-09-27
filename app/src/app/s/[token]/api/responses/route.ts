import { getContext } from "@/lib/service/context";
import { submitResponse } from "@/lib/service/responses";
import { ensureVisit, visitorRequest } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";
import { ValidationError } from "@/lib/service/errors";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/** A visitor answering the form. Their answers wait for the owner before any agent sees them. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const req = visitorRequest(request, (await params).token);
    // Anyone with the link can post here, so the size is capped before parsing.
    if (Number(request.headers.get("content-length") ?? 0) > 256 * 1024) throw new ValidationError("those answers are too long");
    limit(`answers:${req.link.id}:${clientAddress(request.headers)}`, 30, 60 * 60_000);
    const input = await body(request);
    const { visitor, setCookie } = ensureVisit(req);
    const response = submitResponse(getContext(), req.artifact.slug, (input.answers ?? {}) as Record<string, unknown>, {
      kind: "visitor",
      email: visitor.email,
      linkId: req.link.id,
      version: req.link.pinnedVersion,
    });
    return json({ response: { id: response.id } }, { status: 201, headers: setCookie ? { "set-cookie": setCookie } : {} });
  } catch (err) {
    return fail(err);
  }
}
