import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export async function waitReady(
  url,
  { timeout = 30000, fetcher = fetch, signal } = {},
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    try {
      const response = await fetcher(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(1000)])
          : AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Readiness failed: ${url}`);
}
export function startOwned(
  command,
  args,
  { env, port, children, failures, timeout = 30000 },
) {
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  children.push(child);
  const ownership = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Owned listener ${port} did not start`)),
      timeout,
    );
    child.on("message", (message) => {
      if (
        message?.type === "listening" &&
        message.port === port &&
        message.host === "127.0.0.1"
      ) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Owned listener ${port} exited (${code})`));
    });
  });
  child.once("error", failures);
  child.once("exit", (code) =>
    failures(new Error(`Demo service on ${port} exited (${code})`)),
  );
  return ownership;
}
// Call only with detached children created by this supervisor. Their PID is
// also the owned process-group ID, which remains valid while descendants live.
const cleanupByChild = new WeakMap();
export async function stopChildren(
  children,
  { graceMs = 4000, killWaitMs = 1000 } = {},
) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.all(
    children.map((child) => {
      if (cleanupByChild.has(child)) return cleanupByChild.get(child);
      const cleanup = (async () => {
        const pid = child.pid;
        // spawn errors have no PID. Never turn an absent PID into a group signal.
        if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
          return;
        const signalGroup = (signal) => {
          try {
            process.kill(-pid, signal);
            return true;
          } catch (error) {
            if (error.code === "ESRCH") return false;
            error.message = `Owned process group ${pid} signal ${signal} failed (${error.code}); leader exit=${child.exitCode}, signal=${child.signalCode}: ${error.message}`;
            throw error;
          }
        };
        const directAlive = () =>
          child.exitCode === null && child.signalCode === null;
        const deadline = Date.now() + graceMs;
        if (directAlive()) child.kill("SIGTERM");
        // Give the service time to close workers and let Node reap its leader.
        // macOS can return EPERM for kill(-pgid, 0) while that leader is a zombie
        // but its exit event has not run. Do not probe that intermediate state;
        // genuine group-signal permission errors must still propagate.
        // A reaped leader alone does not prove that its descendants are gone.
        let descendantsNotified = false;
        while (Date.now() < deadline) {
          if (directAlive()) {
            await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
            continue;
          }
          if (!signalGroup(0)) return;
          if (!descendantsNotified) {
            if (!signalGroup("SIGTERM")) return;
            descendantsNotified = true;
          }
          await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
        }
        if (!signalGroup("SIGKILL")) return;
        // Reaping is asynchronous and orphan zombies may briefly retain the group.
        // Cleanup must remain bounded even if the OS delays reaping a descendant.
        const killDeadline = Date.now() + killWaitMs;
        while (Date.now() < killDeadline) {
          if (!directAlive() && !signalGroup(0)) return;
          await sleep(Math.min(25, Math.max(1, killDeadline - Date.now())));
        }
      })();
      cleanupByChild.set(child, cleanup);
      return cleanup;
    }),
  );
}

async function command(args, env, children, fail) {
  const child = spawn("pnpm", args, { env, stdio: "inherit", detached: true });
  children.push(child);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`pnpm ${args.join(" ")} failed (${code})`)),
      );
    });
  } finally {
    // Reap a build command's descendants immediately, rather than retaining its
    // old process-group ID throughout a potentially long-lived app session.
    await stopChildren([child]);
    const index = children.indexOf(child);
    if (index !== -1) children.splice(index, 1);
  }
}
async function main() {
  // Validate the actual cluster owned by our wrapper, not just a naming convention.
  await import("./assert-isolated-database.mjs");
  const env = process.env;
  if (env.REVIEWFLOW_ISOLATED_READY !== "1" || !env.REVIEWFLOW_ISOLATED_PGDATA)
    throw new Error("Owned isolated cluster required");
  const data = await realpath(env.REVIEWFLOW_ISOLATED_PGDATA);
  const pid = (await readFile(join(data, "postmaster.pid"), "utf8")).split(
    "\n",
  );
  const db = new URL(env.DATABASE_URL);
  if (
    (await realpath(pid[1])) !== data ||
    pid[3] !== db.port ||
    db.hostname !== "127.0.0.1" ||
    db.pathname !== "/reviewflow_test_isolated" ||
    env.REVIEWFLOW_MIGRATION_DATABASE_URL !== env.DATABASE_URL
  )
    throw new Error("Owned cluster identity mismatch");
  await runServices(
    { ...env, SESSION_SECRET: randomBytes(32).toString("hex") },
    { migrate: true },
  );
}
export async function runServices(
  env,
  {
    migrate = false,
    readyMessage = "ReviewFlow demo ready at http://localhost:5280. Press Ctrl-C to stop and discard this demo database.",
  } = {},
) {
  const children = [];
  const cancellation = new AbortController();
  let stopping = false,
    fail;
  const fatal = new Promise((_, reject) => {
    fail = (error) => {
      if (!stopping) reject(error);
    };
  });
  const stop = () => fail(new Error("Demo stopped"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(signal, stop);
  const base = {
    ...env,
    APP_MODE: "demo",
    LIVE_INFERENCE_ENABLED: "false",
    REVIEWFLOW_HOST: "127.0.0.1",
    REVIEWFLOW_PUBLIC_LISTEN: "false",
    TRUSTED_ORIGINS: "http://localhost:5280,http://127.0.0.1:5280",
  };
  const work = async () => {
    if (migrate)
      await command(
        ["--filter", "@workspace/db", "run", "migrate"],
        base,
        children,
      );
    if (stopping) return;
    await command(
      ["--filter", "@workspace/api-server", "run", "build"],
      base,
      children,
    );
    if (stopping) return;
    const launch = (file, port, extra) =>
      startOwned(process.execPath, [file], {
        env: { ...base, ...extra },
        port,
        children,
        failures: fail,
      });
    await Promise.all([
      launch("artifacts/api-server/dist/index.mjs", 5281, { PORT: "5281" }),
      launch("artifacts/api-server/dist/worker.mjs", 5282, {
        WORKER_PORT: "5282",
      }),
      launch("scripts/demo-web.mjs", 5283, { PORT: "5283", BASE_PATH: "/" }),
      launch("scripts/same-origin-proxy.mjs", 5280, {
        PORT: "5280",
        REVIEWFLOW_API_ORIGIN: "http://127.0.0.1:5281",
        REVIEWFLOW_WEB_ORIGIN: "http://127.0.0.1:5283",
      }),
    ]);
    await Promise.all(
      [
        "http://127.0.0.1:5280/api/readyz",
        "http://127.0.0.1:5282/readyz",
        "http://127.0.0.1:5280/",
      ].map((url) => waitReady(url, { signal: cancellation.signal })),
    );
    console.log(readyMessage);
    await new Promise(() => {});
  };
  try {
    await Promise.race([work(), fatal]);
  } finally {
    stopping = true;
    cancellation.abort();
    await stopChildren(children);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.removeListener(signal, stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.message === "Demo stopped" ? 0 : 1;
  });
