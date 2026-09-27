import { getContext } from "@/lib/service/context";
import { identify } from "@/lib/service/sharing";
import { visitorRequest } from "@/lib/api/visitor";
import { body, fail, json } from "@/lib/api/respond";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/**
 * A visitor saying who they are, the first time they comment or tick on any
 * share link: { name, email } (only { name } on an email link, which already
 * confirmed the address). The answer is a signed token the browser keeps and
 * sends with every interaction. Sending a token back returns it unchanged,
 * whatever name comes with it, so an identity cannot be edited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const req = visitorRequest(request, (await params).token);
    limit(`identity:${req.link.id}:${clientAddress(request.headers)}`, 20, 15 * 60_000);
    const input = await body(request);
    const { identity, token } = identify(getContext(), req.link, req.visitor, { token: input.token, name: input.name, email: input.email });
    // The browser shows the visitor their own name and email; nobody else's ever comes back.
    return json({ identity: { name: identity.name, email: identity.email, verified: identity.verified }, token });
  } catch (err) {
    return fail(err);
  }
}
