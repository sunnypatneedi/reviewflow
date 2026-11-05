// Real first-run smoke: only the launcher-created throwaway database is used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { checkPorts, cleanEnvironment } from "./demo-local.mjs";
await checkPorts([5280, 5281, 5282, 5283]);
const child = spawn(process.execPath, ["scripts/demo-local.mjs"], {
  env: cleanEnvironment(),
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (data) => {
  output += data;
  process.stdout.write(data);
});
child.stderr.on("data", (data) => {
  output += data;
  process.stderr.write(data);
});
const exited = new Promise((resolve) => child.once("exit", resolve));
try {
  const end = Date.now() + 120000;
  while (!output.includes("ReviewFlow demo ready at")) {
    if (child.exitCode !== null)
      throw new Error(`Demo exited before ready (${child.exitCode})`);
    if (Date.now() > end) throw new Error("Demo startup timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await fetch("http://127.0.0.1:5280/api/readyz")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:5282/readyz")).status, 200);
  const second = spawn(process.execPath, ["scripts/demo-local.mjs"], {
    env: cleanEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let secondOutput = "";
  second.stderr.on("data", (data) => {
    secondOutput += data;
  });
  assert.equal(await new Promise((resolve) => second.once("exit", resolve)), 1);
  assert.match(secondOutput, /Another demo owns/);
  assert.equal(
    (await fetch("http://127.0.0.1:5280/api/readyz")).status,
    200,
    "Second launch must not stop original",
  );
  if (process.argv.includes("--browser")) {
    const { verifyAnonymousLocalBrowser } =
      await import("./browser-local-e2e.mjs");
    await verifyAnonymousLocalBrowser();
  }
} finally {
  child.kill("SIGTERM");
  let timer;
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Demo shutdown timeout")),
        15000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
const end = Date.now() + 10000;
while (true) {
  try {
    await checkPorts([5280, 5281, 5282, 5283]);
    break;
  } catch (error) {
    if (Date.now() > end) throw error;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
console.log(
  "Actual disposable demo launch, owned readiness, duplicate-launch refusal and process cleanup passed. No live inference.",
);
