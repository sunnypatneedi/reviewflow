export const FACTORIES = ["evidence", "preference"] as const;
export type Factory = (typeof FACTORIES)[number];
export type Lane =
  | "human_review"
  | "assistance"
  | "escalation"
  | "blind_audit"
  | "quarantine"
  | "complete";
export type FactoryPolicy = {
  schemaVersion: 1;
  assistanceAllowed: boolean;
  requireAssignments: boolean;
  highRiskLane: "human_review" | "escalation";
  minimumConfidence: number;
  redirectionThreshold: number;
};
export const DEFAULT_FACTORY_POLICY: Readonly<FactoryPolicy> = Object.freeze({
  schemaVersion: 1,
  assistanceAllowed: true,
  requireAssignments: false,
  highRiskLane: "human_review",
  minimumConfidence: 0.75,
  redirectionThreshold: 0.5,
});
export class FactoryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export function parseFactory(value: unknown): Factory {
  if (!FACTORIES.includes(value as Factory))
    throw new FactoryError("Choose the evidence or preference factory", 400);
  return value as Factory;
}
export function validateFactoryPolicy(input: unknown): FactoryPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new FactoryError("A complete factory policy is required", 400);
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !Object.hasOwn(DEFAULT_FACTORY_POLICY, key),
    ) ||
    value.schemaVersion !== 1 ||
    typeof value.assistanceAllowed !== "boolean" ||
    typeof value.requireAssignments !== "boolean" ||
    typeof value.highRiskLane !== "string" ||
    !["human_review", "escalation"].includes(value.highRiskLane) ||
    ![value.minimumConfidence, value.redirectionThreshold].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
    )
  ) {
    throw new FactoryError(
      "Invalid policy: use schemaVersion 1, booleans, supported lanes, and thresholds from 0 to 1",
      400,
    );
  }
  return {
    schemaVersion: 1,
    assistanceAllowed: value.assistanceAllowed,
    requireAssignments: value.requireAssignments,
    highRiskLane: value.highRiskLane as FactoryPolicy["highRiskLane"],
    minimumConfidence: value.minimumConfidence as number,
    redirectionThreshold: value.redirectionThreshold as number,
  };
}
export type RoutingInput = {
  quarantined?: boolean;
  finalized?: boolean;
  escalated?: boolean;
  blindAudit?: boolean;
  hasProposal?: boolean;
  highRisk?: boolean;
  confidence?: number | null;
  redirection?: number | null;
};
/** Shared routing policy never authorizes automatic acceptance or release. */
export function routeFactoryItem(input: RoutingInput, policy: FactoryPolicy) {
  const reasons: string[] = [];
  let lane: Lane = "human_review";
  if (input.quarantined) {
    lane = "quarantine";
    reasons.push("Owner quarantine must be resolved before work or export.");
  } else if (input.blindAudit) {
    lane = "blind_audit";
    reasons.push(
      "Independent audit decisions hide prior labels and assistance.",
    );
  } else if (input.finalized) {
    lane = "complete";
    reasons.push("Human decision recorded; release checks still apply.");
  } else if (
    input.escalated ||
    (input.redirection != null &&
      input.redirection >= policy.redirectionThreshold) ||
    (input.highRisk && policy.highRiskLane === "escalation")
  ) {
    lane = "escalation";
    reasons.push("An owner or adjudicator must resolve this item.");
  } else if (input.hasProposal && policy.assistanceAllowed) {
    lane = "assistance";
    reasons.push("Optional proposal available; a human decision is required.");
  } else
    reasons.push("Record a human decision without requiring a model proposal.");
  if (input.confidence != null && input.confidence < policy.minimumConfidence)
    reasons.push(
      "Proposal confidence is below this policy's review threshold.",
    );
  return { lane, reasons, automaticAcceptance: false as const };
}
