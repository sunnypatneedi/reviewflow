import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Rubric definitions and provenance are append-only; item source identity never changes. */
export const rubricSpecsTable = pgTable(
  "rf_rubric_specs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    revision: integer("revision").notNull(),
    hash: text("hash").notNull(),
    definition: jsonb("definition").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rf_rubric_spec_revision_unique").on(t.projectId, t.revision),
  ],
);
export const rubricItemsTable = pgTable(
  "rf_rubric_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    rubricId: text("rubric_id")
      .notNull()
      .references(() => rubricSpecsTable.id),
    externalId: text("external_id").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
    state: jsonb("state").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rf_rubric_item_external_unique").on(t.projectId, t.externalId),
  ],
);
export const rubricRecordsTable = pgTable("rf_rubric_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),
  itemId: text("item_id"),
  actor: text("actor").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
