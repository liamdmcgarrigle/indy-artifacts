/**
 * Container entrypoint.
 *
 * Three parts in one process tree: Next on a loopback port, the document
 * server on another, and the proxy in this process on the public port. If a
 * child exits, everything exits, so the container restarts a whole system
 * rather than leaving half of one running.
 */
import { spawn } from "node:child_process";
import { startProxy } from "./proxy.mjs";

const PORT = Number(process.env.PORT || 5174);
const APP_PORT = Number(process.env.INDY_APP_PORT || 3100);
const COLLAB_PORT = Number(process.env.COLLAB_PORT || 3101);
const APP_ENTRY = process.env.INDY_APP_ENTRY || "/app/app/server.js";
const COLLAB_ENTRY = process.env.INDY_COLLAB_ENTRY || "/app/collab/server.mjs";

const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}

function run(name, args, env) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code, signal) => {
    console.log(`[indy] ${name} exited (code ${code}, signal ${signal})`);
    stop(code ?? 1);
  });
  children.push(child);
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

const shared = {
  COLLAB_PORT: String(COLLAB_PORT),
  INDY_COLLAB_URL: `http://127.0.0.1:${COLLAB_PORT}`,
  INDY_APP_URL: `http://127.0.0.1:${APP_PORT}`,
};
run("app", [APP_ENTRY], { ...shared, PORT: String(APP_PORT), HOSTNAME: "127.0.0.1" });
run("documents", [COLLAB_ENTRY], shared);
startProxy({ port: PORT, appPort: APP_PORT, collabPort: COLLAB_PORT });
