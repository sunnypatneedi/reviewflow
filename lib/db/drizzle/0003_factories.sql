CREATE TABLE rf_factory_policies (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  factory text NOT NULL CHECK (factory IN ('evidence', 'preference')),
  revision integer NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rf_factory_policy_revision_unique ON rf_factory_policies (project_id, factory, revision);
--> statement-breakpoint
CREATE TABLE rf_factory_items (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  factory text NOT NULL CHECK (factory IN ('evidence', 'preference')),
  item_id text NOT NULL,
  quarantined boolean NOT NULL DEFAULT false,
  quarantine_reason text,
  revision integer NOT NULL DEFAULT 0,
  assigned_to text,
  claim_token text,
  expires_at timestamptz
);
CREATE UNIQUE INDEX rf_factory_item_unique ON rf_factory_items (project_id, factory, item_id);
--> statement-breakpoint
ALTER TABLE rf_reviews ALTER COLUMN proposal_id DROP NOT NULL;
ALTER TABLE rf_reviews ADD COLUMN factory_policy_revision integer;
