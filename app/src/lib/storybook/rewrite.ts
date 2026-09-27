import { posix } from "node:path";

/**
 * Storybook's own files refer to each other by relative path, so a build works
 * from any folder. A project's files often do not: its CSS says
 * url(/fonts/x.woff2) and its fixtures say "/avatar.jpg", meaning the root of
 * the site the build was made for. Under /sb/<cap>/<build>/ those miss.
 *
 * So when a build arrives, each root-relative reference to a file that is in
 * the build is made relative. A reference to anything else is left alone: it
 * might be an app route, and changing it would be guessing.
 */

export type Exists = (path: string) => boolean;

/** "/fonts/a b.woff2?v=2#x" -> the build path it names, and what followed it. */
function target(ref: string, exists: Exists): { path: string; suffix: string } | null {
  if (!ref.startsWith("/") || ref.startsWith("//")) return null;
  const cut = ref.search(/[?#]/);
  const bare = cut < 0 ? ref : ref.slice(0, cut);
  const suffix = cut < 0 ? "" : ref.slice(cut);
  let path: string;
  try {
    path = decodeURI(bare).slice(1);
  } catch {
    return null;
  }
  if (!path || path.split("/").some((p) => p === ".." || p === ".")) return null;
  return exists(path) ? { path: bare.slice(1), suffix } : null;
}

function relativeFrom(file: string, path: string): string {
  const rel = posix.relative(posix.dirname(file), path);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/*
 * The patterns below are written so they cannot backtrack: each run of
 * characters is taken greedily and never given back, and whatever must follow
 * it is checked afterwards in code. An uploaded file is untrusted, and a
 * pattern that retries at every position could hold the server for minutes.
 */
const MAX_REF = 400;

export interface Rewritten {
  text: string;
  count: number;
}

/** url(/x) in a stylesheet, relative to the stylesheet. */
export function rewriteCss(css: string, file: string, exists: Exists): Rewritten {
  let count = 0;
  const text = css.replace(/url\((["']?)(\/[^"')\s]*)(["']?)(\)?)/g, (whole, open: string, ref: string, close: string, paren: string) => {
    if (open !== close || !paren || ref.length > MAX_REF) return whole;
    const hit = target(ref, exists);
    if (!hit) return whole;
    count++;
    return `url(${open}${relativeFrom(file, hit.path)}${hit.suffix}${close})`;
  });
  return { text, count };
}

/**
 * A string literal "/x.ext" in a script, relative to the document: a path in
 * a string ends up as an img src or a fetch, and both resolve against the
 * page, which is iframe.html at the root of the build.
 */
export function rewriteJs(js: string, exists: Exists): Rewritten {
  let count = 0;
  const text = js.replace(/(["'`])(\/[A-Za-z0-9_@%][^"'`\s\\]*)(["'`]?)/g, (whole, open: string, ref: string, close: string) => {
    if (open !== close || ref.length > MAX_REF || !FILE_REF.test(ref)) return whole;
    const hit = target(ref, exists);
    if (!hit) return whole;
    count++;
    return `${open}./${hit.path}${hit.suffix}${close}`;
  });
  return { text, count };
}

/** A path ending in a file extension, with an optional query or fragment. */
const FILE_REF = /^[^?#]*\.[A-Za-z0-9]{1,8}(?:[?#].*)?$/;

/** src="/x" and href="/x" in an HTML file, and url(/x) in its inline styles. */
export function rewriteHtml(html: string, file: string, exists: Exists): Rewritten {
  let count = 0;
  let text = html.replace(/(\s(?:src|href)=)(["'])(\/[^"']*)(["']?)/gi, (whole, attr: string, quote: string, ref: string, close: string) => {
    if (quote !== close || ref.length > MAX_REF) return whole;
    const hit = target(ref, exists);
    if (!hit) return whole;
    count++;
    return `${attr}${quote}${relativeFrom(file, hit.path)}${hit.suffix}${close}`;
  });
  const css = rewriteCss(text, file, exists);
  text = css.text;
  count += css.count;
  return { text, count };
}

export function rewriteFile(path: string, contents: string, exists: Exists): Rewritten | null {
  const ext = posix.extname(path).toLowerCase();
  if (ext === ".css") return rewriteCss(contents, path, exists);
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return rewriteJs(contents, exists);
  if (ext === ".html" || ext === ".htm") return rewriteHtml(contents, path, exists);
  return null;
}
