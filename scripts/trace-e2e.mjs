import assert from "node:assert/strict";

assert.equal(process.env.REVIEWFLOW_E2E_ISOLATED, "1", "Trace E2E requires an explicitly disposable database");
const base = process.env.REVIEWFLOW_BASE_URL;
assert.ok(base, "Set REVIEWFLOW_BASE_URL to the disposable API");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname), "Refusing non-loopback API");
const origin = process.env.REVIEWFLOW_E2E_ORIGIN ?? "http://localhost:8080";
function session() {
  let cookie = "";
  return async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${base}/reviewflow${path}`, {
      method,
      headers: { "content-type": "application/json", origin, "x-reviewflow-csrf": "1", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, text };
  };
}
const request = session();
const other = session();
assert.equal((await request("/bootstrap")).status, 200);
assert.equal((await other("/bootstrap")).status, 200);
const context = {
  complete: true,
  messages: [{ role: "user", content: "Read the observable result: the local test exited with code 0. Report the result." }],
  tools: [],
  parameters: { temperature: 0 },
};
function pair(scenarioId, options = {}) {
  return ["a", "b"].map((side) => ({
    id: `trace-e2e-${scenarioId}-${side}`, scenarioId, groupId: "related-local-tests",
    task: "Summarize an observed local test result.", decisionPoint: "final-response",
    context: structuredClone(context),
    response: side === "a" ? "The observed local test passed (exit code 0)." : "The local test failed.",
    events: [{ order: 0, type: "observation", content: "process exit code: 0" }],
    provenance: { source: "synthetic-disposable-e2e", authorEmail: "synthetic-private@example.invalid" },
    candidateIdentity: `synthetic-model-${side}`, kind: "scripted", ...options,
  }));
}
const mismatch = pair("mismatch");
mismatch[1].context.messages[0].content = "A different model-visible prompt.";
const partial = pair("partial", { kind: "telemetry", response: null, context: null });
const incomplete = pair("incomplete");
delete incomplete[1].context.tools;
const singleton = pair("singleton").slice(0, 1);
const document = {
  schemaVersion: 1,
  runs: [...pair("directional"), ...pair("tie"), ...pair("uncertain"), ...pair("unacceptable"),
    ...pair("escalation"), ...pair("pending"), ...mismatch, ...partial, ...incomplete, ...singleton],
};
let result = await request("/traces/imports", { document });
assert.ok([200, 201].includes(result.status), JSON.stringify(result.data));
result = await request("/traces/imports", { document });
assert.ok([200, 201].includes(result.status), "Identical import must be idempotent");
const conflicting = structuredClone(document);
conflicting.runs[0].response = "A changed response under an existing immutable run ID.";
assert.equal((await request("/traces/imports", { document: conflicting })).status, 409);
let comparisons = (await request("/traces/comparisons")).data;
assert.ok(Array.isArray(comparisons));
assert.equal(comparisons.length, 10);
for (const scenario of ["mismatch", "partial", "incomplete", "singleton"]) {
  const item = comparisons.find((c) => c.scenarioId === scenario);
  assert.equal(item.eligible, false, `${scenario} must remain visible but ineligible`);
  assert.ok(item.reasons.length > 0);
}
let directional = comparisons.find((c) => c.scenarioId === "directional");
assert.equal(directional.eligible, true);
assert.equal(directional.revealed, false);
assert.ok(!JSON.stringify(directional).includes("synthetic-model-"), "Blind payload leaks candidate identity");
assert.equal((await other(`/traces/comparisons/${directional.id}`)).status, 404, "Cross-project read must fail");
assert.equal((await other(`/traces/comparisons/${directional.id}/reviews`, {
  decision: "a", expectedVersion: directional.version, evidenceRefs: [],
})).status, 404, "Cross-project mutation must fail");
assert.notEqual((await request(`/traces/comparisons/${directional.id}/proposals`, {
  provider: "jev", consent: true,
})).status, 200, "Live provider must remain disabled in demo");
result = await request(`/traces/comparisons/${directional.id}/proposals`, { provider: "simulator" });
assert.equal(result.status, 200, JSON.stringify(result.data));
directional = (await request(`/traces/comparisons/${directional.id}`)).data;
assert.ok(!directional.proposal, "Creating a proposal must not reveal it");
result = await request(`/traces/comparisons/${directional.id}/reveal`, {});
assert.equal(result.status, 200);
assert.equal(result.data.revealed, true);
assert.ok(result.data.proposal, "Explicit reveal should return the separate simulated proposal");
directional = result.data;
const concurrent = await Promise.all(["a", "b"].map((decision) =>
  request(`/traces/comparisons/${directional.id}/reviews`, {
    decision, expectedVersion: directional.version, evidenceRefs: ["a.events[0]"], effort: { activeMs: 123, waitingMs: 50 },
  })));
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409], "Exactly one competing review may commit");
directional = concurrent.find((r) => r.status === 200).data;
assert.equal(directional.review.assisted, true, "Reveal must be recorded separately from the human judgment");
async function quality(item) {
  const r = await request(`/traces/comparisons/${item.id}/quality`, {
    expectedVersion: item.version, status: "passed", note: "Synthetic mechanical E2E check, not independent human audit.",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
directional = await quality(directional);
for (const [scenarioId, decision] of [
  ["tie", "tie"], ["uncertain", "insufficient_evidence"],
  ["unacceptable", "both_unacceptable"], ["escalation", "escalate"],
]) {
  let item = comparisons.find((c) => c.scenarioId === scenarioId);
  result = await request(`/traces/comparisons/${item.id}/reviews`, {
    decision, expectedVersion: item.version, evidenceRefs: [],
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  item = result.data;
  assert.equal(item.review.assisted, false);
  await quality(item);
}
result = await request("/traces/releases", { name: "synthetic-mechanical-e2e" });
assert.equal(result.status, 201, JSON.stringify(result.data));
assert.equal(result.data.trainingCount, 1, "Only the eligible finalized directional comparison may train");
const releaseId = result.data.id;
const complete = await request(`/traces/releases/${releaseId}/download?format=complete`);
const training = await request(`/traces/releases/${releaseId}/download?format=preference`);
assert.equal(complete.status, 200);
assert.equal(training.status, 200);
assert.ok(!complete.text.includes("synthetic-private@example.invalid"), "Structured private identity leaked");
assert.ok(!complete.text.includes("synthetic-model-"), "Candidate identity leaked");
const records = training.text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
assert.equal(records.length, 1);
assert.notEqual(records[0].chosen, records[0].rejected);
assert.ok(records[0].context, "Full model-visible context must survive training export");
assert.equal(records[0].chosen, directional[directional.review.decision].response,
  "Chosen response must follow canonical saved identity, never display position or model suggestion");
assert.ok(JSON.stringify(complete.data).includes("a.events[0]"), "Complete export must preserve human evidence references");
assert.ok(complete.data.complete.some((row) => row.decision?.outcome === "tie"));
assert.ok(complete.data.complete.some((row) => row.decision?.outcome === "both_unacceptable"));
assert.ok(complete.data.complete.some((row) => row.decision?.outcome === "insufficient_evidence"));
assert.ok(complete.data.complete.some((row) => row.decision?.outcome === "escalation"));
assert.ok(complete.data.complete.every((row) => Array.isArray(row.exclusionReasons)));
const labelStudio = await request("/traces/labelstudio");
assert.equal(labelStudio.status, 200);
assert.ok(labelStudio.data.config.includes("Choices"));
assert.ok(Array.isArray(labelStudio.data.tasks));
assert.ok(labelStudio.data.manifest, "Label Studio kit must retain its canonical side mapping");
const analysis = await request("/traces/analysis");
assert.equal(analysis.status, 200);
assert.equal((await other(`/traces/releases/${releaseId}/download?format=complete`)).status, 404);
const before = complete.text;
result = await request(`/traces/comparisons/${directional.id}/reviews`, {
  decision: "tie", expectedVersion: directional.version, evidenceRefs: [], effort: { correctionMs: 25 },
});
assert.equal(result.status, 200, JSON.stringify(result.data));
assert.equal((await request(`/traces/releases/${releaseId}/download?format=complete`)).text, before,
  "Later corrections must not rewrite a previously published dataset snapshot");
// Exercise genuine Label Studio JSON shape through the application's import and
// explicit finalization boundary. These annotations are scripted test data,
// not a claim that a person or a running Label Studio server produced them.
const externalComparison = comparisons.find((c) => c.scenarioId === "pending");
const lsTask = labelStudio.data.tasks.find((task) => task.data.comparison_id === externalComparison.id);
assert.ok(lsTask);
const lsMapping = labelStudio.data.manifest.find((entry) => entry.comparisonId === externalComparison.id).displayMap;
const annotationBody = {
  annotations: [{ ...lsTask, annotations: [{ id: 9001, result: [{
    from_name: "preference", to_name: "a", type: "choices", value: { choices: ["B preferred"] },
  }] }] }],
  expectedVersions: { [externalComparison.id]: externalComparison.version }, reviewMode: "human_only",
};
result = await request("/traces/labelstudio/reconcile", annotationBody);
assert.equal(result.status, 200, JSON.stringify(result.data));
assert.equal(result.data.pending, 1);
assert.equal((await request("/traces/labelstudio/reconcile", annotationBody)).status, 409,
  "The same annotation batch must not create competing final decisions");
let external = (await request(`/traces/comparisons/${externalComparison.id}`)).data;
assert.equal(external.pendingAnnotation.decision, lsMapping.b,
  "Label Studio display choice must reconcile to canonical candidate identity");
assert.equal(external.review, null, "Imported annotations must not silently become final decisions");
result = await request(`/traces/comparisons/${external.id}/confirm-labelstudio`, {
  expectedVersion: external.version, evidenceRefs: ["a.events[0]"],
});
assert.equal(result.status, 200, JSON.stringify(result.data));
external = result.data;
assert.equal(external.review.decision, lsMapping.b);
assert.equal(external.review.interface, "labelstudio");
assert.equal(external.review.assisted, false);
external = await quality(external);
const externalRelease = await request("/traces/releases", { name: "confirmed-external-annotation" });
assert.equal(externalRelease.status, 201);
assert.equal(externalRelease.data.trainingCount, 1);

const leaked = pair("nested-reference-leak", {
  events: [{ type: "observation", metadata: { reference_answer: "Private reference must not leave the server." } }],
});
result = await request("/traces/imports", { document: { schemaVersion: 1, runs: leaked } });
assert.equal(result.status, 201);
const leakedComparison = (await request("/traces/comparisons")).data.find((c) => c.scenarioId === "nested-reference-leak");
result = await request(`/traces/comparisons/${leakedComparison.id}/proposals`, { provider: "simulator" });
assert.equal(result.status, 409, "Nested reference-answer metadata must block proposal admission, not be silently stripped");
assert.match(result.data.error, /reference|leak|earlier human/i);
console.log("Trace2Preference API E2E passed: imports/idempotency/conflict, context mismatch/partial/missing counterpart, blind reveal, simulator/live gate, project isolation, concurrent review fencing, all nonbinary outcomes, quality-gated private exports, and immutable release correction.");
console.log("Label Studio shaped annotation reconciliation/finalization and nested reference-answer leakage denial passed; real Label Studio UI compatibility is reported separately.");
console.log("All judgments and timing inputs in this check are scripted synthetic test values; no human benchmark or live provider run occurred.");