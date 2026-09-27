import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// A hash of the primitives, put in their addresses so a browser never runs a
// copy from before an upgrade. Read when Next builds or starts, after the
// vendor script has copied them into public/.
function primitivesVersion(): string {
  const hash = createHash("sha256");
  for (const file of ["primitives.js", "primitives.css"]) {
    try {
      hash.update(readFileSync(new URL(`./public/primitives/${file}`, import.meta.url)));
    } catch {
      return "";
    }
  }
  return hash.digest("hex").slice(0, 10);
}

// Hosts other than localhost that may load the dev server, comma separated.
const devOrigins = (process.env.INDY_DEV_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  allowedDevOrigins: ["127.0.0.1", "localhost", ...devOrigins],
  serverExternalPackages: ["esbuild", "esbuild-svelte", "svelte", "sharp"],
  env: { INDY_PRIMITIVES_VERSION: primitivesVersion() },
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    // OAuth discovery for MCP clients (RFC 8414 and RFC 9728). Clients try the
    // bare path and the path with the resource appended, so both answer.
    return {
      beforeFiles: [
        { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
        { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
        { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata" },
        { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/resource" },
        { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    // Sandboxed frames run on an opaque origin, so anything they fetch with
    // CORS semantics (module scripts, fonts) needs an explicit allow header.
    // Without it a compiled artifact renders as a blank frame and the only
    // clue is a console message no one is looking at.
    // They change only with a new release, so a browser may keep them for a
    // while; the 5 MB diagram library is fetched once, not per diagram.
    const open = [
      { key: "access-control-allow-origin", value: "*" },
      { key: "cache-control", value: "public, max-age=3600, stale-while-revalidate=604800" },
    ];
    return [
      { source: "/primitives/:file*", headers: open },
      { source: "/vendor/:file*", headers: open },
      { source: "/fonts/:file*", headers: open },
      // Indy's own pages may only be framed by Indy. The artifact frames under
      // /embed, /api and /sb (Storybook builds) set their own, stricter policy.
      {
        source: "/((?!embed/|api/|sb/).*)",
        headers: [
          { key: "x-frame-options", value: "SAMEORIGIN" },
          // style-src keeps a stylesheet from anywhere else out of Indy's own
          // pages: theme CSS is generated from settings an agent can change.
          { key: "content-security-policy", value: "frame-ancestors 'self'; style-src 'self' 'unsafe-inline'" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "same-origin" },
        ],
      },
      // The consent page decides who gets access; nobody may frame it.
      { source: "/oauth/:path*", headers: [{ key: "x-frame-options", value: "DENY" }, { key: "content-security-policy", value: "frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
