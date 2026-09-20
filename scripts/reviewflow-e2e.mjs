import assert from "node:assert/strict";

const base = process.env.REVIEWFLOW_BASE_URL ?? "http://localhost:80/api";
assert.equal(
  process.env.REVIEWFLOW_E2E_ISOLATED,
  "1",
  "Refusing E2E: REVIEWFLOW_E2E_ISOLATED=1 must explicitly select a disposable database",
);
const baseUrl = new URL(base);
const browserOrigin = process.env.REVIEWFLOW_E2E_ORIGIN ?? "http://localhost:8080";
assert.ok(
  ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname),
  "Refusing E2E against a non-loopback server",
);
let cookie = "";
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: browserOrigin,
      "x-reviewflow-csrf": "1",
      cookie,
      ...(init.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

async function waitForJobs(taskIds, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await request(`/reviewflow/evaluation-jobs?mode=demo&taskIds=${taskIds.join(",")}`);
    assert.equal(result.response.status, 200);
    if (result.body.length === taskIds.length && result.body.every((job) => job.status === "succeeded")) return;
    const failed = result.body.find((job) => job.status === "failed");
    assert.equal(failed, undefined, `Evaluation failed: ${failed?.lastError ?? "unknown error"}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for queued demo evaluations");
}

const boot = await request("/reviewflow/bootstrap");
assert.equal(boot.response.status, 200);
assert.equal(boot.body.tasks.length, 20);

const task = { externalId:"e2e-001",question:"Is assembly required?",evidence:"Ships fully assembled.",candidateAnswer:"No assembly is required.",risk:"low" };
const first = await request("/reviewflow/tasks/import", { method:"POST",body:JSON.stringify({tasks:[task]}) });
assert.equal(first.response.status, 200);
const second = await request("/reviewflow/tasks/import", { method:"POST",body:JSON.stringify({tasks:[task]}) });
assert.equal(second.body.unchanged, 1);
const conflict = await request("/reviewflow/tasks/import", { method:"POST",body:JSON.stringify({tasks:[{...task,evidence:"Different"}]}) });
assert.equal(conflict.response.status, 409);

const listed = await request("/reviewflow/tasks");
const imported = listed.body.find((item) => item.externalId === task.externalId);
const evaluated = await request("/reviewflow/evaluate", { method:"POST",body:JSON.stringify({taskIds:[imported.id],mode:"demo",ownerConsent:false}) });
assert.equal(evaluated.response.status, 202);
assert.equal(evaluated.body.queued, 1);
assert.equal(evaluated.body.processed, 0);
await waitForJobs([imported.id]);
const next = await request("/reviewflow/review/next");
assert.equal(next.response.status, 200);
assert.equal(next.body.task.id, imported.id);
const reviewed = await request("/reviewflow/reviews", { method:"POST",body:JSON.stringify({
  taskId:next.body.task.id,version:next.body.task.version,action:"correct",
  correctedLabel:"insufficient_evidence",reason:"E2E correction reason",activeMs:1200,
}) });
assert.equal(reviewed.response.status, 200);
const stale = await request("/reviewflow/reviews", { method:"POST",body:JSON.stringify({
  taskId:next.body.task.id,version:next.body.task.version,action:"accept",activeMs:10,
}) });
assert.equal(stale.response.status, 409);

const originalIds = boot.body.tasks.map((item) => item.id);
const queued = await request("/reviewflow/evaluate", {
  method: "POST",
  body: JSON.stringify({ taskIds: originalIds, mode: "demo", ownerConsent: false }),
});
assert.equal(queued.response.status, 202);
assert.equal(queued.body.queued, originalIds.length);
await waitForJobs(originalIds);

for (const expectedId of originalIds) {
  const item = await request("/reviewflow/review/next");
  assert.equal(item.response.status, 200);
  assert.ok(item.body?.task, `Expected review item ${expectedId}`);
  const accepted = await request("/reviewflow/reviews", {
    method: "POST",
    body: JSON.stringify({
      taskId: item.body.task.id,
      version: item.body.task.version,
      action: "accept",
      activeMs: 100,
    }),
  });
  assert.equal(accepted.response.status, 200);
}
const emptyQueue = await request("/reviewflow/review/next");
assert.equal(emptyQueue.body, null);

const released = await request("/reviewflow/releases", {
  method: "POST",
  body: JSON.stringify({ name: "isolated-e2e", includeSourceText: true }),
});
assert.equal(released.response.status, 201);
assert.equal(released.body.itemCount, 21);
const download = await request(`/reviewflow/releases/${released.body.id}/download`);
assert.equal(download.response.status, 200);
assert.match(download.response.headers.get("content-type") ?? "", /application\/x-ndjson/);
const records = String(download.body).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(records.length, 21);
assert.equal(records.find((record) => record.external_id === task.externalId)?.label, "insufficient_evidence");
assert.ok(records.every((record) => record.provenance?.proposal_id && record.provenance?.review_id));

console.log("ReviewFlow E2E passed: import, async queue, correction, stale review, release, and JSONL download.");