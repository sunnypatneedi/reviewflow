import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { cleanEnvironment, checkPorts, acquireLock } from "./demo-local.mjs";
import { checkPrerequisites } from "./doctor.mjs";
import { waitReady, startOwned, stopChildren } from "./demo-services.mjs";
test("demo rejects ambient credentials, database, listener and executable injection", () => {
  const env = cleanEnvironment({
    PATH: "/usr/bin",
    HOME: "/tmp",
    DATABASE_URL: "private",
    CLERK_SECRET_KEY: "private",
    TYPESAFE_API_KEY: "private",
    NODE_OPTIONS: "--import=evil",
    REVIEWFLOW_ISOLATED_READY: "1",
    REVIEWFLOW_PUBLIC_LISTEN: "true",
    LIVE_INFERENCE_ENABLED: "true",
  });
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.CLERK_SECRET_KEY, undefined);
  assert.equal(env.TYPESAFE_API_KEY, undefined);
  assert.equal(env.REVIEWFLOW_ISOLATED_READY, undefined);
  assert.equal(env.LIVE_INFERENCE_ENABLED, "false");
  assert.equal(env.REVIEWFLOW_HOST, "127.0.0.1");
  assert.equal(env.REVIEWFLOW_PUBLIC_LISTEN, "false");
});
test("doctor reports missing tools without installation", () => {
  assert.equal(checkPrerequisites(() => ({ status: 1 })).length, 6);
});
test("exclusive launch lock refuses second launcher and releases owned lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reviewflow-launch-test-"));
  const path = join(directory, "lock");
  try {
    const release = await acquireLock(path);
    await assert.rejects(acquireLock(path), /Another demo/);
    await release();
    const again = await acquireLock(path);
    await again();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("occupied ports are rejected without stopping existing service", async () => {
  const server = createServer((_, response) => response.end("unrelated"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(checkPorts([port]), /occupied/);
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "unrelated",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("readiness failure on a fresh synthetic HTTP service does not declare success", async () => {
  const server = createServer((_, response) => {
    response.writeHead(503);
    response.end("not ready");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      waitReady(`http://127.0.0.1:${server.address().port}/readyz`, {
        timeout: 20,
      }),
      /Readiness failed/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("HTTP availability is insufficient without owned IPC listener", async () => {
  const children = [];
  let failed = false;
  try {
    await assert.rejects(
      startOwned(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        env: cleanEnvironment(),
        port: 9999,
        children,
        failures: () => {
          failed = true;
        },
        timeout: 40,
      }),
      /Owned listener/,
    );
  } finally {
    await stopChildren(children);
  }
  assert.equal(children[0].signalCode, "SIGTERM");
  assert.equal(failed, true);
});
test("early child exit fails ownership readiness", async () => {
  const children = [];
  let failure;
  await assert.rejects(
    startOwned(process.execPath, ["-e", "process.exit(2)"], {
      env: cleanEnvironment(),
      port: 9999,
      children,
      failures: (error) => {
        failure = error;
      },
      timeout: 1000,
    }),
    /exited/,
  );
  await stopChildren(children);
  assert.match(failure.message, /exited/);
});
