import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import { db, pool, projectsTable, tasksTable, proposalsTable, reviewsTable, auditsTable, auditItemsTable, auditDecisionsTable, auditDisputesTable, releasesTable } from "@workspace/db";

let server: Server;
let base: string;
before(async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  process.env.APP_MODE = "demo";
  process.env.DEMO_PROJECT_CREATION_WINDOW_MAX = "100";
  process.env.SESSION_SECRET = "isolated-release-integrity-test-secret";
  const { default: app } = await import("../app");
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address(); assert.ok(addr && typeof addr === "object");
      base = `http://127.0.0.1:${addr.port}/api/reviewflow`; resolve();
    });
  });
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await pool.end(); });
async function request(cookie: string, path: string, body?: unknown) {
  return fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: "http://127.0.0.1:5173", "x-reviewflow-csrf": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function fixture() {
  const boot = await request("", "/bootstrap"); assert.equal(boot.status, 200);
  const cookie = boot.headers.get("set-cookie")!.split(";", 1)[0];
  const projectId = `demo:${/^s:([^.]+)/.exec(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)))![1]}`;
  // Seed synthetic finalized records, preserving bootstrap tasks. No user data.
  const tasks = await db.update(tasksTable).set({ status: "finalized", finalLabel: "supported", version: 2 }).where(eq(tasksTable.projectId, projectId)).returning();
  const rows = tasks.map(t => ({ id: randomUUID(), projectId, taskId: t.id, mode: "demo", requestedModel: "demo-simulator-v1", returnedModel: "demo-simulator-v1", label: "supported", labelProbability: "0.9", probabilities: {}, injectionProbability: "0", complexity: 1, confidence: "0.9", latencyMs: 1, rawResponse: {} }));
  await db.insert(proposalsTable).values(rows);
  await db.insert(reviewsTable).values(tasks.map((t, i) => ({ id: randomUUID(), projectId, taskId: t.id, proposalId: rows[i].id, reviewerId: "synthetic-original-reviewer", action: "accept", label: "supported", activeMs: 1, taskVersion: 1 })));
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  return { cookie, projectId, tasks, actor: `demo:${project.demoSessionId}` };
}
async function disputed(f: Awaited<ReturnType<typeof fixture>>) {
  const auditId = randomUUID(), itemId = randomUUID(), disputeId = randomUUID();
  const allReviews = await db.select().from(reviewsTable).where(eq(reviewsTable.projectId, f.projectId));
  const { releaseSamplingFrame } = await import("../lib/releases");
  const frame = releaseSamplingFrame(f.tasks, allReviews, "synthetic-auditor", true);
  const { selectDeterministicSample, samplingFrameHash } = await import("../lib/audits");
  const selected = selectDeterministicSample("synthetic", frame.eligible, 1)[0];
  const review = allReviews.find(r => r.id === selected.reviewId)!;
  const task = f.tasks.find(t => t.id === selected.taskId)!;
  await db.insert(auditsTable).values({ id: auditId, projectId: f.projectId, status: "blocked", sampleSize: 1, seed: "synthetic", samplingFrameHash: samplingFrameHash(frame), samplingFrame: frame, independent: true, required: true, auditorId: "synthetic-auditor" });
  await db.insert(auditItemsTable).values({ id: itemId, auditId, taskId: review.taskId, ordinal: 1, originalReviewId: review.id, originalReviewerId: review.reviewerId, originalLabel: review.label!, taskContentHash: task.contentHash, taskVersion: task.version });
  await db.insert(auditDecisionsTable).values({ id: randomUUID(), auditId, auditItemId: itemId, taskId: review.taskId, auditorId: "synthetic-auditor", label: "contradicted" });
  await db.insert(auditDisputesTable).values({ id: disputeId, auditId, auditItemId: itemId, taskId: review.taskId, originalLabel: "supported", auditLabel: "contradicted" });
  return { auditId, itemId, disputeId, review, task };
}

test("adjudication to a different label reaches the downloaded release and preserves old bytes", async () => {
  const f = await fixture();
  const old = await request(f.cookie, "/releases", { name: "before" }); assert.equal(old.status, 201);
  const oldRelease = await old.json() as { id: string; digest: string };
  const oldBytes = await (await request(f.cookie, `/releases/${oldRelease.id}/download`)).text();
  await db.update(projectsTable).set({ releaseAuditPolicyVersion: "independent-sample-v1" }).where(eq(projectsTable.id, f.projectId));
  const d = await disputed(f);
  const adjudicated = await request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: "contradicted", reason: "Synthetic correction, not human quality evidence" });
  assert.equal(adjudicated.status, 200);
  const released = await request(f.cookie, "/releases", { name: "after" }); assert.equal(released.status, 201, await released.clone().text());
  const release = await released.json() as { id: string; digest: string };
  const bytes = await (await request(f.cookie, `/releases/${release.id}/download`)).text();
  const row = bytes.trim().split("\n").map(s => JSON.parse(s)).find(r => r.external_id === d.task.externalId);
  assert.equal(row.label, "contradicted");
  assert.equal(row.provenance.adjudication_id, d.disputeId);
  assert.equal(row.provenance.review_id, d.review.id);
  assert.equal(row.provenance.original_review_id, d.review.id);
  assert.equal(release.digest, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(await (await request(f.cookie, `/releases/${oldRelease.id}/download`)).text(), oldBytes);
  assert.notEqual(release.digest, oldRelease.digest);
  if (process.env.REVIEWFLOW_RELEASE_EVIDENCE_DIR) {
    const dir = process.env.REVIEWFLOW_RELEASE_EVIDENCE_DIR;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "before.jsonl"), oldBytes);
    await writeFile(join(dir, "after.jsonl"), bytes);
    await writeFile(join(dir, "export-inspection.json"), JSON.stringify({ synthetic: true, originalLabel: "supported", correctedLabel: row.label,
      oldDigest: oldRelease.digest, newDigest: release.digest, oldBytesUnchanged: true, adjudicationId: d.disputeId,
      originalReviewId: d.review.id, releasedProvenance: row.provenance }, null, 2) + "\n");
  }
});

