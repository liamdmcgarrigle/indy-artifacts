import { renderMarkdown, type RenderResult } from "../pipeline/index";
import type { Version } from "./types";

const cache = new Map<string, RenderResult>();
const MAX = 120;

/** Render a markdown version, memoised on its content hash. */
export function renderVersion(
  version: Pick<Version, "contentHash" | "source">,
  fallbackTitle = "Untitled",
  assetBase?: string,
): RenderResult {
  const key = `${version.contentHash}|${assetBase ?? ""}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = renderMarkdown(version.source ?? "", fallbackTitle, { assetBase });
  cache.set(key, result);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

export function clearRenderCache(): void {
  cache.clear();
}
