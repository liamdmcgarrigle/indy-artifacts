/**
 * One public port for the whole of Indy.
 *
 * Next and the document server each listen on loopback. This forwards
 * /collab (the websocket and the document server's own HTTP endpoints) to the
 * document server and everything else to Next, so an install needs one port,
 * one TLS certificate and one address.
 */
import http from "node:http";
import net from "node:net";

const COLLAB_PREFIX = "/collab";

function target(url, ports) {
  if (url === COLLAB_PREFIX || url.startsWith(`${COLLAB_PREFIX}/`) || url.startsWith(`${COLLAB_PREFIX}?`)) {
    return { port: ports.collab, path: url.slice(COLLAB_PREFIX.length) || "/" };
  }
  return { port: ports.app, path: url };
}

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  const remote = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${remote}` : remote;
  if (!headers["x-forwarded-host"] && headers.host) headers["x-forwarded-host"] = headers.host;
  if (!headers["x-forwarded-proto"]) headers["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
  return headers;
}

export function startProxy({ port, host = "0.0.0.0", appPort, collabPort, log = console.log }) {
  const ports = { app: appPort, collab: collabPort };

  const server = http.createServer((req, res) => {
    const { port: to, path } = target(req.url ?? "/", ports);
    const upstream = http.request(
      { host: "127.0.0.1", port: to, method: req.method, path, headers: forwardedHeaders(req) },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.statusMessage, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(to === ports.collab ? "The document server is not answering." : "Indy is starting up. Try again in a moment.");
      } else res.destroy(err);
    });
    // Server-sent events and long polls must not be buffered or timed out here.
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    const { port: to, path } = target(req.url ?? "/", ports);
    const upstream = net.connect(to, "127.0.0.1", () => {
      const headers = forwardedHeaders(req);
      const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`];
      for (const [key, value] of Object.entries(headers)) {
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
  });

  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 0;
  server.listen(port, host, () => log(`[indy] listening on ${host}:${port} (app ${appPort}, documents ${collabPort})`));
  return server;
}
