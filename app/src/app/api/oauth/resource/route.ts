import { resourceMetadata } from "@/lib/auth/oauth";
import { oauthJson, preflight, requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";

/** RFC 9728, served at /.well-known/oauth-protected-resource[/mcp] (see next.config). */
export function GET(request: Request) {
  return oauthJson(resourceMetadata(requestBase(request.headers)));
}
export const OPTIONS = preflight;
