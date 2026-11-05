import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvaluationIdentity, evaluationHash } from "./evaluation-identity";
const base = { projectId: "p", taskId: "t", workload: "evidence" as const, snapshot: { question: "Q", evidence: "E", candidate: "A" },
  questionVersion: "q1", contextPreparationVersion: "c1", requestedModel: "m1", experimentRunId: "r1" };
test("identity is canonical and captures an immutable snapshot", () => {
  const snapshot = { ...base.snapshot };
  const a = createEvaluationIdentity({ ...base, snapshot });
  const b = createEvaluationIdentity({ ...base, snapshot: { candidate: "A", evidence: "E", question: "Q" } });
  assert.equal(a.evaluationId, b.evaluationId);
  snapshot.evidence = "changed";
  assert.equal((a.identity.snapshot as typeof snapshot).evidence, "E");
});
test("every inference dimension separates results while routing replay reuses inference", () => {
  const original = createEvaluationIdentity(base).evaluationId;
  for (const key of ["projectId", "taskId", "questionVersion", "contextPreparationVersion", "requestedModel", "experimentRunId"]) {
    assert.notEqual(createEvaluationIdentity({ ...base, [key]: "different" }).evaluationId, original, key);
  }
  assert.notEqual(createEvaluationIdentity({ ...base, snapshot: { ...base.snapshot, evidence: "new" } }).evaluationId, original);
  const route = (_policy: string) => createEvaluationIdentity(base).evaluationId;
  assert.equal(route("strict"), route("lenient"));
  assert.equal(evaluationHash(base.snapshot), createEvaluationIdentity(base).identity.snapshotHash);
});
test("identity rejects missing or unbounded experiment versions", () => {
  for (const experimentRunId of ["", " ", "x".repeat(201)]) assert.throws(() => createEvaluationIdentity({ ...base, experimentRunId }));
});
