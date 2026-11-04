CREATE TABLE "rf_shared_notes" (
  "project_id" text NOT NULL REFERENCES "rf_projects"("id") ON DELETE CASCADE,
  "task_id" text NOT NULL REFERENCES "rf_tasks"("id") ON DELETE CASCADE,
  "content_hash" text NOT NULL,
  "state" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("project_id", "task_id")
);
