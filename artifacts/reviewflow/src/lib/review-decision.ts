export const REVIEW_LABELS = [
  "supported",
  "contradicted",
  "insufficient_evidence",
] as const;

export type ReviewLabel = (typeof REVIEW_LABELS)[number];

export type ReviewDecisionAction = "accept" | "correct" | "escalate";

export type ReviewAttempt = "primary" | "escalate" | null;

export const REASON_MAX_LENGTH = 2000;

export const LABEL_TITLES: Record<ReviewLabel, string> = {
  supported: "Supported",
  contradicted: "Contradicted",
  insufficient_evidence: "Insufficient evidence",
};

export function labelTitle(label: ReviewLabel): string {
  return LABEL_TITLES[label];
}

/** Accept when the selected label matches the model; otherwise correct. */
export function primaryActionForSelection(
  selected: ReviewLabel,
  proposed: ReviewLabel,
): Exclude<ReviewDecisionAction, "escalate"> {
  return selected === proposed ? "accept" : "correct";
}

export function primaryButtonLabel(
  action: Exclude<ReviewDecisionAction, "escalate">,
  selected: ReviewLabel,
  proposed: ReviewLabel,
): string {
  if (action === "accept") {
    return `Accept · ${labelTitle(proposed)}`;
  }
  return `Correct to ${labelTitle(selected)}`;
}

export function reasonRequirementHint(
  action: Exclude<ReviewDecisionAction, "escalate">,
): string {
  return action === "accept"
    ? "Needed to correct or escalate"
    : "Required to correct";
}

export function reasonHelpText(args: {
  action: Exclude<ReviewDecisionAction, "escalate">;
  attempt: ReviewAttempt;
  reason: string;
}): { message: string; invalid: boolean } {
  const trimmed = args.reason.trim();
  const invalid =
    !trimmed &&
    !!args.attempt &&
    (args.attempt === "escalate" ||
      (args.attempt === "primary" && args.action === "correct"));

  if (invalid) {
    return {
      invalid: true,
      message:
        args.attempt === "escalate"
          ? "Add a reason to escalate."
          : "Add a reason to correct.",
    };
  }

  if (args.action === "accept") {
    return { invalid: false, message: "Not saved when you accept." };
  }

  return { invalid: false, message: "" };
}

export function isPrimaryBlocked(
  action: Exclude<ReviewDecisionAction, "escalate">,
  reason: string,
): boolean {
  return action === "correct" && !reason.trim();
}

export function canEscalate(reason: string): boolean {
  return Boolean(reason.trim());
}

/** Prefer the server's `error` field when present; otherwise strip the HTTP prefix. */
export function friendlyReviewError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Review failed. Try again.";
  }

  const maybe = error as {
    message?: string;
    status?: number;
    data?: unknown;
  };

  const fromData =
    maybe.data &&
    typeof maybe.data === "object" &&
    typeof (maybe.data as { error?: unknown }).error === "string"
      ? (maybe.data as { error: string }).error.trim()
      : "";

  if (fromData) return fromData;

  const raw = typeof maybe.message === "string" ? maybe.message.trim() : "";
  if (!raw) return "Review failed. Try again.";

  const stripped = raw.replace(/^HTTP \d+ [^:]+:\s*/i, "").trim();
  return stripped || raw;
}

export function formatProbability(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function riskTitle(risk: string): string {
  const lower = risk.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)} risk`;
}
