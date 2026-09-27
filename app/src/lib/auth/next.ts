/**
 * Where to go after signing in: a path on this site and nothing else.
 * Browsers read `/\evil.com` and `/<tab>/evil.com` as another host, so the
 * value is resolved the way a browser would and must stay on this origin.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const base = "http://indy.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
