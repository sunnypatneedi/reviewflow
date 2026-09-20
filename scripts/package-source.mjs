#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const stagingRoot = resolve(
  process.env.REVIEWFLOW_SOURCE_STAGE || "/tmp/reviewflow-source-stage",
);
const archivePath = resolve(
  process.env.REVIEWFLOW_SOURCE_ARCHIVE ||
    join(projectRoot, "releases", "reviewflow-source.tar.gz"),
);

// Publication is intentionally allowlist-only. Add new source roots explicitly.
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
  "scripts",
  "screenshots/reviewflow-review.png",
  "tsconfig.base.json",
  "tsconfig.json",
];

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
  "releases",
]);

const excludedFilePatterns = [
  /(?:^|\/)(?:npm-debug|yarn-error|testem|libpeerconnection)\.log$/i,
  /\.(?:dump|log|trace)$/i,
  /\.tsbuildinfo$/i,
];

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function shouldExclude(relativePath) {
  if (relativePath.startsWith("screenshots/") && relativePath !== "screenshots/reviewflow-review.png") return true;
  if (relativePath === "scripts/src/hello.ts" || relativePath === "scripts/post-merge.sh") return true;
  const segments = relativePath.split(/[\\/]/);
  return (
    segments.some((segment) => excludedNames.has(segment)) ||
    excludedFilePatterns.some((pattern) => pattern.test(relativePath))
  );
}

function copyCandidate(source, destination, relativePath) {
  if (shouldExclude(relativePath)) return;

  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(source);
    if (!isWithin(projectRoot, target)) {
      throw new Error(`Refusing symlink outside project: ${relativePath}`);
    }
    throw new Error(
      `Refusing symlink in publication candidate: ${relativePath} -> ${readlinkSync(source)}`,
    );
  }
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source).sort()) {
      copyCandidate(
        join(source, entry),
        join(destination, entry),
        `${relativePath}/${entry}`,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Refusing non-file publication candidate: ${relativePath}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    force: true,
    preserveTimestamps: false,
  });
}

if (isWithin(projectRoot, stagingRoot)) {
  throw new Error("Staging must be outside the project tree (use /tmp by default)");
}
if (isWithin(stagingRoot, archivePath)) {
  throw new Error("Archive must not be written inside staging");
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });

for (const relativePath of allowedFiles) {
  const source = join(projectRoot, relativePath);
  if (!existsSync(source)) {
    throw new Error(`Required allowlisted path is missing: ${relativePath}`);
  }
  copyCandidate(source, join(stagingRoot, relativePath), relativePath);
}

mkdirSync(dirname(archivePath), { recursive: true });
rmSync(archivePath, { force: true });
execFileSync(
  "tar",
  [
    "--create",
    "--gzip",
    "--file",
    archivePath,
    "--directory",
    dirname(stagingRoot),
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    dirname(stagingRoot) === stagingRoot ? "." : stagingRoot.split(sep).at(-1),
  ],
  { stdio: "inherit" },
);

console.log(`Staged source candidate: ${stagingRoot}`);
console.log(`Created source archive: ${archivePath}`);