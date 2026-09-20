import { getContext } from "@/lib/service/context";
import { listEvents } from "@/lib/service/events";
import type { EventRecord } from "@/lib/service/types";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The events feed is consumed by the host-side hook poller, which is written in
 * Python against a snake_case contract. Everything else on the wire follows the
 * service types, so the mapping lives here rather than in the service.
 */
function wire(event: EventRecord) {
  return {
    id: event.id,
    kind: event.kind,
    created_at: event.createdAt,
    delivered_at: event.deliveredAt,
    delivery_note: event.deliveryNote,
    artifact: {
      slug: event.artifact.slug,
      title: event.artifact.title,
      url: event.artifact.url,
      terminal_handle: event.artifact.terminalHandle,
      agent_name: event.artifact.agentName,
    },
    payload: event.payload,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = getContext();
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? 0);
    const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0), 0), 50);
    const slug = url.searchParams.get("slug") ?? undefined;
    const undeliveredOnly = url.searchParams.get("undelivered") !== "false";

    const deadline = Date.now() + wait * 1000;
    for (;;) {
      const page = listEvents(ctx, { after, slug, undeliveredOnly });
      if (page.events.length || Date.now() >= deadline)
        return json({ events: page.events.map(wire), last_id: page.lastId });
      await sleep(1000);
    }
  } catch (err) {
    return fail(err);
  }
}
