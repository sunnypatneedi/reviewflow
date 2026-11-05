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
export async function stopChildren(children) {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try {
        child.kill("SIGTERM");
      } catch {}
      let timer;
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {}
            resolve();
          }, 4000);
        }),
      ]);
      clearTimeout(timer);
      await exited;
    }),
  );
}
async function command(args, env, children, fail) {
  const child = spawn("pnpm", args, { env, stdio: "inherit", detached: true });
  children.push(child);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pnpm ${args.join(" ")} failed (${code})`)),
    );
  });
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
