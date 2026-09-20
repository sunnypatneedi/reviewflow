import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const projectsTable = pgTable("rf_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id"),
  demoSessionId: text("demo_session_id"),
  mode: text("mode").notNull().default("demo"),
  rubricVersion: text("rubric_version").notNull().default("evidence-v1"),
  shadowPolicyVersion: text("shadow_policy_version").notNull().default("shadow-v1"),
  ...timestamps,
});

export const membershipsTable = pgTable("rf_memberships", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_memberships_project_user_unique").on(table.projectId, table.userId),
]);

export const rubricVersionsTable = pgTable("rf_rubric_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  version: text("version").notNull(),
  definition: jsonb("definition").notNull(),
  ...timestamps,
});

export const tasksTable = pgTable("rf_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  externalId: text("external_id").notNull(),
  question: text("question").notNull(),
  evidence: text("evidence").notNull(),
  candidateAnswer: text("candidate_answer").notNull(),
  scenarioFamilyId: text("scenario_family_id"),
  risk: text("risk").notNull(),
  status: text("status").notNull().default("pending"),
  version: integer("version").notNull().default(1),
  mode: text("mode").notNull().default("demo"),
  finalLabel: text("final_label"),
  referenceLabel: text("reference_label"),
  contentHash: text("content_hash").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_tasks_project_external_unique").on(table.projectId, table.externalId),
]);

export const jobsTable = pgTable("rf_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull().default("queued"),
  mode: text("mode").notNull().default("demo"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_jobs_task_mode_unique").on(table.taskId, table.mode),
  index("rf_jobs_claim_index").on(table.status, table.availableAt, table.leaseExpiresAt),
]);

export const proposalsTable = pgTable("rf_proposals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskId: text("task_id").notNull(),
  mode: text("mode").notNull(),
  requestedModel: text("requested_model").notNull(),
  returnedModel: text("returned_model").notNull(),
  label: text("label").notNull(),
  labelProbability: text("label_probability").notNull(),
  probabilities: jsonb("probabilities").notNull(),
  injectionProbability: text("injection_probability").notNull(),
  complexity: integer("complexity").notNull(),
  confidence: text("confidence").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  rawResponse: jsonb("raw_response").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_proposals_task_mode_unique").on(table.taskId, table.mode),
]);

export const reviewsTable = pgTable("rf_reviews", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskId: text("task_id").notNull(),
  proposalId: text("proposal_id").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  action: text("action").notNull(),
  label: text("label"),
  reason: text("reason"),
  evidenceExcerpt: text("evidence_excerpt"),
  activeMs: integer("active_ms").notNull(),
  taskVersion: integer("task_version").notNull(),
  ...timestamps,
});

export const auditsTable = pgTable("rf_audits", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  status: text("status").notNull(),
  sampleSize: integer("sample_size").notNull(),
  seed: text("seed").notNull(),
  samplingFrameHash: text("sampling_frame_hash").notNull(),
  samplingFrame: jsonb("sampling_frame").notNull(),
  independent: boolean("independent").notNull(),
  required: boolean("required").notNull().default(true),
  auditorId: text("auditor_id"),
  ...timestamps,
});

export const auditItemsTable = pgTable("rf_audit_items", {
  id: text("id").primaryKey(),
  auditId: text("audit_id").notNull(),
  taskId: text("task_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  originalReviewId: text("original_review_id").notNull(),
  originalReviewerId: text("original_reviewer_id").notNull(),
  originalLabel: text("original_label").notNull(),
  taskContentHash: text("task_content_hash").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_audit_items_audit_task_unique").on(table.auditId, table.taskId),
]);
export const releasesTable = pgTable("rf_releases", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  itemCount: integer("item_count").notNull(),
  includeSourceText: boolean("include_source_text").notNull(),
  digest: text("digest").notNull(),
  manifest: jsonb("manifest").notNull(),
  jsonl: text("jsonl").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eventsTable = pgTable("rf_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  actorId: text("actor_id").notNull(),
  type: text("type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditDisputesTable = pgTable("rf_audit_disputes", {
  id: text("id").primaryKey(),
  auditId: text("audit_id").notNull(),
  auditItemId: text("audit_item_id").notNull(),
  taskId: text("task_id").notNull(),
  originalLabel: text("original_label").notNull(),
  auditLabel: text("audit_label").notNull(),
  status: text("status").notNull().default("pending"),
  adjudicatorId: text("adjudicator_id"),
  resolvedLabel: text("resolved_label"),
  reason: text("reason"),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_audit_disputes_item_unique").on(table.auditItemId),
]);

export const auditDecisionsTable = pgTable("rf_audit_decisions", {
  id: text("id").primaryKey(),
  auditId: text("audit_id").notNull(),
  auditItemId: text("audit_item_id").notNull(),
  taskId: text("task_id").notNull(),
  auditorId: text("auditor_id").notNull(),
  label: text("label").notNull(),
  reason: text("reason"),
  selfCheck: boolean("self_check").notNull().default(false),
  included: boolean("included").notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("rf_audit_decisions_item_auditor_unique").on(table.auditItemId, table.auditorId),
]);
