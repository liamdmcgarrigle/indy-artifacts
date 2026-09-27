import type { Artifact } from "./types";

/**
 * Who would hear the operator press "Send to agent" right now.
 *
 * Nothing here is stored: it is what this server process has seen in the last
 * moments. An agent in artifact_wait is listening, and so is one that has just
 * come out of a wait, since agents call it again in a loop. Orca's forwarder
 * long-polls the events feed; a page published with a terminal handle reaches
 * that terminal while the feed is being polled.
 */

export type Listener = "waiting" | "terminal" | "terminal-offline" | "none";

/** A wait that ended this recently is taken as one that is about to start again. */
const WAIT_GRACE_MS = 15_000;
/** The feed is long-polled for up to 50 seconds, so a gap longer than this means nobody is polling. */
const FEED_GRACE_MS = 90_000;

interface State {
  waits: Map<string, { open: number; lastAt: number }>;
  feedAt: number;
}

// One registry per process, whichever copy of this module a route loaded.
const state: State = ((globalThis as { __indyListeners?: State }).__indyListeners ??= { waits: new Map(), feedAt: 0 });

export function beginWait(slug: string): () => void {
  const entry = state.waits.get(slug) ?? { open: 0, lastAt: 0 };
  entry.open++;
  entry.lastAt = Date.now();
  state.waits.set(slug, entry);
  return () => {
    entry.open = Math.max(0, entry.open - 1);
    entry.lastAt = Date.now();
  };
}

export function feedPolled(): void {
  state.feedAt = Date.now();
}

export function listenerFor(artifact: Pick<Artifact, "slug" | "terminalHandle">, now = Date.now()): Listener {
  const wait = state.waits.get(artifact.slug);
  if (wait && (wait.open > 0 || now - wait.lastAt < WAIT_GRACE_MS)) return "waiting";
  if (artifact.terminalHandle) return now - state.feedAt < FEED_GRACE_MS ? "terminal" : "terminal-offline";
  return "none";
}
