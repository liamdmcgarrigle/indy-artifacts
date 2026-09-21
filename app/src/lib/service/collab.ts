/**
 * Keeping the live document honest.
 *
 * A version written through the API or MCP does not go through the document
 * server, so the shared copy it holds would still carry the old text and the
 * next editor to open the page would save it back over the new version. Every
 * version written outside the live path tells the document server to reset.
 *
 * Fire and forget by design: publishing must not fail because the document
 * server is restarting, and a reset that misses is repaired the next time the
 * document is loaded cold.
 */
function collabUrl(): string {
  return process.env.ARTIFACTS_COLLAB_URL || `http://127.0.0.1:${process.env.COLLAB_PORT || 5175}`;
}

export function resetLiveDocument(slug: string, text: string | null): void {
  if (text === null) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  void fetch(`${collabUrl()}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, text }),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
