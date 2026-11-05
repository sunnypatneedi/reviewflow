import { pool } from "@workspace/db";
import { createReadiness } from "./lib/readiness";
import {
  requestBudget,
  requestCapacity,
  requestPrivacy,
  requireConfiguredIdentity,
  privateErrors,
} from "./middlewares/launchSecurity";
import express, { type Express, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
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
app.disable("x-powered-by");
app.use(requestPrivacy);
const budget = requestBudget(config.apiRequestsPerMinute);
const capacity = requestCapacity(32);
app.use("/api", (req, res, next) =>
  ["/healthz", "/readyz"].includes(req.path)
    ? next()
    : capacity(req, res, next),
);
app.use("/api", (req, res, next) =>
  ["/healthz", "/readyz"].includes(req.path) ? next() : budget(req, res, next),
);

app.use(
  pinoHttp({
    logger,
    genReqId: (_req, res) => (res as Response).locals.requestId,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          routeGroup: req.url?.startsWith("/api/reviewflow")
            ? "/api/reviewflow"
            : req.url?.startsWith("/api/")
              ? "/api"
              : "/",
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
if (config.appMode === "clerk" && config.clerkProxyOrigin) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware(config.clerkProxyOrigin));
}
app.use(cors({ credentials: true, origin: corsOrigin(config.trustedOrigins) }));
app.use(cookieParser(config.sessionSecret));
if (config.appMode === "clerk") {
  app.use(
    "/api/reviewflow",
    clerkMiddleware({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      authorizedParties: [...config.trustedOrigins],
    }),
  );
} else {
  app.use(demoSignedOutAuth());
}
app.use("/api/reviewflow", requireConfiguredIdentity(config.appMode));
app.use(protectCredentialedWrites(config));
app.use("/api/reviewflow/traces", express.json({ limit: "8mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(enforceLiveInference(config));

const ready = createReadiness(() => {
  const probe = {
    text: [
      "SELECT id, exposure_tracking_enabled, release_audit_policy_version FROM rf_projects LIMIT 0",
      "SELECT id, user_id, role, revision FROM rf_memberships LIMIT 0",
      "SELECT id FROM rf_rubric_versions LIMIT 0",
      "SELECT id, revision, hash, definition FROM rf_rubric_specs LIMIT 0",
      "SELECT id, content_hash, version, state FROM rf_rubric_items LIMIT 0",
      "SELECT id, kind, payload FROM rf_rubric_records LIMIT 0",
      "SELECT event_id, delivered_at FROM rf_telemetry_outbox LIMIT 0",
      "SELECT event_id, projected_at FROM rf_telemetry_projection LIMIT 0",
      "SELECT event_id, session_id, sequence, visible_ms FROM rf_browser_telemetry LIMIT 0",
      "SELECT id, content_hash, version, current_evaluation_id, current_proposal_id FROM rf_tasks LIMIT 0",
      "SELECT id, status, lease_owner, lease_expires_at, evaluation_id, evaluation_identity FROM rf_jobs LIMIT 0",
      "SELECT id, raw_response, evaluation_id, evaluation_identity FROM rf_proposals LIMIT 0",
      "SELECT id FROM rf_reviews LIMIT 0",
      "SELECT id, sampling_frame_hash FROM rf_audits LIMIT 0",
      "SELECT id FROM rf_audit_items LIMIT 0",
      "SELECT id, resolved_label FROM rf_audit_disputes LIMIT 0",
      "SELECT id, auditor_id FROM rf_audit_decisions LIMIT 0",
      "SELECT id, digest, jsonl FROM rf_releases LIMIT 0",
      "SELECT id FROM rf_events LIMIT 0",
      "SELECT id, revision, definition FROM rf_factory_policies LIMIT 0",
      "SELECT id, quarantined, claim_token FROM rf_factory_items LIMIT 0",
      "SELECT id, kind, key, payload FROM rf_trace_records LIMIT 0",
      "SELECT id, content_hash FROM rf_exposures LIMIT 0",
      "SELECT project_id, enabled, max_calls FROM rf_jev_controls LIMIT 0",
      "SELECT id, status FROM rf_jev_calls LIMIT 0",
      "SELECT project_id, task_id, state, revision FROM rf_shared_notes LIMIT 0",
    ].join(";"),
    query_timeout: 500,
  };
  return pool.query(probe);
});
app.get("/api/readyz", async (_req, res) => {
  const ok = !app.locals.draining && (await ready());
  res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "unavailable" });
});
app.use("/api", router);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Not found", requestId: res.locals.requestId }),
);
app.use(privateErrors);

export default app;
