import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { findArtifact, requireArtifact } from "@/lib/service/artifacts";
import { fail } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** A cheap fingerprint of everything the viewer would want to redraw for. */
function stamp(slug: string): string {
  const ctx = getContext();
  const artifact = findArtifact(ctx, slug);
  if (!artifact) return "gone";
  const row = ctx.db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS at FROM comments WHERE artifact_id = ?")
    .get(artifact.id) as { n: number; at: string };
  return `${artifact.currentVersion}:${row.n}:${row.at}`;
}

/**
 * Server-sent events for one artifact, so a page open on the operator's screen
 * follows what an agent is doing to it instead of going stale until a reload.
 *
 * Polling the database beats a bus here: the server is one process, the query
 * is two indexed reads, and a dropped connection cannot leave a subscriber
 * wedged.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    requireArtifact(getContext(), slug);

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        let last = stamp(slug);
        let ticks = 0;
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send("hello", { stamp: last });

        const stop = () => {
          if (timer) clearInterval(timer);
          timer = null;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        timer = setInterval(() => {
          try {
            const now = stamp(slug);
            if (now !== last) {
              last = now;
              const [version] = now.split(":");
              send("changed", { stamp: now, version: Number(version) });
            } else if (++ticks % 20 === 0) {
              // Proxies drop a silent stream, so say something now and then.
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }
          } catch {
            stop();
          }
        }, 1000);

        request.signal.addEventListener("abort", stop);
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
