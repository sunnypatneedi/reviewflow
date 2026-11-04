import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  factoryItemsTable,
  factoryPoliciesTable,
} from "@workspace/db";
import {
  DEFAULT_FACTORY_POLICY,
  FactoryError,
  validateFactoryPolicy,
  type Factory,
} from "./factory-engine";

export type FactoryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
type Executor = FactoryTransaction | typeof db;
export const itemWhere = (
  projectId: string,
  factory: Factory,
  itemId?: string,
) =>
  and(
    eq(factoryItemsTable.projectId, projectId),
    eq(factoryItemsTable.factory, factory),
    ...(itemId === undefined ? [] : [eq(factoryItemsTable.itemId, itemId)]),
  );
export async function factoryPolicy(
  tx: Executor,
  projectId: string,
  factory: Factory,
) {
  const [row] = await tx
    .select()
    .from(factoryPoliciesTable)
    .where(
      and(
        eq(factoryPoliciesTable.projectId, projectId),
        eq(factoryPoliciesTable.factory, factory),
      ),
    )
    .orderBy(desc(factoryPoliciesTable.revision))
    .limit(1);
  return {
    revision: row?.revision ?? 0,
    definition: row
      ? validateFactoryPolicy(row.definition)
      : { ...DEFAULT_FACTORY_POLICY },
  };
}
export async function lockFactory(
  tx: FactoryTransaction,
  projectId: string,
  factory: Factory,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`factory:${projectId}:${factory}`}, 0))`,
  );
}
export async function lockFactoryItem(
  tx: FactoryTransaction,
  projectId: string,
  factory: Factory,
  itemId: string,
) {
  await tx
    .insert(factoryItemsTable)
    .values({ id: randomUUID(), projectId, factory, itemId })
    .onConflictDoNothing();
  const [item] = await tx
    .select()
    .from(factoryItemsTable)
    .where(itemWhere(projectId, factory, itemId))
    .for("update");
  return item;
}
export async function factoryEvent(
  tx: FactoryTransaction,
  projectId: string,
  actorId: string,
  type: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  await tx
    .insert(eventsTable)
    .values({ id: randomUUID(), projectId, actorId, type, entityId, payload });
}
export async function assertFactoryWork(
  tx: FactoryTransaction,
  input: {
    projectId: string;
    factory: Factory;
    itemId: string;
    actorId: string;
    claimToken?: unknown;
    assistance?: boolean;
  },
) {
  const item = await lockFactoryItem(
    tx,
    input.projectId,
    input.factory,
    input.itemId,
  );
  const policy = await factoryPolicy(tx, input.projectId, input.factory);
  if (item.quarantined)
    throw new FactoryError(
      "This item is quarantined. An owner must resolve it first.",
    );
  if (input.assistance && !policy.definition.assistanceAllowed)
    throw new FactoryError(
      "Assistance is disabled by this factory policy",
      403,
    );
  const active = item.expiresAt && item.expiresAt.getTime() > Date.now();
  if (active && item.assignedTo !== input.actorId)
    throw new FactoryError("This item is assigned to another reviewer");
  if (
    (active || policy.definition.requireAssignments) &&
    (!active || item.claimToken !== input.claimToken)
  ) {
    throw new FactoryError(
      "A current work claim is required. Claim or renew this item before submitting.",
    );
  }
  return { item, policy };
}
export async function assertFactoryAssistance(
  tx: FactoryTransaction,
  projectId: string,
  factory: Factory,
  itemId: string,
) {
  const item = await lockFactoryItem(tx, projectId, factory, itemId);
  const policy = await factoryPolicy(tx, projectId, factory);
  if (item.quarantined || !policy.definition.assistanceAllowed)
    throw new FactoryError(
      "Assistance blocked by quarantine or factory policy",
    );
  return policy;
}
export async function assertFactoryNotQuarantined(
  tx: FactoryTransaction,
  projectId: string,
  factory: Factory,
  itemId: string,
) {
  const item = await lockFactoryItem(tx, projectId, factory, itemId);
  if (item.quarantined)
    throw new FactoryError(
      "This item is quarantined. An owner must resolve it first.",
    );
}
export async function assertFactoryRelease(
  tx: Executor,
  projectId: string,
  factory: Factory,
) {
  const held = await tx
    .select({ id: factoryItemsTable.id })
    .from(factoryItemsTable)
    .where(
      and(
        itemWhere(projectId, factory),
        eq(factoryItemsTable.quarantined, true),
      ),
    );
  if (held.length)
    throw new FactoryError(
      "Release blocked: resolve all quarantined items first",
    );
  return factoryPolicy(tx, projectId, factory);
}
