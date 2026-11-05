import assert from "node:assert/strict";
import test from "node:test";
import {
  localVerificationStages,
  runLocalVerification,
  verificationEnvironment,
} from "./verify-local.mjs";

test("local gate includes API, browser and both actual launcher modes", () => {
  assert.deepEqual(
    localVerificationStages.map((s) => s.name),
    [
      "prerequisites",
      "isolated-api-build-and-recovery",
      "synthetic-browser-and-accessibility",
      "disposable-launcher",
      "durable-local-restart",
    ],
  );
});
test("local gate discards inherited databases and provider credentials", () => {
  const env = verificationEnvironment(
    {
      PATH: "/tools",
      DATABASE_URL: "valuable",
      REVIEWFLOW_ISOLATED_READY: "1",
      REVIEWFLOW_TEST_PGPORT: "5432",
      CLERK_SECRET_KEY: "secret",
      JEV_API_KEY: "secret",
      TYPESAFE_API_KEY: "synthetic-credential-must-not-reach-tests",
      OPENAI_API_KEY: "secret",
      UNKNOWN_PROVIDER_TOKEN: "synthetic-credential-must-not-reach-tests",
      NODE_OPTIONS: "--require=/untrusted-module",
      VITE_CLERK_PUBLISHABLE_KEY: "other",
      SESSION_SECRET: "secret",
      REVIEWFLOW_CHROMIUM_PATH: "/browser",
      REVIEWFLOW_PUBLIC_LISTEN: "true",
    },
    "/tmp/check",
  );
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.REVIEWFLOW_ISOLATED_READY, undefined);
  assert.equal(env.REVIEWFLOW_TEST_PGPORT, undefined);
  assert.equal(env.CLERK_SECRET_KEY, undefined);
  assert.equal(env.JEV_API_KEY, undefined);
  assert.equal(env.TYPESAFE_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.UNKNOWN_PROVIDER_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.VITE_CLERK_PUBLISHABLE_KEY, undefined);
  assert.equal(env.SESSION_SECRET, undefined);
  assert.equal(env.REVIEWFLOW_CHROMIUM_PATH, "/browser");
  assert.equal(env.REVIEWFLOW_PUBLIC_LISTEN, "false");
  assert.equal(env.APP_MODE, "demo");
  assert.equal(env.LIVE_INFERENCE_ENABLED, "false");
});
test("failure is not reported as complete coverage and later stages do not execute", () => {
  const calls = [];
  const result = runLocalVerification({
    root: "/source",
    folder: "/report",
    source: {},
    runner(command, args) {
      calls.push([command, args]);
      return { status: calls.length === 2 ? 1 : 0 };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.stages.map((s) => s.status),
    ["passed", "failed", "not-run", "not-run", "not-run"],
  );
});
test("all stages must pass and exact revision is retained only when supplied", () => {
  const revision = "a".repeat(40);
  const result = runLocalVerification({
    root: "/source",
    folder: "/report",
    source: { REVIEWFLOW_SOURCE_REVISION: revision },
    runner: () => ({ status: 0 }),
  });
  assert.equal(result.status, "passed");
  assert.equal(result.stages.length, 5);
  assert.equal(result.revision, revision);
});
