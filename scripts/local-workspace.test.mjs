import test from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  symlink,
  realpath,
  chmod,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDirectory,
  readWorkspace,
  workspaceLock,
  schemaHash,
} from "./local-workspace.mjs";
async function fixture(t) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "reviewflow-workspace-unit-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  return join(parent, "workspace");
}
test("initialization refuses existing and interrupted paths without altering data", async (t) => {
  const path = await fixture(t);
  await initializeDirectory(path);
  const secret = await readFile(join(path, "session-secret"), "utf8");
  await assert.rejects(initializeDirectory(path), /NEW directory/);
  await assert.rejects(readWorkspace(path), /interrupted/);
  assert.equal(await readFile(join(path, "session-secret"), "utf8"), secret);
});
test("workspace lock fails closed, including stale locks", async (t) => {
  const path = await fixture(t);
  await initializeDirectory(path);
  const release = await workspaceLock(path);
  await assert.rejects(workspaceLock(path), /lock exists/);
  await release();
  await (
    await workspaceLock(path)
  )();
});
test("ready manifest binds canonical path, schema and private files", async (t) => {
  const path = await fixture(t);
  const { manifest } = await initializeDirectory(path);
  await mkdir(join(path, "data"), { mode: 0o700 });
  manifest.state = "ready";
  manifest.systemIdentifier = "123";
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  assert.equal((await readWorkspace(path)).manifest.id, manifest.id);
  manifest.schemaHash = "stale";
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(readWorkspace(path), /upgrade/);
  const link = `${path}-link`;
  await symlink(path, link);
  await assert.rejects(readWorkspace(link), /canonical/);
});
test("migration inventory hash detects content changes", async (t) => {
  const path = await fixture(t);
  await mkdir(path);
  await writeFile(join(path, "001.sql"), "SELECT 1;");
  const before = await schemaHash(path);
  await writeFile(join(path, "001.sql"), "SELECT 2;");
  assert.notEqual(await schemaHash(path), before);
});

test("copied identity and permissive secrets are refused", async (t) => {
  const path = await fixture(t);
  const { manifest } = await initializeDirectory(path);
  await mkdir(join(path, "data"), { mode: 0o700 });
  Object.assign(manifest, {
    state: "ready",
    systemIdentifier: "123",
    path: "/different-owned-workspace",
  });
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(readWorkspace(path), /identity mismatch/);
  manifest.path = path;
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  await chmod(join(path, "session-secret"), 0o644);
  await assert.rejects(readWorkspace(path), /owned private file/);
});
test("existing unknown empty directory is never adopted", async (t) => {
  const path = await fixture(t);
  await mkdir(path, { mode: 0o700 });
  await assert.rejects(initializeDirectory(path), /NEW directory/);
  await assert.rejects(readFile(join(path, "manifest.json")), {
    code: "ENOENT",
  });
});

test("source checkout root and descendants are refused before creating files", async () => {
  const root = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  await assert.rejects(
    initializeDirectory(root),
    /outside the source checkout/,
  );
  await assert.rejects(readWorkspace(root), /outside the source checkout/);
  for (const parent of [root, join(root, "scripts")]) {
    const path = join(parent, `workspace-refusal-${randomUUID()}`);
    await assert.rejects(
      initializeDirectory(path),
      /outside the source checkout/,
    );
    await assert.rejects(lstat(path), { code: "ENOENT" });
    await assert.rejects(readWorkspace(path), /outside the source checkout/);
  }
});
