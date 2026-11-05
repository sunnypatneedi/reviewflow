import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvaluationConfiguration } from "./evaluation-request";
test("evaluation configuration only names supported implementations and bounded run IDs", () => {
  assert.equal(parseEvaluationConfiguration({ experimentRunId: "study-2:trial.a" }, "demo").experimentRunId, "study-2:trial.a");
  assert.equal(parseEvaluationConfiguration({}, "demo").requestedModel, "demo-simulator-v1");
  for (const body of [{ experimentRunId: "" }, { experimentRunId: "x".repeat(129) }, { experimentRunId: "private source text" }, { questionVersion: "invented" }, { contextPreparationVersion: "new" }, { requestedModel: "a-new-model" }]) {
    assert.throws(() => parseEvaluationConfiguration(body, "demo"), /experimentRunId|Unsupported/);
  }
});
