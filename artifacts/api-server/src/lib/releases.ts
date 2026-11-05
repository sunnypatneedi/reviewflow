import { evaluationProvenance } from "./current-proposal";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, projectsTable, tasksTable, proposalsTable, reviewsTable, auditsTable, auditItemsTable, auditDecisionsTable, auditDisputesTable, releasesTable } from "@workspace/db";
import { samplingFrameHash, selectDeterministicSample } from "./audits";
import { assertFactoryRelease } from "./factories";
import { assertCurrentRole, blindTaskIds } from "./team";
import { EXPORT_ROLES } from "../routes/authorization";

type Task = typeof tasksTable.$inferSelect;
type Review = typeof reviewsTable.$inferSelect;
type Audit = typeof auditsTable.$inferSelect;
type Item = typeof auditItemsTable.$inferSelect;
type Decision = typeof auditDecisionsTable.$inferSelect;
type Dispute = typeof auditDisputesTable.$inferSelect;
export class ReleaseBlocked extends Error {}
const blocked = (message: string): never => { throw new ReleaseBlocked(`Release blocked: ${message}`); };
const labels = ["supported", "contradicted", "insufficient_evidence"];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function originalFinalReview(task: Task, reviews: Review[], version = task.version, label = task.finalLabel) {
  const rows = reviews.filter(r => r.taskId === task.id && r.projectId === task.projectId && r.taskVersion === version - 1 && ["accept", "correct", "label"].includes(r.action));
  return rows.length === 1 && rows[0].label === label ? rows[0] : undefined;
}

type Evidence = { audits: Audit[]; items: Item[]; decisions: Decision[]; disputes: Dispute[]; reviews: Review[] };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function readDecisionEvidence(tx: Transaction, projectId: string): Promise<Evidence> {
  const audits = await tx.select().from(auditsTable).where(eq(auditsTable.projectId, projectId)).orderBy(auditsTable.id);
  const ids = audits.map(a => a.id);
  return {
    audits,
    items: ids.length ? await tx.select().from(auditItemsTable).where(inArray(auditItemsTable.auditId, ids)) : [],
    decisions: ids.length ? await tx.select().from(auditDecisionsTable).where(inArray(auditDecisionsTable.auditId, ids)) : [],
    disputes: ids.length ? await tx.select().from(auditDisputesTable).where(inArray(auditDisputesTable.auditId, ids)) : [],
    reviews: await tx.select().from(reviewsTable).where(eq(reviewsTable.projectId, projectId)),
  };
}

/** Validate an audit because its evidence is used, regardless of required. */
export function assertAuditEvidence(audit: Audit, evidence: Evidence, phase: "release" | "adjudication" = "release") {
  const complete = phase === "release";
  if (complete ? audit.status !== "completed" : !["blocked", "in_progress"].includes(audit.status)) return blocked("supporting audit is revoked, invalid, or incomplete");
  const selected = evidence.items.filter(i => i.auditId === audit.id).sort((a, b) => a.ordinal - b.ordinal);
  if (!Number.isInteger(audit.sampleSize) || audit.sampleSize < 1 || selected.length !== audit.sampleSize) return blocked("supporting audit sample evidence is missing");
  const frame = audit.samplingFrame as ReleaseFrame;
  if (frame?.version !== "rf-audit-v2" || !Array.isArray(frame.eligible) || frame.eligible.some(row => !row || typeof row !== "object")
    || samplingFrameHash(frame) !== audit.samplingFrameHash) return blocked("supporting audit frame is missing, changed, or unversioned");
  const expectedSample = selectDeterministicSample(audit.seed, frame.eligible, audit.sampleSize);
  if (expectedSample.length !== selected.length || expectedSample.some((row, index) => row.taskId !== selected[index].taskId || selected[index].ordinal !== index + 1)) return blocked("supporting audit sample does not match its committed frame");
  const decisions = evidence.decisions.filter(d => d.auditId === audit.id);
  const disputes = evidence.disputes.filter(d => d.auditId === audit.id);
  if (decisions.some(d => !selected.some(i => i.id === d.auditItemId)) || disputes.some(d => !selected.some(i => i.id === d.auditItemId))) return blocked("supporting audit has unbound evidence");
  for (const item of selected) {
    const snapshots = frame.eligible.filter(row => row.taskId === item.taskId);
    const snapshot = snapshots.length === 1 ? snapshots[0] : undefined;
    if (!snapshot || snapshot.reviewId !== item.originalReviewId || snapshot.reviewerId !== item.originalReviewerId
      || snapshot.label !== item.originalLabel || snapshot.contentHash !== item.taskContentHash || snapshot.taskVersion !== item.taskVersion
      || snapshot.adjudicationId !== item.originalAdjudicationId) return blocked("supporting audit item no longer matches its decision snapshot");
    const original = evidence.reviews.find(r => r.id === item.originalReviewId && r.taskId === item.taskId && r.projectId === audit.projectId);
    if (!original) return blocked("supporting audit original review is missing");
    const rows = decisions.filter(d => d.auditItemId === item.id);
    if (!complete && !rows.length) continue; // Other selected items may still await review at adjudication entry.
    const decision = rows.length === 1 ? rows[0] : undefined;
    if (!decision || !labels.includes(decision.label) || !decision.included || decision.selfCheck || decision.taskId !== item.taskId
      || decision.auditorId !== audit.auditorId || decision.auditorId === item.originalReviewerId || decision.auditorId === original.reviewerId) return blocked("supporting audit decision is missing, excluded, or not independent");
    const itemDisputes = disputes.filter(d => d.auditItemId === item.id);
    if (decision.label === item.originalLabel) {
      if (itemDisputes.length) return blocked("supporting audit has contradictory disagreement evidence");
    } else {
      const dispute = itemDisputes.length === 1 ? itemDisputes[0] : undefined;
      if (!dispute || dispute.taskId !== item.taskId || dispute.originalLabel !== item.originalLabel || dispute.auditLabel !== decision.label
        || (complete ? dispute.status !== "resolved" : !["pending", "resolved"].includes(dispute.status))) return blocked("supporting audit disagreement evidence is missing or invalid");
    }
  }
  return selected;
}

