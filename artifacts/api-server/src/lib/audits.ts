import { createHash } from "node:crypto";

export type SamplingCandidate = {
  taskId: string;
  contentHash: string;
  originalReviewerId: string;
};

export type AuditSamplingFrame = {
  version: "rf-audit-v1";
  eligible: Array<{ taskId: string; contentHash: string }>;
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function eligibleAuditCandidates(
  candidates: SamplingCandidate[],
  auditorId: string,
  independent: boolean,
) {
  return candidates
    .filter((candidate) => !independent || candidate.originalReviewerId !== auditorId)
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function buildSamplingFrame(candidates: SamplingCandidate[]): AuditSamplingFrame {
  return {
    version: "rf-audit-v1",
    eligible: [...candidates]
      .sort((a, b) => a.taskId.localeCompare(b.taskId))
      .map(({ taskId, contentHash }) => ({ taskId, contentHash })),
  };
}

export function samplingFrameHash(frame: AuditSamplingFrame) {
  return sha(JSON.stringify(frame));
}

export function selectDeterministicSample<T extends { taskId: string }>(
  seed: string,
  candidates: T[],
  sampleSize: number,
) {
  return [...candidates]
    .sort((a, b) => sha(`${seed}:${a.taskId}`).localeCompare(sha(`${seed}:${b.taskId}`)))
    .slice(0, sampleSize);
}

export function nextAuditStatus(
  itemCount: number,
  decisionCount: number,
  includedDecisionCount: number,
  pendingDisputeCount: number,
) {
  if (pendingDisputeCount > 0) return "blocked";
  if (decisionCount < itemCount) return "in_progress";
  return includedDecisionCount > 0 ? "completed" : "invalid";
}

export function blindAuditTask(
  task: {
    id: string;
    externalId: string;
    question: string;
    evidence: string;
    candidateAnswer: string;
    risk: string;
  },
  decision: { label: string; reason: string | null; selfCheck: boolean; included: boolean } | undefined,
) {
  return {
    taskId: task.id,
    externalId: task.externalId,
    question: task.question,
    evidence: task.evidence,
    candidateAnswer: task.candidateAnswer,
    risk: task.risk,
    decision: decision ? {
      label: decision.label,
      reason: decision.reason,
      selfCheck: decision.selfCheck,
      included: decision.included,
    } : null,
  };
}