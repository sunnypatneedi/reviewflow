import assert from "node:assert/strict";
import { test } from "node:test";
import { currentProposal, evaluationProvenance } from "./current-proposal";
import { createEvaluationIdentity } from "./evaluation-identity";

const task = { id: "task", projectId: "project", mode: "demo", currentEvaluationId: "run-b", currentProposalId: "b" };
const a = { id: "a", taskId: "task", projectId: "project", mode: "demo", evaluationId: "run-a" };
const b = { ...a, id: "b", evaluationId: "run-b" };
test("current proposal is an exact fenced pointer, not arbitrary experiment history", () => {
  assert.equal(currentProposal(task, [b, a]), b);
  assert.equal(currentProposal(task, [a]), undefined);
  assert.equal(currentProposal({ ...task, currentProposalId: null }, [a, b]), undefined);
  assert.equal(currentProposal(task, [{ ...b, projectId: "other" }]), undefined);
  assert.equal(currentProposal(task, [{ ...b, mode: "live" }]), undefined);
  assert.equal(currentProposal(task, [{ ...b, evaluationId: "run-a" }]), undefined);
});
test("legacy fallback requires no current identity and exactly one legacy candidate", () => {
  const legacyTask = { ...task, currentEvaluationId: null, currentProposalId: null };
  const legacy = { ...a, evaluationId: null };
  assert.equal(currentProposal(legacyTask, [b, legacy]), legacy);
  assert.equal(currentProposal(legacyTask, [legacy, { ...legacy, id: "duplicate" }]), undefined);
  assert.equal(currentProposal({ ...legacyTask, currentProposalId: "a" }, [legacy]), legacy);
  assert.equal(currentProposal({ ...task, currentProposalId: null }, [legacy]), undefined);
});
test("exported evaluation provenance is integrity-checked and excludes raw input", () => {
  const captured = createEvaluationIdentity({ projectId: "project", taskId: "task", workload: "evidence", snapshot: { evidence: "PRIVATE_SOURCE" }, questionVersion: "q1", contextPreparationVersion: "c1", requestedModel: "demo-simulator-v1", experimentRunId: "r1" });
  const row = { ...a, evaluationId: captured.evaluationId, evaluationIdentity: captured.identity };
  const exported = evaluationProvenance(row);
  assert.equal(exported?.provenance, "captured");
  assert.equal(JSON.stringify(exported).includes("PRIVATE_SOURCE"), false);
  assert.equal(evaluationProvenance({ ...row, evaluationIdentity: { ...captured.identity, requestedModel: "changed" } }), null);
  assert.equal(evaluationProvenance({ ...row, projectId: "other" }), null);
  assert.equal(evaluationProvenance({ ...row, evaluationIdentity: null }), null);
  assert.deepEqual(evaluationProvenance({ ...a, evaluationId: null }), { provenance: "legacy-unknown", evaluation_id: null });
});
