import { resolveListenHost } from "../../../scripts/listen-host.mjs";
import { pool } from "@workspace/db";
import { createServer } from "node:http";
import { logger } from "./lib/logger";
import { EvaluationWorker } from "./evaluation-worker";

const worker = new EvaluationWorker();
const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8099);
const healthServer = createServer((req, res) => {
  const ready = req.url === "/readyz" ? worker.ready() : true;
  res.writeHead(ready ? 200 : 503, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ ok: ready, service: "evaluation-worker" }));
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Evaluation worker stopping");
  worker.stop();
  setTimeout(() => process.exit(1), 25_000).unref();
  healthServer.close();
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

logger.info("Evaluation worker started");
healthServer.listen(port, resolveListenHost(process.env), () => {
  logger.info({ port }, "Evaluation worker health server listening");
  process.send?.({
    type: "listening",
    host: resolveListenHost(process.env),
    port,
  });
});
await worker.start();
await pool.end();