export function resolvedDecision(task: Task, evidence: Evidence) {
  const chain: Dispute[] = [];
  const visit = (version: number, label: string | null, adjudicationId: string | null): Review => {
    if (!adjudicationId) return originalFinalReview(task, evidence.reviews, version, label) ?? blocked("missing or contradictory final review");
    if (chain.some(d => d.id === adjudicationId)) return blocked("cyclic adjudication lineage");
    const dispute = evidence.disputes.find(d => d.id === adjudicationId && d.taskId === task.id);
    const audit = evidence.audits.find(a => a.id === dispute?.auditId && a.projectId === task.projectId);
    const item = evidence.items.find(i => i.id === dispute?.auditItemId && i.auditId === audit?.id && i.taskId === task.id);
    const decisions = evidence.decisions.filter(d => d.auditItemId === item?.id && d.auditId === audit?.id);
    const decision = decisions.length === 1 ? decisions[0] : undefined;
    if (!dispute || !audit || !item || !decision || dispute.status !== "resolved" || dispute.resolvedLabel !== label || !labels.includes(label ?? "")
      || item.taskVersion !== version - 1 || item.taskContentHash !== task.contentHash
      || dispute.originalLabel !== item.originalLabel || dispute.auditLabel !== decision.label
      || decision.taskId !== task.id || decision.auditorId !== audit.auditorId || !decision.included || decision.selfCheck
      || !dispute.adjudicatorId || dispute.adjudicatorId === audit.auditorId || dispute.adjudicatorId === item.originalReviewerId
      || decision.auditorId === item.originalReviewerId) return blocked("adjudication evidence is missing, revoked, or stale");
    assertAuditEvidence(audit, evidence);
    chain.push(dispute);
    const original = visit(item.taskVersion, item.originalLabel, item.originalAdjudicationId);
    if (original.id !== item.originalReviewId) return blocked("adjudication review lineage changed");
    if (original.reviewerId === dispute.adjudicatorId || original.reviewerId === decision.auditorId) return blocked("original reviewer is not independent of the audit");
    const previousActor = item.originalAdjudicationId
      ? evidence.disputes.find(d => d.id === item.originalAdjudicationId)?.adjudicatorId : original.reviewerId;
    if (item.originalReviewerId !== previousActor) return blocked("adjudication actor lineage changed");
    return original;
  };
  const review = visit(task.version, task.finalLabel, task.finalAdjudicationId);
  if (evidence.disputes.some(d => d.taskId === task.id && d.status === "resolved" && !chain.some(c => c.id === d.id))) {
    return blocked("contradictory or unbound adjudication history");
  }
  return { review, chain, reviewerId: chain[0]?.adjudicatorId ?? review.reviewerId };
}

