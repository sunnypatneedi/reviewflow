import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.REVIEWFLOW_MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "REVIEWFLOW_MIGRATION_DATABASE_URL is required; DATABASE_URL is intentionally ignored",
  );
}
if (process.env.REVIEWFLOW_DISPOSABLE_DB !== "1") {
  throw new Error("Set REVIEWFLOW_DISPOSABLE_DB=1 to confirm this database is disposable");
}

let databaseName;
try {
  databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch {
  throw new Error("REVIEWFLOW_MIGRATION_DATABASE_URL is not a valid PostgreSQL URL");
}
if (!/^reviewflow_(?:dev|demo|test|ci)(?:_|$)/.test(databaseName)) {
  throw new Error(
    "Refusing migration: database name must begin reviewflow_dev, reviewflow_demo, reviewflow_test, or reviewflow_ci",
  );
}
if (process.env.REVIEWFLOW_MIGRATION_CONFIRM !== databaseName) {
  throw new Error(
    "Set REVIEWFLOW_MIGRATION_CONFIRM to the exact disposable database name",
  );
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log(`Applied committed migrations to disposable database ${databaseName}`);
} finally {
  await pool.end();
}