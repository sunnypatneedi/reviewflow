import assert from "node:assert/strict";
import { test } from "node:test";
import { metricNumber, metricDuration, metricPercent } from "./observability";
test("display helpers preserve unavailable, measured zero and finite denominators", () => {
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(metricNumber(value), "N/A");
    assert.equal(metricDuration(value), "N/A");
    assert.equal(metricPercent(value), "N/A");
  }
  assert.equal(metricNumber(0), "0");
  assert.equal(metricDuration(0), "0 ms");
  assert.equal(metricPercent(0), "0%");
  assert.equal(metricDuration(1000), "1 s");
  assert.equal(metricDuration(60_000), "1 min");
  assert.equal(metricDuration(3_600_000), "1 h");
  assert.equal(metricPercent(0.5), "50%");
});