export type ReleaseFrame = {
  version: "rf-audit-v2";
  eligible: Array<{ taskId: string; contentHash: string; taskVersion: number; reviewId: string; label: string; reviewerId: string; adjudicationId: string | null }>;
};
export function releaseSamplingFrame(tasks: Task[], reviews: Review[], auditorId: string, independent: boolean, disputes: Dispute[] = []): ReleaseFrame {
  return { version: "rf-audit-v2", eligible: tasks.flatMap(task => {
    // The original review remains immutable. Subsequent audit snapshots bind the
    // current adjudication pointer/version, rather than treating it as a review.
    const original = task.finalAdjudicationId
      ? reviews.filter(r => r.taskId === task.id && r.projectId === task.projectId && ["accept", "correct", "label"].includes(r.action)).sort((a, b) => b.taskVersion - a.taskVersion)[0]
      : originalFinalReview(task, reviews);
    if (!original || !task.finalLabel) return [];
    const reviewerId = task.finalAdjudicationId ? disputes.find(d => d.id === task.finalAdjudicationId)?.adjudicatorId : original.reviewerId;
    if (!reviewerId) return [];
    return [{ taskId: task.id, contentHash: task.contentHash, taskVersion: task.version, reviewId: original.id, label: task.finalLabel, reviewerId, adjudicationId: task.finalAdjudicationId }];
  }).filter(row => !independent || (row.reviewerId !== auditorId && reviews.find(r => r.id === row.reviewId)?.reviewerId !== auditorId)).sort((a, b) => a.taskId.localeCompare(b.taskId)) };
}

function auditCoversCurrentPopulation(audit: Audit, tasks: Task[], evidence: Evidence): boolean {
  const frame = audit.samplingFrame as ReleaseFrame;
  if (frame?.version !== "rf-audit-v2" || !Array.isArray(frame.eligible) || samplingFrameHash(frame) !== audit.samplingFrameHash) return false;
  const expected = releaseSamplingFrame(tasks, evidence.reviews, audit.auditorId!, true, evidence.disputes);
  if (frame.eligible.length !== expected.eligible.length) return false;
  return expected.eligible.every(current => {
    const rows = frame.eligible.filter(r => r.taskId === current.taskId);
    if (rows.length !== 1) return false;
    const row = rows[0];
    if (row.contentHash !== current.contentHash || row.reviewId !== current.reviewId) return false;
    if (row.taskVersion === current.taskVersion) return row.reviewerId === current.reviewerId && row.label === current.label && row.adjudicationId === current.adjudicationId;
    // This sample may produce the final correction itself. Bind the accepted
    // one-step transition to this audit's exact input decision, not just text.
    const dispute = evidence.disputes.find(d => d.id === current.adjudicationId && d.auditId === audit.id && d.status === "resolved");
    const item = evidence.items.find(i => i.id === dispute?.auditItemId);
    return row.taskVersion + 1 === current.taskVersion && dispute?.resolvedLabel === current.label
      && item?.taskVersion === row.taskVersion && item.originalReviewerId === row.reviewerId && item.originalLabel === row.label && item.originalAdjudicationId === row.adjudicationId;
  });
}

