import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Append-only policy revisions. The default policy is revision zero.
export const factoryPoliciesTable = pgTable("rf_factory_policies", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  factory: text("factory").notNull(),
  revision: integer("revision").notNull(),
  definition: jsonb("definition").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("rf_factory_policy_revision_unique").on(table.projectId, table.factory, table.revision)]);

export const factoryItemsTable = pgTable("rf_factory_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  factory: text("factory").notNull(),
  itemId: text("item_id").notNull(),
  quarantined: boolean("quarantined").notNull().default(false),
  quarantineReason: text("quarantine_reason"),
  revision: integer("revision").notNull().default(0),
  assignedTo: text("assigned_to"),
  claimToken: text("claim_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, table => [uniqueIndex("rf_factory_item_unique").on(table.projectId, table.factory, table.itemId)]);
