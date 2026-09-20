import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  allowedDevOrigins: ["agentbox", "agentbox.taila42e4e.ts.net", "100.100.43.42"],
  serverExternalPackages: ["esbuild", "esbuild-svelte", "svelte"],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
