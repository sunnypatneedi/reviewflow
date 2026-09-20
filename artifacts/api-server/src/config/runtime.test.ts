import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig, resolveAppMode, resolveTrustedOrigins } from "./runtime";

test("mode defaults to demo without Clerk and preserves a complete Clerk configuration", () => {
  assert.equal(resolveAppMode({}), "demo");
  assert.equal(resolveAppMode({ CLERK_PUBLISHABLE_KEY: "pk", CLERK_SECRET_KEY: "sk" }), "clerk");
});

test("explicit modes and incomplete Clerk configuration fail closed", () => {
  assert.throws(() => resolveAppMode({ APP_MODE: "clerk" }), /requires Clerk/);
  assert.throws(() => resolveAppMode({ CLERK_SECRET_KEY: "sk" }), /incomplete/);
  assert.throws(() => resolveAppMode({ APP_MODE: "unsafe" }), /APP_MODE/);
});

test("trusted origins accept explicit origins and safely-derived Replit hosts", () => {
  const origins = resolveTrustedOrigins({
    NODE_ENV: "development",
    TRUSTED_ORIGINS: "https://example.test",
    REPLIT_DEV_DOMAIN: "safe-name.replit.dev",
    REPLIT_DOMAINS: "published.replit.app",
  });
  assert(origins.has("https://example.test"));
  assert(origins.has("https://safe-name.replit.dev"));
  assert(origins.has("https://published.replit.app"));
  assert(origins.has("http://localhost:5173"));
});

test("unsafe managed host values are ignored and malformed explicit origins are rejected", () => {
  const origins = resolveTrustedOrigins({ NODE_ENV: "production", REPLIT_DOMAINS: "good.replit.app,evil.test/path" });
  assert.deepEqual([...origins], ["https://good.replit.app"]);
  assert.throws(() => resolveTrustedOrigins({ TRUSTED_ORIGINS: "https://example.test/path" }), /Invalid trusted origin/);
});

test("live inference is off by default and production requires a session secret", () => {
  const defaults = loadRuntimeConfig({}, () => "ephemeral");
  assert.equal(defaults.liveInferenceEnabled, false);
  assert.equal(defaults.demoProjectCap, 100);
  assert.equal(defaults.demoProjectCreationWindowMax, 10);
  assert.equal(defaults.demoProjectCreationWindowSeconds, 60);
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: "production", APP_MODE: "demo" }), /SESSION_SECRET/);
  assert.throws(
    () => loadRuntimeConfig({ SESSION_SECRET: "secret", LIVE_INFERENCE_ENABLED: "yes" }),
    /LIVE_INFERENCE_ENABLED/,
  );
});

test("demo bootstrap limits accept only positive integer configuration", () => {
  const config = loadRuntimeConfig({
    DEMO_PROJECT_CAP: "25",
    DEMO_PROJECT_CREATION_WINDOW_MAX: "4",
    DEMO_PROJECT_CREATION_WINDOW_SECONDS: "30",
  }, () => "ephemeral");
  assert.equal(config.demoProjectCap, 25);
  assert.equal(config.demoProjectCreationWindowMax, 4);
  assert.equal(config.demoProjectCreationWindowSeconds, 30);
  assert.throws(() => loadRuntimeConfig({ DEMO_PROJECT_CAP: "0" }), /DEMO_PROJECT_CAP/);
  assert.throws(() => loadRuntimeConfig({ DEMO_PROJECT_CREATION_WINDOW_MAX: "1.5" }), /WINDOW_MAX/);
});
