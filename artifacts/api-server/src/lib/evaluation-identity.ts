import { createHash } from "node:crypto";

/** Versioned inference identity. Routing policy is deliberately not an input. */
export type EvaluationIdentity = {
  schemaVersion: 1;
  provenance: "captured";
  projectId: string;
  taskId: string;
  workload: "evidence" | "preference";
  snapshot: unknown;
  snapshotHash: string;
  questionVersion: string;
  contextPreparationVersion: string;
  requestedModel: string;
  experimentRunId: string;
};
export type EvaluationConfiguration = {
  questionVersion?: string;
  contextPreparationVersion?: string;
  requestedModel?: string;
  experimentRunId?: string;
};
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const evaluationHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function createEvaluationIdentity(input: Omit<EvaluationIdentity, "schemaVersion" | "provenance" | "snapshotHash">) {
  for (const value of [input.projectId, input.taskId, input.questionVersion, input.contextPreparationVersion, input.requestedModel, input.experimentRunId]) {
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("Evaluation identity requires bounded, nonempty version identifiers");
  }
  // JSON copy prevents subsequent edits to caller-owned input from changing identity.
  const identity: EvaluationIdentity = { ...input, snapshot: JSON.parse(canonicalJson(input.snapshot)), schemaVersion: 1, provenance: "captured", snapshotHash: evaluationHash(input.snapshot) };
  return { evaluationId: evaluationHash(identity), identity };
}
export function evidenceSnapshot(task: { question: string; evidence: string; candidateAnswer: string; externalId: string; referenceLabel: string | null }) {
  return { question: task.question, evidence: task.evidence, candidateAnswer: task.candidateAnswer, externalId: task.externalId, referenceLabel: task.referenceLabel };
}
