import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPrerequisites } from "./doctor.mjs";
export function cleanEnvironment(source = process.env) {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SYSTEMROOT",
  ])
    if (source[key]) env[key] = source[key];
  return {
    ...env,
    APP_MODE: "demo",
    LIVE_INFERENCE_ENABLED: "false",
    REVIEWFLOW_HOST: "127.0.0.1",
    REVIEWFLOW_PUBLIC_LISTEN: "false",
  };
}
export async function checkPorts(ports) {
  for (const port of ports)
    await new Promise((accept, reject) => {
      const server = createServer();
      server.once("error", () =>
        reject(
          new Error(
            `Port ${port} is occupied. Stop your existing demo yourself or free this port; no existing process was changed.`,
          ),
        ),
      );
      server.listen(port, "127.0.0.1", () => server.close(accept));
    });
}
export async function acquireLock(path) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Another demo owns the launch lock: ${path}. If its terminal crashed, verify no demo is running before removing this directory yourself.`,
      );
    throw error;
  }
  return () => rm(path, { recursive: true, force: true });
}
async function main() {
  const failures = checkPrerequisites();
  if (failures.length)
    throw new Error(
      failures.join("\n") + "\nRun pnpm run doctor; see docs/setup.md.",
    );
  const release = await acquireLock(
    join(tmpdir(), "reviewflow-demo-5280.lock"),
  );
  let child,
    stopping = false;
  const stop = () => {
    stopping = true;
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGHUP", stop);
  try {
    await checkPorts([5280, 5281, 5282, 5283]);
    if (stopping) return;
    console.log(
      "Starting synthetic demo. ALL demo data is deleted when this command stops. No live providers are enabled.",
    );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    child = spawn(
      "sh",
      [
        "scripts/with-isolated-postgres.sh",
        process.execPath,
        "scripts/demo-services.mjs",
      ],
      { cwd: root, env: cleanEnvironment(), stdio: "inherit", detached: true },
    );
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (!stopping && code !== 0) throw new Error(`Demo exited (${code}).`);
  } finally {
    await release();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
