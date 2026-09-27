import { createMcpHandler } from "mcp-handler";
import { buildTools, REFERENCE_URI } from "@/lib/mcp/tools";
import { REFERENCE_MD } from "@/lib/mcp/reference";
import pkg from "../../../package.json";
import { getContext } from "@/lib/service/context";
import { bearer, principalFrom } from "@/lib/auth/access";
import { SCOPE } from "@/lib/auth/oauth";
import { requestBase } from "@/lib/api/oauth";
import { json } from "@/lib/api/respond";
import type { AgentCaller } from "@/lib/service/sharing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    const ctx = getContext();
    for (const tool of buildTools(ctx)) {
      server.registerTool(tool.name, tool.config as never, tool.run as never);
    }
    server.registerResource(
      "reference",
      REFERENCE_URI,
      {
        title: "Indy artifact authoring reference",
        description: "The block vocabulary, form fields, kinds, themes and limits for writing Indy artifacts.",
        mimeType: "text/markdown",
      },
      async () => ({ contents: [{ uri: REFERENCE_URI, mimeType: "text/markdown", text: REFERENCE_MD }] }),
    );
  },
  {
    serverInfo: { name: "indy", version: pkg.version },
    instructions:
      "Indy hosts artifacts: versioned pages, reports and forms the operator reads, comments on and answers in a browser. Publish one with artifact_publish instead of pasting a long report into the terminal, and read indy://reference for the blocks. The operator's comments do not interrupt you: after publishing, call artifact_wait to collect them, or artifact_comments to check.",
  },
);

/**
 * An agent without a valid token gets a 401 that says where to sign in:
 * MCP clients follow resource_metadata to Indy's OAuth server and send the
 * owner to the browser to approve them. Hand-made tokens work too.
 */
async function guarded(request: Request): Promise<Response> {
  const who = principalFrom(getContext(), request.headers);
  if (!who) {
    const url = requestBase(request.headers);
    const presented = Boolean(bearer(request.headers));
    const challenge = [
      `Bearer resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"`,
      `scope="${SCOPE}"`,
      ...(presented ? ['error="invalid_token"', 'error_description="The token is unknown, expired or revoked"'] : []),
    ].join(", ");
    return json(
      {
        error: {
          code: "unauthorized",
          message: `Indy needs you to sign in. Connect this agent from ${url}/connect, or send a token from Settings › Agents as 'Authorization: Bearer <token>'.`,
        },
      },
      { status: 401, headers: { "www-authenticate": challenge, "access-control-expose-headers": "www-authenticate" } },
    );
  }
  // Tools that record who acted (artifact_share) read this as ctx.http.authInfo.
  const caller: AgentCaller = who.kind === "agent" ? { name: who.name, tokenId: who.tokenId } : { name: "agent without a token", tokenId: null };
  Object.assign(request, { auth: { token: "", clientId: caller.tokenId ?? "", scopes: [], extra: { caller } } });
  return handler(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
