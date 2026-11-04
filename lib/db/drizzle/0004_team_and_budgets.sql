ALTER TABLE rf_memberships ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE rf_projects ADD COLUMN exposure_tracking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE rf_projects ALTER COLUMN exposure_tracking_enabled SET DEFAULT true;
--> statement-breakpoint
CREATE TABLE rf_exposures (id text PRIMARY KEY, project_id text NOT NULL, actor_id text NOT NULL, task_id text NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX rf_exposure_unique ON rf_exposures (project_id, actor_id, task_id, content_hash);
--> statement-breakpoint
CREATE TABLE rf_jev_controls (project_id text PRIMARY KEY, revision integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false, max_calls integer NOT NULL DEFAULT 0 CHECK (max_calls BETWEEN 0 AND 100));
CREATE TABLE rf_jev_calls (id text PRIMARY KEY, project_id text NOT NULL, purpose text NOT NULL, item_id text NOT NULL, revision integer NOT NULL, status text NOT NULL DEFAULT 'reserved', created_at timestamptz NOT NULL DEFAULT now());
