ALTER TABLE rf_projects ADD COLUMN release_audit_policy_version text NOT NULL DEFAULT 'independent-sample-v1';
--> statement-breakpoint
UPDATE rf_projects SET release_audit_policy_version = 'demo-unverified-v1' WHERE demo_session_id IS NOT NULL AND mode = 'demo';
--> statement-breakpoint
ALTER TABLE rf_tasks ADD COLUMN final_adjudication_id text;
--> statement-breakpoint
ALTER TABLE rf_audit_items ADD COLUMN task_version integer;
--> statement-breakpoint
ALTER TABLE rf_audit_items ADD COLUMN original_adjudication_id text;
