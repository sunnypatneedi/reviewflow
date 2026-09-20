import { createServer } from "node:http";
import { logger } from "./lib/logger";
import { EvaluationWorker } from "./evaluation-worker";

const worker = new EvaluationWorker();
const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8099);
const healthServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "evaluation-worker" }));
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Evaluation worker stopping");
  worker.stop();
  healthServer.close();
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

logger.info("Evaluation worker started");
healthServer.listen(port, () => logger.info({ port }, "Evaluation worker health server listening"));
await worker.start();