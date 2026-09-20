import assert from "node:assert/strict";

assert.equal(
  process.env.REVIEWFLOW_DISPOSABLE_DB,
  "1",
  "Database tests require REVIEWFLOW_DISPOSABLE_DB=1",
);
assert.ok(process.env.DATABASE_URL, "Database tests require an explicit DATABASE_URL");
let databaseName;
try {
  databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
} catch {
  assert.fail("DATABASE_URL must be a valid PostgreSQL URL");
}
assert.match(
  databaseName,
  /^reviewflow_(?:dev|demo|test|ci)(?:_|$)/,
  "Refusing tests: the selected database is not named as a disposable ReviewFlow database",
);