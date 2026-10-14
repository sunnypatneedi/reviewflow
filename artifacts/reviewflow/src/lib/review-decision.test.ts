import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEscalate,
  friendlyReviewError,
  formatConfidence,
  formatProbability,
  isPrimaryBlocked,
  labelTitle,
  primaryActionForSelection,
  primaryButtonLabel,
  reasonHelpText,
  reasonRequirementHint,
  riskTitle,
} from "./review-decision.ts";

describe("primaryActionForSelection", () => {
  it("accepts when the selection matches the model label", () => {
    assert.equal(primaryActionForSelection("supported", "supported"), "accept");
  });

  it("corrects when the selection differs from the model label", () => {
    assert.equal(
      primaryActionForSelection("contradicted", "supported"),
      "correct",
    );
  });
});

describe("primaryButtonLabel", () => {
  it("names the accept action with the model label", () => {
    assert.equal(
      primaryButtonLabel("accept", "supported", "supported"),
      "Accept · Supported",
    );
  });

  it("names the correct action with the chosen label", () => {
    assert.equal(
      primaryButtonLabel("correct", "contradicted", "supported"),
      "Correct to Contradicted",
    );
  });
});

describe("reason validation", () => {
  it("blocks correct without a reason and allows escalate only with a reason", () => {
    assert.equal(isPrimaryBlocked("correct", ""), true);
    assert.equal(isPrimaryBlocked("correct", "  "), true);
    assert.equal(isPrimaryBlocked("correct", "evidence mismatch"), false);
    assert.equal(isPrimaryBlocked("accept", ""), false);
    assert.equal(canEscalate(""), false);
    assert.equal(canEscalate("needs specialist"), true);
  });

  it("shows accept helper copy until a failed attempt needs a reason", () => {
    assert.deepEqual(
      reasonHelpText({ action: "accept", attempt: null, reason: "" }),
      { invalid: false, message: "Not saved when you accept." },
    );
    assert.deepEqual(
      reasonHelpText({ action: "correct", attempt: "primary", reason: "" }),
      { invalid: true, message: "Add a reason to correct." },
    );
    assert.deepEqual(
      reasonHelpText({ action: "accept", attempt: "escalate", reason: "" }),
      { invalid: true, message: "Add a reason to escalate." },
    );
    assert.equal(
      reasonRequirementHint("accept"),
      "Needed to correct or escalate",
    );
    assert.equal(reasonRequirementHint("correct"), "Required to correct");
  });
});

describe("display helpers", () => {
  it("formats labels, risk, confidence, and probabilities", () => {
    assert.equal(labelTitle("insufficient_evidence"), "Insufficient evidence");
    assert.equal(riskTitle("low"), "Low risk");
    assert.equal(formatConfidence(0.74), "74.0%");
    assert.equal(formatProbability(0.74), "74%");
    assert.equal(formatProbability(undefined), "—");
  });
});

describe("friendlyReviewError", () => {
  it("prefers the API error body and strips HTTP prefixes", () => {
    assert.equal(
      friendlyReviewError({
        message:
          "HTTP 409 Conflict: This task changed in another session. Reload before submitting.",
        data: {
          error:
            "This task changed in another session. Reload before submitting.",
        },
      }),
      "This task changed in another session. Reload before submitting.",
    );
    assert.equal(
      friendlyReviewError({
        message: "HTTP 409 Conflict: This task already has a final decision",
      }),
      "This task already has a final decision",
    );
    assert.equal(friendlyReviewError(null), "Review failed. Try again.");
  });
});
