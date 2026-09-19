import assert from "node:assert/strict";

const base = process.env.REVIEWFLOW_BASE_URL ?? "http://localhost:80/api";
let cookie = "";
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
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
assert.equal(evaluated.body.processed, 1);
const next = await request("/reviewflow/review/next");
assert.equal(next.response.status, 200);
const reviewed = await request("/reviewflow/reviews", { method:"POST",body:JSON.stringify({
  taskId:next.body.task.id,version:next.body.task.version,action:"correct",
  correctedLabel:"insufficient_evidence",reason:"E2E correction reason",activeMs:1200,
}) });
assert.equal(reviewed.response.status, 200);
const stale = await request("/reviewflow/reviews", { method:"POST",body:JSON.stringify({
  taskId:next.body.task.id,version:next.body.task.version,action:"accept",activeMs:10,
}) });
assert.equal(stale.response.status, 409);

console.log("ReviewFlow E2E passed: bootstrap, import idempotency/conflict, demo evaluation, correction, stale review.");