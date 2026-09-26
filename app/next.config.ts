import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  allowedDevOrigins: ["agentbox", "agentbox.taila42e4e.ts.net", "100.100.43.42", "127.0.0.1", "localhost"],
  serverExternalPackages: ["esbuild", "esbuild-svelte", "svelte", "sharp"],
  typescript: { ignoreBuildErrors: false },
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
    ];
  },
};

export default nextConfig;
