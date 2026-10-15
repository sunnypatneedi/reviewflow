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

export const SUBMIT_SHORTCUT = {
  mac: "⌘ ↵",
  other: "Ctrl ↵",
} as const;

export type SessionSummary = {
  decided: number;
  corrected: number;
  escalated: number;
};

export type QueueProgress = {
  decided: number;
  total: number;
  awaiting: number;
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

export function reasonFieldCopy(action: ReviewDecisionAction): {
  label: string;
  hint: string;
  help: string;
} {
  switch (action) {
    case "accept":
      return {
        label: "Reason",
        hint: "Optional to accept",
        help: "Not saved when you accept.",
      };
    case "correct":
      return {
        label: "Reason for correction",
        hint: "Required",
        help: "Saved with the correction.",
      };
    case "escalate":
      return {
        label: "Reason for escalation",
        hint: "Required",
        help: "",
      };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Help / invalid copy for a reason field. Pass the field's own action so an
 * escalate dialog never reports "Add a reason to correct." and vice versa.
 */
export function reasonHelpText(args: {
  action: ReviewDecisionAction;
  attempt: ReviewAttempt;
  reason: string;
}): { message: string; invalid: boolean } {
  const trimmed = args.reason.trim();
  const copy = reasonFieldCopy(args.action);

  // Accept never invalidates. Escalate errors only from the dialog field;
  // correct errors only from the rail field on a primary attempt.
  const invalid =
    !trimmed &&
    ((args.action === "correct" && args.attempt === "primary") ||
      (args.action === "escalate" && args.attempt === "escalate"));

  if (invalid) {
    return {
      invalid: true,
      message:
        args.action === "escalate"
          ? "Add a reason to escalate."
          : "Add a reason to correct.",
    };
  }

  return { invalid: false, message: copy.help };
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

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function submitShortcutLabel(): string {
  return isMacPlatform() ? SUBMIT_SHORTCUT.mac : SUBMIT_SHORTCUT.other;
}

export function progressFromMetrics(m: {
  finalized: number;
  escalated: number;
  total: number;
  proposed: number;
}): QueueProgress {
  return {
    decided: m.finalized + m.escalated,
    total: m.total,
    awaiting: m.proposed,
  };
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

export function isConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (status === 409) return true;
  const message = friendlyReviewError(error).toLowerCase();
  return (
    message.includes("changed in another session") ||
    message.includes("already has a final")
  );
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

export function flashKey(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rf:key", { detail: key }));
}
