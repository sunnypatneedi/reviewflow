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
attachCollaboration(server, app.locals.runtimeConfig);
server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
