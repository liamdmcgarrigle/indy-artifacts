import { getContext } from "@/lib/service/context";
import { requireOwner } from "@/lib/auth/access";
import { checkAuthorize, issueAuthCode } from "@/lib/auth/oauth";
import { fail } from "@/lib/api/respond";
import { requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";

/**
 * The consent form's post. The session cookie is SameSite=Lax, and
 * requireOwner refuses a post from any other site (an opaque origin included).
 */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    const form = await request.formData();
    const params = new URLSearchParams(String(form.get("params") ?? ""));
    const base = requestBase(request.headers);
    const checked = checkAuthorize(ctx, params, `${base}/mcp`);
    if ("fatal" in checked) return new Response(checked.fatal, { status: 400 });
    if ("redirect" in checked) return Response.redirect(checked.redirect, 303);

    const req = checked.ok;
    const back = new URL(req.redirectUri);
    if (form.get("decision") === "allow") {
      back.searchParams.set("code", issueAuthCode(ctx, req, String(form.get("name") ?? "")));
    } else {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "The owner said no.");
    }
    if (req.state) back.searchParams.set("state", req.state);
    back.searchParams.set("iss", base);
    return new Response(null, { status: 303, headers: { location: back.toString() } });
  } catch (err) {
    return fail(err);
  }
}
