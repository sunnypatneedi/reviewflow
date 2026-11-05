import { spawn } from "node:child_process";
import { checkPorts } from "./demo-local.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWorkspace } from "./local-workspace.mjs";
const require = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
);
const { Client } = require("pg");
const parent = await realpath(
  await mkdtemp(join(tmpdir(), "reviewflow-workspace-smoke-")),
);
const path = join(parent, "synthetic-workspace");
let secret, app;
async function launch() {
  await checkPorts([5280, 5281, 5282, 5283]);
  const child = spawn(
    process.execPath,
    ["scripts/local-workspace.mjs", "start", path],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  app = child;
  let output = "";
  child.diagnosticOutput = () => output;
  const exited = new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => accept({ code, signal }));
  });
  child.exited = exited;
  await new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Local application startup timed out: ${output}`)),
      60000,
    );
    const collect = (chunk) => {
      output = (output + chunk).slice(-12000);
      if (output.includes("ReviewFlow local workspace ready")) {
        clearTimeout(timer);
        accept();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    exited.then((result) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Local application exited before readiness (${result.code}): ${output}`,
        ),
      );
    }, reject);
  });
}
async function stop() {
  if (!app) return;
  const child = app;
  child.kill("SIGTERM");
  let timer;
  try {
    const result = await Promise.race([
      child.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Managed application shutdown timed out; retaining workspace",
              ),
            ),
          20000,
        );
      }),
    ]);
    assert.equal(result.code, 0, `Managed application shutdown failed (code=${result.code}, signal=${result.signal}):\n${child.diagnosticOutput()}`);
    app = undefined;
  } finally {
    clearTimeout(timer);
  }
  await checkPorts([5280, 5281, 5282, 5283]);
  await assert.rejects(access(join(path, "data/postmaster.pid")));
  await assert.rejects(access(join(path, "running.lock")));
}
let cookie = "";
async function request(route, body) {
  const response = await fetch(`http://127.0.0.1:5280/api/reviewflow${route}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      origin: "http://127.0.0.1:5280",
      "content-type": "application/json",
      "x-reviewflow-csrf": "1",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(
    response.ok,
    `${route}: ${response.status} ${await response.clone().text()}`,
  );
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return response;
}
async function appPersistence() {
  await launch();
  const bootstrap = await (await request("/bootstrap")).json();
  const originalCookie = cookie;
  await request("/tasks/import", {
    tasks: [
      {
        externalId: "durable-smoke",
        question: "Synthetic question",
        evidence: "Synthetic evidence",
        candidateAnswer: "Synthetic answer",
        risk: "low",
      },
    ],
  });
  const tasks = await (await request("/tasks")).json();
  await request("/evaluate", {
    taskIds: tasks.map((t) => t.id),
    mode: "demo",
    ownerConsent: false,
  });
  const until = Date.now() + 30000;
  while (true) {
    const jobs = await (
      await request(
        `/evaluation-jobs?mode=demo&taskIds=${tasks.map((t) => t.id).join(",")}`,
      )
    ).json();
    assert.ok(
      !jobs.some((job) => job.status === "failed"),
      "Synthetic evaluations failed",
    );
    if (
      jobs.length === tasks.length &&
      jobs.every((job) => job.status === "succeeded")
    )
      break;
    assert.ok(Date.now() < until, "Evaluation queue timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (let i = 0; i < tasks.length; i++) {
    const next = await (await request("/review/next")).json();
    assert.ok(next?.task);
    await request("/reviews", {
      taskId: next.task.id,
      version: next.task.version,
      action: "accept",
      activeMs: 100,
    });
  }
  const release = await (
    await request("/releases", {
      name: "synthetic durable release",
      includeSourceText: true,
      privacyReviewed: true,
    })
  ).json();
  const bytes = await (
    await request(`/releases/${release.id}/download`)
  ).text();
  assert.equal(release.itemCount, 21);
  await stop();
  await launch();
  assert.equal(cookie, originalCookie);
  const restarted = await (await request("/bootstrap")).json();
  assert.equal(restarted.projectId, bootstrap.projectId);
  assert.equal(
    cookie,
    originalCookie,
    "Restart must accept original signed browser session",
  );
  assert.equal(restarted.tasks.length, 21);
  assert.ok(
    restarted.tasks.some((task) => task.externalId === "durable-smoke"),
  );
  assert.ok(restarted.releases.some((item) => item.id === release.id));
  assert.equal(
    await (await request(`/releases/${release.id}/download`)).text(),
    bytes,
  );
  await stop();
}

async function query(url, sql) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}
try {
  await withWorkspace(path, { initialize: true }, async ({ url, env }) => {
    secret = env.SESSION_SECRET;
    await query(
      url,
      "CREATE TABLE local_preservation_probe (value text); INSERT INTO local_preservation_probe VALUES ('synthetic persistent record')",
    );
    await assert.rejects(
      withWorkspace(path, {}, async () => {}),
      /lock exists/,
    );
  });
  await assert.rejects(access(join(path, "data/postmaster.pid")));
  await withWorkspace(path, {}, async ({ url, env }) => {
    assert.equal(env.SESSION_SECRET, secret);
    assert.equal(
      (await query(url, "SELECT value FROM local_preservation_probe")).rows[0]
        .value,
      "synthetic persistent record",
    );
    throw new Error("synthetic service failure");
  }).then(
    () => assert.fail("Expected failure"),
    (error) => assert.equal(error.message, "synthetic service failure"),
  );
  await assert.rejects(access(join(path, "data/postmaster.pid")));
  await withWorkspace(path, {}, async ({ url, env }) => {
    assert.equal(env.SESSION_SECRET, secret);
    assert.equal(
      (await query(url, "SELECT count(*) FROM local_preservation_probe"))
        .rows[0].count,
      "1",
    );
  });
  assert.equal(
    JSON.parse(await readFile(join(path, "manifest.json"), "utf8")).state,
    "ready",
  );
  await appPersistence();
  console.log(
    "Durable workspace smoke passed: actual app cookie, tasks and release bytes survive restart; signal shutdown frees all ports;  initialization, records/session restart preservation, duplicate launch refusal, failure cleanup and subsequent recovery.",
  );
} catch (error) {
  console.error("Durable workspace smoke failed before final cleanup:", error);
  throw error;
} finally {
  await stop();
  // Only remove this invocation's mkdtemp test tree, and only with PostgreSQL stopped.
  let running = false;
  try {
    await access(join(path, "data/postmaster.pid"));
    running = true;
  } catch {}
  if (!running) await rm(parent, { recursive: true, force: true });
  else
    throw new Error(
      `Test workspace retained because PostgreSQL may still run: ${parent}`,
    );
}
