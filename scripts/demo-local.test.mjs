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

// These processes are synthetic, detached, and created exclusively by this test.
async function descendantFixture({
  parentExits = false,
  ignoreTerm = false,
} = {}) {
  const { spawn } = await import("node:child_process");
  const script = `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(`
      ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
      process.send({ ready: true });
      setInterval(() => {}, 1000);
    `)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    grandchild.once('message', () => {
      process.send({ pid: grandchild.pid }, () => {
        ${parentExits ? "process.exit(0);" : "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"}
      });
    });
  `;
  const parent = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const exit = new Promise((resolve) => parent.once("exit", resolve));
  const grandchild = await new Promise((resolve, reject) => {
    parent.once("error", reject);
    parent.once("message", (message) => resolve(message.pid));
  });
  if (parentExits) await exit;
  return { parent, grandchild };
}
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function assertGone(pid) {
  const end = Date.now() + 2000;
  while (processExists(pid) && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    processExists(pid),
    false,
    `Synthetic descendant ${pid} survived cleanup`,
  );
}
for (const parentExits of [false, true]) {
  test(`cleanup removes owned grandchild when parent ${parentExits ? "already exited" : "exits during shutdown"}`, async () => {
    const { parent, grandchild } = await descendantFixture({ parentExits });
    assert.equal(processExists(grandchild), true);
    try {
      await stopChildren([parent], { graceMs: 250, killWaitMs: 500 });
      await assertGone(grandchild);
    } finally {
      try {
        process.kill(-parent.pid, "SIGKILL");
      } catch {}
    }
  });
}
test("cleanup escalates TERM-ignoring descendants within a bounded interval", async () => {
  const { parent, grandchild } = await descendantFixture({
    parentExits: true,
    ignoreTerm: true,
  });
  try {
    const start = Date.now();
    await stopChildren([parent], { graceMs: 150, killWaitMs: 500 });
    assert.ok(
      Date.now() - start < 1500,
      "cleanup exceeded its bounded grace period",
    );
    await assertGone(grandchild);
  } finally {
    try {
      process.kill(-parent.pid, "SIGKILL");
    } catch {}
  }
});
test("spawn error and absent PIDs are safe to clean up", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn("/definitely-absent-reviewflow-test-command", [], {
    detached: true,
  });
  await new Promise((resolve) => child.once("error", resolve));
  assert.equal(child.pid, undefined);
  await stopChildren([child, { pid: 0 }, { pid: -1 }, { pid: process.pid }], {
    graceMs: 10,
    killWaitMs: 10,
  });
});


test("cleanup waits for the direct child to be reaped before probing its group", async () => {
  const originalKill = process.kill;
  const pid = 999999;
  let signaled = false;
  const child = { pid, exitCode: null, signalCode: null, kill(signal) {
    assert.equal(signal, "SIGTERM");
    signaled = true;
    setTimeout(() => { child.exitCode = 0; }, 10);
    return true;
  } };
  process.kill = (target, signal) => {
    assert.equal(target, -pid);
    assert.ok(signaled);
    if (child.exitCode === null) {
      throw Object.assign(new Error("Unreaped zombie group probe"), { code: "EPERM" });
    }
    throw Object.assign(new Error("Owned group is gone"), { code: "ESRCH" });
  };
  try { await stopChildren([child], { graceMs: 100, killWaitMs: 100 }); }
  finally { process.kill = originalKill; }
});

test("cleanup still rejects genuine group permission errors", async () => {
  const originalKill = process.kill;
  const child = { pid: 999998, exitCode: 0, signalCode: null };
  process.kill = () => { throw Object.assign(new Error("Permission denied"), { code: "EPERM" }); };
  try {
    await assert.rejects(stopChildren([child], { graceMs: 100 }),
      error => error.code === "EPERM" && /Owned process group/.test(error.message));
  } finally { process.kill = originalKill; }
});
