#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSource } from "./package-source.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw new Error("Commit the candidate first: clean checkout required");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const folder = mkdtempSync(join(tmpdir(), "reviewflow-clean-candidate-"));
const {
  stage,
  archive,
  revision: sourceRevision,
  files,
} = packageSource({
  revision,
  stage: join(folder, "stage"),
  archive: join(folder, "reviewflow-source.tar.gz"),
});
// Check every screenshot reference in shipped Markdown against the actual artifact.
function checkLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) checkLinks(path);
    else if (entry.name.endsWith(".md")) {
      for (const match of readFileSync(path, "utf8").matchAll(
        /\]\(([^)\s]*screenshots\/[^)\s]+)\)/g,
      )) {
        if (!existsSync(resolve(dirname(path), match[1])))
          throw new Error(`Missing screenshot in candidate: ${match[1]}`);
      }
    }
  }
}
checkLinks(stage);
const scanner = process.env.REVIEWFLOW_GITLEAKS;
if (!scanner)
  throw new Error(
    "Set REVIEWFLOW_GITLEAKS to a trusted installed gitleaks binary; candidate scans are required",
  );
execFileSync(
  scanner,
  [
    "dir",
    stage,
    "--redact",
    "--report-format",
    "json",
    "--report-path",
    join(folder, "secrets.json"),
  ],
  { stdio: "inherit" },
);
const extracted = join(folder, "extracted");
execFileSync(process.env.PYTHON || "python3", [
  "-c",
  `
import pathlib, sys, tarfile
archive, destination = sys.argv[1:]
with tarfile.open(archive, 'r:gz') as tar:
 for member in tar:
  path = pathlib.PurePosixPath(member.name)
  if not member.isfile() or path.parts[0] != 'reviewflow-source' or '..' in path.parts: raise ValueError('Unsafe archive member')
  target = pathlib.Path(destination).joinpath(*path.parts)
  target.parent.mkdir(parents=True, exist_ok=True)
  target.write_bytes(tar.extractfile(member).read()); target.chmod(member.mode)
`,
  archive,
  extracted,
]);
function inventory(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = prefix + entry.name;
      return entry.isDirectory()
        ? inventory(join(directory, entry.name), name + "/")
        : [
            [
              name,
              createHash("sha256")
                .update(readFileSync(join(directory, entry.name)))
                .digest("hex"),
            ],
          ];
    });
}
assert.equal(sourceRevision, revision, "Package must use the recorded commit");
const sorted = (rows) => [...rows].sort((a, b) => a[0].localeCompare(b[0]));
assert.deepEqual(
  sorted(inventory(stage)),
  sorted(files),
  "Scanned stage must match the allowlisted committed blobs",
);
assert.deepEqual(
  inventory(join(extracted, "reviewflow-source")),
  inventory(stage),
  "Extracted source must exactly match the scanned stage",
);
execFileSync(process.execPath, ["scripts/verify-local.mjs"], {
  cwd: join(extracted, "reviewflow-source"),
  env: { ...process.env, REVIEWFLOW_SOURCE_REVISION: revision },
  stdio: "inherit",
});
const manifest = {
  revision,
  archive,
  sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  secrets: "gitleaks candidate scan passed",
  inventory: "committed/staged/extracted paths and SHA-256 digests match",
  fileCount: files.length,
  verification:
    "full isolated API/build/recovery, synthetic browser/accessibility, disposable launcher and durable local restart gates passed from extracted archive",
  published: false,
};
writeFileSync(
  join(folder, "verification.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
