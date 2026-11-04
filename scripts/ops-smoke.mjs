import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import {
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
await import("./assert-isolated-database.mjs");
assert.equal(process.env.REVIEWFLOW_OPS_OWN_CLUSTER, "1");
const data = realpathSync(process.env.REVIEWFLOW_ISOLATED_PGDATA || "/missing"),
  port = process.env.REVIEWFLOW_ISOLATED_PGPORT;
assert.equal(basename(data), "data");
assert.match(basename(dirname(data)), /^reviewflow-pg\./);
const socket = realpathSync(
  process.env.REVIEWFLOW_ISOLATED_PGSOCKET || "/missing",
);
assert.equal(dirname(socket), dirname(data));
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, port);
assert.equal(target.pathname, "/reviewflow_test_isolated");
assert.equal(
  readFileSync(join(data, "postmaster.pid"), "utf8").split("\n")[3],
  port,
  "Crash rehearsal must target only its owned fresh cluster",
);
const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  logs = mkdtempSync(join(tmpdir(), "reviewflow-ops-"));
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { WebSocket } = require("ws"),
  Y = require("yjs");
const environment = {
  ...process.env,
  APP_MODE: "demo",
  NODE_ENV: "test",
  LIVE_INFERENCE_ENABLED: "false",
  REVIEWFLOW_HOST: "127.0.0.1",
  REVIEWFLOW_PUBLIC_LISTEN: "false",
  SESSION_SECRET: "synthetic-ops-session-fixture-not-a-real-secret",
  TRUSTED_ORIGINS: "http://localhost:8080",
  API_REQUESTS_PER_MINUTE: "180",
};
for (const key of Object.keys(environment))
  if (/CLERK|TYPESAFE|OPENAI|ANTHROPIC|TRACE_ALLOW_LIVE/.test(key))
    delete environment[key];
async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const apiPort = await freePort(),
  workerPort = await freePort(),
  base = `http://127.0.0.1:${apiPort}/api`;
