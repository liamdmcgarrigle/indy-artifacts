import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Most suites exercise the service, not sign-in, so they run as a trusted
    // local install. test/auth.test.ts switches this off for itself.
    env: { INDY_AUTH: "local" },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
