import { resolveListenHost } from "../../../scripts/listen-host.mjs";
import { pool } from "@workspace/db";
import { createServer } from "node:http";
import { attachCollaboration } from "./lib/collaboration";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
const sockets = attachCollaboration(server, app.locals.runtimeConfig);
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.maxRequestsPerSocket = 100;
let draining = false;
const shutdown = () => {
  if (draining) return;
  draining = true;
  app.locals.draining = true;
  for (const peer of sockets.clients) peer.close(1001, "Server restarting");
  setTimeout(() => {
    for (const peer of sockets.clients) peer.terminate();
  }, 1_000).unref();
  server.close(() => {
    void pool.end();
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 25_000).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
server.listen(port, resolveListenHost(process.env), () => {
  logger.info({ port }, "Server listening");
  process.send?.({
    type: "listening",
    host: resolveListenHost(process.env),
    port,
  });
});
