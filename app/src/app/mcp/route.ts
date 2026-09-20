import { createMcpHandler } from "mcp-handler";
import { buildTools, REFERENCE_URI } from "@/lib/mcp/tools";
import { REFERENCE_MD } from "@/lib/mcp/reference";
import { getContext } from "@/lib/service/context";

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
        title: "Artifact authoring reference",
        description: "The block vocabulary, kinds, themes and limits for writing artifacts.",
        mimeType: "text/markdown",
      },
      async () => ({ contents: [{ uri: REFERENCE_URI, mimeType: "text/markdown", text: REFERENCE_MD }] }),
    );
  },
  {
    serverInfo: { name: "artifacts", version: "0.1.0" },
    instructions:
      "Artifacts are versioned, sandboxed pages the operator reads in a browser. Publish one instead of pasting a long report into the terminal. Read artifacts://reference for the block vocabulary.",
  },
);

export { handler as GET, handler as POST, handler as DELETE };
