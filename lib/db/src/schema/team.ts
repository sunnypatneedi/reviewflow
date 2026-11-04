import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
export const exposuresTable = pgTable("rf_exposures", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(), contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("rf_exposure_unique").on(table.projectId, table.actorId, table.taskId, table.contentHash)]);
export const jevControlsTable = pgTable("rf_jev_controls", {
  projectId: text("project_id").primaryKey(), revision: integer("revision").notNull().default(0),
  enabled: boolean("enabled").notNull().default(false), maxCalls: integer("max_calls").notNull().default(0),
});
export const jevCallsTable = pgTable("rf_jev_calls", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), purpose: text("purpose").notNull(),
  itemId: text("item_id").notNull(), revision: integer("revision").notNull(),
  status: text("status").notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
