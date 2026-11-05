import {
  pgTable,
  text,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
export const telemetryOutboxTable = pgTable("rf_telemetry_outbox", {
  eventId: text("event_id").primaryKey(),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});
export const telemetryProjectionTable = pgTable("rf_telemetry_projection", {
  eventId: text("event_id").primaryKey(),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  projectedAt: timestamp("projected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const browserTelemetryTable = pgTable(
  "rf_browser_telemetry",
  {
    eventId: text("event_id").primaryKey(),
    projectId: text("project_id").notNull(),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    factory: text("factory").notNull(),
    itemId: text("item_id"),
    itemVersion: integer("item_version"),
    proposalId: text("proposal_id"),
    visibleMs: integer("visible_ms").notNull(),
    dropped: integer("dropped").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rf_browser_telemetry_session_sequence").on(
      table.projectId,
      table.sessionId,
      table.sequence,
    ),
  ],
);
