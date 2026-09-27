import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let post: (body: unknown, headers?: Record<string, string>) => Promise<Record<string, unknown>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-mcp-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://agentbox:5174";
  const mod = await import("@/app/mcp/route");
  const handler = mod.POST as (req: Request) => Promise<Response>;

  post = async (body: unknown, extra: Record<string, string> = {}) => {
    const res = await handler(
      new Request("http://localhost:5174/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...extra,
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
  it("lists the artifact tools", async () => {
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
      "artifact_share",
      "artifact_share_revoke",
      "artifact_stories",
      "artifact_storybook_set",
      "artifact_storybook_upload",
      "artifact_theme_set",
      "artifact_themes",
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

  it("lets an agent give a project a theme, which its pages then use", async () => {
    const set = await callTool("artifact_theme_set", {
      name: "mcp-brand",
      label: "MCP brand",
      base: "graphite",
      tokens: { accent: "#e4572e", radius: 4 },
      projects: ["mcp-app"],
    });
    expect(textOf(set)).toContain('Theme "mcp-brand"');
    const listed = textOf(await callTool("artifact_themes", {}));
    expect(listed).toContain("mcp-app: mcp-brand");
    expect(listed).toContain("mcp-brand: MCP brand, accent #e4572e");

    const pub = await callTool("artifact_publish", { title: "Branded", source: "---\ntitle: Branded\n---\n\nHi\n", project: "mcp-app" });
    expect(textOf(pub)).toContain("Published");
    const { getContext } = await import("@/lib/service/context");
    const { findArtifact } = await import("@/lib/service/artifacts");
    const { effectiveTheme, themeHref } = await import("@/lib/service/themes");
    const ctx = getContext();
    const slug = /Published "([^"]+)"/.exec(textOf(pub))![1];
    const artifact = findArtifact(ctx, slug)!;
    const theme = effectiveTheme(ctx, artifact);
    expect(theme.name).toBe("mcp-brand");

    const route = (await import("@/app/themes/[name]/route")).GET;
    const href = themeHref(theme);
    const res = await route(new Request(`http://localhost:5174${href}`), { params: Promise.resolve({ name: "mcp-brand.css" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toContain("--art-accent: #e4572e");
    const stale = await route(new Request("http://localhost:5174/themes/mcp-brand.css?v=0000000000"), { params: Promise.resolve({ name: "mcp-brand.css" }) });
    expect(stale.headers.get("cache-control")).toBe("no-cache");
    const missing = await route(new Request("http://localhost:5174/themes/nope.css"), { params: Promise.resolve({ name: "nope.css" }) });
    expect(missing.status).toBe(404);
  });

  it("explains a bad theme setting rather than saving it", async () => {
    const bad = await callTool("artifact_theme_set", { name: "mcp-bad", tokens: { accent: "orange" } });
    expect(textOf(bad)).toMatch(/Error: accent must be a hex colour/);
    const preset = await callTool("artifact_theme_set", { name: "graphite", tokens: { accent: "#000000" } });
    expect(textOf(preset)).toMatch(/built-in theme/);
  });

  it("shares a page for an agent only once the owner allows it, and names the agent", async () => {
    const { getContext } = await import("@/lib/service/context");
    const { createApiToken } = await import("@/lib/auth/accounts");
    const { updateSettings } = await import("@/lib/service/settings");
    const { listSharedPages } = await import("@/lib/service/sharing");
    const ctx = getContext();
    const { token } = createApiToken(ctx, "laptop claude");
    const asAgent = (name: string, args: Record<string, unknown>) =>
      post(
        { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } },
        { authorization: `Bearer ${token}` },
      );
    const args = { slug: "mcp-demo", confirm: "mcp-demo", reason: "Liam asked: share this with the design team" };

    const refused = await asAgent("artifact_share", args);
    expect(textOf(refused)).toMatch(/Settings › Shared links/);
    expect(textOf(refused)).toMatch(/do not try any other way/);

    updateSettings(ctx, { agentSharing: true });
    const shared = await asAgent("artifact_share", args);
    expect(textOf(shared)).toMatch(/^Shared "mcp-demo": http:\/\/agentbox:5174\/s\//);
    const listed = listSharedPages(ctx).find((s) => s.slug === "mcp-demo")!;
    expect(listed.agent).toEqual({ agent: "laptop claude", reason: args.reason });

    const mine = jsonOf(await asAgent("artifact_share_revoke", {})) as { slug: string; agent: string }[];
    expect(mine).toMatchObject([{ slug: "mcp-demo", agent: "laptop claude" }]);
    expect(textOf(await asAgent("artifact_share_revoke", { slug: "mcp-demo" }))).toMatch(/Revoked/);
    expect(listSharedPages(ctx).find((s) => s.slug === "mcp-demo")).toBeUndefined();
    updateSettings(ctx, { agentSharing: false });
  });
});
