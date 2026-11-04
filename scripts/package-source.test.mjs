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
