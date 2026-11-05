#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const localVerificationStages = [
  { name: "prerequisites", command: "node", args: ["scripts/doctor.mjs"] },
  {
    name: "isolated-api-build-and-recovery",
    command: "sh",
    args: ["scripts/verify-isolated.sh"],
  },
  {
    name: "synthetic-browser-and-accessibility",
    command: "sh",
    args: ["scripts/browser-isolated.sh"],
  },
  {
    name: "disposable-launcher",
    command: "node",
    args: ["scripts/demo-smoke.mjs"],
  },
  {
    name: "durable-local-restart",
    command: "node",
    args: ["scripts/local-workspace-smoke.mjs"],
  },
];

export function verificationEnvironment(source, folder) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (
      /^(?:DATABASE_URL|REVIEWFLOW_(?:MIGRATION|DISPOSABLE|ISOLATED|TEST_|E2E_|BASE_URL|PUBLIC_LISTEN|HOST)|CLERK_|VITE_CLERK_|JEV_|OPENAI_|SESSION_SECRET|LIVE_INFERENCE_ENABLED|APP_MODE|NODE_ENV|TRUSTED_ORIGINS|PORT$|WORKER_PORT$)/.test(
        name,
      )
    )
      delete env[name];
  }
  return {
    ...env,
    APP_MODE: "demo",
    LIVE_INFERENCE_ENABLED: "false",
    REVIEWFLOW_HOST: "127.0.0.1",
    REVIEWFLOW_PUBLIC_LISTEN: "false",
    REVIEWFLOW_SCREENSHOT_DIR: join(folder, "screenshots"),
  };
}

export function runLocalVerification({
  root,
  folder,
  source = process.env,
  runner = spawnSync,
}) {
  const startedAt = new Date().toISOString();
  const env = verificationEnvironment(source, folder);
  const stages = [];
  let failed = false;
  for (const stage of localVerificationStages) {
    if (failed) {
      stages.push({ name: stage.name, status: "not-run" });
      continue;
    }
    console.log(`\nReviewFlow local verification: ${stage.name}`);
    const start = performance.now();
    const result = runner(stage.command, stage.args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    const passed = !result.error && !result.signal && result.status === 0;
    stages.push({
      name: stage.name,
      status: passed ? "passed" : "failed",
      durationMs: Math.round(performance.now() - start),
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
    });
    failed = !passed;
  }
  return {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    revision: /^[0-9a-f]{40}$/.test(source.REVIEWFLOW_SOURCE_REVISION ?? "")
      ? source.REVIEWFLOW_SOURCE_REVISION
      : null,
    scope:
      "Local synthetic verification only; no live provider, hosted identity, independent human benchmark or production qualification",
    status: failed ? "failed" : "passed",
    stages,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const folder = mkdtempSync(join(tmpdir(), "reviewflow-local-checks-"));
  const report = runLocalVerification({ root, folder });
  const path = join(folder, "verification.json");
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nLocal verification ${report.status}. Report: ${path}`);
  if (report.status !== "passed") process.exitCode = 1;
}
