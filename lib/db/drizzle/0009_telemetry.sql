-- rf_events is the transactional source of truth. Never consume by timestamp cursor.
CREATE TABLE rf_telemetry_outbox (
 event_id text PRIMARY KEY, project_id text NOT NULL, event_type text NOT NULL,
 occurred_at timestamptz NOT NULL, delivered_at timestamptz
);
CREATE INDEX rf_telemetry_outbox_pending ON rf_telemetry_outbox(project_id) WHERE delivered_at IS NULL;
CREATE TABLE rf_telemetry_projection (
 event_id text PRIMARY KEY, project_id text NOT NULL, event_type text NOT NULL,
 occurred_at timestamptz NOT NULL, projected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rf_telemetry_projection_project ON rf_telemetry_projection(project_id);
CREATE FUNCTION rf_enqueue_telemetry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO rf_telemetry_outbox(event_id,project_id,event_type,occurred_at)
 VALUES(NEW.id,NEW.project_id,NEW.type,NEW.created_at) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER rf_event_telemetry AFTER INSERT ON rf_events FOR EACH ROW EXECUTE FUNCTION rf_enqueue_telemetry();
INSERT INTO rf_telemetry_outbox(event_id,project_id,event_type,occurred_at)
 SELECT id,project_id,type,created_at FROM rf_events ON CONFLICT DO NOTHING;
CREATE TABLE rf_browser_telemetry (
 event_id text PRIMARY KEY, project_id text NOT NULL, session_id text NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 1000000),
 kind text NOT NULL, factory text NOT NULL, item_id text, item_version integer,
 proposal_id text, visible_ms integer NOT NULL CHECK(visible_ms BETWEEN 0 AND 15000),
 dropped integer NOT NULL CHECK(dropped BETWEEN 0 AND 1000000),
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,session_id,sequence)
);
CREATE INDEX rf_browser_telemetry_project ON rf_browser_telemetry(project_id);
