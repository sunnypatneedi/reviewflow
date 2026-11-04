import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  auditsTable,
  auditItemsTable,
  exposuresTable,
  membershipsTable,
  projectsTable,
} from "@workspace/db";
import { FactoryError } from "./factory-engine";
import { type FactoryTransaction } from "./factories";
import { isProjectRole, type ProjectRole } from "../routes/authorization";

export async function assertCurrentRole(
  tx: FactoryTransaction,
  projectId: string,
  actorId: string,
  allowed: readonly ProjectRole[],
) {
  const [project] = await tx
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  // Anonymous synthetic projects have no authenticated owner or shared members.
  if (!project?.ownerId) return;
  const [member] = await tx
    .select()
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.projectId, projectId),
        eq(membershipsTable.userId, actorId),
      ),
    )
    .for("share");
  if (!member || !isProjectRole(member.role) || !allowed.includes(member.role))
    throw new FactoryError(
      "Project access changed. Reload before continuing.",
      403,
    );
}
export async function blindTaskIds(
  projectId: string,
  actorId: string,
  executor: FactoryTransaction | typeof db = db,
) {
  const audits = await executor
    .select({ id: auditsTable.id })
    .from(auditsTable)
    .where(
      and(
        eq(auditsTable.projectId, projectId),
        eq(auditsTable.auditorId, actorId),
        eq(auditsTable.independent, true),
        inArray(auditsTable.status, ["in_progress", "blocked"]),
      ),
    );
  if (!audits.length) return new Set<string>();
  const items = await executor
    .select({ taskId: auditItemsTable.taskId })
    .from(auditItemsTable)
    .where(
      inArray(
        auditItemsTable.auditId,
        audits.map((a) => a.id),
      ),
    );
  return new Set(items.map((item) => item.taskId));
}
export async function recordExposure(
  projectId: string,
  actorId: string,
  tasks: Array<{ id: string; contentHash: string }>,
) {
  if (!tasks.length) return;
  await db.transaction(async (tx) => {
    await lockExposure(tx, projectId, actorId);
    const blind = await blindTaskIds(projectId, actorId, tx);
    if (tasks.some((task) => blind.has(task.id)))
      throw new FactoryError(
        "A blind audit started. Reload to hide prior decisions.",
      );
    await tx
      .insert(exposuresTable)
      .values(
        tasks.map((task) => ({
          id: randomUUID(),
          projectId,
          actorId,
          taskId: task.id,
          contentHash: task.contentHash,
        })),
      )
      .onConflictDoNothing();
  });
}
export async function lockExposure(
  tx: FactoryTransaction,
  projectId: string,
  actorId: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`exposure:${projectId}:${actorId}`}, 0))`,
  );
}
export async function assertUnexposed(
  tx: FactoryTransaction | typeof db,
  projectId: string,
  actorId: string,
  taskIds: string[],
) {
  if (!taskIds.length) return;
  const rows = await tx
    .select()
    .from(exposuresTable)
    .where(
      and(
        eq(exposuresTable.projectId, projectId),
        eq(exposuresTable.actorId, actorId),
        inArray(exposuresTable.taskId, taskIds),
      ),
    );
  if (rows.length)
    throw new FactoryError(
      "Independent audit requires an auditor who has not accessed prior decisions or proposals for this population.",
    );
}
export async function lockMemberships(
  tx: FactoryTransaction,
  projectId: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${projectId}`}, 0))`,
  );
}
