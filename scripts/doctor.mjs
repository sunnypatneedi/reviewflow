import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
export function checkPrerequisites(run = spawnSync) {
  const specs = [
    ["node", ["--version"], /^v24\./, "Node.js 24"],
    ["pnpm", ["--version"], /^10\.26\.1\s*$/, "pnpm 10.26.1"],
    ["python3", ["--version"], /^Python 3\.(1[1-9]|[2-9]\d)\./, "Python 3.11+"],
    ...["initdb", "pg_ctl"].map((name) => [
      name,
      ["--version"],
      /\b16\./,
      `PostgreSQL 16 ${name}`,
    ]),
    [
      "sh",
      ["-c", "command -v createdb"],
      /createdb/,
      "PostgreSQL createdb executable",
    ],
  ];
  const failures = [];
  for (const [name, args, expected, description] of specs) {
    const result = run(name, args, { encoding: "utf8" });
    if (
      result.status !== 0 ||
      !expected.test(`${result.stdout || ""}${result.stderr || ""}`.trim())
    )
      failures.push(`${description} is required on PATH (${name}).`);
  }
  if (process.platform === "win32")
    failures.push(
      "Use Linux/WSL2; the local launcher requires POSIX process groups.",
    );
  return failures;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures = checkPrerequisites();
  if (failures.length) {
    console.error(
      failures.join("\n") +
        "\nSee docs/setup.md. Nothing was installed or changed.",
    );
    process.exitCode = 1;
  } else
    console.log(
      "Local prerequisites ready: Node 24, pnpm 10.26.1, Python 3.11+, PostgreSQL 16. Demo data is disposable.",
    );
}
