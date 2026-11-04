import type { EvaluationResult } from "../evaluation";
import {
  routeFactoryItem,
  type FactoryPolicy,
  type RoutingInput,
} from "./factory-engine";

/** Provider advice cannot override the policy route or authorize a decision. */
export function routingAdvice(
  input: RoutingInput,
  policy: FactoryPolicy,
  result?: EvaluationResult,
) {
  const baseline = routeFactoryItem(input, policy);
  const protectedLane = [
    "quarantine",
    "blind_audit",
    "complete",
    "escalation",
  ].includes(baseline.lane);
  const recommendedLane =
    protectedLane || !result
      ? baseline.lane
      : result.injection >= policy.redirectionThreshold ||
          result.complexity >= 4
        ? "escalation"
        : "human_review";
  return {
    effectiveLane: baseline.lane,
    recommendedLane,
    reasons: baseline.reasons,
    automaticAcceptance: false as const,
    applied: false as const,
    protectedLane,
  };
}
