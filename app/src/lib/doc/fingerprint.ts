import type { JSONContent } from "@tiptap/core";
import { ORIGIN_ATTRS } from "./schema";

const ORIGIN = new Set<string>(ORIGIN_ATTRS);

/** Attributes that are filled in for display and are not part of what was written. */
const DERIVED = new Set(["html", "embedId"]);

/** The block's content with origin and display attributes left out, in a stable order. */
function canonical(node: JSONContent, top: boolean): unknown {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if ((top && ORIGIN.has(key)) || DERIVED.has(key)) continue;
    attrs[key] = value;
  }
  return [node.type, attrs, node.text ?? null, node.marks ?? null, (node.content ?? []).map((c) => canonical(c, false))];
}

/**
 * A short hash of what a top-level block contains. A block whose fingerprint
 * still matches the one taken when it was parsed is written back as its
 * original source; FNV-1a over the canonical JSON is plenty for that.
 */
export function fingerprint(node: JSONContent): string {
  const text = JSON.stringify(canonical(node, true));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${text.length}`;
}
