#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
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
  mkdirSync(stage, { recursive: true });
  function copy(path) {
    if (shouldExclude(path)) return;
    const source = join(root, path),
      target = join(stage, path),
      stat = lstatSync(source);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new Error(`Refusing non-regular source: ${path}`);
    if (stat.isDirectory()) {
      mkdirSync(target, { recursive: true });
      for (const entry of readdirSync(source).sort()) copy(`${path}/${entry}`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
    }
  }
  for (const path of allowlist) {
    if (!existsSync(join(root, path)))
      throw new Error(`Required path missing: ${path}`);
    copy(path);
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
  return { stage, archive };
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
    `Staged source candidate: ${result.stage}\nCreated source archive: ${result.archive}`,
  );
}
