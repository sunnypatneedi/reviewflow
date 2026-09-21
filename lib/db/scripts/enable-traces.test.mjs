import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";

assert.equal(process.env.REVIEWFLOW_DISPOSABLE_DB, "1", "Tests require the disposable harness");
assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1", "Tests require the isolated cluster");
assert.equal(new URL(process.env.DATABASE_URL).pathname, "/reviewflow_test_isolated");
const script = new URL("./enable-traces.mjs", import.meta.url).pathname;
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  env: { ...process.env, NODE_ENV: "development", ...env }, encoding: "utf8", timeout: 30_000,
});
const flag = ["--confirm-additive-trace-schema"];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  assert.equal(run([]).status, 1, "Must refuse without explicit opt-in");
  assert.equal(run(flag, { NODE_ENV: "production" }).status, 1, "Must refuse production");
  assert.equal(run(flag).status, 1, "Must refuse missing existing application schema");
  assert.equal((await db.query("SELECT to_regclass('public.rf_trace_records') AS table")).rows[0].table, null);
  await db.query(await readFile(new URL("../drizzle/0000_initial_schema.sql", import.meta.url), "utf8"));
  await db.query("INSERT INTO rf_projects(id,name) VALUES ('preserved-project','Existing user project')");
  const before = (await db.query("SELECT row_to_json(p) AS data FROM rf_projects p WHERE id='preserved-project'")).rows[0].data;
  const first = run(flag);
  assert.equal(first.status, 0, first.stderr);
  await db.query("INSERT INTO rf_trace_records(id,project_id,kind,key,payload) VALUES ('preserved-trace','preserved-project','fixture','key','{\"existing\":true}')");
  const traceBefore = (await db.query("SELECT row_to_json(t) AS data FROM rf_trace_records t")).rows[0].data;
  const second = run(flag);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual((await db.query("SELECT row_to_json(p) AS data FROM rf_projects p WHERE id='preserved-project'")).rows[0].data, before);
  assert.deepEqual((await db.query("SELECT row_to_json(t) AS data FROM rf_trace_records t")).rows[0].data, traceBefore);
  // Deliberately incompatible fixture is confined to this disposable database.
  await db.query("ALTER TABLE rf_trace_records RENAME COLUMN payload TO incompatible_payload");
  const rejected = run(flag);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Incompatible existing schema/);
  assert.equal((await db.query("SELECT incompatible_payload FROM rf_trace_records")).rows[0].incompatible_payload.existing, true);
  assert.deepEqual((await db.query("SELECT row_to_json(p) AS data FROM rf_projects p WHERE id='preserved-project'")).rows[0].data, before);
  console.log("Additive trace schema checks passed: opt-in, production guard, prerequisite, idempotence twice, existing project/trace preservation, incompatible-table refusal.");
} finally {
  await db.end();
}