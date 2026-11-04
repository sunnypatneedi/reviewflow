#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const allowedFiles = [
  ".github",
  ".env.example",
  ".gitignore",
  ".npmrc",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "artifacts/api-server",
  "artifacts/reviewflow",
  "docs",
  "lib",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "python",
  "scripts",
  "screenshots",
  "tsconfig.base.json",
  "tsconfig.json",
];
const screenshots = new Set([
  "reviewflow-review.png",
  "reviewflow-factories.png",
  "reviewflow-factories-mobile.png",
  "reviewflow-team.png",
  "reviewflow-team-mobile.png",
  "reviewflow-launch.png",
  "reviewflow-launch-mobile.png",
  "reviewflow-live-notes.png",
]);
const excludedNames = new Set([
  ".agents",
  ".cache",
  ".config",
  ".git",
  ".local",
  ".replit",
  ".replit-artifact",
  ".replitignore",
  "attached_assets",
  "dist",
  "mockup-sandbox",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "releases",
]);
export function shouldExclude(path) {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1);
  return (
    parts.some((p) => excludedNames.has(p)) ||
    (name !== ".env.example" && /^\.env(?:\.|$)/i.test(name)) ||
    /(?:^|\/)(?:credentials|id_rsa|id_ed25519)(?:\.|$)/i.test(path) ||
    /\.(?:pem|key|p12|pfx|dump|log|trace|tsbuildinfo|py[co])$/i.test(path) ||
    (path.startsWith("screenshots/") && !screenshots.has(name)) ||
    ["scripts/src/hello.ts", "scripts/post-merge.sh"].includes(path)
  );
}
function within(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}
export function packageSource({
  root = projectRoot,
  stage,
  archive,
  allowlist = allowedFiles,
  revision = "HEAD",
}) {
  const physical = (path) =>
    existsSync(path)
      ? realpathSync(path)
      : join(physical(dirname(path)), basename(path));
  root = realpathSync(root);
  stage = physical(resolve(stage));
  archive = physical(resolve(archive));
  if (
    within(root, stage) ||
    within(stage, root) ||
    within(stage, archive) ||
    stage === "/"
  )
    throw new Error("Unsafe staging/archive path");
  // Never remove an operator-supplied directory. Each candidate gets a fresh stage.
  if (existsSync(stage))
    throw new Error("Staging already exists; choose a new empty path");
  if (existsSync(archive))
    throw new Error("Archive already exists; choose a new path");
  const sourceRevision = execFileSync(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const entries = execFileSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", sourceRevision],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^([0-7]+) ([a-z]+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error("Invalid committed source inventory");
      const [, mode, type, oid, path] = match;
      if (
        path.startsWith("/") ||
        path.split("/").some((part) => part === ".." || part === "") ||
        path.includes("\\")
      )
        throw new Error("Unsafe committed source path");
      return { mode, type, oid, path };
    });
  const allowed = (path) =>
    allowlist.some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    );
  for (const prefix of allowlist) {
    if (
      !entries.some(
        (entry) => entry.path === prefix || entry.path.startsWith(prefix + "/"),
      )
    )
      throw new Error(`Required committed path missing: ${prefix}`);
  }
  const files = [];
  mkdirSync(stage, { recursive: true });
  // Read immutable blobs, never recurse through the local working tree. Ignored
  // prose, generated files and even concurrent tracked-file edits cannot enter.
  for (const entry of entries) {
    if (!allowed(entry.path) || shouldExclude(entry.path)) continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new Error(`Refusing non-regular committed source: ${entry.path}`);
    const content = execFileSync("git", ["cat-file", "blob", entry.oid], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    });
    const target = join(stage, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, {
      flag: "wx",
      mode: entry.mode === "100755" ? 0o755 : 0o644,
    });
    files.push([
      entry.path,
      createHash("sha256").update(content).digest("hex"),
    ]);
  }
  mkdirSync(dirname(archive), { recursive: true });
  // Python stdlib gives the same sorted, normalized archive on BSD and GNU hosts.
  execFileSync(
    process.env.PYTHON || "python3",
    [
      "-c",
      `
import gzip, os, sys, tarfile
stage, archive = sys.argv[1:]
with open(archive, 'wb') as output:
 with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
  with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as tar:
   for base, dirs, files in os.walk(stage):
    dirs.sort()
    for name in sorted(files):
     path = os.path.join(base, name)
     info = tar.gettarinfo(path, 'reviewflow-source/' + os.path.relpath(path, stage))
     info.uid = info.gid = 0; info.uname = info.gname = ''; info.mtime = 0
     info.mode = 0o755 if info.mode & 0o111 else 0o644
     with open(path, 'rb') as source: tar.addfile(info, source)
`,
      stage,
      archive,
    ],
    { stdio: "inherit" },
  );
  return { stage, archive, revision: sourceRevision, files };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const parent = mkdtempSync(join(tmpdir(), "reviewflow-candidate-"));
  const result = packageSource({
    stage: process.env.REVIEWFLOW_SOURCE_STAGE || join(parent, "stage"),
    archive:
      process.env.REVIEWFLOW_SOURCE_ARCHIVE ||
      join(parent, "reviewflow-source.tar.gz"),
  });
  console.log(
    `Committed source revision: ${result.revision}\nStaged source candidate: ${result.stage}\nCreated source archive: ${result.archive}`,
  );
}