test("unresolved optional disputes also block release", async () => {
  const f = await fixture(); const d = await disputed(f);
  await db.update(auditsTable).set({ required: false }).where(eq(auditsTable.id, d.auditId));
  const release = await request(f.cookie, "/releases", { name: "must-block" });
  assert.equal(release.status, 409);
  assert.equal((await db.select().from(releasesTable).where(eq(releasesTable.projectId, f.projectId))).length, 0);
});

async function completeAudit(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await request(f.cookie, "/audits", { sampleSize: 1, independent: true, required: true, seed: "synthetic-complete" });
  assert.equal(created.status, 201, await created.clone().text());
  const audit = await created.json() as { id: string };
  const [item] = await db.select().from(auditItemsTable).where(eq(auditItemsTable.auditId, audit.id));
  const submitted = await request(f.cookie, `/audits/${audit.id}/decisions`, { auditItemId: item.id, label: item.originalLabel, reason: "Synthetic mechanics only" });
  assert.equal(submitted.status, 201, await submitted.clone().text());
  return { audit, item };
}

test("versioned trusted policy rejects zero audits; demo policy remains explicitly unverified", async () => {
  const f = await fixture();
  assert.equal((await request(f.cookie, "/releases", { name: "synthetic-demo" })).status, 201);
  await db.update(projectsTable).set({ releaseAuditPolicyVersion: "independent-sample-v1" }).where(eq(projectsTable.id, f.projectId));
  const absent = await request(f.cookie, "/releases", { name: "trusted-without-evidence" });
  assert.equal(absent.status, 409, await absent.clone().text());
  const { audit } = await completeAudit(f);
  const trusted = await request(f.cookie, "/releases", { name: "trusted-current-sample" });
  assert.equal(trusted.status, 201, await trusted.clone().text());
  const release = await trusted.json() as { id: string };
  const [saved] = await db.select().from(releasesTable).where(eq(releasesTable.id, release.id));
  assert.equal((saved.manifest as { release_audit_policy_version: string }).release_audit_policy_version, "independent-sample-v1");
  const row = JSON.parse(saved.jsonl.split("\n")[0]);
  assert.deepEqual(row.provenance.audit_ids, [audit.id]);
});

