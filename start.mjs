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

const PORT = Number(process.env.PORT || 1936);
const APP_PORT = Number(process.env.INDY_APP_PORT || 3100);
const COLLAB_PORT = Number(process.env.COLLAB_PORT || 3101);
const APP_ENTRY = process.env.INDY_APP_ENTRY || "/app/app/server.js";
const COLLAB_ENTRY = process.env.INDY_COLLAB_ENTRY || "/app/collab/server.mjs";

const children = new Map();
let proxy = null;
let stopping = false;

/** Resolves when the child has exited, killing it outright once `ms` have passed. */
function exited(child, ms) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Shut down in order, inside Docker's ten-second grace period: stop taking
 * requests, then stop the document server while the app is still up, so it
 * can save open documents and hand its last edits to the app as versions,
 * then stop the app.
 */
async function stop(code) {
  if (stopping) return;
  stopping = true;
  const deadline = Date.now() + 8000;
  proxy?.close();
  for (const name of ["documents", "app"]) {
    const child = children.get(name);
    if (!child) continue;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited(child, Math.max(500, deadline - Date.now()));
  }
  process.exit(code);
}

function run(name, args, env) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code, signal) => {
    console.log(`[indy] ${name} exited (code ${code}, signal ${signal})`);
    void stop(code ?? 1);
  });
  children.set(name, child);
}

process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

const shared = {
  COLLAB_PORT: String(COLLAB_PORT),
  INDY_COLLAB_URL: `http://127.0.0.1:${COLLAB_PORT}`,
  INDY_APP_URL: `http://127.0.0.1:${APP_PORT}`,
};
run("app", [APP_ENTRY], { ...shared, PORT: String(APP_PORT), HOSTNAME: "127.0.0.1" });
run("documents", [COLLAB_ENTRY], shared);
proxy = startProxy({ port: PORT, appPort: APP_PORT, collabPort: COLLAB_PORT });
