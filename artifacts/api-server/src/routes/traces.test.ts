import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express, { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, projectsTable, traceRecordsTable } from "@workspace/db";
import { registerTraceRoutes } from "./traces";
import { roleAllows, type ProjectRole } from "./authorization";

const ids = [`trace-test-${randomUUID()}`, `trace-test-${randomUUID()}`, `trace-test-${randomUUID()}`];
let server: Server, base: string;
before(async () => {
  assert.equal(process.env.REVIEWFLOW_DISPOSABLE_DB, "1", "Trace API tests require the disposable database harness");
  const app = express(), router = Router();
  app.use(express.json());
  app.locals.runtimeConfig = { appMode: "clerk", liveInferenceEnabled: true };
  registerTraceRoutes(router, {
    ensureProject: async req => ({ project: { id: req.get("x-project") === "lease" ? ids[2] : req.get("x-project") === "other" ? ids[1] : ids[0], mode: req.get("x-test-mode") === "live" ? "live" : "demo" },
      userId: "test-user", role: (req.get("x-role") ?? "owner") as ProjectRole }),
    identity: req => req.get("x-actor") ?? "test-user",
    requireProjectAccess: async (_req, res, context, roles) => {
      if (!roleAllows(context.role, roles)) { res.status(403).json({ error: "Not permitted" }); return false; }
      return true;
    },
  });
  app.use(router);
  await db.insert(projectsTable).values(ids.map(id => ({ id, name: "Disposable trace verification" })));
  await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/reviewflow/traces`;
});

test("trace provider requests release the project lock, fence stale results, and recover expired reservations", async () => {
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => call(path, body, { ...headers, "x-project": "lease" });
  const newDocument = structuredClone(document);
  for (const run of newDocument.runs) { run.id = `lease-${run.id}`; run.scenarioId = "lease-case"; }
  assert.equal((await request("/imports", { document: newDocument })).status, 201);
  const comparison = (await (await request("/comparisons")).json() as any[]).find(row => row.scenarioId === "lease-case");
  const path = `/comparisons/${comparison.id}`;
  const originalFetch = globalThis.fetch, originalKey = process.env.TYPESAFE_API_KEY, originalOptIn = process.env.TRACE_ALLOW_LIVE_JEV;
  process.env.TYPESAFE_API_KEY = "mock-only-no-paid-request";
  process.env.TRACE_ALLOW_LIVE_JEV = "true";
  let releaseProvider!: () => void, providerStarted!: () => void;
  const waiting = new Promise<void>(resolve => { releaseProvider = resolve; });
  const started = new Promise<void>(resolve => { providerStarted = resolve; });
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.typesafe.ai/")) return originalFetch(url, options);
    providerStarted();
    await waiting;
    return new Response(JSON.stringify({ answers: { preference: { choice: "a", confidence: 1,
      probabilities: { a: 1, b: 0, tie: 0, both_unacceptable: 0, insufficient_evidence: 0, escalate: 0 } } } }), { status: 200 });
  };
  try {
    assert.equal((await request(`${path}/proposals`, { provider: "jev", consent: true }, { "x-test-mode": "live" })).status, 403);
    assert.equal((await request(`${path}/proposals`, { provider: "jev", outboundReviewed: true }, { "x-test-mode": "live" })).status, 403);
    const proposalResponse = request(`${path}/proposals`, { provider: "jev", consent: true, outboundReviewed: true }, { "x-test-mode": "live" });
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("Mock provider did not start")), 2000).unref())]);
    assert.equal((await request(`${path}/proposals`, { provider: "simulator" })).status, 409);
    const reviewResponse = await Promise.race([
      request(`${path}/reviews`, { decision: "a", expectedVersion: comparison.version, evidenceRefs: [] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Review blocked behind external provider lock")), 2000).unref()),
    ]);
    assert.equal(reviewResponse.status, 200);
    releaseProvider();
    assert.equal((await proposalResponse).status, 409, "Stale async result must not overwrite changed review");
    const clause = and(eq(traceRecordsTable.projectId, ids[2]), eq(traceRecordsTable.kind, "comparison"), eq(traceRecordsTable.key, comparison.id));
    const [stored] = await db.select().from(traceRecordsTable).where(clause);
    const payload = stored.payload as any;
    assert.equal(payload.proposalRequest, null);
    assert.equal(payload.proposal, undefined);
    // Simulates process loss after reservation without executing an external call.
    payload.proposalRequest = { requestId: "terminated-process", provider: "jev", expiresAt: Date.now() - 1 };
    await db.update(traceRecordsTable).set({ payload }).where(clause);
    assert.equal((await request(`${path}/proposals`, { provider: "simulator" })).status, 200);
    const visible = await (await request(`${path}/reveal`, {})).json() as any;
    assert.equal(visible.proposal.provider, "simulator");
    assert.equal(visible.review.decision, "a");
  } finally {
    releaseProvider();
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalKey;
    if (originalOptIn === undefined) delete process.env.TRACE_ALLOW_LIVE_JEV; else process.env.TRACE_ALLOW_LIVE_JEV = originalOptIn;
  }
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (process.env.REVIEWFLOW_DISPOSABLE_DB === "1") {
    await db.delete(traceRecordsTable).where(inArray(traceRecordsTable.projectId, ids));
    await db.delete(projectsTable).where(inArray(projectsTable.id, ids));
  }
  await pool.end();
});
async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const document = {
  schemaVersion: 1,
  runs: ["a", "b"].map((id, index) => ({
    id, scenarioId: "observable-case", groupId: "family", task: "Pick an observed color",
    decisionPoint: "turn-1", context: { complete: true, messages: [{ role: "user", content: "Name a color" }], tools: [], parameters: {} },
    response: index ? "blue" : "green", events: [{ sequence: 0, observation: "color chart" }],
    provenance: { source: "private/path", reviewerEmail: "private@example.test" }, candidateIdentity: `candidate-${id}`, kind: "scripted",
  })),
};

test("trace API: import, blind reveal, concurrent human reviews, scoped immutable release and nonbinary exclusions", async () => {
  assert.equal((await call("/imports", { document }, { "x-role": "reviewer" })).status, 403);
  const imported = await call("/imports", { document });
  assert.equal(imported.status, 201, await imported.clone().text());
  assert.equal((await imported.json() as any).imported, 2);
  assert.equal((await (await call("/imports", { document })).json() as any).imported, 0);
  const conflicting = structuredClone(document);
  conflicting.runs[0].response = "modified";
  assert.equal((await call("/imports", { document: conflicting })).status, 409);
  assert.equal((await call("/imports", { document: { schemaVersion: 1, runs: [document.runs[0], document.runs[0]] } })).status, 409);
  let comparisons = await (await call("/comparisons")).json() as any[];
  assert.equal(comparisons.length, 1);
  let comparison = comparisons[0];
  const path = `/comparisons/${comparison.id}`;
  assert.equal(comparison.a.candidateIdentity, undefined);
  assert.equal(comparison.proposal, undefined);
  assert.equal((await call(path, undefined, { "x-project": "other" })).status, 404);
  assert.deepEqual(await (await call("/comparisons", undefined, { "x-project": "other" })).json(), []);
  assert.equal((await call(`${path}/proposals`, { provider: "jev", consent: true })).status, 403);
  assert.equal((await call(`${path}/proposals`, { provider: "simulator" })).status, 200);
  assert.equal((await (await call(path)).json() as any).proposal, undefined);

  const competing = await Promise.all(["a", "b"].map(decision => call(`${path}/reviews`, {
    decision, expectedVersion: comparison.version, evidenceRefs: ["a:event:0"], effort: { activeMs: 300 },
  })));
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  comparison = await (await call(path)).json() as any;
  assert.equal(comparison.review.assisted, false);
  const humanDecision = comparison.review.decision;
  let releaseResponse = await call("/releases", { name: "Unresolved required quality" });
  assert.equal(releaseResponse.status, 201, await releaseResponse.clone().text());
  assert.equal((await releaseResponse.json() as any).trainingCount, 0);
  assert.equal((await call(`${path}/quality`, { status: "passed", note: "Invalid measurement", expectedVersion: comparison.version, effort: { auditMs: -1 } })).status, 400);
  comparison = await (await call(`${path}/quality`, { status: "passed", note: "Synthetic evidence/privacy checked", expectedVersion: comparison.version, effort: { auditMs: 40, waitingMs: null } })).json() as any;
  assert.equal(comparison.quality.effort.auditMs, 40);
  releaseResponse = await call("/releases", { name: "Verified synthetic fixture" });
  assert.equal(releaseResponse.status, 201, await releaseResponse.clone().text());
  const release = await releaseResponse.json() as any;
  assert.equal(release.trainingCount, 1);
  const completeBefore = await (await call(`/releases/${release.id}/download`)).text();
  const exported = JSON.parse(completeBefore);
  assert.equal(exported.complete[0].reviewHistory[0].assisted, false);
  assert.equal(completeBefore.includes("private@example.test"), false);
  assert.equal(completeBefore.includes("test-user"), false);
  const training = JSON.parse(await (await call(`/releases/${release.id}/download?format=preference`)).text());
  assert.equal(training.chosen, humanDecision === "a" ? "green" : "blue");
  assert.equal((await call(`/releases/${release.id}/download`, undefined, { "x-project": "other" })).status, 404);

  comparison = await (await call(`${path}/reveal`, {})).json() as any;
  assert.equal(comparison.proposal.simulated, true);
  assert.equal(comparison.review.assisted, false);
  assert.equal(comparison.revealed, true);
  assert.equal((await (await call(path, undefined, { "x-actor": "another-reviewer" })).json() as any).revealed, false);
  comparison = await (await call(`${path}/reviews`, { decision: "tie", expectedVersion: comparison.version, evidenceRefs: [] })).json() as any;
  assert.equal(comparison.review.assisted, true);
  assert.equal(comparison.quality.status, "pending");
  assert.equal(await (await call(`/releases/${release.id}/download`)).text(), completeBefore);
  const nonbinary = await (await call("/releases", { name: "Tie retained" })).json() as any;
  assert.equal(nonbinary.trainingCount, 0);
  const evidence = await (await call(`/releases/${nonbinary.id}/download`)).json() as any;
  assert.equal(evidence.complete[0].decision.outcome, "tie");
  assert.ok(evidence.complete[0].exclusionReasons.includes("nonbinary_or_missing_decision"));
  assert.equal(evidence.complete[0].reviewHistory.length, 2);
  const analysis = await (await call("/analysis")).json() as any;
  assert.equal(analysis.accuracy, null);
  assert.equal(analysis.conditions.reduce((sum: number, c: any) => sum + (c.auditMs.total ?? 0), 0), 40);
  assert.equal(analysis.conditions.reduce((sum: number, c: any) => sum + c.serviceMs.measured, 0), 1);
  const kit = await (await call("/labelstudio")).json() as any;
  assert.ok(kit.tasks.length > 0);
  const manifest = kit.manifest.find((row: any) => row.comparisonId === comparison.id);
  const task = kit.tasks.find((row: any) => row.id === manifest.taskId);
  const annotations = [{ ...task, annotations: [{ id: 123, result: [{ from_name: "preference", to_name: "a", type: "choices", value: { choices: ["B preferred"] } }] }] }];
  const body = { annotations, expectedVersions: { [comparison.id]: comparison.version }, reviewMode: "human_only" };
  assert.equal((await call("/labelstudio/reconcile", body, { "x-role": "reviewer" })).status, 403);
  const reconciled = await call("/labelstudio/reconcile", body);
  assert.equal(reconciled.status, 200, await reconciled.clone().text());
  assert.equal((await reconciled.json() as any).pending, 1);
  assert.equal((await call("/labelstudio/reconcile", body)).status, 409);
  comparison = await (await call(path)).json() as any;
  assert.equal(comparison.review.decision, "tie", "Import must not silently replace human decision");
  assert.equal(comparison.pendingAnnotation.decision, manifest.displayMap.b);
  const pendingRelease = await (await call("/releases", { name: "Pending annotation does not train" })).json() as any;
  assert.equal(pendingRelease.trainingCount, 0);
  comparison = await (await call(`${path}/confirm-labelstudio`, { expectedVersion: comparison.version, evidenceRefs: [] })).json() as any;
  assert.equal(comparison.review.decision, manifest.displayMap.b);
  assert.equal(comparison.review.interface, "labelstudio");
  assert.equal(comparison.quality.status, "pending");
  assert.equal((await call(`${path}/confirm-labelstudio`, { expectedVersion: comparison.version, evidenceRefs: [] })).status, 409);
  assert.equal((await db.select().from(traceRecordsTable).where(eq(traceRecordsTable.projectId, ids[1]))).length, 0);
});