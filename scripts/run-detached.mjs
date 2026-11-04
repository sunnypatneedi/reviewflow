// Portable POSIX process-group ownership for the isolated preview (macOS/Linux).
import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");
const child = spawn(command, args, {
  detached: true,
  stdio: "inherit",
  env: process.env,
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stop);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = stopping ? 0 : (code ?? 1);
});
