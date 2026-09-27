import { getContext } from "@/lib/service/context";
import { ForbiddenError } from "@/lib/service/errors";
import { requireVersion } from "@/lib/service/artifacts";
import { setTick, tickViews } from "@/lib/service/ticks";
import { requireIdentity, visitorRequest } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** The ticks on the version this link shows. Names only; no one's email leaves the owner's view. */
export async function GET(request: Request, { params }: Params) {
  try {
    const req = visitorRequest(request, (await params).token);
    const ctx = getContext();
    const version = requireVersion(ctx, req.artifact, req.link.pinnedVersion ?? undefined);
    return json({ ticks: tickViews(ctx, req.artifact, version), version: version.number });
  } catch (err) {
    return fail(err);
  }
}

/**
 * A visitor ticking or unticking an item: { key, checked }. Only on a link
 * that lets people take part, only once they have said who they are, and
 * only on the version the link shows.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const req = visitorRequest(request, (await params).token);
    if (!req.link.allowComments) throw new ForbiddenError("this link is read-only");
    const identity = requireIdentity(req, request);
    limit(`ticks:${req.link.id}:${clientAddress(request.headers)}`, 120, 10 * 60_000);
    const input = await body(request);
    const ctx = getContext();
    const version = requireVersion(ctx, req.artifact, req.link.pinnedVersion ?? undefined);
    const state = setTick(ctx, req.artifact.slug, {
      key: String(input.key ?? ""),
      checked: input.checked === true,
      version: version.number,
      by: { kind: "visitor", name: identity.name, email: identity.email, verified: identity.verified, linkId: req.link.id },
    });
    return json({ ticks: tickViews(ctx, req.artifact, version), done: state.done });
  } catch (err) {
    return fail(err);
  }
}
