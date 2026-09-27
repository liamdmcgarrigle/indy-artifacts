import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  allowedDevOrigins: ["agentbox", "agentbox.taila42e4e.ts.net", "100.100.43.42", "127.0.0.1", "localhost"],
  serverExternalPackages: ["esbuild", "esbuild-svelte", "svelte", "sharp"],
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
    const open = [{ key: "access-control-allow-origin", value: "*" }];
    return [
      { source: "/primitives/:file*", headers: open },
      { source: "/vendor/:file*", headers: open },
      { source: "/fonts/:file*", headers: open },
      { source: "/themes/:file*", headers: open },
      // The consent page decides who gets access; nobody may frame it.
      { source: "/oauth/:path*", headers: [{ key: "x-frame-options", value: "DENY" }, { key: "content-security-policy", value: "frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
