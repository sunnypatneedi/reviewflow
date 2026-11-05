import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateObservability, type ObservationRows } from "./observability";
const now = new Date("2026-01-02T00:00:00Z"),
  past = new Date(now.getTime() - 1000),
  future = new Date(now.getTime() + 1000);
const empty = (): ObservationRows => ({
  tasks: [],
  jobs: [],
  proposals: [],
  reviews: [],
  assignments: [],
  decisions: [],
  disputes: [],
  releases: [],
  preference: [],
  preferenceAssignments: [],
});
test("empty is zero volume, unknown measurement; no invented costs or baseline", () => {
  const result = aggregateObservability(empty(), now);
  assert.equal(result.pipeline.total, 0);
  assert.equal(result.pipeline.recordedReviewMs, 0);
  assert.equal(result.pipeline.correctionRate, null);
  assert.equal(result.pipeline.averageTimeToFirstReleaseMs, null);
  assert.equal(result.pipeline.totalHumanEffortMs, null);
  assert.equal(result.pipeline.costPerAcceptedItem, null);
  assert.equal(result.pipeline.independentAccuracy, null);
  assert.equal(result.pipeline.baselineImprovement, null);
  assert.equal(result.operations.live.averageLatencyMs, null);
  assert.equal(result.operations.live.inputTokens, null);
  assert.equal(result.operations.queue.oldestActiveAgeMs, null);
});
test("stage, release and correction denominators have explicit deduplication", () => {
  const rows = empty();
  rows.tasks = [
    { id: "one", status: "finalized", contentHash: "hash1", createdAt: past },
    { id: "two", status: "escalated", contentHash: "hash2", createdAt: past },
  ];
  rows.reviews = [
    { taskId: "one", action: "accept", activeMs: 10, assisted: true },
    { taskId: "one", action: "correct", activeMs: 20, assisted: true },
    { taskId: "two", action: "escalate", activeMs: 5, assisted: false },
    { taskId: "one", action: "label", activeMs: 0, assisted: false },
    { taskId: "foreign", action: "correct", activeMs: 999, assisted: true },
  ];
  rows.assignments = [
    { itemId: "one", expiresAt: future },
    { itemId: "one", expiresAt: future },
    { itemId: "two", expiresAt: past },
    { itemId: "foreign", expiresAt: future },
  ];
  rows.decisions = [
    { taskId: "one" },
    { taskId: "one" },
    { taskId: "foreign" },
  ];
  rows.releases = [
    { hashes: ["hash1", "hash1"], createdAt: now },
    { hashes: ["hash1"], createdAt: future },
  ];
  const { pipeline: p } = aggregateObservability(rows, now);
  assert.equal(p.assigned, 1);
  assert.equal(p.completed, 1);
  assert.equal(p.audited, 1);
  assert.equal(p.released, 1);
  assert.equal(p.releases, 2);
  assert.equal(p.correctionRate, 0.5);
  assert.equal(p.correctionDenominator, 2);
  assert.equal(p.recordedReviewMs, 35);
  assert.equal(p.escalationEvents, 1);
  assert.equal(p.averageTimeToFirstReleaseMs, 1000);
  assert.equal(p.releaseTimingSamples, 1);
  assert.deepEqual(p.reviewCohorts, { assisted: 2, humanOnly: 2 });
});
test("queue distinguishes retries, due/delayed jobs, failed jobs and expired or absent leases", () => {
  const rows = empty();
  rows.jobs = [
    "queued",
    "queued",
    "running",
    "running",
    "failed",
    "succeeded",
    "unexpected",
  ].map((status, i) => ({
    status,
    attempts: i === 4 ? 3 : 1,
    createdAt: past,
    availableAt: i === 1 ? future : past,
    leaseExpiresAt: i === 2 ? past : null,
  }));
  const q = aggregateObservability(rows, now).operations.queue;
  assert.equal(q.queued, 2);
  assert.equal(q.ready, 1);
  assert.equal(q.delayed, 1);
  assert.equal(q.failed, 1);
  assert.equal(q.succeeded, 1);
  assert.equal(q.unknown, 1);
  assert.equal(q.retriedJobs, 1);
  assert.equal(q.retryAttempts, 2);
  assert.equal(q.expiredLeases, 1);
  assert.equal(q.missingLeases, 1);
  assert.equal(q.oldestActiveAgeMs, 1000);
});
test("real zero latency/tokens are known; simulation never enters live latency", () => {
  const rows = empty();
  rows.proposals = [
    { mode: "live", latencyMs: 0, inputTokens: 0, outputTokens: null },
    { mode: "live", latencyMs: 20, inputTokens: null, outputTokens: null },
    { mode: "demo", latencyMs: 800, inputTokens: null, outputTokens: null },
  ];
  const { operations } = aggregateObservability(rows, now);
  assert.equal(operations.live.averageLatencyMs, 10);
  assert.equal(operations.simulated.averageLatencyMs, 800);
  assert.equal(operations.live.inputTokens, 0);
  assert.equal(operations.live.outputTokens, null);
  assert.deepEqual(operations.live.tokenCoverage, { input: 1, output: 0 });
});
test("preference checks are not independent audits; released snapshots deduplicate IDs", () => {
  const rows = empty();
  rows.preference = [
    {
      kind: "comparison",
      reviewed: true,
      finalized: true,
      escalated: false,
      qualityPassed: true,
      assisted: false,
      releasedIds: [],
    },
    ...[1, 2].map(() => ({
      kind: "release",
      reviewed: false,
      finalized: false,
      escalated: false,
      qualityPassed: false,
      assisted: null,
      releasedIds: ["private-id", "private-id"],
    })),
  ];
  const result = aggregateObservability(rows, now);
  assert.equal(result.preference.completed, 1);
  assert.equal(result.preference.audited, null);
  assert.equal(result.preference.released, 1);
  assert.equal(result.preference.releases, 2);
  assert.equal(result.preference.humanOnly, 1);
  assert.ok(!JSON.stringify(result).includes("private-id"));
});
