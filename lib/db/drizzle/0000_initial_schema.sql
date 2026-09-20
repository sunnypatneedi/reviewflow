CREATE TABLE "rf_audit_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"audit_item_id" text NOT NULL,
	"task_id" text NOT NULL,
	"auditor_id" text NOT NULL,
	"label" text NOT NULL,
	"reason" text,
	"self_check" boolean DEFAULT false NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_audit_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"audit_item_id" text NOT NULL,
	"task_id" text NOT NULL,
	"original_label" text NOT NULL,
	"audit_label" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"adjudicator_id" text,
	"resolved_label" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_audit_items" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"task_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"original_review_id" text NOT NULL,
	"original_reviewer_id" text NOT NULL,
	"original_label" text NOT NULL,
	"task_content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"sample_size" integer NOT NULL,
	"seed" text NOT NULL,
	"sampling_frame_hash" text NOT NULL,
	"sampling_frame" jsonb NOT NULL,
	"independent" boolean NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"auditor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text,
	"demo_session_id" text,
	"mode" text DEFAULT 'demo' NOT NULL,
	"rubric_version" text DEFAULT 'evidence-v1' NOT NULL,
	"shadow_policy_version" text DEFAULT 'shadow-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"mode" text NOT NULL,
	"requested_model" text NOT NULL,
	"returned_model" text NOT NULL,
	"label" text NOT NULL,
	"label_probability" text NOT NULL,
	"probabilities" jsonb NOT NULL,
	"injection_probability" text NOT NULL,
	"complexity" integer NOT NULL,
	"confidence" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"raw_response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"item_count" integer NOT NULL,
	"include_source_text" boolean NOT NULL,
	"digest" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"jsonl" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"action" text NOT NULL,
	"label" text,
	"reason" text,
	"evidence_excerpt" text,
	"active_ms" integer NOT NULL,
	"task_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_rubric_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rf_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"external_id" text NOT NULL,
	"question" text NOT NULL,
	"evidence" text NOT NULL,
	"candidate_answer" text NOT NULL,
	"scenario_family_id" text,
	"risk" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"final_label" text,
	"reference_label" text,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rf_audit_decisions_item_auditor_unique" ON "rf_audit_decisions" USING btree ("audit_item_id","auditor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_audit_disputes_item_unique" ON "rf_audit_disputes" USING btree ("audit_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_audit_items_audit_task_unique" ON "rf_audit_items" USING btree ("audit_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_jobs_task_mode_unique" ON "rf_jobs" USING btree ("task_id","mode");--> statement-breakpoint
CREATE INDEX "rf_jobs_claim_index" ON "rf_jobs" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_memberships_project_user_unique" ON "rf_memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_proposals_task_mode_unique" ON "rf_proposals" USING btree ("task_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_tasks_project_external_unique" ON "rf_tasks" USING btree ("project_id","external_id");