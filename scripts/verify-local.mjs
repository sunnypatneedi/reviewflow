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
    args: ["scripts/demo-smoke.mjs", "--browser"],
  },
  {
    name: "durable-local-restart",
    command: "node",
    args: ["scripts/local-workspace-smoke.mjs"],
  },
];

export function verificationEnvironment(source, folder) {
  // Allowlist rather than guessing every provider's credential prefix. In
  // particular, the real Jev adapter uses TYPESAFE_API_KEY, not JEV_API_KEY.
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SYSTEMROOT",
    "CI",
    "NO_COLOR",
    "FORCE_COLOR",
    "REVIEWFLOW_CHROMIUM_PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
  ]) {
    if (typeof source[name] === "string") env[name] = source[name];
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
