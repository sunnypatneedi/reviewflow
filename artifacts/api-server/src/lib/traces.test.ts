import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVersion, assertNoReferenceLeakage, comparisonView, measuredEffort, proposalState, publicProposal, shareableEvidence, stableJson, traceProposal, tracePython, validateReview,
} from "./traces";

const context = { complete: true, messages: [{ role: "user", content: "Return one or two." }], tools: [], parameters: {} };
const runs = [
  { id: "one", scenarioId: "case", groupId: "family", task: "Choose", decisionPoint: "turn-1", context, response: "one",
    events: [{ sequence: 0, observation: "observed", model: "private-model" }], provenance: { email: "private@example.test" }, candidateIdentity: "private-model", kind: "scripted" },
  { id: "two", scenarioId: "case", groupId: "family", task: "Choose", decisionPoint: "turn-1", context, response: "two",
    events: [], provenance: {}, candidateIdentity: "other-model", kind: "scripted" },
];

test("Python trace validator is used by API and rejects mismatched and incomplete context", async () => {
  const valid = await tracePython("validate", { schemaVersion: 1, runs });
  assert.equal(valid.comparisons[0].eligible, true);
  const mismatch = structuredClone(runs);
  mismatch[1].context = { ...mismatch[1].context, parameters: { temperature: 1 } };
  const rejected = await tracePython("validate", { schemaVersion: 1, runs: mismatch });
  assert.equal(rejected.comparisons[0].eligible, false);
  const incomplete = structuredClone(runs);
  incomplete[1].context = { ...incomplete[1].context, complete: false };
  assert.equal((await tracePython("validate", { schemaVersion: 1, runs: incomplete })).comparisons[0].eligible, false);
  assert.equal((await tracePython("validate", { schemaVersion: 1, runs: [runs[0]] })).comparisons[0].eligible, false);
});

test("blind views hide identity/proposal and a later reveal does not mutate human-only history", () => {
  const payload = { id: "c", a: { runId: "private-a", ...runs[0] }, b: { runId: "private-b", ...runs[1] },
    proposal: { decision: "b" }, reveals: [], history: [], review: { actor: "person", decision: "a", assisted: false } };
  const blind = comparisonView(payload, "person");
  assert.equal(blind.proposal, undefined);
  assert.equal(blind.a.candidateIdentity, undefined);
  assert.equal(blind.a.events[0].model, undefined);
  assert.equal(blind.review.actor, undefined);
  const revealed = comparisonView({ ...payload, reveals: [{ actor: "person" }] }, "person");
  assert.equal(revealed.proposal.decision, "b");
  assert.equal(revealed.review.assisted, false);
  assert.equal(comparisonView({ ...payload, reveals: [{ actor: "other" }] }, "person").revealed, false);
});

test("canonical decision keys survive display order and all nonbinary outcomes validate", () => {
  for (const decision of ["a", "b", "tie", "both_unacceptable", "insufficient_evidence", "escalate"]) {
    const result = validateReview({ decision, expectedVersion: 1, evidenceRefs: ["a:event:0"], displayOrder: ["b", "a"] });
    assert.equal(result.decision, decision);
    assert.equal(result.effort.activeMs, null);
  }
  assert.throws(() => validateReview({ decision: "left", expectedVersion: 1, evidenceRefs: [] }));
  assert.throws(() => validateReview({ decision: "a", expectedVersion: 1, evidenceRefs: [], effort: { activeMs: -1 } }));
  assert.throws(() => assertVersion({ version: 2 }, 1), /Reload/);
});

test("proposal payload rejects nested reference context rather than rewriting it and excludes non-context identities", () => {
  assert.throws(() => proposalState({ context: { ...context, referenceAnswer: "DO_NOT_SEND" } }), /Provider evaluation blocked/);
  const state = proposalState({
    context, a: { response: "one", candidateIdentity: "secret" },
    b: { response: "two" }, review: { decision: "a" }, referenceAnswer: "DO_NOT_SEND", proposal: { decision: "b" },
  });
  assert.equal(JSON.stringify(state).includes("DO_NOT_SEND"), false);
  assert.equal(JSON.stringify(state).includes("secret"), false);
  assert.deepEqual(Object.keys(state).sort(), ["a", "b", "context"]);
  assert.deepEqual(state.context, context);
  for (const key of ["reference_answer", "groundTruth", "earlierHumanDecision", "human_judgment"]) {
    assert.throws(() => assertNoReferenceLeakage({ task: { nested: [{ [key]: "PRIVATE" }] } }), /Provider evaluation blocked/);
    assert.throws(() => proposalState({ context: { ...context, tools: [{ metadata: { [key]: "PRIVATE" } }] } }), /Provider evaluation blocked/);
  }
});

test("audit effort validates finite safe measured milliseconds and preserves unavailable values", () => {
  assert.deepEqual(measuredEffort({ auditMs: 7, waitingMs: null }, ["auditMs", "waitingMs"]), { auditMs: 7, waitingMs: null });
  assert.deepEqual(measuredEffort(undefined, ["auditMs", "waitingMs"]), { auditMs: null, waitingMs: null });
  for (const value of [-1, 1.5, Infinity, 8 * 86400_000, "9"]) assert.throws(() => measuredEffort({ auditMs: value }, ["auditMs"]));
});

test("shareable records remove structured identities and private provider metadata without changing actual text", () => {
  const exported = shareableEvidence({ events: [{ actorId: "secret-person", content: "actual unchanged response" }] }, "salt");
  assert.equal(JSON.stringify(exported).includes("secret-person"), false);
  assert.equal(exported.events[0].content, "actual unchanged response");
  assert.deepEqual(publicProposal({ provider: "jev", decision: "a", authorization: "secret", raw: { accountId: "private" } }),
    { provider: "jev", decision: "a" });
});

test("simulator is deterministic, explicitly simulated, and does not use reference labels", async () => {
  const first = await traceProposal({ id: "fixed", eligible: true }, "simulator");
  const second = await traceProposal({ id: "fixed", eligible: true, referenceAnswer: "b" }, "simulator");
  assert.equal(first.decision, second.decision);
  assert.equal(first.simulated, true);
  await assert.rejects(traceProposal({ id: "bad", eligible: false }, "simulator"));
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test("mocked Jev transport validates typed probabilities and never silently simulates live failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-only-not-a-real-key";
  const comparison = { id: "mock", eligible: true, context, a: { response: "one" }, b: { response: "two" },
    referenceAnswer: "private-reference", review: { decision: "b" } };
  try {
    let captured = "";
    globalThis.fetch = async (_url, options) => {
      captured = String(options?.body);
      return new Response(JSON.stringify({ answers: { preference: {
        choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: 0.1, tie: 0.025, both_unacceptable: 0.025, insufficient_evidence: 0.025, escalate: 0.025 },
      } } }), { status: 200 });
    };
    const result = await traceProposal(comparison, "jev");
    assert.equal(result.decision, "a");
    assert.equal(result.simulated, false);
    assert.equal(captured.includes("private-reference"), false);
    globalThis.fetch = async () => new Response(JSON.stringify({ answers: { preference: {
      choice: "a", confidence: 1, probabilities: { a: -1, b: 2, tie: 0, both_unacceptable: 0, insufficient_evidence: 0, escalate: 0 },
    } } }), { status: 200 });
    await assert.rejects(traceProposal(comparison, "jev"), /invalid typed/);
    globalThis.fetch = async () => { throw new Error("mock timeout"); };
    await assert.rejects(traceProposal(comparison, "jev"), /No simulated fallback/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }
});