test("required audit fails closed on incomplete, missing, excluded or changed evidence", async () => {
  const f = await fixture();
  await db.update(projectsTable).set({ releaseAuditPolicyVersion: "independent-sample-v1" }).where(eq(projectsTable.id, f.projectId));
  const { audit, item } = await completeAudit(f);
  const release = () => request(f.cookie, "/releases", { name: "evidence-check" });
  assert.equal((await release()).status, 201);
  for (const status of ["in_progress", "invalid", "blocked"]) {
    await db.update(auditsTable).set({ status }).where(eq(auditsTable.id, audit.id));
    assert.equal((await release()).status, 409, status);
  }
  await db.update(auditsTable).set({ status: "completed" }).where(eq(auditsTable.id, audit.id));
  await db.update(auditDecisionsTable).set({ included: false }).where(eq(auditDecisionsTable.auditItemId, item.id));
  assert.equal((await release()).status, 409);
  await db.update(auditDecisionsTable).set({ included: true, auditItemId: "missing-item" }).where(eq(auditDecisionsTable.auditItemId, item.id));
  assert.equal((await release()).status, 409);
  await db.update(auditDecisionsTable).set({ auditItemId: item.id }).where(and(eq(auditDecisionsTable.auditId, audit.id), eq(auditDecisionsTable.auditItemId, "missing-item")));
  const unsampled = f.tasks.find(t => t.id !== item.taskId)!;
  // A changed decision outside the selected sample invalidates population
  // coverage even though source text, selected item and audit status are intact.
  await db.update(tasksTable).set({ version: 3 }).where(eq(tasksTable.id, unsampled.id));
  const [old] = await db.select().from(reviewsTable).where(eq(reviewsTable.taskId, unsampled.id));
  await db.insert(reviewsTable).values({ ...old, id: randomUUID(), taskVersion: 2 });
  assert.equal((await release()).status, 409);
  await completeAudit(f);
  assert.equal((await release()).status, 201, "a new current-population audit restores coverage");
});

test("adjudication lineage rejects revoked, changed and contradictory decisions", async () => {
  const f = await fixture(); const d = await disputed(f);
  const response = await request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: "contradicted", reason: "Synthetic correction" });
  assert.equal(response.status, 200);
  const release = () => request(f.cookie, "/releases", { name: "must-not-fallback" });
  assert.equal((await release()).status, 201);
  await db.update(auditDisputesTable).set({ status: "revoked" }).where(eq(auditDisputesTable.id, d.disputeId));
  assert.equal((await release()).status, 409);
  await db.update(auditDisputesTable).set({ status: "resolved", resolvedLabel: "supported" }).where(eq(auditDisputesTable.id, d.disputeId));
  assert.equal((await release()).status, 409);
  await db.update(auditDisputesTable).set({ resolvedLabel: "contradicted" }).where(eq(auditDisputesTable.id, d.disputeId));
  await db.update(tasksTable).set({ finalLabel: "supported" }).where(eq(tasksTable.id, d.task.id));
  assert.equal((await release()).status, 409);
});

test("independent actor restrictions and concurrent corrections prevent competing final labels", async () => {
  const f = await fixture(); const first = await disputed(f), second = await disputed(f);
  await db.update(auditsTable).set({ auditorId: f.actor }).where(eq(auditsTable.id, first.auditId));
  const resolve = (d: typeof first, label = "contradicted") => request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: label, reason: "Synthetic race" });
  assert.equal((await resolve(first)).status, 403, "assigned auditor cannot adjudicate");
  await db.update(auditsTable).set({ auditorId: "synthetic-auditor" }).where(eq(auditsTable.id, first.auditId));
  await db.update(auditItemsTable).set({ originalReviewerId: f.actor }).where(eq(auditItemsTable.id, first.itemId));
  assert.equal((await resolve(first)).status, 403, "original reviewer cannot adjudicate");
  await db.update(auditItemsTable).set({ originalReviewerId: first.review.reviewerId }).where(eq(auditItemsTable.id, first.itemId));
  const results = await Promise.all([resolve(first), resolve(second, "insufficient_evidence")]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await request(f.cookie, "/releases", { name: "remaining-dispute" })).status, 409);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, first.task.id));
  assert.equal(task.version, 3);
  assert.ok([first.disputeId, second.disputeId].some(id => id === task.finalAdjudicationId));
});

