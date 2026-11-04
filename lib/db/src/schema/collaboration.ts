import { integer, pgTable, text, primaryKey } from "drizzle-orm/pg-core";

/** Shared scratchpad only. Final decisions remain immutable review events. */
export const sharedNotesTable = pgTable(
  "rf_shared_notes",
  {
    projectId: text("project_id").notNull(),
    taskId: text("task_id").notNull(),
    contentHash: text("content_hash").notNull(),
    state: text("state").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.taskId] })],
);
