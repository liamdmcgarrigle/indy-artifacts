import { parseDocument } from "yaml";

/**
 * Change keys in a page's frontmatter lines (delimiters included), keeping
 * every other key, comment and its order as written. A null drops the key.
 */
export function withFront(front: string[] | null, patch: Record<string, string | null>): string[] {
  const body = front && front.length >= 2 ? front.slice(1, -1).join("\n") : "";
  const doc = parseDocument(body);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  }
  const text = doc.contents === null ? "" : doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
  return ["---", ...(text && text !== "{}" ? text.split("\n") : []), "---"];
}
