import type { Kind } from "./types";

/**
 * The words of a markdown page without its syntax, for search. Directive
 * fences, attribute braces, table pipes and emphasis marks go; the words
 * inside them, and a chart's labels, stay.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\s*\n/, "")
    .replace(/^\s*(```|~~~).*$/gm, "")
    .replace(/^\s*:{2,}\s*[\w-]*\s*(\{[^}]*\})?\s*$/gm, (_m, attrs: string | undefined) =>
      attrs ? readableAttrs(attrs) : "",
    )
    .replace(/\{(?:tone|name|type|label|required)[^}]*\}/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/^\s*[-: ]{3,}\s*$/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** A directive's title and label read as words; tone, width and the like do not. */
function readableAttrs(attrs: string): string {
  const words: string[] = [];
  for (const m of attrs.matchAll(/\b(title|label|caption|alt)=(?:"([^"]*)"|(\S+?))(?=[\s}])/g)) words.push(m[2] ?? m[3]);
  return words.join(" ");
}

/** What search reads: a markdown page's words, raw HTML, or a compiled artifact's source files. */
export function searchableText(content: { source: string | null; files: Record<string, string> | null }, kind?: Kind): string {
  if (content.source !== null) return kind === "markdown" ? plainText(content.source) : content.source;
  if (!content.files) return "";
  return Object.values(content.files).join("\n").slice(0, 200_000);
}
