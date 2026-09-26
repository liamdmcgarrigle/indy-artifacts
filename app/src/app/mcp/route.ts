import { createMcpHandler } from "mcp-handler";
import { buildTools, REFERENCE_URI } from "@/lib/mcp/tools";
import { REFERENCE_MD } from "@/lib/mcp/reference";
import { getContext } from "@/lib/service/context";
import { principalFrom } from "@/lib/auth/access";
import { json } from "@/lib/api/respond";

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
    serverInfo: { name: "indy", version: "0.2.0" },
    instructions:
      "Indy hosts artifacts: versioned pages, reports and forms the operator reads, comments on and answers in a browser. Publish one with artifact_publish instead of pasting a long report into the terminal, and read indy://reference for the blocks. The operator's comments do not interrupt you: after publishing, call artifact_wait to collect them, or artifact_comments to check.",
  },
);

/** An agent needs a token from Settings → Agents, unless the install trusts every request. */
async function guarded(request: Request): Promise<Response> {
  if (!principalFrom(getContext(), request.headers)) {
    return json(
      {
        error: {
          code: "unauthorized",
          message: "Indy needs a token. Create one in Settings → Agents and send it as 'Authorization: Bearer <token>'.",
        },
      },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="indy"' } },
    );
  }
  return handler(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
