/**
 * Container entrypoint: the app and the document server in one process tree.
 *
 * They are two processes because the document server is a websocket server with
 * its own lifecycle, and one container because the document server calls the
 * app over HTTP and container to container name resolution is not dependable
 * on this host. If either exits, the container exits, so the supervisor
 * restarts a healthy pair rather than leaving half a system running.
 */
import { spawn } from "node:child_process";

const children = [];

function run(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    console.log(`[start] ${name} exited (code ${code}, signal ${signal})`);
    stop(code ?? 1);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

run("app", ["/app/app/server.js"]);
if (process.env.ARTIFACTS_COLLAB_PORT !== "off") {
  run("collab", ["/collab/server.mjs"], {
    ARTIFACTS_APP_URL: process.env.ARTIFACTS_APP_URL || `http://127.0.0.1:${process.env.PORT || 5174}`,
  });
}
