import { authServerMetadata } from "@/lib/auth/oauth";
import { oauthJson, preflight, requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";

/** RFC 8414, served at /.well-known/oauth-authorization-server (see next.config). */
export function GET(request: Request) {
  return oauthJson(authServerMetadata(requestBase(request.headers)));
}
export const OPTIONS = preflight;
