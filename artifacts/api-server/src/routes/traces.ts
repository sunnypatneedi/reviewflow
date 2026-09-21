import type { IRouter, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, traceRecordsTable } from "@workspace/db";
import { RELEASE_ROLES, REVIEW_ROLES, type ProjectRole } from "./authorization";
import {
  TraceError, assertVersion, assertNoReferenceLeakage, comparisonView, measuredEffort, publicProposal, shareableEvidence, stableJson, traceHash, traceProposal,
  tracePython, validateReview, type TraceObject,
} from "../lib/traces";

type Context = { project: { id: string; mode: string }; userId: string | null; role: ProjectRole | null };
type Helpers = {
  ensureProject: (req: Request) => Promise<Context>;
  requireProjectAccess: (req: Request, res: Response, context: any, roles?: readonly ProjectRole[]) => Promise<boolean>;
  identity: (req: Request) => string;
};
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const where = (projectId: string, kind: string, key?: string) =>
  and(eq(traceRecordsTable.projectId, projectId), eq(traceRecordsTable.kind, kind),
    ...(key === undefined ? [] : [eq(traceRecordsTable.key, key)]));
const rows = async (tx: Transaction | typeof db, projectId: string, kind: string) =>
  (await tx.select().from(traceRecordsTable).where(where(projectId, kind))).map(row => row.payload as TraceObject);
