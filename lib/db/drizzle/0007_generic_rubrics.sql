CREATE TABLE rf_rubric_specs (
  id text PRIMARY KEY, project_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  hash text NOT NULL, definition jsonb NOT NULL, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rf_rubric_spec_revision_unique ON rf_rubric_specs(project_id, revision);
CREATE TABLE rf_rubric_items (
  id text PRIMARY KEY, project_id text NOT NULL, rubric_id text NOT NULL REFERENCES rf_rubric_specs(id),
  external_id text NOT NULL, content text NOT NULL, content_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), state jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rf_rubric_item_external_unique ON rf_rubric_items(project_id, external_id);
CREATE TABLE rf_rubric_records (
  id text PRIMARY KEY, project_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('import','claim','quarantine','review','adjudication','audit','release')),
  item_id text, actor text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rf_rubric_records_project_kind ON rf_rubric_records(project_id, kind);
--> statement-breakpoint
CREATE FUNCTION rf_rubric_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Rubric definitions and provenance are append-only'; END; $$;
CREATE TRIGGER rf_rubric_specs_immutable BEFORE UPDATE OR DELETE ON rf_rubric_specs FOR EACH ROW EXECUTE FUNCTION rf_rubric_append_only();
CREATE TRIGGER rf_rubric_records_immutable BEFORE UPDATE OR DELETE ON rf_rubric_records FOR EACH ROW EXECUTE FUNCTION rf_rubric_append_only();
CREATE FUNCTION rf_rubric_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Rubric source items cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.project_id, NEW.rubric_id, NEW.external_id, NEW.content, NEW.content_hash, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.project_id, OLD.rubric_id, OLD.external_id, OLD.content, OLD.content_hash, OLD.created_by, OLD.created_at)
  THEN RAISE EXCEPTION 'Rubric source identity is immutable'; END IF;
  IF NEW.version != OLD.version + 1 THEN RAISE EXCEPTION 'Rubric mutation must advance exactly one version'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER rf_rubric_item_identity_immutable BEFORE UPDATE OR DELETE ON rf_rubric_items FOR EACH ROW EXECUTE FUNCTION rf_rubric_item_identity();
