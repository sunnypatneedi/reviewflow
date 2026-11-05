-- Historical rows retain their original IDs, payloads, releases and unknown provenance.
-- Never invent the configuration or input snapshots that produced legacy results.
ALTER TABLE rf_tasks ADD COLUMN current_evaluation_id text;
ALTER TABLE rf_tasks ADD COLUMN current_proposal_id text;
ALTER TABLE rf_jobs ADD COLUMN evaluation_id text;
ALTER TABLE rf_jobs ADD COLUMN evaluation_identity jsonb;
ALTER TABLE rf_jobs ADD COLUMN provenance text NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE rf_proposals ADD COLUMN evaluation_id text;
ALTER TABLE rf_proposals ADD COLUMN evaluation_identity jsonb;
ALTER TABLE rf_proposals ADD COLUMN provenance text NOT NULL DEFAULT 'legacy-unknown';
UPDATE rf_tasks t SET current_proposal_id = p.id FROM rf_proposals p
WHERE p.task_id = t.id AND p.project_id = t.project_id AND p.mode = t.mode;
DROP INDEX rf_jobs_task_mode_unique;
DROP INDEX rf_proposals_task_mode_unique;
CREATE UNIQUE INDEX rf_jobs_evaluation_unique ON rf_jobs(evaluation_id);
CREATE UNIQUE INDEX rf_proposals_evaluation_unique ON rf_proposals(evaluation_id);
-- Previously queued work has no captured immutable snapshot. Preserve it, but do
-- not infer provenance or silently execute today's configuration on its behalf.
UPDATE rf_jobs SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
  last_error = 'Legacy evaluation has unknown provenance; enqueue a versioned evaluation', updated_at = now()
WHERE status IN ('queued', 'running');
-- Evaluation configuration and finished evidence are append-only. Operational
-- job status/lease fields remain mutable for bounded recovery.
CREATE FUNCTION rf_guard_evaluation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'rf_proposals' THEN
    RAISE EXCEPTION 'Evaluation proposals are immutable';
  END IF;
  IF NEW.evaluation_id IS DISTINCT FROM OLD.evaluation_id
    OR NEW.evaluation_identity IS DISTINCT FROM OLD.evaluation_identity
    OR NEW.provenance IS DISTINCT FROM OLD.provenance
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'Evaluation identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rf_proposals_immutable BEFORE UPDATE ON rf_proposals FOR EACH ROW EXECUTE FUNCTION rf_guard_evaluation_immutable();
CREATE TRIGGER rf_jobs_identity_immutable BEFORE UPDATE ON rf_jobs FOR EACH ROW EXECUTE FUNCTION rf_guard_evaluation_immutable();
CREATE FUNCTION rf_guard_trace_evaluation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'evaluation' THEN RAISE EXCEPTION 'Preference evaluations are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rf_trace_evaluations_immutable BEFORE UPDATE ON rf_trace_records FOR EACH ROW EXECUTE FUNCTION rf_guard_trace_evaluation_immutable();
