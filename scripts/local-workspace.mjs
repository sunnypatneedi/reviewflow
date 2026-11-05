import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanEnvironment, checkPorts } from "./demo-local.mjs";
import { checkPrerequisites } from "./doctor.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "lib/db/package.json"));
const { Client } = require("pg");
const database = "reviewflow_dev_managed";
const role = "reviewflow_local_owner";
export async function schemaHash(folder = join(root, "lib/db/drizzle")) {
  const hash = createHash("sha256");
  async function walk(path, prefix = "") {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name),
        relative = `${prefix}${name}`,
        stat = await lstat(file);
      if (stat.isSymbolicLink())
        throw new Error("Migration symlinks are not supported");
      if (stat.isDirectory()) await walk(file, `${relative}/`);
      else
        hash
          .update(relative)
          .update("\0")
          .update(await readFile(file))
          .update("\0");
    }
  }
  await walk(folder);
  return hash.digest("hex");
}
async function privatePath(path, directory = false) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    throw new Error(
      `Expected an owned private ${directory ? "directory" : "file"}: ${path}`,
    );
}
async function requireOutsideSource(path) {
  const source = await realpath(root);
  if (path === source || path.startsWith(`${source}${sep}`))
    throw new Error(
      "Managed workspace must be outside the source checkout; no files were created.",
    );
}
export async function canonicalNewPath(input) {
  const path = resolve(input);
  await requireOutsideSource(path);
  const parent = await realpath(dirname(path));
  if (parent !== dirname(path))
    throw new Error("Workspace parent must be canonical, without symlinks");
  return path;
}
async function saveManifest(path, value) {
  await writeFile(
    join(path, "manifest.next"),
    JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  await rename(join(path, "manifest.next"), join(path, "manifest.json"));
}
export async function initializeDirectory(input) {
  const path = await canonicalNewPath(input);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Initialization requires a NEW directory. Existing or interrupted workspaces are never reset.",
      );
    throw error;
  }
  const manifest = {
    format: 1,
    state: "initializing",
    path,
    database,
    role,
    schemaHash: await schemaHash(),
    id: randomBytes(16).toString("hex"),
  };
  await saveManifest(path, manifest);
  await writeFile(
    join(path, "session-secret"),
    randomBytes(32).toString("hex"),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(path, "database-password"),
    randomBytes(32).toString("hex"),
    { mode: 0o600, flag: "wx" },
  );
  return { path, manifest };
}
export async function readWorkspace(input) {
  const path = resolve(input);
  await requireOutsideSource(path);
  if ((await realpath(path)) !== path)
    throw new Error("Workspace must use its canonical path, without symlinks");
  await privatePath(path, true);
  await privatePath(join(path, "manifest.json"));
  const manifest = JSON.parse(
    await readFile(join(path, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    manifest.path !== path ||
    manifest.database !== database ||
    manifest.role !== role ||
    !/^[a-f0-9]{32}$/.test(manifest.id)
  )
    throw new Error("Workspace identity mismatch");
  if (manifest.state !== "ready" || !manifest.systemIdentifier)
    throw new Error(
      "Workspace initialization was interrupted or incomplete. Preserve it for manual recovery; it will not be reset.",
    );
  if (manifest.schemaHash !== (await schemaHash()))
    throw new Error(
      "Workspace schema differs from this release. An explicit supported upgrade is required; no migration was run.",
    );
  await privatePath(join(path, "data"), true);
  for (const name of ["session-secret", "database-password"]) {
    await privatePath(join(path, name));
    if (!/^[a-f0-9]{64}$/.test(await readFile(join(path, name), "utf8")))
      throw new Error(`Invalid workspace ${name}`);
  }
  return { path, manifest };
}
export async function workspaceLock(path) {
  const lock = join(path, "running.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Workspace launch lock exists. Another launch or an interrupted run owns it. Verify all workspace processes stopped before manually removing running.lock.",
      );
    throw error;
  }
  return () => rmdir(lock);
}
function command(program, args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, {
      cwd: root,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`${program} failed (${code}): ${stderr}`)),
    );
  });
}
async function freePort() {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => accept(port));
    });
  });
}
export async function withWorkspace(
  input,
  { initialize = false } = {},
  operation,
) {
  // Ambient URLs, provider keys and auth settings never enter the managed runtime.
  const env = cleanEnvironment();
  const workspace = initialize
    ? await initializeDirectory(input)
    : await readWorkspace(input);
  const { path, manifest } = workspace,
    data = join(path, "data");
  const release = await workspaceLock(path);
  let started = false,
    interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  signals.forEach((signal) => process.on(signal, onSignal));
  let port;
  try {
    port = await freePort();
    if (initialize)
      await command(
        "initdb",
        [
          "-D",
          data,
          `--username=${role}`,
          "--auth-local=scram-sha-256",
          "--auth-host=scram-sha-256",
          `--pwfile=${join(path, "database-password")}`,
          "--no-instructions",
        ],
        env,
      );
    if (interrupted) throw new Error("Local workspace stopped");
    started = true;
    await command(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        join(path, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -k ''`,
        "-w",
        "start",
      ],
      env,
    );
    started = true;
    const pid = (await readFile(join(data, "postmaster.pid"), "utf8")).split(
      "\n",
    );
    if (pid[1] !== data || Number(pid[3]) !== port)
      throw new Error("Started cluster identity mismatch");
    const password = await readFile(join(path, "database-password"), "utf8");
    const url = `postgresql://${role}:${password}@127.0.0.1:${port}/${database}`;
    const admin = new Client({
      connectionString: url.replace(`/${database}`, "/postgres"),
    });
    await admin.connect();
    let systemIdentifier;
    try {
      systemIdentifier = String(
        (await admin.query("SELECT system_identifier FROM pg_control_system()"))
          .rows[0].system_identifier,
      );
      if (!initialize && systemIdentifier !== manifest.systemIdentifier)
        throw new Error("PostgreSQL cluster identity mismatch");
      if (initialize) await admin.query(`CREATE DATABASE ${database}`);
    } finally {
      await admin.end();
    }
    if (initialize) {
      // Only the newly created empty database is disposable until initialization completes.
      await command(process.execPath, ["lib/db/scripts/migrate.mjs"], {
        ...env,
        REVIEWFLOW_MIGRATION_DATABASE_URL: url,
        REVIEWFLOW_DISPOSABLE_DB: "1",
        REVIEWFLOW_MIGRATION_CONFIRM: database,
      });
      if (manifest.schemaHash !== (await schemaHash()))
        throw new Error(
          "Migration inventory changed during initialization; workspace retained incomplete.",
        );
      manifest.state = "ready";
      manifest.systemIdentifier = systemIdentifier;
      await saveManifest(path, manifest);
    }
    if (interrupted) throw new Error("Local workspace stopped");
    return await operation({
      ...workspace,
      url,
      env: {
        ...env,
        DATABASE_URL: url,
        SESSION_SECRET: await readFile(join(path, "session-secret"), "utf8"),
      },
    });
  } finally {
    try {
      if (started) {
        let pid;
        try {
          pid = (await readFile(join(data, "postmaster.pid"), "utf8")).split(
            "\n",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (pid) {
          if (pid[1] !== data || Number(pid[3]) !== port)
            throw new Error(
              "Refusing to stop an unrecognized PostgreSQL process; launch lock retained.",
            );
          await command(
            "pg_ctl",
            ["-D", data, "-m", "fast", "-w", "stop"],
            env,
          );
        }
      }
      await release();
    } finally {
      signals.forEach((signal) => process.removeListener(signal, onSignal));
    }
  }
}
async function main() {
  const [action, path, ...extra] = process.argv.slice(2);
  if (!["init", "start"].includes(action) || !path || extra.length)
    throw new Error(
      "Usage: node scripts/local-workspace.mjs <init|start> /absolute/new-workspace-path",
    );
  const failures = checkPrerequisites();
  if (failures.length) throw new Error(failures.join("\n"));
  if (action === "init") {
    await withWorkspace(path, { initialize: true }, async ({ path }) =>
      console.log(
        `Initialized durable local workspace: ${path}\nStart with: pnpm run local:start ${path}`,
      ),
    );
  } else {
    await checkPorts([5280, 5281, 5282, 5283]);
    const { runServices } = await import("./demo-services.mjs");
    await withWorkspace(path, {}, async ({ path, env }) =>
      runServices(env, {
        migrate: false,
        readyMessage: `ReviewFlow local workspace ready at http://127.0.0.1:5280\nDurable data: ${path}\nCtrl-C stops services; data and sessions are preserved.`,
      }),
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = ["Demo stopped", "Local workspace stopped"].includes(
      error.message,
    )
      ? 0
      : 1;
  });
