import { getContext } from "@/lib/service/context";
import { config } from "@/lib/config";
import { requireOwner } from "@/lib/auth/access";
import { checkAuthorize, issueAuthCode } from "@/lib/auth/oauth";
import { fail } from "@/lib/api/respond";
import { requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";

/**
 * The consent form's post. The session cookie is SameSite=Lax, so another
 * site cannot post this form as the owner; the Origin check says so twice.
 */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    const c = config();
    requireOwner(ctx, request);
    // Compared with the host the browser actually used, which may be an IP
    // rather than the name in INDY_URL.
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin && origin !== "null") {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost !== host && originHost !== new URL(c.url).host) return new Response("Cross-site request refused.", { status: 403 });
    }

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
