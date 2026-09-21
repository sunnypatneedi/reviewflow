import { pgTable, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./reviewflow";

// Payloads are workload-versioned; all writes serialize on the owning project.
export const traceRecordsTable = pgTable("rf_trace_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("rf_trace_records_project_kind_key").on(table.projectId, table.kind, table.key)]);