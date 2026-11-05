import { evaluationHash, type EvaluationIdentity } from "./evaluation-identity";

type TaskPointer = { id: string; projectId: string; mode: string; currentEvaluationId?: string | null; currentProposalId?: string | null };
type ProposalPointer = { id: string; projectId: string; taskId: string; mode: string; evaluationId?: string | null };

/** A current pointer is authoritative. History can never become a current result by ordering. */
export function currentProposal<T extends ProposalPointer>(task: TaskPointer, rows: readonly T[]): T | undefined {
  const matches = rows.filter(row => row.projectId === task.projectId && row.taskId === task.id && row.mode === task.mode);
  if (task.currentProposalId) {
    const pointed = matches.find(row => row.id === task.currentProposalId);
    return pointed && (task.currentEvaluationId == null
      ? pointed.evaluationId == null
      : pointed.evaluationId === task.currentEvaluationId) ? pointed : undefined;
  }
  if (task.currentEvaluationId != null) return undefined;
  const legacy = matches.filter(row => row.evaluationId == null);
  return legacy.length === 1 ? legacy[0] : undefined;
}

/** Export only provenance, never the private immutable inference input snapshot. */
export function evaluationProvenance(row: ProposalPointer & { evaluationIdentity?: unknown }) {
  if (row.evaluationId == null) return { provenance: "legacy-unknown" as const, evaluation_id: null };
  const value = row.evaluationIdentity as EvaluationIdentity | null | undefined;
  if (!value || value.schemaVersion !== 1 || value.provenance !== "captured"
    || value.projectId !== row.projectId || value.taskId !== row.taskId
    || value.workload !== "evidence" || typeof value.snapshotHash !== "string"
    || value.snapshotHash !== evaluationHash(value.snapshot)
    || row.evaluationId !== evaluationHash(value)) return null;
  return {
    provenance: "captured" as const,
    evaluation_id: row.evaluationId,
    snapshot_hash: value.snapshotHash,
    question_version: value.questionVersion,
    context_preparation_version: value.contextPreparationVersion,
    requested_model: value.requestedModel,
    experiment_run_id: value.experimentRunId,
  };
}
