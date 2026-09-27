import { getContext } from "@/lib/service/context";
import { registerClient, OAuthError } from "@/lib/auth/oauth";
import { oauthFail, oauthJson, preflight } from "@/lib/api/oauth";
import { clientAddress, limit } from "@/lib/auth/limits";

export const dynamic = "force-dynamic";

/** RFC 7591 dynamic client registration, for public clients only. */
export async function POST(request: Request) {
  try {
    limit(`register:${clientAddress(request.headers)}`, 30, 60 * 60_000);
    let input: Record<string, unknown>;
    try {
      input = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new OAuthError("invalid_client_metadata", "send the client metadata as JSON");
    }
    const client = registerClient(getContext(), input ?? {});
    return oauthJson(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  } catch (err) {
    return oauthFail(err);
  }
}
export const OPTIONS = preflight;
