import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, jevCallsTable, jevControlsTable } from "@workspace/db";
import { FactoryError } from "./factory-engine";
import type { FactoryTransaction } from "./factories";
export async function jevBudget(
  projectId: string,
  executor: FactoryTransaction | typeof db = db,
) {
  const [control] = await executor
    .select()
    .from(jevControlsTable)
    .where(eq(jevControlsTable.projectId, projectId));
  const [count] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(jevCallsTable)
    .where(eq(jevCallsTable.projectId, projectId));
  const used = count?.count ?? 0;
  return {
    revision: control?.revision ?? 0,
    enabled: control?.enabled ?? false,
    maxCalls: control?.maxCalls ?? 0,
    used,
    remaining: Math.max(0, (control?.maxCalls ?? 0) - used),
  };
}
/** A reservation is never refunded: a timeout or process loss may still be billed.
 * Admission runs after the budget wait, in this transaction. Callers must lock
 * and validate every outbound guard here; network I/O starts only after commit.
 */
export async function reserveJevCall(
  projectId: string,
  purpose: string,
  itemId: string,
  admit: (tx: FactoryTransaction) => Promise<void>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`jev:${projectId}`}, 0))`,
    );
    await admit(tx);
    const [control] = await tx
      .select()
      .from(jevControlsTable)
      .where(eq(jevControlsTable.projectId, projectId));
    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(jevCallsTable)
      .where(eq(jevCallsTable.projectId, projectId));
    if (!control?.enabled || (count?.count ?? 0) >= control.maxCalls)
      throw new FactoryError(
        "Jev is disabled for this project or its call budget is exhausted",
        403,
      );
    const id = randomUUID();
    await tx
      .insert(jevCallsTable)
      .values({ id, projectId, purpose, itemId, revision: control.revision });
    return id;
  });
}
export async function finishJevCall(
  id: string,
  status: "succeeded" | "failed",
) {
  await db
    .update(jevCallsTable)
    .set({ status })
    .where(eq(jevCallsTable.id, id));
}
