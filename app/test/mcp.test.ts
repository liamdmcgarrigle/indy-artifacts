import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let post: (body: unknown) => Promise<Record<string, unknown>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-mcp-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://agentbox:5174";
  const mod = await import("@/app/mcp/route");
  const handler = mod.POST as (req: Request) => Promise<Response>;

  post = async (body: unknown) => {
    const res = await handler(
      new Request("http://localhost:5174/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    const line = text
      .split("\n")
      .map((l) => (l.startsWith("data: ") ? l.slice(6) : l))
      .find((l) => l.trim().startsWith("{"));
    if (!line) throw new Error(`no JSON in response (${res.status}): ${text.slice(0, 400)}`);
    return JSON.parse(line) as Record<string, unknown>;
  };

  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1" },
    },
  });
  expect((init.result as Record<string, unknown>).serverInfo).toMatchObject({ name: "indy" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function callTool(name: string, args: Record<string, unknown>) {
  return post({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } });
}

function textOf(response: Record<string, unknown>): string {
  const result = response.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  if (!result?.content) throw new Error(`no content: ${JSON.stringify(response).slice(0, 300)}`);
  return result.content.map((c) => c.text ?? "").join("\n");
}

function jsonOf(response: Record<string, unknown>): unknown {
  const text = textOf(response);
  const start = text.indexOf("\n\n");
  return JSON.parse(text.slice(start + 2));
}

describe("mcp endpoint", () => {
  it("lists the eleven artifact tools", async () => {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = ((res.result as { tools: { name: string }[] }).tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      "artifact_comments",
      "artifact_diff",
      "artifact_get",
      "artifact_list",
      "artifact_publish",
      "artifact_reply",
      "artifact_resolve",
      "artifact_responses",
      "artifact_type",
      "artifact_update",
      "artifact_wait",
    ]);
  });

  it("serves the authoring reference as a resource", async () => {
    const res = await post({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "indy://reference" } });
    const contents = (res.result as { contents: { text: string }[] }).contents;
    expect(contents[0].text).toContain(":::kpis");
  });

  it("publishes, reads back and updates an artifact", async () => {
    const published = await callTool("artifact_publish", {
      slug: "mcp-demo",
      source: "---\ntitle: MCP demo\n---\n\nFirst body.\n",
      agent: { name: "vitest", terminal: "term_t" },
    });
    expect(textOf(published)).toContain("http://agentbox:5174/a/mcp-demo");
    expect((jsonOf(published) as { version: number }).version).toBe(1);

    const got = await callTool("artifact_get", { slug: "mcp-demo" });
    expect((jsonOf(got) as { source: string }).source).toContain("First body.");

    const updated = await callTool("artifact_update", {
      slug: "mcp-demo",
      expected_version: 1,
      source: "---\ntitle: MCP demo\n---\n\nSecond body.\n",
    });
    expect((jsonOf(updated) as { version: number }).version).toBe(2);

    const diff = await callTool("artifact_diff", { slug: "mcp-demo", from: 1, to: 2 });
    expect(textOf(diff)).toContain("+Second body.");
  });

  it("returns a tool error for a stale expected_version", async () => {
    const res = await callTool("artifact_update", {
      slug: "mcp-demo",
      expected_version: 1,
      source: "---\ntitle: MCP demo\n---\n\nStale.\n",
    });
    expect((res.result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toContain("is at version 2");
  });

  it("reports a build failure in the tool result without losing the version", async () => {
    const res = await callTool("artifact_publish", {
      slug: "broken-react",
      title: "Broken",
      kind: "react",
      files: { "App.tsx": 'import fs from "node:fs";\nexport default function App(){return <b>{String(fs)}</b>}' },
    });
    expect(textOf(res)).toContain("Build FAILED");
    expect(textOf(res)).toContain("is not available in artifacts");
    const got = await callTool("artifact_get", { slug: "broken-react" });
    expect((jsonOf(got) as { build_status: string }).build_status).toBe("error");
  });

  it("round-trips comments: list, reply, resolve", async () => {
    const { createComment } = await import("@/lib/service/comments");
    const { getContext } = await import("@/lib/service/context");
    const comment = createComment(getContext(), "mcp-demo", {
      body: "this number is wrong",
      authorName: "liam",
      anchor: { type: "range", block: "b0", lines: [5, 5], quote: "Second" },
    });

    const listed = await callTool("artifact_comments", { slug: "mcp-demo" });
    const threads = jsonOf(listed) as { id: string; anchor: { lines: number[] } }[];
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor.lines).toEqual([5, 5]);

    await callTool("artifact_reply", { comment_id: comment.id, body: "fixed in v3", agent: { name: "vitest" } });
    const withReply = jsonOf(await callTool("artifact_comments", { slug: "mcp-demo" })) as {
      replies: { body: string }[];
    }[];
    expect(withReply[0].replies[0].body).toBe("fixed in v3");

    await callTool("artifact_resolve", { comment_id: comment.id });
    expect(jsonOf(await callTool("artifact_comments", { slug: "mcp-demo" }))).toHaveLength(0);
  });

  it("wait returns promptly when there is nothing new", async () => {
    const res = await callTool("artifact_wait", { slug: "mcp-demo", timeout_s: 1 });
    expect(textOf(res)).toContain("No feedback");
  });
});
