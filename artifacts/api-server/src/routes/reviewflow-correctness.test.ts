import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTaskContent, taskContentHash } from "./reviewflow.ts";

const base = {
  externalId: "legacy-1",
  question: "Question",
  evidence: "Evidence",
  candidateAnswer: "Answer",
  risk: "low",
};

test("task hashing is canonical across input property order", () => {
  const reordered = {
    risk: "low",
    candidateAnswer: "Answer",
    evidence: "Evidence",
    question: "Question",
    externalId: "legacy-1",
  };
  assert.equal(taskContentHash(base), taskContentHash(reordered));
});

test("null scenario family retains the legacy hash shape", () => {
  assert.equal(canonicalTaskContent({ ...base, scenarioFamilyId: null }), JSON.stringify(base));
  assert.equal(taskContentHash({ ...base, scenarioFamilyId: null }), taskContentHash(base));
  assert.notEqual(taskContentHash({ ...base, scenarioFamilyId: "family-a" }), taskContentHash(base));
});