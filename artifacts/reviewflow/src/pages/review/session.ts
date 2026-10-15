import type { SessionSummary } from "@/lib/review-decision";

const KEY = "rf.session";

const EMPTY: SessionSummary = {
  decided: 0,
  corrected: 0,
  escalated: 0,
};

export function readSessionSummary(): SessionSummary {
  if (typeof sessionStorage === "undefined") return { ...EMPTY };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SessionSummary>;
    return {
      decided: Number(parsed.decided) || 0,
      corrected: Number(parsed.corrected) || 0,
      escalated: Number(parsed.escalated) || 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function recordSessionDecision(
  action: "accept" | "correct" | "escalate",
): SessionSummary {
  const next = readSessionSummary();
  next.decided += 1;
  if (action === "correct") next.corrected += 1;
  if (action === "escalate") next.escalated += 1;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
