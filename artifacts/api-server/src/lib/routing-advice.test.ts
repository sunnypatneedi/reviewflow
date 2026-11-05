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


test("fractional compatibility complexity preserves the native level-three escalation boundary", () => {
  const advice = (complexity: number) => routingAdvice({}, policy, { injection: 0, complexity } as EvaluationResult);
  assert.equal(advice(3.99).recommendedLane, "human_review");
  assert.equal(advice(4).recommendedLane, "escalation");
  assert.equal(advice(4.43).recommendedLane, "escalation");
  assert.equal(advice(4.43).effectiveLane, "human_review");
});
