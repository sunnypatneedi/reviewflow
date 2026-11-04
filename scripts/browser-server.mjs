// Test fixture only. Never imported by the production entry point.
import { createRequire } from "node:module";
import { createServer } from "node:http";
if (
  process.env.REVIEWFLOW_BROWSER_SYNTHETIC !== "1" ||
  process.env.REVIEWFLOW_ISOLATED_READY !== "1"
)
  throw new Error("Synthetic isolated browser harness required");
await import("./assert-isolated-database.mjs");
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const express = require("express"),
  cookieParser = require("cookie-parser");
const { attachCollaboration } =
  await import("../artifacts/api-server/src/lib/collaboration.ts");
const {
  requestPrivacy,
  requestBudget,
  requestCapacity,
  requireConfiguredIdentity,
  privateErrors,
} = await import("../artifacts/api-server/src/middlewares/launchSecurity.ts");
const { protectCredentialedWrites } =
  await import("../artifacts/api-server/src/middlewares/requestSecurity.ts");
const app = express();
app.use(requestPrivacy);
app.use(requestCapacity(32));
app.use(requestBudget(600));
app.use(cookieParser("synthetic-browser-only"));
app.locals.runtimeConfig = {
  appMode: "clerk",
  liveInferenceEnabled: false,
  trustedOrigins: new Set(["http://127.0.0.1:5290"]),
  demoProjectCap: 1000,
  demoProjectCreationWindowMax: 1000,
  demoProjectCreationWindowSeconds: 60,
};
app.use((req, _res, next) => {
  const auth = () => ({
    userId: req.get("x-synthetic-user") ?? null,
    tokenType: "session_token",
  });
  Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
  req.auth = auth;
  next();
});
app.use("/api/reviewflow", requireConfiguredIdentity("clerk"));
app.use(protectCredentialedWrites(app.locals.runtimeConfig));
app.use(express.json());
app.use((req, res, next) => {
  if (req.body?.mode === "live" || req.body?.provider === "jev")
    return res
      .status(403)
      .json({ error: "This synthetic harness prohibits live inference" });
  next();
});
app.use(
  "/api",
  (await import("../artifacts/api-server/src/routes/reviewflow.ts")).default,
);
app.use(privateErrors);
const server = createServer(app);
attachCollaboration(server, app.locals.runtimeConfig);
server.listen(5291, "127.0.0.1");
