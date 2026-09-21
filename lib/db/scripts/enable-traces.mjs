// Explicit operator command for an existing DEVELOPMENT workspace only.
// Never imported by application startup, deployment, or disposable migrations.
import pg from "pg";

const confirmation = "--confirm-additive-trace-schema";
if (process.argv.slice(2).length !== 1 || process.argv[2] !== confirmation) {
  console.error(`Refusing: run with ${confirmation} after reviewing this additive development-only operation.`);
  process.exit(1);
}
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  console.error("Refusing: managed production schema changes belong to the Publish flow.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required; connection details will not be printed.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
let client;
const incompatible = message => { throw new Error(`Incompatible existing schema: ${message}. No changes committed.`); };
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '20s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reviewflow:enable-traces-schema:v1', 0))");
  const projects = await client.query(`
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='rf_projects' AND c.relkind='r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a JOIN pg_constraint k ON k.conrelid=c.oid
        WHERE a.attrelid=c.oid AND a.attname='id' AND a.atttypid='text'::regtype
          AND a.attnotnull AND NOT a.attisdropped AND k.contype='p'
          AND k.conkey=ARRAY[a.attnum]::smallint[]
      )
  `);
  if (projects.rowCount !== 1) incompatible("public.rf_projects with a text primary key id is required");

  // These are the ONLY schema mutations in this command. No data mutation,
  // migration-history writes, ALTER, DROP, DELETE, or schema-wide synchronization.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.rf_trace_records (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES public.rf_projects(id),
      kind text NOT NULL,
      key text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  const columns = await client.query(`
    SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
           a.attnotnull AS required, a.attidentity AS identity, a.attgenerated AS generated,
           pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname='rf_trace_records' AND c.relkind='r'
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
  `);
  const expected = { id: "text", project_id: "text", kind: "text", key: "text", payload: "jsonb", created_at: "timestamp with time zone" };
  if (columns.rowCount !== Object.keys(expected).length
    || columns.rows.some(c => expected[c.name] !== c.type || !c.required || c.identity || c.generated)
    || !/^(now\(\)|CURRENT_TIMESTAMP)$/i.test(columns.rows.find(c => c.name === "created_at")?.default_value ?? "")) {
    incompatible("public.rf_trace_records columns must match the committed Trace2Preference schema");
  }
  const constraints = await client.query(`
    SELECT k.contype, k.convalidated, k.confrelid,
      ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(num,ord)
            JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num ORDER BY u.ord) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(num,ord)
            JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num ORDER BY u.ord) AS referenced_columns
    FROM pg_constraint k WHERE k.conrelid='public.rf_trace_records'::regclass
  `);
  if (!constraints.rows.some(k => k.contype === "p" && JSON.stringify(k.columns) === '["id"]')
    || !constraints.rows.some(k => k.contype === "f" && k.convalidated
      && Number(k.confrelid) === Number(projects.rows[0].oid)
      && JSON.stringify(k.columns) === '["project_id"]' && JSON.stringify(k.referenced_columns) === '["id"]')) {
    incompatible("trace primary key or project foreign key is missing");
  }
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rf_trace_records_project_kind_key
      ON public.rf_trace_records (project_id, kind, key)
  `);
  const indexes = await client.query(`
    SELECT i.indisunique, i.indisvalid, i.indisready, i.indpred IS NULL AS unfiltered,
      i.indexprs IS NULL AS unexpressed, i.indnatts,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY u(num,ord)
            JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=u.num ORDER BY u.ord) AS columns
    FROM pg_index i
    WHERE i.indexrelid=to_regclass('public.rf_trace_records_project_kind_key')
      AND i.indrelid='public.rf_trace_records'::regclass
  `);
  const index = indexes.rows[0];
  if (!index || !index.indisunique || !index.indisvalid || !index.indisready
    || !index.unfiltered || !index.unexpressed || index.indnatts !== 3
    || JSON.stringify(index.columns) !== '["project_id","kind","key"]') {
    incompatible("trace project/kind/key unique index does not match");
  }
  await client.query("COMMIT");
  console.log("Trace development schema is compatible and enabled. Existing application records were not modified.");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  // Driver messages may contain connection or data details: print only our fixed
  // validation text, or a non-sensitive PostgreSQL error code.
  console.error(error instanceof Error && error.message.startsWith("Incompatible existing schema:")
    ? error.message : `Trace schema addition failed; no changes committed${/^[A-Z0-9]{5}$/.test(error?.code ?? "") ? ` (database code ${error.code})` : ""}.`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}