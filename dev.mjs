/**
 * Development: the same three parts as start.mjs, with Next in dev mode.
 *   PORT=5178 node dev.mjs
 */
import { spawn } from "node:child_process";
import { startProxy } from "./proxy.mjs";

const PORT = Number(process.env.PORT || 1936);
const APP_PORT = Number(process.env.INDY_APP_PORT || 3100);
const COLLAB_PORT = Number(process.env.COLLAB_PORT || 3101);
const shared = {
  COLLAB_PORT: String(COLLAB_PORT),
  INDY_COLLAB_URL: `http://127.0.0.1:${COLLAB_PORT}`,
  INDY_APP_URL: `http://127.0.0.1:${APP_PORT}`,
};

const children = [];
function run(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts, env: { ...process.env, ...shared, ...(opts?.env ?? {}) } });
  child.on("exit", (code) => {
    console.log(`[dev] ${args.join(" ")} exited (${code})`);
    for (const c of children) c.kill("SIGTERM");
    process.exit(code ?? 1);
  });
  children.push(child);
}

run("npx", ["next", "dev", "--port", String(APP_PORT), "--hostname", "127.0.0.1"], { cwd: "app" });
run(process.execPath, [process.env.INDY_COLLAB_ENTRY || "collab/server.mjs"]);
startProxy({ port: PORT, appPort: APP_PORT, collabPort: COLLAB_PORT });
process.on("SIGTERM", () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
});