async function save(tx: Transaction, projectId: string, kind: string, key: string, payload: TraceObject) {
  await tx.insert(traceRecordsTable).values({ id: randomUUID(), projectId, kind, key, payload })
    .onConflictDoUpdate({ target: [traceRecordsTable.projectId, traceRecordsTable.kind, traceRecordsTable.key], set: { payload } });
}
async function find(tx: Transaction | typeof db, projectId: string, kind: string, key: string) {
  const [record] = await tx.select().from(traceRecordsTable).where(where(projectId, kind, key));
  if (!record) throw new TraceError("Trace record not found in this project", 404);
  return record.payload as TraceObject;
}
async function locked<T>(projectId: string, action: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`traces:${projectId}`}, 0))`);
    return action(tx);
  });
}
const metadata = (release: TraceObject) => ({
  id: release.id, name: release.name, createdAt: release.createdAt,
  itemCount: release.itemCount, trainingCount: release.trainingCount, digest: release.digest,
});

export function registerTraceRoutes(router: IRouter, helpers: Helpers) {
  const base = "/reviewflow/traces";
  const route = (method: "get" | "post", path: string, roles: readonly ProjectRole[] | undefined,
    action: (req: Request, res: Response, context: Context, actor: string) => Promise<void>) => {
    router[method](`${base}${path}`, async (req, res) => {
      try {
        const context = await helpers.ensureProject(req);
        if (!await helpers.requireProjectAccess(req, res, context, roles)) return;
        await action(req, res, context, helpers.identity(req));
      } catch (error) {
        if (error instanceof TraceError) res.status(error.status).json({ error: error.message });
        else res.status(500).json({ error: "Trace operation failed; no partial update was committed" });
      }
    });
  };
  route("post", "/imports", RELEASE_ROLES, async (req, res, { project }) => {
    const document = req.body?.document;
    if (document?.schemaVersion !== 1 || !Array.isArray(document.runs) || document.runs.length === 0) throw new TraceError("Expected a schemaVersion 1 document with nonempty runs");
    const result = await locked(project.id, async tx => {
      const existingRuns = await rows(tx, project.id, "run");
      const byId = new Map(existingRuns.map(run => [run.id, run]));
      const incomingIds = new Set<string>();
      let imported = 0;
      for (const run of document.runs) {
        if (!run || typeof run.id !== "string") throw new TraceError("Each run requires a string id");
        if (incomingIds.has(run.id)) throw new TraceError(`Duplicate run ID within this document: ${run.id}`, 409);
        incomingIds.add(run.id);
        const existing = byId.get(run.id);
        if (existing && stableJson(existing) !== stableJson(run)) throw new TraceError(`Conflicting duplicate run ID: ${run.id}`, 409);
        if (!existing) { byId.set(run.id, run); imported++; }
      }
      const validation = await tracePython("validate", { schemaVersion: 1, runs: [...byId.values()] });
      const existingComparisons = new Map((await rows(tx, project.id, "comparison")).map(row => [row.id, row]));
      for (const run of byId.values()) await save(tx, project.id, "run", run.id, run);
      for (const comparison of validation.comparisons) {
        if (!existingComparisons.has(comparison.id)) {
          await save(tx, project.id, "comparison", comparison.id, {
            ...comparison, version: 1, review: null, history: [], reveals: [],
            quality: { status: "pending", note: "Required evidence, privacy, and eligibility check has not been completed." },
          });
        }
      }
      // Incomplete singletons may disappear once their actual counterpart arrives.
      // Retain their history for evidence, but never let stale eligibility train.
      const currentIds = new Set(validation.comparisons.map((c: TraceObject) => c.id));
      for (const old of existingComparisons.values()) {
        if (!currentIds.has(old.id)) {
          await save(tx, project.id, "comparison", old.id, { ...old, eligible: false,
            reasons: [...new Set([...(old.reasons ?? []), "superseded_by_new_import"])], version: old.version + 1 });
        }
      }
      return { imported, comparisons: validation.comparisons.length, issues: validation.issues };
    });
    res.status(201).json(result);
  });

  route("get", "/comparisons", undefined, async (_req, res, { project }, actor) => {
    res.json((await rows(db, project.id, "comparison")).map(row => comparisonView(row, actor)));
  });
  route("get", "/comparisons/:id", undefined, async (req, res, { project }, actor) => {
    res.json(comparisonView(await find(db, project.id, "comparison", String(req.params.id)), actor));
  });
  route("post", "/comparisons/:id/reveal", REVIEW_ROLES, async (req, res, { project }, actor) => {
    const updated = await locked(project.id, async tx => {
      const value = await find(tx, project.id, "comparison", String(req.params.id));
      if (!value.reveals.some((entry: TraceObject) => entry.actor === actor)) {
        value.reveals.push({ actor, createdAt: new Date().toISOString(), proposalPresent: Boolean(value.proposal) });
        await save(tx, project.id, "comparison", value.id, value);
      }
      return value;
    });
    res.json(comparisonView(updated, actor));
  });
  route("post", "/comparisons/:id/reviews", REVIEW_ROLES, async (req, res, context, actor) => {
    const input = validateReview(req.body ?? {});
    const updated = await locked(context.project.id, async tx => {
      const value = await find(tx, context.project.id, "comparison", String(req.params.id));
      assertVersion(value, input.expectedVersion);
      if (value.review?.decision === "escalate" && context.userId && !RELEASE_ROLES.includes(context.role!)) throw new TraceError("An owner or adjudicator must resolve escalated comparisons", 403);
      if (value.review) value.history.push(value.review);
      value.review = {
        decision: input.decision, evidenceRefs: input.evidenceRefs, effort: input.effort,
        actor, assisted: value.reveals.some((entry: TraceObject) => entry.actor === actor),
        interface: "reviewflow", createdAt: new Date().toISOString(), revision: value.version + 1,
      };
      value.version++;
      if (value.quality.createdAt) value.qualityHistory = [...(value.qualityHistory ?? []), value.quality];
      // A correction requires quality rechecking; published releases remain unchanged.
      value.quality = { status: "pending", note: "Review changed; required evidence and privacy check must be completed again." };
      await save(tx, context.project.id, "comparison", value.id, value);
      return value;
    });
    res.json(comparisonView(updated, actor));
  });
  route("post", "/comparisons/:id/quality", RELEASE_ROLES, async (req, res, { project }, actor) => {
    if (!["passed", "pending", "failed"].includes(req.body?.status) || typeof req.body?.note !== "string" || !req.body.note.trim() || req.body.note.length > 2000) {
      throw new TraceError("Quality check requires a status and evidence/privacy review note");
    }
    const effort = measuredEffort(req.body?.effort, ["auditMs", "waitingMs"]);
    const updated = await locked(project.id, async tx => {
      const value = await find(tx, project.id, "comparison", String(req.params.id));
      assertVersion(value, req.body.expectedVersion);
      if (value.quality.createdAt) value.qualityHistory = [...(value.qualityHistory ?? []), value.quality];
      value.quality = { status: req.body.status, note: req.body.note, actor, effort, createdAt: new Date().toISOString() };
      value.version++;
      await save(tx, project.id, "comparison", value.id, value);
      return value;
    });
    res.json(comparisonView(updated, actor));
  });
  route("post", "/comparisons/:id/proposals", REVIEW_ROLES, async (req, res, context) => {
    const provider = req.body?.provider ?? "simulator";
    if (provider !== "simulator" && provider !== "jev") throw new TraceError("Choose simulator or jev");
    if (provider === "jev") {
      if (process.env.TRACE_ALLOW_LIVE_JEV !== "true" || !req.app.locals.runtimeConfig?.liveInferenceEnabled
        || req.app.locals.runtimeConfig?.appMode !== "clerk" || !context.userId || context.project.mode !== "live") throw new TraceError("Paid trace evaluation is disabled; it requires explicit server opt-in and an authorized live project", 403);
      if (req.body?.consent !== true || req.body?.outboundReviewed !== true) throw new TraceError("Explicit outbound-data consent and confirmation that the actual trace text was reviewed for private data are required", 403);
    }
    const requestId = randomUUID();
    const snapshot = await locked(context.project.id, async tx => {
      const value = await find(tx, context.project.id, "comparison", String(req.params.id));
      if (value.proposal) throw new TraceError("A proposal already exists for this comparison", 409);
      if (value.proposalRequest?.expiresAt > Date.now()) throw new TraceError("A proposal request is already running; retry after its bounded lease expires", 409);
      const importedRuns = await rows(tx, context.project.id, "run");
      for (const run of importedRuns.filter(run => [value.a?.runId, value.b?.runId].includes(run.id))) assertNoReferenceLeakage(run);
      value.proposalRequest = { requestId, provider, expiresAt: Date.now() + 30_000 };
      await save(tx, context.project.id, "comparison", value.id, value);
      return value;
    });
    // Never hold the project lock during external I/O. Failure commits nothing.
    try {
      const proposal = await traceProposal(snapshot, provider);
      await locked(context.project.id, async tx => {
        const value = await find(tx, context.project.id, "comparison", snapshot.id);
        assertVersion(value, snapshot.version);
        if (value.proposal || value.proposalRequest?.requestId !== requestId) throw new TraceError("Another proposal request superseded this result. No result was overwritten.", 409);
        value.proposal = proposal;
        value.proposalRequest = null;
        await save(tx, context.project.id, "comparison", value.id, value);
      });
    } catch (error) {
      await locked(context.project.id, async tx => {
        const value = await find(tx, context.project.id, "comparison", snapshot.id);
        if (value.proposalRequest?.requestId === requestId) {
          value.proposalRequest = null;
          await save(tx, context.project.id, "comparison", value.id, value);
        }
      });
      throw error;
    }
    res.json({ available: true, provider });
  });

  route("get", "/releases", undefined, async (_req, res, { project }) => {
    res.json((await rows(db, project.id, "release")).map(metadata));
  });
  route("post", "/releases", RELEASE_ROLES, async (req, res, { project }) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 150) throw new TraceError("A release name (1–150 characters) is required");
    const release = await locked(project.id, async tx => {
      const comparisons = await rows(tx, project.id, "comparison");
      if (!comparisons.length) throw new TraceError("Import traces before creating a release", 409);
      const decisions = comparisons.filter(row => row.review).map(row => ({
        comparisonId: row.id, outcome: row.review.decision === "escalate" ? "escalation" : row.review.decision,
        finalized: !row.pendingAnnotation && !["insufficient_evidence", "escalate"].includes(row.review.decision),
        reviewMode: row.review.assisted ? "model_assisted" : "human_only", qualityChecksPassed: !row.pendingAnnotation && row.quality.status === "passed",
        evidenceReferences: row.review.evidenceRefs, effort: row.review.effort,
        interface: row.review.interface, createdAt: row.review.createdAt, revision: row.review.revision,
      }));
      let salts = await rows(tx, project.id, "salt");
      if (!salts.length) { salts = [{ value: randomUUID() }]; await save(tx, project.id, "salt", "export", salts[0]); }
      const validation = { schemaVersion: 1, runs: await rows(tx, project.id, "run"),
        comparisons: comparisons.map(({ review, history, reveals, quality, proposal, version, ...comparison }) => comparison), issues: [] };
      const exported = await tracePython("export", { validation, decisions, salt: salts[0].value });
      const byPublicId = new Map(comparisons.map(row => [traceHash(stableJson([salts[0].value, row.id])).slice(0, 24), row]));
      for (const record of exported.complete) {
        const source = byPublicId.get(record.id);
        if (!source) continue;
        const publicReview = (review: TraceObject) => ({
          decision: review.decision, evidenceRefs: review.evidenceRefs, effort: review.effort,
          assisted: review.assisted, interface: review.interface, createdAt: review.createdAt, revision: review.revision,
        });
        record.reviewHistory = [...source.history, ...(source.review ? [source.review] : [])].map(publicReview);
        record.assistedReveals = source.reveals.map((reveal: TraceObject) => ({
          createdAt: reveal.createdAt, proposalPresent: reveal.proposalPresent,
        }));
        record.modelProposal = publicProposal(source.proposal);
        record.qualityCheck = { status: source.quality.status, checkedAt: source.quality.createdAt ?? null, effort: source.quality.effort ?? { auditMs: null, waitingMs: null } };
        record.qualityHistory = [...(source.qualityHistory ?? []), ...(source.quality.createdAt ? [source.quality] : [])]
          .map(check => ({ status: check.status, checkedAt: check.createdAt, effort: check.effort ?? { auditMs: null, waitingMs: null } }));
        record.pendingAnnotation = source.pendingAnnotation ? { decision: source.pendingAnnotation.decision,
          reviewMode: source.pendingAnnotation.reviewMode, importedAt: source.pendingAnnotation.importedAt, finalized: false } : null;
      }
      // Python owns pseudonymization/grouped splitting and exclusion semantics.
      const snapshot = { schemaVersion: 1, rubricVersion: "trace-preference-v1", createdAt: new Date().toISOString(), ...shareableEvidence(exported, salts[0].value) };
      const value = { id: randomUUID(), name: req.body.name.trim(), createdAt: snapshot.createdAt,
        itemCount: exported.complete.length, trainingCount: exported.training.length,
        digest: traceHash(stableJson(snapshot)), snapshot };
      await save(tx, project.id, "release", value.id, value);
      return value;
    });
    res.status(201).json(metadata(release));
  });
  route("get", "/releases/:id/download", undefined, async (req, res, { project }) => {
    const format = req.query.format ?? "complete";
    if (format !== "complete" && format !== "preference") throw new TraceError("format must be complete or preference");
    const release = await find(db, project.id, "release", String(req.params.id));
    res.setHeader("Content-Disposition", `attachment; filename="trace-${release.id}-${format}.${format === "complete" ? "json" : "jsonl"}"`);
    res.type(format === "complete" ? "application/json" : "application/x-ndjson");
    res.send(format === "complete" ? JSON.stringify(release.snapshot, null, 2)
      : release.snapshot.training.map((row: TraceObject) => JSON.stringify(row)).join("\n") + (release.snapshot.training.length ? "\n" : ""));
  });
  route("get", "/labelstudio", RELEASE_ROLES, async (req, res, { project }) => {
    const condition = req.query.condition ?? "human_only";
    if (!["human_only", "model_assisted"].includes(String(condition))) throw new TraceError("Choose human_only or model_assisted kit condition");
    const comparisons = await rows(db, project.id, "comparison");
    const validation = { schemaVersion: 1, runs: await rows(db, project.id, "run"),
      comparisons: comparisons.map(({ review, history, reveals, quality, proposal, version, ...comparison }) => comparison), issues: [] };
    const kit = await tracePython("labelstudio", { validation, condition,
      proposals: comparisons.filter(c => c.proposal).map(c => ({ comparisonId: c.id, outcome: c.proposal.decision === "escalate" ? "escalation" : c.proposal.decision, provider: c.proposal.provider, simulated: c.proposal.simulated })) });
    res.setHeader("Content-Disposition", 'attachment; filename="trace-labelstudio-kit.json"');
    res.json(kit);
  });
  route("post", "/labelstudio/reconcile", RELEASE_ROLES, async (req, res, { project }, actor) => {
    if (!Array.isArray(req.body?.annotations) || !req.body.annotations.length
      || !req.body.expectedVersions || typeof req.body.expectedVersions !== "object"
      || !["human_only", "model_assisted"].includes(req.body.reviewMode)) {
      throw new TraceError("annotations, expectedVersions, and explicit reviewMode are required");
    }
    const result = await locked(project.id, async tx => {
      const batchDigest = traceHash(stableJson(req.body.annotations));
      const prior = await tx.select().from(traceRecordsTable).where(where(project.id, "annotation_batch", batchDigest));
      if (prior.length) throw new TraceError("This annotation batch has already been reconciled", 409);
      const runs = await rows(tx, project.id, "run");
      const validation = await tracePython("validate", { schemaVersion: 1, runs });
      const comparisons = await rows(tx, project.id, "comparison");
      const kit = await tracePython("labelstudio", { validation, condition: req.body.reviewMode,
        proposals: comparisons.filter(c => c.proposal).map(c => ({ comparisonId: c.id, outcome: c.proposal.decision === "escalate" ? "escalation" : c.proposal.decision, provider: c.proposal.provider, simulated: c.proposal.simulated })) });
      const result = await tracePython("reconcile", { manifest: kit.manifest, annotations: req.body.annotations });
      for (const decision of result.decisions) {
        const value = await find(tx, project.id, "comparison", decision.comparisonId);
        assertVersion(value, req.body.expectedVersions[value.id]);
        if (value.pendingAnnotation) throw new TraceError("Confirm the existing pending annotation before importing another", 409);
        const annotationDigest = traceHash(stableJson([value.id, decision.sourceAnnotationId, decision.outcome]));
        const duplicate = await tx.select().from(traceRecordsTable).where(where(project.id, "annotation", annotationDigest));
        if (duplicate.length) throw new TraceError("This comparison annotation has already been imported", 409);
        value.pendingAnnotation = { decision: decision.outcome === "escalation" ? "escalate" : decision.outcome,
          reviewMode: decision.reviewMode, assignedCondition: decision.assignedCondition, assistedReveal: decision.assistedReveal,
          importedAt: new Date().toISOString(), importedBy: actor, annotationDigest };
        value.version++;
        if (value.quality.createdAt) value.qualityHistory = [...(value.qualityHistory ?? []), value.quality];
        value.quality = { status: "pending", note: "Imported Label Studio annotation requires explicit confirmation and a new quality check." };
        await save(tx, project.id, "comparison", value.id, value);
        await save(tx, project.id, "annotation", annotationDigest, { comparisonId: value.id, importedAt: value.pendingAnnotation.importedAt });
      }
      if (result.decisions.length) await save(tx, project.id, "annotation_batch", batchDigest, { importedAt: new Date().toISOString() });
      return { pending: result.decisions.length, issues: result.issues };
    });
    res.json(result);
  });
  route("post", "/comparisons/:id/confirm-labelstudio", RELEASE_ROLES, async (req, res, { project }, actor) => {
    const updated = await locked(project.id, async tx => {
      const value = await find(tx, project.id, "comparison", String(req.params.id));
      assertVersion(value, req.body?.expectedVersion);
      if (!value.pendingAnnotation) throw new TraceError("No pending Label Studio annotation to confirm", 409);
      const input = validateReview({ ...req.body, decision: value.pendingAnnotation.decision });
      if (value.review) value.history.push(value.review);
      value.review = { decision: input.decision, evidenceRefs: input.evidenceRefs, effort: input.effort,
        actor, assisted: value.pendingAnnotation.reviewMode === "model_assisted",
        interface: "labelstudio", createdAt: new Date().toISOString(), revision: value.version + 1,
        confirmationInterface: "reviewflow", annotationDigest: value.pendingAnnotation.annotationDigest };
      value.pendingAnnotation = null;
      value.version++;
      if (value.quality.createdAt) value.qualityHistory = [...(value.qualityHistory ?? []), value.quality];
      value.quality = { status: "pending", note: "Confirmed external annotation requires evidence, privacy, and quality review." };
      await save(tx, project.id, "comparison", value.id, value);
      return value;
    });
    res.json(comparisonView(updated, actor));
  });
  route("get", "/analysis", RELEASE_ROLES, async (_req, res, { project }) => {
    const comparisons = await rows(db, project.id, "comparison");
    const records = comparisons.flatMap(row => [...row.history, ...(row.review ? [row.review] : [])].map(review => ({
      reviewerId: traceHash(review.actor), comparisonId: row.id, groupId: row.groupId,
      interface: review.interface, reviewMode: review.assisted ? "model_assisted" : "human_only",
      activeMs: review.effort?.activeMs ?? null, correctionMs: review.effort?.correctionMs ?? null,
      waitingMs: review.effort?.waitingMs ?? null, auditMs: null, serviceMs: null, outcome: review.decision,
    })));
    for (const row of comparisons) {
      for (const check of [...(row.qualityHistory ?? []), ...(row.quality.createdAt ? [row.quality] : [])]) {
        records.push({ reviewerId: traceHash(check.actor), comparisonId: row.id, groupId: row.groupId,
          interface: "reviewflow", reviewMode: row.reveals.some((reveal: TraceObject) => reveal.actor === check.actor && reveal.createdAt <= check.createdAt) ? "model_assisted" : "human_only",
          activeMs: null, correctionMs: null, waitingMs: check.effort?.waitingMs ?? null, auditMs: check.effort?.auditMs ?? null, serviceMs: null, outcome: null });
      }
      if (row.proposal) records.push({ reviewerId: "service", comparisonId: row.id, groupId: row.groupId,
        interface: "reviewflow", reviewMode: "model_assisted", activeMs: null, correctionMs: null,
        waitingMs: null, auditMs: null, serviceMs: row.proposal.serviceMs ?? null, outcome: null });
    }
    res.json(await tracePython("analyze", { records }));
  });
}