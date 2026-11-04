import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FACTORY_POLICY,
  FactoryError,
  routeFactoryItem,
  validateFactoryPolicy,
} from "./factory-engine";

test("routing never accepts automatically, prioritizes holds, and keeps no-model work reviewable", () => {
  const policy = { ...DEFAULT_FACTORY_POLICY };
  assert.equal(routeFactoryItem({}, policy).lane, "human_review");
  assert.equal(
    routeFactoryItem({ hasProposal: true }, policy).lane,
    "assistance",
  );
  assert.equal(
    routeFactoryItem(
      { hasProposal: true },
      { ...policy, assistanceAllowed: false },
    ).lane,
    "human_review",
  );
  assert.equal(
    routeFactoryItem(
      { highRisk: true },
      { ...policy, highRiskLane: "escalation" },
    ).lane,
    "escalation",
  );
  assert.equal(
    routeFactoryItem({ redirection: 0.8 }, policy).lane,
    "escalation",
  );
  assert.equal(
    routeFactoryItem({ blindAudit: true, hasProposal: true }, policy).lane,
    "blind_audit",
  );
  assert.equal(
    routeFactoryItem(
      { quarantined: true, finalized: true, blindAudit: true },
      policy,
    ).lane,
    "quarantine",
  );
  for (const input of [
    {},
    { confidence: 1, hasProposal: true },
    { finalized: true },
    { escalated: true },
  ]) {
    assert.equal(routeFactoryItem(input, policy).automaticAcceptance, false);
  }
});

test("policy validation rejects attempts to add automatic acceptance or weaken release gates", () => {
  for (const invalid of [
    { automaticAcceptance: true },
    { auditRequired: false },
    { minimumConfidence: NaN },
    { redirectionThreshold: 2 },
    { requireAssignments: "false" },
    { highRiskLane: "complete" },
  ]) {
    assert.throws(
      () => validateFactoryPolicy({ ...DEFAULT_FACTORY_POLICY, ...invalid }),
      FactoryError,
    );
  }
  assert.deepEqual(
    validateFactoryPolicy(DEFAULT_FACTORY_POLICY),
    DEFAULT_FACTORY_POLICY,
  );
});
