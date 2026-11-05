import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonical,
  contentHash,
  independentAuditCount,
  releaseProblems,
  rubricHash,
  validateRubric,
  validateScores,
  type RubricState,
} from "./rubric-engine";
const definition = {
  schemaVersion: 1,
  name: "Accuracy",
  criteria: [
    { id: "quality", label: "Quality", kind: "score", min: 0, max: 5 },
    { id: "safe", label: "Safe", kind: "option", options: ["yes", "no"] },
  ],
  minimumAudits: 1,
};
test("rubric factory accepts bounded score/option criteria and rejects unsafe definitions", () => {
  assert.deepEqual(validateRubric(definition), definition);
  for (const patch of [
    { schemaVersion: 2 },
    { minimumAudits: 0 },
    { minimumAudits: 6 },
    { minimumAudits: 1.2 },
    { name: "" },
    { other: 1 },
    { criteria: [] },
    { criteria: Array(13).fill(definition.criteria[0]) },
    { criteria: [definition.criteria[0], definition.criteria[0]] },
    { criteria: [{ ...definition.criteria[0], id: "constructor" }] },
    { criteria: [{ ...definition.criteria[0], min: -1 }] },
    { criteria: [{ ...definition.criteria[0], max: 101 }] },
    { criteria: [{ ...definition.criteria[0], min: 5 }] },
    { criteria: [{ ...definition.criteria[0], max: 2.5 }] },
    { criteria: [{ ...definition.criteria[1], options: ["yes", "yes"] }] },
    { criteria: [{ ...definition.criteria[1], options: ["yes"] }] },
  ])
    assert.throws(() => validateRubric({ ...definition, ...patch }));
});
test("scores require exact criterion set and bounded typed values", () => {
  const rubric = validateRubric(definition);
  assert.deepEqual(validateScores({ quality: 5, safe: "yes" }, rubric), {
    quality: 5,
    safe: "yes",
  });
  for (const scores of [
    { quality: "5", safe: "yes" },
    { quality: 6, safe: "yes" },
    { quality: -1, safe: "yes" },
    { quality: 2.5, safe: "yes" },
    { quality: 5, safe: "maybe" },
    { quality: 5 },
    { quality: 5, safe: "yes", extra: 2 },
    null,
    [],
  ])
    assert.throws(() => validateScores(scores, rubric));
});
test("canonical identities ignore JSON key order but preserve source bytes", () => {
  assert.equal(
    rubricHash({ b: 2, a: [1, 2] }),
    rubricHash({ a: [1, 2], b: 2 }),
  );
  assert.notEqual(contentHash("source"), contentHash(" source "));
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
});
test("release gates fail closed for empty queues, missing/duplicate/self/stale audits, privacy and quarantine", () => {
  const rubric = validateRubric(definition);
  const state: RubricState = {
    status: "reviewed",
    quarantined: false,
    contributors: ["reviewer"],
    decision: {
      id: "decision",
      actor: "reviewer",
      scores: { quality: 5, safe: "yes" },
      reason: "Verified",
      privacyReviewed: true,
      kind: "review",
    },
    audits: [],
  };
  const problems = () => releaseProblems([{ id: "item", state, rubric }]);
  assert.equal(releaseProblems([]).length, 1);
  assert.equal(problems().length, 1);
  state.audits.push({
    id: "a",
    actor: "reviewer",
    decisionId: "decision",
    pass: true,
    independentHuman: true,
    scores: {},
    reason: "Self",
  });
  assert.equal(independentAuditCount(state), 0);
  state.audits[0].actor = "auditor";
  state.audits[0].decisionId = "stale";
  assert.equal(independentAuditCount(state), 0);
  state.audits[0].decisionId = "decision";
  state.audits.push({ ...state.audits[0], id: "duplicate" });
  assert.equal(independentAuditCount(state), 1);
  assert.deepEqual(problems(), []);
  rubric.minimumAudits = 2;
  assert.equal(problems().length, 1);
  rubric.minimumAudits = 1;
  state.audits[0].pass = false;
  assert.equal(problems().length, 1);
  state.audits[0].pass = true;
  state.quarantined = true;
  assert.equal(problems().length, 1);
  state.quarantined = false;
  state.status = "escalated";
  assert.equal(problems().length, 1);
});
