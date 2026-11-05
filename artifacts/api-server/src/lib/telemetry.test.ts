import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  parseTelemetry,
  drainTelemetry,
  telemetrySnapshot,
  telemetryIdentity,
} from "./telemetry";
const event = {
  id: "event_1",
  session: "session_1",
  sequence: 1,
  kind: "foreground",
  factory: "evidence",
  itemId: "item_1",
  itemVersion: 2,
  proposalId: null,
  visibleMs: 15000,
  dropped: 0,
};
test("telemetry rejects text/payload/secret fields, invalid identifiers and unbounded intervals", () => {
  assert.deepEqual(parseTelemetry([event]), [event]);
  for (const changed of [
    { ...event, reason: "private" },
    { ...event, itemId: "raw source with spaces" },
    { ...event, visibleMs: 15001 },
    { ...event, sequence: 0 },
    { ...event, kind: "edit", visibleMs: 1 },
  ])
    assert.throws(() => parseTelemetry([changed]));
  assert.throws(() => parseTelemetry(Array(51).fill(event)));
  assert.notEqual(
    telemetryIdentity("project", "actor1", "session"),
    telemetryIdentity("project", "actor2", "session"),
  );
});
test("transactional outbox survives rollback, late commit, repeated/concurrent delivery and lock recovery", async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  const project = randomUUID(),
    early = randomUUID(),
    late = randomUUID(),
    aborted = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO rf_events(id,project_id,actor_id,type,entity_id,payload,created_at) VALUES($1,$2,'private','test.late','private',$3,'2000-01-01')",
      [late, project, { reason: "SECRET_SENTINEL" }],
    );
    await db.execute(
      sql`INSERT INTO rf_events(id,project_id,actor_id,type,entity_id,payload) VALUES(${early},${project},'private','test.early','private','{}')`,
    );
    await drainTelemetry(project);
    assert.equal((await telemetrySnapshot(project)).delivery.delivered, 1);
    await client.query("COMMIT");
    await Promise.all([drainTelemetry(project), drainTelemetry(project)]);
    await drainTelemetry(project);
    assert.equal((await telemetrySnapshot(project)).delivery.delivered, 2);
    assert.equal(
      (await telemetrySnapshot(project)).events.reduce(
        (n: number, e: any) => n + e.count,
        0,
      ),
      2,
    );
    assert.ok(
      !JSON.stringify(await telemetrySnapshot(project)).includes(
        "SECRET_SENTINEL",
      ),
    );
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO rf_events(id,project_id,actor_id,type,entity_id,payload) VALUES($1,$2,'private','test.rollback','private','{}')",
      [aborted, project],
    );
    await client.query("ROLLBACK");
    assert.equal((await telemetrySnapshot(project)).delivery.delivered, 2);
    // A consumer that dies before commit holds a row lock, not an unrecoverable lease.
    await db.execute(
      sql`UPDATE rf_telemetry_outbox SET delivered_at=NULL WHERE event_id=${early}`,
    );
    await client.query("BEGIN");
    await client.query(
      "SELECT * FROM rf_telemetry_outbox WHERE event_id=$1 FOR UPDATE",
      [early],
    );
    await drainTelemetry(project);
    assert.equal((await telemetrySnapshot(project)).delivery.pending, 1);
    await client.query("ROLLBACK");
    await drainTelemetry(project);
    const recovered = await telemetrySnapshot(project);
    assert.equal(recovered.delivery.pending, 0);
    assert.equal(
      recovered.events.reduce((n: number, e: any) => n + e.count, 0),
      2,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
test("late/out-of-order browser delivery fills gaps without double counting foreground", async () => {
  const project = randomUUID(),
    session = randomUUID();
  const insert = async (sequence: number, kind = "foreground") =>
    db.execute(sql`INSERT INTO rf_browser_telemetry(event_id,project_id,session_id,sequence,kind,factory,visible_ms,dropped)
    VALUES(${session + sequence},${project},${session},${sequence},${kind},'evidence',${kind === "foreground" ? 10000 : 0},0) ON CONFLICT DO NOTHING`);
  await insert(3, "session_closed");
  await insert(1);
  await insert(1);
  assert.equal((await telemetrySnapshot(project)).browser.missingSequences, 1);
  await insert(2);
  const snapshot = await telemetrySnapshot(project);
  assert.equal(snapshot.browser.missingSequences, 0);
  assert.equal(snapshot.browser.observedForegroundMs, 20000);
  assert.equal(snapshot.browser.unclosedSessions, 0);
  await insert(4);
  assert.equal((await telemetrySnapshot(project)).browser.unclosedSessions, 1);
});

after(async () => {
  await pool.end();
});
