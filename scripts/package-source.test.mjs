import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageSource, shouldExclude } from "./package-source.mjs";

const git = (root, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Synthetic fixture",
      "-c",
      "user.email=fixture@example.invalid",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
const commit = (root) => {
  git(root, "add", "-A");
  git(root, "commit", "-qm", "Synthetic package fixture");
};

test("publication excludes nested credentials and includes the reviewed screenshots", () => {
  for (const path of [
    "lib/.env",
    "lib/deep/.env.local",
    "docs/private.key",
    "scripts/credentials.json",
    "lib/id_rsa",
    "lib/node_modules/index.js",
    "screenshots/unreviewed.png",
  ])
    assert.equal(shouldExclude(path), true, path);
  for (const path of [
    ".env.example",
    "lib/.env.example",
    "screenshots/reviewflow-team.png",
    "screenshots/reviewflow-launch.png",
  ])
    assert.equal(shouldExclude(path), false, path);
});
test("source archive is deterministic, refuses symlinks and never deletes an existing stage", () => {
  const base = mkdtempSync(join(tmpdir(), "reviewflow-package-test-")),
    root = join(base, "root");
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "README.md"), "Synthetic candidate\n");
    writeFileSync(join(root, "docs", ".env"), "SYNTHETIC_SECRET=excluded\n");
    git(root, "init", "-q", "--template=");
    commit(root);
    const run = (n) =>
      packageSource({
        root,
        stage: join(base, `stage${n}`),
        archive: join(base, `archive${n}.tar.gz`),
        allowlist: ["docs"],
      });
    run(1);
    run(2);
    assert.deepEqual(
      readFileSync(join(base, "archive1.tar.gz")),
      readFileSync(join(base, "archive2.tar.gz")),
    );
    assert.equal(existsSync(join(base, "stage1/docs/.env")), false);
    assert.throws(() => run(1), /already exists/);
    assert.equal(
      readFileSync(join(base, "stage1/docs/README.md"), "utf8"),
      "Synthetic candidate\n",
    );
    symlinkSync(join(root, "docs/README.md"), join(root, "docs/link"));
    commit(root);
    assert.throws(() => run(3), /non-regular/);
    assert.throws(
      () =>
        packageSource({
          root,
          stage: root,
          archive: join(base, "unsafe.tar.gz"),
        }),
      /Unsafe/,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("clean status cannot admit ignored prose; packaging uses pinned committed bytes", () => {
  const base = mkdtempSync(join(tmpdir(), "reviewflow-commit-package-test-")),
    root = join(base, "repo");
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "tmp\n.DS_Store\nout-tsc\n");
    writeFileSync(join(root, "docs/public.md"), "Committed public source\n");
    git(root, "init", "-q", "--template=");
    commit(root);
    const revision = git(root, "rev-parse", "HEAD").trim();
    mkdirSync(join(root, "docs/tmp"));
    writeFileSync(
      join(root, "docs/tmp/private-note.txt"),
      "Synthetic private prose without a detectable secret\n",
    );
    writeFileSync(join(root, "docs/.DS_Store"), "Synthetic metadata");
    mkdirSync(join(root, "docs/out-tsc"));
    writeFileSync(
      join(root, "docs/out-tsc/generated.js"),
      "Synthetic generated material",
    );
    assert.equal(
      git(root, "status", "--porcelain").trim(),
      "",
      "Reproduce the reviewer's ignored-but-clean fixture",
    );
    const result = packageSource({
      root,
      stage: join(base, "stage"),
      archive: join(base, "source.tar.gz"),
      allowlist: ["docs"],
      revision,
    });
    assert.equal(result.revision, revision);
    assert.equal(
      existsSync(join(result.stage, "docs/tmp/private-note.txt")),
      false,
    );
    assert.equal(existsSync(join(result.stage, "docs/.DS_Store")), false);
    assert.equal(
      existsSync(join(result.stage, "docs/out-tsc/generated.js")),
      false,
    );
    assert.deepEqual(
      result.files.map(([path]) => path),
      ["docs/public.md"],
    );
    writeFileSync(join(root, "docs/public.md"), "Uncommitted local edit\n");
    commit(root); // HEAD now differs, but explicit old revision must remain immutable.
    const pinned = packageSource({
      root,
      stage: join(base, "pinned"),
      archive: join(base, "pinned.tar.gz"),
      allowlist: ["docs"],
      revision,
    });
    assert.equal(
      readFileSync(join(pinned.stage, "docs/public.md"), "utf8"),
      "Committed public source\n",
    );
    assert.deepEqual(
      readFileSync(result.archive),
      readFileSync(pinned.archive),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