let api, worker;
function start(file, extra, log) {
  const output = openSync(join(logs, log), "a");
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...environment, ...extra },
    stdio: ["ignore", output, output, "ipc"],
  });
  closeSync(output);
  child.bound = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Owned child did not bind its listener")),
      5000,
    );
    child.once("message", (message) => {
      clearTimeout(timer);
      try {
        assert.equal(message.type, "listening");
        assert.equal(message.host, "127.0.0.1");
        assert.equal(message.port, Number(extra.PORT ?? extra.WORKER_PORT));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Owned child exited before its listener was confirmed"));
    });
  });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Graceful shutdown exceeded five seconds"));
      }, 5000).unref(),
    ),
  ]);
  assert.equal(child.exitCode, 0, "Controlled shutdown must exit cleanly");
}
async function waitStatus(path, expected) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    try {
      if (
        (await fetch(base + path, { signal: AbortSignal.timeout(1000) }))
          .status === expected
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path} status ${expected}`);
}
for (const [signal, code] of [
  ["SIGTERM", 143],
  ["SIGINT", 130],
])
  process.once(signal, () => {
    void Promise.allSettled([stop(worker), stop(api)]).then(() =>
      process.exit(code),
    );
  });
const session = () => ({ cookie: "" });
async function request(s, path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:8080",
      "x-reviewflow-csrf": "1",
      "content-type": "application/json",
      ...(s.cookie ? { cookie: s.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.headers.get("set-cookie"))
    s.cookie = response.headers.get("set-cookie").split(";")[0];
  const text = await response.text();
  return {
    status: response.status,
    text,
    value: response.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(text)
      : null,
  };
}
function message(ws, predicate) {
  return new Promise((resolve, reject) => {
    const done = (error, value) => {
      clearTimeout(timer);
      ws.off("message", read);
      ws.off("close", closed);
      error ? reject(error) : resolve(value);
    };
    const read = (raw) => {
      try {
        const value = JSON.parse(raw.toString());
        if (value.type === "error")
          done(new Error("Shared-note operation rejected"));
        else if (predicate(value)) done(undefined, value);
      } catch {
        done(new Error("Invalid shared-note message"));
      }
    };
    const closed = () =>
      done(new Error("Shared-note connection closed before completion"));
    const timer = setTimeout(
      () => done(new Error("Shared-note verification timed out")),
      5000,
    );
    ws.on("message", read);
    ws.once("close", closed);
  });
}
async function notes(s, task, write = false) {
  const ticket = await request(
    s,
    `/reviewflow/tasks/${task}/collaboration-ticket`,
    {},
  );
  assert.equal(ticket.status, 200, ticket.text);
  const ws = new WebSocket(
    `ws://127.0.0.1:${apiPort}/api/reviewflow/collaboration`,
    { origin: "http://localhost:8080" },
  );
  await once(ws, "open");
  ws.on("error", () => {});
  const first = message(ws, (value) => value.type === "state");
  ws.send(JSON.stringify({ type: "auth", token: ticket.value.token }));
  const initial = await first;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(initial.state, "base64"));
  if (write) {
    doc.getText("notes").insert(0, "Synthetic recovery note");
    const updated = message(ws, (value) => value.ack === 1);
    ws.send(
      JSON.stringify({
        type: "update",
        id: 1,
        state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
      }),
    );
    assert.equal((await updated).ack, 1);
  } else
    assert.equal(doc.getText("notes").toString(), "Synthetic recovery note");
  ws.close();
  await once(ws, "close");
  doc.destroy();
}
try {
  api = start(
    "artifacts/api-server/dist/index.mjs",
    { PORT: String(apiPort) },
    "api.log",
  );
  await api.bound;
  await waitStatus("/readyz", 200);
  const { Client } = createRequire(
    new URL("../lib/db/package.json", import.meta.url),
  )("pg");
  const probe = new Client({ connectionString: process.env.DATABASE_URL });
  await probe.connect();
  try {
    await probe.query("ALTER TABLE rf_jobs RENAME TO rf_jobs_rehearsal_hidden");
    try {
      await waitStatus("/readyz", 503);
    } finally {
      await probe.query(
        "ALTER TABLE rf_jobs_rehearsal_hidden RENAME TO rf_jobs",
      );
    }
    await waitStatus("/readyz", 200);
  } finally {
    await probe.end();
  }
  const a = session(),
    b = session();
  const bootstrap = (await request(a, "/reviewflow/bootstrap")).value;
  const task = bootstrap.tasks[0];
  assert.equal(bootstrap.mode, "demo");
  assert.equal(bootstrap.liveCredentialConfigured, false);
  await notes(a, task.id, true);
  assert.equal(
    (
      await request(a, "/reviewflow/evaluate", {
        taskIds: [task.id],
        mode: "demo",
      })
    ).status,
    202,
  );
  const releaseProject = (await request(b, "/reviewflow/bootstrap")).value;
  for (const item of releaseProject.tasks)
    assert.equal(
      (
        await request(b, "/reviewflow/reviews", {
          taskId: item.id,
          version: item.version,
          action: "label",
          correctedLabel: "supported",
          reason: "Scripted recovery fixture; no human accuracy claim",
          activeMs: 10,
        })
      ).status,
      200,
    );
  const release = await request(b, "/reviewflow/releases", {
    name: "synthetic-recovery",
    includeSourceText: false,
  });
  assert.equal(release.status, 201, release.text);
  const frozen = await request(
    b,
    `/reviewflow/releases/${release.value.id}/download`,
  );
  assert.equal(frozen.status, 200);
  const digest = createHash("sha256").update(frozen.text).digest("hex");
  // Simulate a DB crash while the API has idle connections. Only the owned new
  // cluster can be controlled; this is WAL/restart evidence, not backup restore.
  execFileSync(
    "pg_ctl",
    ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"],
    { stdio: "ignore", timeout: 15000 },
  );
  await waitStatus("/readyz", 503);
  await waitStatus("/healthz", 200);
  worker = start(
    "artifacts/api-server/dist/worker.mjs",
    { WORKER_PORT: String(workerPort) },
    "worker.log",
  );
  async function workerStatus(expected) {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      try {
        if (
          (
            await fetch(`http://127.0.0.1:${workerPort}/readyz`, {
              signal: AbortSignal.timeout(1000),
            })
          ).status === expected
        )
          return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Worker readiness did not reach ${expected}`);
  }
  await worker.bound;
  await workerStatus(503);
  execFileSync(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(logs, "postgres-restart.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${socket}`,
      "-w",
      "-t",
      "10",
      "start",
    ],
    { stdio: "ignore", timeout: 15000 },
  );
  await api.bound;
  await waitStatus("/readyz", 200);
  const recovered = await request(
    b,
    `/reviewflow/releases/${release.value.id}/download`,
  );
  assert.equal(recovered.status, 200);
  assert.equal(
    createHash("sha256").update(recovered.text).digest("hex"),
    digest,
  );
  await notes(a, task.id);
  await stop(api);
  api = start(
    "artifacts/api-server/dist/index.mjs",
    { PORT: String(apiPort) },
    "api.log",
  );
  await api.bound;
  await waitStatus("/readyz", 200);
  assert.equal(
    (await request(a, "/reviewflow/bootstrap")).value.projectId,
    bootstrap.projectId,
    "Signed demo session survives API restart with the same configured key",
  );
  await notes(a, task.id);
  await workerStatus(200);
  const end = Date.now() + 8000;
  while (
    (await request(a, "/reviewflow/tasks")).value.find(
      (row) => row.id === task.id,
    ).status !== "proposed"
  ) {
    assert.ok(Date.now() < end, "Persisted queued job must resume");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Probe privacy through the actual server in the live logger before its rate budget is exhausted.
  const privateResponse = await fetch(
    base + "/unknown/OPS_PRIVATE_SENTINEL?token=OPS_PRIVATE_SENTINEL",
  );
  assert.equal(privateResponse.status, 404);
  const privateRequestId = privateResponse.headers.get("x-request-id");
  assert.match(privateRequestId ?? "", /^[a-f0-9-]{36}$/);
  await privateResponse.text();
  const times = [];
  let finished = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let i = 0; i < 10; i++) {
        const before = performance.now();
        assert.equal(
          (await request(a, "/reviewflow/factories/evidence")).status,
          200,
        );
        times.push(performance.now() - before);
        finished++;
      }
    }),
  );
  assert.equal(finished, 120);
  const rejected = [];
  for (let round = 0; round < 10; round++)
    rejected.push(
      ...(await Promise.all(
        Array.from({ length: 10 }, () =>
          request(a, "/reviewflow/factories/evidence"),
        ),
      )),
    );
  assert.ok(
    rejected.some((result) => result.status === 429),
    "API request budget must reject excess traffic",
  );
  await waitStatus("/healthz", 200);
  await api.bound;
  await waitStatus("/readyz", 200);
  await stop(worker);
  worker = undefined;
  await stop(api);
  api = undefined;
  assert.ok(
    readFileSync(join(logs, "api.log"), "utf8").includes(privateRequestId),
  );
  assert.doesNotMatch(
    readFileSync(join(logs, "api.log"), "utf8"),
    /OPS_PRIVATE_SENTINEL/,
  );
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scope:
        "local synthetic single API process; no hosted/load/backup qualification",
      schemaDriftDetected: true,
      crashRecovery: true,
      ready503DuringDatabaseLoss: true,
      livenessDuringDatabaseLoss: true,
      immutableReleaseDigestPreserved: true,
      notesAndSessionSurviveRestart: true,
      persistedJobResumed: true,
      workerRecoveredFromDatabaseLoss: true,
      gracefulShutdown: true,
      concurrentClients: 12,
      completedReads: 120,
      observedP50Ms: Math.round(times[59] * 100) / 100,
      observedP95Ms: Math.round(times[113] * 100) / 100,
      excessRequestsRejected: rejected.filter((result) => result.status === 429)
        .length,
      privatePathNotLogged: true,
      logs,
    }),
  );
} finally {
  const cleanup = await Promise.allSettled([stop(worker), stop(api)]);
  if (cleanup.some((result) => result.status === "rejected"))
    throw new Error(
      "Operations rehearsal cleanup failed; inspect owned process logs",
    );
}
