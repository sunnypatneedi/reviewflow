import { drainTelemetry, telemetrySnapshot } from "../lib/telemetry";
import type { IRouter, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  traceRecordsTable,
  projectsTable,
  tasksTable,
  jobsTable,
  proposalsTable,
  reviewsTable,
  factoryItemsTable,
  auditsTable,
  auditDecisionsTable,
  auditDisputesTable,
  releasesTable,
} from "@workspace/db";
import type { ProjectRole } from "./authorization";
import {
  aggregateObservability,
  OBSERVABILITY_ROLES,
} from "../lib/observability";
import { assertCurrentRole, blindTaskIds } from "../lib/team";

type Helpers = {
  ensureProject: (req: Request) => Promise<{
    project: typeof projectsTable.$inferSelect;
    userId: string | null;
  }>;
  requireProjectAccess: (
    req: Request,
    res: Response,
    context: any,
    roles?: readonly ProjectRole[],
  ) => Promise<boolean>;
  identity: (req: Request) => string;
};
// Reject oversized snapshots instead of silently sampling metrics. No source/label/user columns are read.
const LIMIT = 50_000;
export function registerObservabilityRoutes(router: IRouter, helpers: Helpers) {
  router.get("/reviewflow/observability", async (req, res) => {
    const context = await helpers.ensureProject(req);
    if (
      !(await helpers.requireProjectAccess(
        req,
        res,
        context,
        OBSERVABILITY_ROLES,
      ))
    )
      return;
    res.setHeader("Cache-Control", "no-store");
    try {
      const snapshot = await db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
          await assertCurrentRole(
            tx,
            context.project.id,
            helpers.identity(req),
            OBSERVABILITY_ROLES,
          );
          const project = context.project.id;
          if ((await blindTaskIds(project, helpers.identity(req), tx)).size) {
            throw Object.assign(new Error("Blind assignment active"), {
              status: 403,
            });
          }
          const tasks = await tx
            .select({
              id: tasksTable.id,
              status: tasksTable.status,
              contentHash: tasksTable.contentHash,
              createdAt: tasksTable.createdAt,
            })
            .from(tasksTable)
            .where(eq(tasksTable.projectId, project))
            .limit(LIMIT + 1);
          const jobs = await tx
            .select({
              status: jobsTable.status,
              attempts: jobsTable.attempts,
              createdAt: jobsTable.createdAt,
              availableAt: jobsTable.availableAt,
              leaseExpiresAt: jobsTable.leaseExpiresAt,
            })
            .from(jobsTable)
            .where(eq(jobsTable.projectId, project))
            .limit(LIMIT + 1);
          const proposals = await tx
            .select({
              mode: proposalsTable.mode,
              latencyMs: proposalsTable.latencyMs,
              inputTokens: proposalsTable.inputTokens,
              outputTokens: proposalsTable.outputTokens,
            })
            .from(proposalsTable)
            .where(eq(proposalsTable.projectId, project))
            .limit(LIMIT + 1);
          const reviews = await tx
            .select({
              taskId: reviewsTable.taskId,
              action: reviewsTable.action,
              activeMs: reviewsTable.activeMs,
              assisted: sql<boolean>`${reviewsTable.proposalId} IS NOT NULL`,
            })
            .from(reviewsTable)
            .where(eq(reviewsTable.projectId, project))
            .limit(LIMIT + 1);
          const assignments = await tx
            .select({
              itemId: factoryItemsTable.itemId,
              expiresAt: factoryItemsTable.expiresAt,
            })
            .from(factoryItemsTable)
            .where(
              and(
                eq(factoryItemsTable.projectId, project),
                eq(factoryItemsTable.factory, "evidence"),
                sql`${factoryItemsTable.assignedTo} IS NOT NULL`,
              ),
            )
            .limit(LIMIT + 1);
          const decisions = await tx
            .select({ taskId: auditDecisionsTable.taskId })
            .from(auditDecisionsTable)
            .innerJoin(
              auditsTable,
              eq(auditsTable.id, auditDecisionsTable.auditId),
            )
            .where(
              and(
                eq(auditsTable.projectId, project),
                eq(auditsTable.independent, true),
                eq(auditDecisionsTable.included, true),
                eq(auditDecisionsTable.selfCheck, false),
              ),
            )
            .limit(LIMIT + 1);
          const disputes = await tx
            .select({ status: auditDisputesTable.status })
            .from(auditDisputesTable)
            .innerJoin(
              auditsTable,
              eq(auditsTable.id, auditDisputesTable.auditId),
            )
            .where(eq(auditsTable.projectId, project))
            .limit(LIMIT + 1);
          const releases = await tx
            .select({
              hashes: sql<unknown>`${releasesTable.manifest}->'source_hashes'`,
              createdAt: releasesTable.createdAt,
            })
            .from(releasesTable)
            .where(eq(releasesTable.projectId, project))
            .limit(LIMIT + 1);
          const preferenceAssignments = await tx
            .select({ expiresAt: factoryItemsTable.expiresAt })
            .from(factoryItemsTable)
            .where(
              and(
                eq(factoryItemsTable.projectId, project),
                eq(factoryItemsTable.factory, "preference"),
                sql`${factoryItemsTable.assignedTo} IS NOT NULL`,
              ),
            )
            .limit(LIMIT + 1);
          const p = traceRecordsTable.payload;
          const preference = await tx
            .select({
              kind: traceRecordsTable.kind,
              reviewed: sql<boolean>`COALESCE(${p}->'review'->>'decision' IS NOT NULL, false)`,
              finalized: sql<boolean>`COALESCE((${p}->'review'->>'decision') IN ('a', 'b', 'tie', 'both_unacceptable') AND (${p}->>'pendingAnnotation') IS NULL, false)`,
              escalated: sql<boolean>`COALESCE(${p}->'review'->>'decision' = 'escalate', false)`,
              qualityPassed: sql<boolean>`COALESCE(${p}->'quality'->>'status' = 'passed', false)`,
              assisted: sql<
                boolean | null
              >`CASE WHEN ${p}->'review'->>'assisted' = 'true' THEN true WHEN ${p}->'review'->>'assisted' = 'false' THEN false ELSE NULL END`,
              releasedIds: sql<unknown>`jsonb_path_query_array(${p}, '$.snapshot.complete[*].id')`,
            })
            .from(traceRecordsTable)
            .where(
              and(
                eq(traceRecordsTable.projectId, project),
                sql`${traceRecordsTable.kind} IN ('comparison', 'release')`,
              ),
            )
            .limit(LIMIT + 1);
          const rows = {
            tasks,
            jobs,
            proposals,
            reviews,
            assignments,
            decisions,
            disputes,
            releases,
            preference,
            preferenceAssignments,
          };
          if (Object.values(rows).some((rows) => rows.length > LIMIT))
            throw new Error("snapshot limit");
          await drainTelemetry(project, tx);
          const rubric = await tx.execute(sql`SELECT count(*)::int AS total,
            count(*) FILTER(WHERE state->>'status'='reviewed')::int AS reviewed,
            count(*) FILTER(WHERE state->>'status'='escalated')::int AS escalated,
            count(*) FILTER(WHERE state->>'quarantined'='true')::int AS quarantined
            FROM rf_rubric_items WHERE project_id=${project}`);
          const rubricReleases = await tx.execute(
            sql`SELECT count(*)::int AS count FROM rf_rubric_records WHERE project_id=${project} AND kind='release'`,
          );
          return {
            ...aggregateObservability(rows),
            rubric: {
              ...rubric.rows[0],
              releases: rubricReleases.rows[0].count,
            },
            telemetry: await telemetrySnapshot(project, tx),
          };
        },
        { isolationLevel: "repeatable read" },
      );
      res.json(snapshot);
    } catch (error) {
      // Role errors retain their explicit authorization semantics, never DB details.
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 403
      ) {
        res
          .status(403)
          .json({ error: "Your project role is not allowed for this action" });
        return;
      }
      res.status(503).json({
        error:
          "Observability snapshot unavailable. Database read failed, timed out, or exceeded the 50,000-record per-table limit. Retry or use a smaller project.",
      });
    }
  });
}
