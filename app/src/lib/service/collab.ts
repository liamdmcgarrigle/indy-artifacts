/**
 * Keeping the live document honest.
 *
 * A version written through the API or MCP does not go through the document
 * server, so the shared copy it holds would still carry the old text and the
 * next editor to open the page would save it back over the new version. Every
 * version written outside the live path tells the document server to reset.
 *
 * Fire and forget by design: publishing must not fail because the document
 * server is restarting. A reset that misses is repaired when the document is
 * next loaded, because the document server reseeds any copy made from an
 * older version, and refuses to snapshot one.
 */
import { config } from "../config";
import { internalKey } from "../auth/access";
import type { ServiceContext } from "./context";

function collabUrl(): string {
  return config().collabUrl;
}

export function resetLiveDocument(ctx: ServiceContext, slug: string, text: string | null, version: number): void {
  if (text === null) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  void fetch(`${collabUrl()}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-indy-internal": internalKey(ctx) },
    body: JSON.stringify({ slug, text, version }),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
