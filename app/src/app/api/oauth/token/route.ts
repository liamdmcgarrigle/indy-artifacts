import { getContext } from "@/lib/service/context";
import { exchange } from "@/lib/auth/oauth";
import { formOf, oauthFail, oauthJson, preflight, requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return oauthJson(exchange(getContext(), await formOf(request), `${requestBase(request.headers)}/mcp`));
  } catch (err) {
    return oauthFail(err);
  }
}
export const OPTIONS = preflight;
