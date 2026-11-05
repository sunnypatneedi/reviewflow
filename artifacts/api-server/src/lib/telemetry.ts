import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const TELEMETRY_KINDS = [
  "task_opened",
  "asset_loaded",
  "proposal_shown",
  "edit",
  "submit",
  "review",
  "release",
  "foreground",
  "session_closed",
] as const;
export type BrowserEvent = {
  id: string;
  session: string;
  sequence: number;
  kind: (typeof TELEMETRY_KINDS)[number];
  factory: "evidence" | "preference" | "audit" | "rubric";
  itemId: string | null;
  itemVersion: number | null;
  proposalId: string | null;
  visibleMs: number;
  dropped: number;
};
const identifier = (x: unknown) =>
  typeof x === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(x);
export function parseTelemetry(body: unknown): BrowserEvent[] {
  if (!Array.isArray(body) || body.length < 1 || body.length > 50)
    throw new Error("Invalid batch");
  return body.map((e) => {
    const keys = [
      "id",
      "session",
      "sequence",
      "kind",
      "factory",
      "itemId",
      "itemVersion",
      "proposalId",
      "visibleMs",
      "dropped",
    ];
    if (
      !e ||
      typeof e !== "object" ||
      Object.keys(e).some((k) => !keys.includes(k)) ||
      !identifier(e.id) ||
      !identifier(e.session) ||
      !Number.isInteger(e.sequence) ||
      e.sequence < 1 ||
      e.sequence > 1000000 ||
      !TELEMETRY_KINDS.includes(e.kind) ||
      !["evidence", "preference", "audit", "rubric"].includes(e.factory) ||
      !(e.itemId === null || identifier(e.itemId)) ||
      !(e.proposalId === null || identifier(e.proposalId)) ||
      !(
        e.itemVersion === null ||
        (Number.isInteger(e.itemVersion) &&
          e.itemVersion >= 0 &&
          e.itemVersion <= 2147483647)
      ) ||
      !Number.isInteger(e.visibleMs) ||
      e.visibleMs < 0 ||
      e.visibleMs > 15000 ||
      (e.kind !== "foreground" && e.visibleMs !== 0) ||
      !Number.isInteger(e.dropped) ||
      e.dropped < 0 ||
      e.dropped > 1000000
    )
      throw new Error("Invalid event");
    return e as BrowserEvent;
  });
}
export const telemetryIdentity = (
  project: string,
  actor: string,
  value: string,
) =>
  createHash("sha256")
    .update(JSON.stringify([project, actor, value]))
    .digest("hex");
/** PostgreSQL row locks are the lease: disconnect/rollback releases them immediately.
 * Projection insert and delivery acknowledgement commit together. A crashed transaction
 * retries from the durable outbox, and the primary key makes delivery idempotent. */
export async function drainTelemetry(project: string, tx: any = db) {
  await tx.execute(sql`WITH pending AS (
    SELECT * FROM rf_telemetry_outbox WHERE project_id=${project} AND delivered_at IS NULL
    ORDER BY occurred_at,event_id LIMIT 1000 FOR UPDATE SKIP LOCKED
  ), projected AS (
    INSERT INTO rf_telemetry_projection(event_id,project_id,event_type,occurred_at)
    SELECT event_id,project_id,event_type,occurred_at FROM pending ON CONFLICT DO NOTHING RETURNING event_id
  ) UPDATE rf_telemetry_outbox SET delivered_at=clock_timestamp() WHERE event_id IN (SELECT event_id FROM pending)`);
}
export async function telemetrySnapshot(project: string, tx: any = db) {
  const delivery =
    await tx.execute(sql`SELECT count(*) FILTER(WHERE delivered_at IS NULL)::int AS pending,
    count(*) FILTER(WHERE delivered_at IS NOT NULL)::int AS delivered,
    EXTRACT(EPOCH FROM (now()-min(occurred_at) FILTER(WHERE delivered_at IS NULL)))*1000 AS "oldestPendingMs"
    FROM rf_telemetry_outbox WHERE project_id=${project}`);
  const browser = await tx.execute(sql`WITH sessions AS (
    SELECT session_id,max(sequence)-count(*) AS gaps,max(dropped) AS dropped,
      max(sequence) FILTER(WHERE kind='session_closed')=max(sequence) AS closed,sum(visible_ms) AS visible
    FROM rf_browser_telemetry WHERE project_id=${project} GROUP BY session_id
  ) SELECT count(*)::int AS sessions,coalesce(sum(gaps),0)::int AS "missingSequences",
    coalesce(sum(dropped),0)::int AS "reportedDropped",count(*) FILTER(WHERE closed IS NOT TRUE)::int AS "unclosedSessions",
    coalesce(sum(visible),0)::float8 AS "observedForegroundMs" FROM sessions`);
  const events =
    await tx.execute(sql`SELECT event_type AS type,count(*)::int AS count FROM rf_telemetry_projection
    WHERE project_id=${project} GROUP BY event_type ORDER BY event_type`);
  return {
    delivery: delivery.rows[0],
    browser: browser.rows[0],
    events: events.rows,
    lifetimeAttemptStarts:
      events.rows.find((e: any) => e.type === "evaluation.attempt.started")
        ?.count ?? 0,
    coverage:
      "Partial, client-reported foreground presence, not verified attention or total human effort. Missing sequences may arrive late; closed sessions can still have gaps. Entirely lost sessions are unknown. Event counts cover retained server events, including backfill; lifetime attempt starts cover instrumented starts only, not historical calls or billing; never authorization or quality evidence.",
  };
}

/** Optional worker lifecycle hook; failures leave the outbox pending. */
export function startTelemetryConsumer(intervalMs = 5000) {
  let stopped = false,
    running: Promise<void> | null = null;
  const run = async () => {
    if (stopped || running) return;
    running = (async () => {
      try {
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
          return tx.execute(
            sql`SELECT project_id FROM rf_telemetry_outbox WHERE delivered_at IS NULL GROUP BY project_id ORDER BY min(occurred_at),project_id LIMIT 20`,
          );
        });
        for (const row of result.rows) {
          if (stopped) break;
          await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
            await drainTelemetry(String(row.project_id), tx);
          });
        }
      } catch {
        /* backlog is the durable failure signal; no payload/DB details logged */
      }
    })();
    await running;
    running = null;
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
