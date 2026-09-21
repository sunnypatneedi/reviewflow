import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { loadRuntimeConfig } from "./config/runtime";
import {
  corsOrigin,
  demoSignedOutAuth,
  enforceLiveInference,
  protectCredentialedWrites,
} from "./middlewares/requestSecurity";

const app: Express = express();
const config = loadRuntimeConfig(process.env);
app.locals.runtimeConfig = config;

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (config.appMode === "clerk") {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(cors({ credentials: true, origin: corsOrigin(config.trustedOrigins) }));
app.use(cookieParser(config.sessionSecret));
app.use("/api/reviewflow/traces", express.json({ limit: "8mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (config.appMode === "clerk") {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
} else {
  app.use(demoSignedOutAuth());
}
app.use(protectCredentialedWrites(config));
app.use(enforceLiveInference(config));

app.use("/api", router);

export default app;
