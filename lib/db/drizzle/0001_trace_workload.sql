CREATE TABLE "rf_trace_records" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "rf_projects"("id"),
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rf_trace_records_project_kind_key" ON "rf_trace_records" ("project_id", "kind", "key");