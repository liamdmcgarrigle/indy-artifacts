import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let eventsGET: (req: Request) => Promise<Response>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifact-api-"));
  process.env.ARTIFACTS_DATA = dir;
  process.env.ARTIFACTS_PUBLIC_URL = "http://agentbox:5174";
  eventsGET = (await import("@/app/api/events/route")).GET as typeof eventsGET;

  const { publishArtifact } = await import("@/lib/service/artifacts");
  const { createComment } = await import("@/lib/service/comments");
  const { getContext } = await import("@/lib/service/context");
  const ctx = getContext();
  await publishArtifact(ctx, {
    slug: "api-demo",
    source: "---\ntitle: API demo\n---\n\nBody.\n",
    agent: { name: "claude", terminal: "term_api", session: "sess_api" },
  });
  createComment(ctx, "api-demo", { body: "look here", authorName: "liam", notify: true });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("events feed", () => {
  it("serves the snake_case shape the host hook poller expects", async () => {
    const res = await eventsGET(new Request("http://localhost:5174/api/events?after=0"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Record<string, unknown>[];
      last_id: number;
    };
    expect(body.last_id).toBeGreaterThan(0);
    const event = body.events[0];
    expect(event.kind).toBe("comment.created");
    expect(event).toHaveProperty("created_at");
    expect(event).toHaveProperty("delivered_at", null);
    const artifact = event.artifact as Record<string, unknown>;
    expect(artifact).toMatchObject({
      slug: "api-demo",
      title: "API demo",
      url: "http://agentbox:5174/a/api-demo",
      terminal_handle: "term_api",
      agent_name: "claude",
    });
    const comment = (event.payload as Record<string, unknown>).comment as Record<string, unknown>;
    expect(comment).toMatchObject({ body: "look here", author_name: "liam" });
    expect(comment).toHaveProperty("version_number", 1);
  });

  it("returns an empty page once everything is acked", async () => {
    const first = await (await eventsGET(new Request("http://localhost:5174/api/events?after=0"))).json();
    const { ackEvent } = await import("@/lib/service/events");
    const { getContext } = await import("@/lib/service/context");
    for (const event of (first as { events: { id: number }[] }).events) ackEvent(getContext(), event.id, "sent");
    const again = (await (await eventsGET(new Request("http://localhost:5174/api/events?after=0"))).json()) as {
      events: unknown[];
    };
    expect(again.events).toHaveLength(0);
  });
});