export async function createRelease(projectId: string, name: string, includeSourceText: boolean, actorId: string, privacyReviewed = false) {
  if (includeSourceText && !privacyReviewed) return blocked("including source text requires explicit confirmation that the actual text was reviewed for private data");
  // Every read, gate, provenance field and byte is from one MVCC snapshot.
  // A concurrent correction can yield a valid before/after release, never a mix.
  return db.transaction(async tx => {
    await assertCurrentRole(tx, projectId, actorId, EXPORT_ROLES);
    if ((await blindTaskIds(projectId, actorId, tx)).size) return blocked("finish assigned blind audits before creating an export");
    const factory = await assertFactoryRelease(tx, projectId, "evidence");
    const [project] = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return blocked("project missing");
    if (project.releaseAuditPolicyVersion === "independent-sample-v1" && !project.exposureTrackingEnabled) return blocked("prior exposure history predates tracking; use a new tracked project for independent qualification");
    const tasks = await tx.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)).orderBy(tasksTable.id);
    if (!name?.trim() || !tasks.length || tasks.some(t => t.status !== "finalized" || !labels.includes(t.finalLabel ?? ""))) return blocked("all tasks must have a resolved human decision");
    const evidence = await readDecisionEvidence(tx, projectId);
    const { audits, decisions, disputes } = evidence;
    const proposals = await tx.select().from(proposalsTable).where(eq(proposalsTable.projectId, projectId));
    if (disputes.some(d => d.status !== "resolved")) return blocked("all audit disagreements need valid adjudication, including optional audits");
    const finalDecisions = new Map(tasks.map(t => [t.id, resolvedDecision(t, evidence)]));
    const required = audits.filter(a => a.required);
    for (const audit of required) {
      const selected = assertAuditEvidence(audit, evidence);
      for (const item of selected) {
        const decision = decisions.find(d => d.auditItemId === item.id && d.auditId === audit.id)!;
        if (decision.label !== item.originalLabel && !disputes.some(d => d.auditItemId === item.id && d.status === "resolved" && finalDecisions.get(item.taskId)?.chain.some(c => c.id === d.id))) return blocked("required disagreement has no approved decision lineage");
      }
    }
    const policy = project.releaseAuditPolicyVersion;
    if (policy !== "independent-sample-v1" && policy !== "demo-unverified-v1") return blocked("unknown audit policy version");
    if (policy === "demo-unverified-v1" && (!project.demoSessionId || project.mode !== "demo")) return blocked("unverified policy is restricted to anonymous synthetic demo projects");
    const covering = required.filter(a => a.independent && auditCoversCurrentPopulation(a, tasks, evidence));
    if (policy === "independent-sample-v1" && !covering.length) return blocked("audit policy requires an independent sample bound to the current task and decision population");
    const usedProposals = tasks.flatMap(t => {
      const review = finalDecisions.get(t.id)!.review;
      const proposal = proposals.find(p => p.id === review.proposalId && p.taskId === t.id);
      return proposal ? [proposal] : [];
    });
    const lines = tasks.map(t => {
      const final = finalDecisions.get(t.id)!;
      const proposal = proposals.find(p => p.id === final.review.proposalId && p.taskId === t.id);
      if (!proposal && (final.review.action !== "label" || final.review.proposalId !== null)) return blocked("final review proposal missing");
      const evaluation = proposal ? evaluationProvenance(proposal) : null;
      if (proposal && !evaluation) return blocked("evaluation provenance is missing or inconsistent");
      return JSON.stringify({ external_id: t.externalId, label: t.finalLabel, risk: t.risk, mode: t.mode,
        ...(includeSourceText ? { question: t.question, evidence: t.evidence, candidate_answer: t.candidateAnswer } : {}),
        provenance: { task_hash: t.contentHash, task_version: t.version, proposal_id: proposal?.id ?? null, review_id: final.review.id,
          review_mode: final.review.proposalId === null ? "human_only" : "model_assisted", factory_policy_revision: final.review.factoryPolicyRevision,
          ...(final.chain.length ? { original_review_id: final.review.id, adjudication_id: final.chain[0].id, adjudication_ids: final.chain.map(d => d.id) } : {}),
          rubric_version: project.rubricVersion, policy_version: project.shadowPolicyVersion, release_audit_policy_version: policy,
          audit_ids: covering.map(a => a.id), model: proposal?.returnedModel ?? null, evaluation } });
    });
    const jsonl = lines.join("\n") + "\n", digest = hash(jsonl);
    const [release] = await tx.insert(releasesTable).values({ id: randomUUID(), projectId, name: name.trim(), mode: project.mode, itemCount: tasks.length,
      includeSourceText, digest, jsonl, createdBy: actorId, manifest: { source_hashes: tasks.map(t => t.contentHash), rubric_version: project.rubricVersion,
        policy_version: project.shadowPolicyVersion, release_audit_policy_version: policy, audit_ids: covering.map(a => a.id),
        factory: { name: "evidence", ...factory },
        privacy_reviewed: privacyReviewed,
        content_digest: digest, model_versions: [...new Set(usedProposals.map(p => p.returnedModel))],
        evaluation_ids: usedProposals.flatMap(p => p.evaluationId ? [p.evaluationId] : []),
        legacy_evaluation_count: usedProposals.filter(p => p.evaluationId == null).length } }).returning();
    return release;
  }, { isolationLevel: "repeatable read" });
}
