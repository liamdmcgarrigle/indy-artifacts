/**
 * Builds the HTML documents served into sandboxed iframes.
 *
 * Every frame is loaded with sandbox="allow-scripts" and WITHOUT
 * allow-same-origin, so it runs on an opaque origin: no cookies, no storage, no
 * access to the page around it, and no credentialed requests. The CSP below is
 * sent as a header and repeated as a meta tag so a same-document navigation
 * cannot shed it. connect-src 'none' means artifact code cannot call out.
 */

export const EMBED_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join("; ");

export function embedHeaders(): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": EMBED_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmbedOptions {
  theme: string;
  scheme: "light" | "dark";
  title: string;
}

function head(options: EmbedOptions, extra = ""): string {
  return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(EMBED_CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="/themes/${encodeURIComponent(options.theme)}.css">
<link rel="stylesheet" href="/primitives/primitives.css">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { color: var(--art-text); font-family: var(--art-font-sans); font-size: var(--art-font-size); }
  #root { padding: 0; }
  .art-embed-error { border: 1px solid var(--art-bad); background: var(--art-bad-wash); color: var(--art-bad);
    border-radius: var(--art-radius); padding: 12px 14px; font-family: var(--art-font-mono); font-size: 13px;
    white-space: pre-wrap; }
</style>${extra}`;
}

function shell(options: EmbedOptions, bodyHtml: string, scripts: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en" data-scheme="${options.scheme}">
<head>
${head(options, extraHead)}
</head>
<body>
${bodyHtml}
<script src="/embed-bridge.js"></script>
${scripts}
</body>
</html>`;
}

/** A mermaid diagram. mermaid is vendored locally; sandbox frames have no network. */
export function mermaidDocument(source: string, options: EmbedOptions): string {
  return shell(
    options,
    `<div id="root"><pre class="mermaid">${escapeHtml(source)}</pre></div>`,
    `<script src="/vendor/mermaid.js"></script>
<script>
  (function () {
    try {
      var dark = document.documentElement.getAttribute("data-scheme") === "dark";
      window.mermaid.initialize({
        startOnLoad: true,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        fontFamily: getComputedStyle(document.body).fontFamily,
      });
    } catch (err) {
      document.getElementById("root").innerHTML =
        '<div class="art-embed-error">mermaid failed: ' + String(err && err.message ? err.message : err) + "</div>";
    }
  })();
</script>`,
  );
}

/** A raw HTML fragment from a ```html fence. */
export function htmlFragmentDocument(fragment: string, options: EmbedOptions): string {
  return shell(options, `<div id="root">${fragment}</div>`, "");
}

/** A whole-page html artifact: the agent's own document, with our CSP and bridge added. */
export function htmlPageDocument(source: string, options: EmbedOptions): string {
  const injection = `${head(options)}`;
  const bridge = `<script src="/embed-bridge.js"></script>`;

  let out = source;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, (m) => `${m}\n${injection}\n`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, (m) => `${m}\n<head>\n${injection}\n</head>\n`);
  } else {
    out = `<!doctype html>\n<html lang="en" data-scheme="${options.scheme}">\n<head>\n${injection}\n</head>\n<body>\n${out}\n</body>\n</html>`;
  }
  if (!/<html[^>]*data-scheme=/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1 data-scheme="${options.scheme}">`);
  }
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${bridge}\n</body>`) : `${out}\n${bridge}`;
  return out;
}

/** A compiled react or svelte artifact. */
export function bundleDocument(
  options: EmbedOptions & { bundleUrl: string; cssUrl: string | null },
): string {
  const css = options.cssUrl ? `\n<link rel="stylesheet" href="${escapeHtml(options.cssUrl)}">` : "";
  return shell(
    options,
    `<div id="root"></div>`,
    `<script type="module" src="/primitives/primitives.js"></script>
<script type="module" src="${escapeHtml(options.bundleUrl)}"></script>`,
    css,
  );
}

export function errorDocument(message: string, options: EmbedOptions): string {
  return shell(options, `<div id="root"><div class="art-embed-error">${escapeHtml(message)}</div></div>`, "");
}
