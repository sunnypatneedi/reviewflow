import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSamplingFrame,
  blindAuditTask,
  eligibleAuditCandidates,
  nextAuditStatus,
  samplingFrameHash,
  selectDeterministicSample,
} from "./audits.ts";

test("sampling preserves a stable frame and is reproducible from its seed", () => {
  const candidates = [
    { taskId: "task-b", contentHash: "hash-b", originalReviewerId: "reviewer-2" },
    { taskId: "task-a", contentHash: "hash-a", originalReviewerId: "reviewer-1" },
    { taskId: "task-c", contentHash: "hash-c", originalReviewerId: "reviewer-3" },
  ];
  const frame = buildSamplingFrame(candidates);
  assert.deepEqual(frame.eligible.map((entry) => entry.taskId), ["task-a", "task-b", "task-c"]);
  assert.equal(samplingFrameHash(frame), samplingFrameHash(buildSamplingFrame([...candidates].reverse())));
  assert.equal("originalReviewerId" in frame.eligible[0], false);
  assert.equal("originalLabel" in frame.eligible[0], false);

  const first = selectDeterministicSample("release-2026-09-20", candidates, 2).map((entry) => entry.taskId);
  const second = selectDeterministicSample("release-2026-09-20", [...candidates].reverse(), 2).map((entry) => entry.taskId);
  assert.deepEqual(first, second);
});

test("blind task views do not expose the original decision", () => {
  const view = blindAuditTask({
    id: "task-1",
    externalId: "catalog-1",
    question: "Does it fit?",
    evidence: "Fits 10-inch shelves.",
    candidateAnswer: "Yes.",
    risk: "medium",
  }, undefined);
  assert.equal(view.taskId, "task-1");
  assert.equal("finalLabel" in view, false);
  assert.equal("proposal" in view, false);
  assert.equal("originalReviewerId" in view, false);
});

test("independent eligibility excludes the original reviewer", () => {
  const candidates = [
    { taskId: "mine", contentHash: "hash-mine", originalReviewerId: "reviewer-1" },
    { taskId: "other", contentHash: "hash-other", originalReviewerId: "reviewer-2" },
  ];
  assert.deepEqual(
    eligibleAuditCandidates(candidates, "reviewer-1", true).map((entry) => entry.taskId),
    ["other"],
  );
  assert.equal(eligibleAuditCandidates(candidates, "reviewer-1", false).length, 2);
});

test("self-check-only work is invalid, while disagreements block completion", () => {
  assert.equal(nextAuditStatus(2, 2, 0, 0), "invalid");
  assert.equal(nextAuditStatus(2, 1, 1, 0), "in_progress");
  assert.equal(nextAuditStatus(2, 2, 1, 1), "blocked");
  assert.equal(nextAuditStatus(2, 2, 1, 0), "completed");
});