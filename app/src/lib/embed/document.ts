/**
 * Builds the HTML documents served into sandboxed iframes.
 *
 * Every frame is loaded with sandbox="allow-scripts allow-forms" and WITHOUT
 * allow-same-origin, so it runs on an opaque origin: no cookies, no storage, no
 * access to the page around it, and no credentialed requests. The CSP below is
 * sent as a header and repeated as a meta tag so a same-document navigation
 * cannot shed it. connect-src 'none' means artifact code cannot call out.
 * allow-forms only lets a form's submit event reach its script; form-action
 * 'none' still stops a form from being sent anywhere.
 */
import { primitivesUrl } from "../primitives";

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
  "sandbox allow-scripts allow-forms",
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
  /** The page theme's stylesheet, versioned: themeHref() in lib/service/themes. */
  themeHref: string;
  scheme: "light" | "dark";
  title: string;
}

function head(options: EmbedOptions, extra = ""): string {
  return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(EMBED_CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="darkreader-lock">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="${escapeHtml(options.themeHref)}">
<link rel="stylesheet" href="${primitivesUrl("primitives.css")}">
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

/**
 * mermaid theme variable -> the --art-* custom property it is read from.
 *
 * mermaid's own palette is a fixed lavender that belongs to no theme on this
 * box, and themeVariables take resolved values rather than custom properties.
 * So the frame reads the theme's tokens with getComputedStyle at run time and
 * hands mermaid the values. A token that resolves to nothing is left out, and
 * mermaid falls back to its own default: no colour is written here.
 *
 * theme: "base" is what makes themeVariables apply at all — the named themes
 * ignore most of them.
 */
export const MERMAID_THEME_TOKENS: Readonly<Record<string, string>> = {
  primaryColor: "--art-accent-wash",
  primaryTextColor: "--art-text",
  primaryBorderColor: "--art-accent",
  lineColor: "--art-text-muted",
  secondaryColor: "--art-surface-2",
  tertiaryColor: "--art-surface",
  background: "--art-surface",
  mainBkg: "--art-accent-wash",
  textColor: "--art-text",
  nodeBorder: "--art-accent",
  edgeLabelBackground: "--art-surface",
  clusterBkg: "--art-surface-2",
  clusterBorder: "--art-border",
  titleColor: "--art-text",
  fontFamily: "--art-font-sans",
  fontSize: "--art-font-size",
};

/* The rendered diagram fills the frame width and takes its height from the
   viewBox, so the frame has no blank margin under it to size around. The <pre>
   mermaid renders into keeps a browser default margin otherwise. */
const MERMAID_STYLE = `
<style>
  #root .mermaid { margin: 0; }
  #root .mermaid svg { display: block; width: 100%; max-width: 100%; height: auto; }
</style>`;

/** A mermaid diagram. mermaid is vendored locally; sandbox frames have no network. */
export function mermaidDocument(source: string, options: EmbedOptions): string {
  return shell(
    options,
    `<div id="root"><pre class="mermaid">${escapeHtml(source)}</pre></div>`,
    `<script src="/vendor/mermaid.js"></script>
<script>
  (function () {
    var root = document.getElementById("root");
    var TOKENS = ${JSON.stringify(MERMAID_THEME_TOKENS)};

    function fail(err) {
      root.innerHTML =
        '<div class="art-embed-error">mermaid failed: ' + String(err && err.message ? err.message : err) + "</div>";
    }

    // mermaid stamps the natural size onto the svg as width/height attributes
    // and an inline max-width. Left alone they hold the diagram at that size in
    // the top left of a wider frame, and they inflate the measured height.
    //
    // A wide diagram in a narrow column shrinks until the labels are specks, so
    // below about three quarters of natural size it keeps its size and the
    // frame scrolls sideways instead.
    function fit() {
      var svg = root.querySelector("svg");
      if (!svg) return;
      var box = svg.viewBox && svg.viewBox.baseVal;
      var natural = box && box.width ? box.width : 0;
      var available = root.clientWidth || document.documentElement.clientWidth;
      svg.removeAttribute("height");
      svg.style.height = "auto";

      // Small diagram: leave it at the size mermaid drew it. Stretching a
      // seven-node flowchart across the column blows the type up with it.
      if (!natural || !available || natural <= available) {
        svg.setAttribute("width", natural ? String(Math.round(natural)) : "100%");
        svg.style.maxWidth = "100%";
        return;
      }

      // Wider than the column: shrink to fit, unless that would make the
      // labels specks, in which case keep it legible and scroll sideways.
      if (available / natural >= 0.75) {
        svg.setAttribute("width", "100%");
        svg.style.maxWidth = "100%";
        return;
      }
      root.style.overflowX = "auto";
      svg.setAttribute("width", String(Math.round(natural)));
      svg.style.maxWidth = "none";
    }

    try {
      var css = getComputedStyle(document.documentElement);
      var vars = {};
      for (var key in TOKENS) {
        var value = (css.getPropertyValue(TOKENS[key]) || "").trim();
        if (value) vars[key] = value;
      }
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: vars,
        fontFamily: vars.fontFamily,
      });
      window.mermaid.run({ querySelector: ".mermaid" }).then(fit, fail);
    } catch (err) {
      fail(err);
    }
  })();
</script>`,
    MERMAID_STYLE,
  );
}

/* An html block sits in a bordered box on the page, so its content is inset
   from the edge the way a card's or a details block's is. The first and last
   child shed their outer margins so the inset is the same on every side. */
export const FRAGMENT_STYLE = `
<style>
  #root { padding: var(--art-space-3, 12px) var(--art-space-4, 16px); }
  #root > :first-child { margin-top: 0; }
  #root > :last-child { margin-bottom: 0; }
</style>`;

/** A raw HTML fragment from a ```html fence. */
export function htmlFragmentDocument(fragment: string, options: EmbedOptions): string {
  return shell(options, `<div id="root">${fragment}</div>`, "", FRAGMENT_STYLE);
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
    `<script type="module" src="${primitivesUrl("primitives.js")}"></script>
<script type="module" src="${escapeHtml(options.bundleUrl)}"></script>`,
    css,
  );
}

export function errorDocument(message: string, options: EmbedOptions): string {
  return shell(options, `<div id="root"><div class="art-embed-error">${escapeHtml(message)}</div></div>`, "");
}
