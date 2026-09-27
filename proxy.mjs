/**
 * One public port for the whole of Indy.
 *
 * Next and the document server each listen on loopback. This forwards the
 * /collab websocket to the document server and everything else to Next, so an
 * install needs one port, one TLS certificate and one address. The document
 * server's HTTP endpoints are for the app alone and are not reachable here.
 */
import http from "node:http";
import net from "node:net";

const COLLAB_PREFIX = "/collab";

/** Plain HTTP to /collab is the document server's internal API: never from outside. */
function isCollab(url) {
  return url === COLLAB_PREFIX || url.startsWith(`${COLLAB_PREFIX}/`) || url.startsWith(`${COLLAB_PREFIX}?`);
}

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
  // The host is the one the request was sent to; a client-supplied header
  // naming another would otherwise steer the addresses Indy hands out.
  if (headers.host) headers["x-forwarded-host"] = headers.host;
  if (!headers["x-forwarded-proto"]) headers["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
  return headers;
}

/** Headers that describe one connection, not the request, and must not be passed on. */
const HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"];
function withoutHopHeaders(headers) {
  const out = { ...headers };
  for (const name of HOP) delete out[name];
  return out;
}

export function startProxy({ port, host = "0.0.0.0", appPort, collabPort, log = console.log }) {
  const ports = { app: appPort, collab: collabPort };

  const server = http.createServer((req, res) => {
    if (isCollab(req.url ?? "/")) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }
    const { port: to, path } = target(req.url ?? "/", ports);
    let reply = null;
    const upstream = http.request(
      // A fresh loopback connection per request. Reusing one after a streamed
      // (event-stream) response let the next request land on a socket Next had
      // finished with, and it came back as an empty 400.
      { host: "127.0.0.1", port: to, method: req.method, path, headers: withoutHopHeaders(forwardedHeaders(req)), agent: false },
      (answer) => {
        reply = answer;
        // The loopback hop closes after each request; the client's connection
        // to us should not, so its hop headers stay here.
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, withoutHopHeaders(answer.headers));
        answer.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("Indy is starting up. Try again in a moment.");
      } else res.destroy(err);
    });
    // When the browser goes away, so does the request to Next. Otherwise a
    // closed tab's live-update stream keeps running there indefinitely.
    res.on("close", () => {
      if (!res.writableFinished) {
        upstream.destroy();
        reply?.destroy();
      }
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

  // A request Node cannot parse never reaches a handler; say why instead of
  // answering an empty 400.
  server.on("clientError", (err, socket) => {
    log(`[indy] rejected a malformed request: ${err.code ?? ""} ${err.message}`);
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
  });

  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 0;
  server.listen(port, host, () => log(`[indy] listening on ${host}:${port} (app ${appPort}, documents ${collabPort})`));
  return server;
}