test("concurrent release and adjudication never export stale or mixed decisions", async () => {
  const f = await fixture(); const d = await disputed(f);
  const [correction, release] = await Promise.all([
    request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: "contradicted", reason: "Synthetic concurrent export" }),
    request(f.cookie, "/releases", { name: "concurrent-snapshot" }),
  ]);
  assert.equal(correction.status, 200);
  assert.ok([201, 409].includes(release.status));
  if (release.status === 201) {
    const saved = await release.json() as { id: string };
    const bytes = await (await request(f.cookie, `/releases/${saved.id}/download`)).text();
    const row = bytes.trim().split("\n").map(s => JSON.parse(s)).find(r => r.external_id === d.task.externalId);
    assert.equal(row.label, "contradicted");
    assert.equal(row.provenance.task_version, 3);
    assert.equal(row.provenance.adjudication_id, d.disputeId);
  }
});

// RF-R1: independent reviewer regressions. Optional audit evidence is still
// mandatory when it supplies the correction in the final decision lineage.
for (const mutation of ["revoked originating optional audit", "changed originating optional frame"] as const) {
  test(`trusted corrected release must reject ${mutation}`, async () => {
    const f = await fixture(), d = await disputed(f);
    await db.update(auditsTable).set({ required: false }).where(eq(auditsTable.id, d.auditId));
    assert.equal((await request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: "contradicted" })).status, 200);
    await db.update(projectsTable).set({ releaseAuditPolicyVersion: "independent-sample-v1" }).where(eq(projectsTable.id, f.projectId));
    await completeAudit(f);
    const control = await request(f.cookie, "/releases", { name: "valid-optional-origin" });
    assert.equal(control.status, 201);
    const old = await control.json() as { id: string; digest: string };
    const bytes = await (await request(f.cookie, `/releases/${old.id}/download`)).text();
    await db.update(auditsTable).set(mutation.startsWith("revoked") ? { status: "revoked" } : { samplingFrameHash: "changed-commitment" }).where(eq(auditsTable.id, d.auditId));
    const result = await request(f.cookie, "/releases", { name: "damaged-optional-origin" });
    assert.equal(result.status, 409, await result.clone().text());
    assert.equal((await db.select().from(releasesTable).where(eq(releasesTable.projectId, f.projectId))).length, 1);
    assert.equal(await (await request(f.cookie, `/releases/${old.id}/download`)).text(), bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), old.digest);
  });
}

for (const mutation of ["revoked", "changed commitment", "changed selection", "changed snapshot"] as const) {
  test(`adjudication rejects ${mutation} optional originating evidence before changing the task`, async () => {
    const f = await fixture(), d = await disputed(f);
    await db.update(auditsTable).set({ required: false }).where(eq(auditsTable.id, d.auditId));
    const [audit] = await db.select().from(auditsTable).where(eq(auditsTable.id, d.auditId));
    if (mutation === "revoked") await db.update(auditsTable).set({ status: "revoked" }).where(eq(auditsTable.id, d.auditId));
    if (mutation === "changed commitment") await db.update(auditsTable).set({ samplingFrameHash: "changed-commitment" }).where(eq(auditsTable.id, d.auditId));
    if (mutation === "changed selection") {
      const { selectDeterministicSample } = await import("../lib/audits");
      const frame = audit.samplingFrame as { eligible: Array<{ taskId: string }> };
      let seed = "";
      for (let n = 0; !seed; n++) if (selectDeterministicSample(`changed-${n}`, frame.eligible, 1)[0].taskId !== d.task.id) seed = `changed-${n}`;
      await db.update(auditsTable).set({ seed }).where(eq(auditsTable.id, d.auditId));
    }
    if (mutation === "changed snapshot") {
      const { samplingFrameHash } = await import("../lib/audits");
      const frame = audit.samplingFrame as import("../lib/releases").ReleaseFrame;
      frame.eligible.find(row => row.taskId === d.task.id)!.label = "insufficient_evidence";
      // Even a self-consistent replacement commitment cannot override the
      // original selected item's bound decision snapshot.
      await db.update(auditsTable).set({ samplingFrame: frame, samplingFrameHash: samplingFrameHash(frame) }).where(eq(auditsTable.id, d.auditId));
    }
    const result = await request(f.cookie, `/audits/${d.auditId}/disputes/${d.disputeId}/adjudicate`, { resolvedLabel: "contradicted" });
    assert.equal(result.status, 409, await result.clone().text());
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, d.task.id));
    const [dispute] = await db.select().from(auditDisputesTable).where(eq(auditDisputesTable.id, d.disputeId));
    assert.equal(task.version, 2);
    assert.equal(task.finalLabel, "supported");
    assert.equal(task.finalAdjudicationId, null);
    assert.equal(dispute.status, "pending");
  });
}
