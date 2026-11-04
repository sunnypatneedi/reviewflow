import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FACTORY_POLICY as policy } from "./factory-engine";
import { routingAdvice } from "./routing-advice";
import type { EvaluationResult } from "../evaluation";
const result = { injection: 0.99, complexity: 5 } as EvaluationResult;
test("model routing advice cannot override protected lanes or apply a decision", () => {
  for (const [input, expected] of [
    [{ quarantined: true }, "quarantine"],
    [{ blindAudit: true }, "blind_audit"],
    [{ finalized: true }, "complete"],
    [{ escalated: true }, "escalation"],
  ] as const) {
    const value = routingAdvice(input, policy, result);
    assert.equal(value.effectiveLane, expected);
    assert.equal(value.recommendedLane, expected);
    assert.equal(value.applied, false);
    assert.equal(value.automaticAcceptance, false);
  }
  const suggestion = routingAdvice({}, policy, result);
  assert.equal(suggestion.effectiveLane, "human_review");
  assert.equal(suggestion.recommendedLane, "escalation");
  assert.equal(routingAdvice({}, policy).recommendedLane, "human_review");
});
