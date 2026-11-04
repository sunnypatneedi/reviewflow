import type { IRouter, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  auditsTable,
  factoryItemsTable,
  factoryPoliciesTable,
  membershipsTable,
  tasksTable,
  proposalsTable,
  traceRecordsTable,
} from "@workspace/db";
import {
  FactoryError,
  parseFactory,
  routeFactoryItem,
  validateFactoryPolicy,
  type Factory,
} from "../lib/factory-engine";
import {
  factoryEvent,
  factoryPolicy,
  itemWhere,
  lockFactory,
  lockFactoryItem,
  type FactoryTransaction,
} from "../lib/factories";
import type { ProjectRole } from "./authorization";

type Context = {
  project: { id: string; mode: string };
  userId: string | null;
  role: ProjectRole | null;
};
type Helpers = {
  ensureProject: (req: Request) => Promise<Context>;
  requireProjectAccess: (
    req: Request,
    res: Response,
    context: any,
    roles?: readonly ProjectRole[],
  ) => Promise<boolean>;
  identity: (req: Request) => string;
};
async function source(
  tx: FactoryTransaction | typeof db,
  projectId: string,
  factory: Factory,
  id: string,
) {
  if (factory === "evidence") {
    const [item] = await tx
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), eq(tasksTable.id, id)));
    if (!item) throw new FactoryError("Work item not found", 404);
    return { version: item.version, finalized: item.status === "finalized" };
  }
  const [row] = await tx
    .select()
    .from(traceRecordsTable)
    .where(
      and(
        eq(traceRecordsTable.projectId, projectId),
        eq(traceRecordsTable.kind, "comparison"),
        eq(traceRecordsTable.key, id),
      ),
    );
  if (!row) throw new FactoryError("Work item not found", 404);
  const item = row.payload as {
    version: number;
    review?: { decision: string };
  };
  return {
    version: item.version,
    finalized: Boolean(item.review && item.review.decision !== "escalate"),
  };
}

export function registerFactoryRoutes(router: IRouter, helpers: Helpers) {
  const route = (
    method: "get" | "post",
    path: string,
    roles: readonly ProjectRole[] | undefined,
    action: (
      req: Request,
      res: Response,
      context: Context,
      actor: string,
      factory: Factory,
    ) => Promise<void>,
  ) => {
    router[method](
      `/reviewflow/factories/:factory${path}`,
      async (req, res) => {
        try {
          const factory = parseFactory(req.params.factory);
          const context = await helpers.ensureProject(req);
          if (!(await helpers.requireProjectAccess(req, res, context, roles)))
            return;
          await action(req, res, context, helpers.identity(req), factory);
        } catch (error) {
          if (error instanceof FactoryError)
            res.status(error.status).json({ error: error.message });
          else throw error;
        }
      },
    );
  };
  route(
    "get",
    "",
    undefined,
    async (_req, res, { project, role, userId }, actor, factory) => {
      const policy = await factoryPolicy(db, project.id, factory);
      const controls = await db
        .select()
        .from(factoryItemsTable)
        .where(itemWhere(project.id, factory));
      const controlView = (id: string) => {
        const control = controls.find((row) => row.itemId === id);
        const active =
          control?.expiresAt && control.expiresAt.getTime() > Date.now();
        return {
          quarantined: control?.quarantined ?? false,
          quarantineReason: control?.quarantineReason ?? null,
          controlRevision: control?.revision ?? 0,
          assignedTo: active ? control!.assignedTo : null,
          expiresAt: active ? control!.expiresAt!.toISOString() : null,
          // Only the current assignee may use its fencing token.
          claimToken:
            active && control!.assignedTo === actor
              ? control!.claimToken
              : null,
        };
      };
      let items;
      if (factory === "evidence") {
        const [tasks, proposals] = await Promise.all([
          db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.projectId, project.id)),
          db
            .select()
            .from(proposalsTable)
            .where(eq(proposalsTable.projectId, project.id)),
        ]);
        items = tasks.map((task) => {
          const proposal = proposals.find(
            (row) => row.taskId === task.id && row.mode === task.mode,
          );
          const control = controlView(task.id);
          return {
            id: task.id,
            workKind: "task",
            title: task.externalId,
            version: task.version,
            ...control,
            ...routeFactoryItem(
              {
                ...control,
                finalized: task.status === "finalized",
                escalated: task.status === "escalated",
                highRisk: task.risk === "high",
                hasProposal: Boolean(proposal),
                confidence: proposal ? Number(proposal.confidence) : null,
                redirection: proposal
                  ? Number(proposal.injectionProbability)
                  : null,
              },
              policy.definition,
            ),
          };
        });
        const audits = await db
          .select()
          .from(auditsTable)
          .where(
            and(
              eq(auditsTable.projectId, project.id),
              eq(auditsTable.auditorId, actor),
            ),
          );
        items.push(
          ...audits
            .filter((audit) =>
              ["in_progress", "blocked"].includes(audit.status),
            )
            .map((audit) => ({
              id: audit.id,
              workKind: "audit",
              title: "Assigned blind audit",
              version: 1,
              quarantined: false,
              quarantineReason: null,
              controlRevision: 0,
              assignedTo: actor,
              expiresAt: null,
              claimToken: null,
              ...routeFactoryItem({ blindAudit: true }, policy.definition),
            })),
        );
      } else {
        const rows = await db
          .select()
          .from(traceRecordsTable)
          .where(
            and(
              eq(traceRecordsTable.projectId, project.id),
              eq(traceRecordsTable.kind, "comparison"),
            ),
          );
        items = rows.map((row) => {
          const value = row.payload as {
            id: string;
            version: number;
            review?: { decision: string };
            quality?: { status: string };
            proposal?: unknown;
          };
          const control = controlView(value.id);
          return {
            id: value.id,
            workKind: "comparison",
            title: value.id,
            version: value.version,
            ...control,
            ...routeFactoryItem(
              {
                ...control,
                escalated: value.review?.decision === "escalate",
                finalized: Boolean(
                  value.review && value.review.decision !== "escalate",
                ),
                hasProposal: Boolean(value.proposal),
              },
              policy.definition,
            ),
          };
        });
      }
      const counts = Object.fromEntries(
        [
          "human_review",
          "assistance",
          "escalation",
          "blind_audit",
          "quarantine",
          "complete",
        ].map((lane) => [
          lane,
          items.filter((item) => item.lane === lane).length,
        ]),
      );
      res.json({
        factory,
        policy,
        items,
        counts,
        actor,
        canConfigure: !userId || role === "owner",
        releaseGate:
          "Human decisions, privacy review, and the existing independent audit policy still apply. Quarantine blocks export.",
      });
    },
  );
  route(
    "post",
    "/policy",
    ["owner"],
    async (req, res, { project }, actor, factory) => {
      const definition = validateFactoryPolicy(req.body?.definition);
      const policy = await db.transaction(async (tx) => {
        await lockFactory(tx, project.id, factory);
        const current = await factoryPolicy(tx, project.id, factory);
        if (req.body?.expectedRevision !== current.revision)
          throw new FactoryError(
            "Factory policy changed. Reload before saving.",
          );
        const revision = current.revision + 1;
        await tx.insert(factoryPoliciesTable).values({
          id: randomUUID(),
          projectId: project.id,
          factory,
          revision,
          definition,
          createdBy: actor,
        });
        await factoryEvent(
          tx,
          project.id,
          actor,
          "factory.policy.created",
          factory,
          { factory, revision, definition },
        );
        return { revision, definition };
      });
      res.status(201).json(policy);
    },
  );
  route(
    "post",
    "/items/:id/claim",
    ["owner", "reviewer", "adjudicator"],
    async (req, res, context, actor, factory) => {
      const id = String(req.params.id);
      const minutes = req.body?.minutes ?? 10;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 15)
        throw new FactoryError("Claims must last 1–15 minutes", 400);
      const target = req.body?.assignedTo ?? actor;
      if (typeof target !== "string" || !target)
        throw new FactoryError("Invalid assignee", 400);
      if (target !== actor) {
        if (context.role !== "owner" || !context.userId)
          throw new FactoryError(
            "Only an authenticated owner may assign another member",
            403,
          );
        const [member] = await db
          .select()
          .from(membershipsTable)
          .where(
            and(
              eq(membershipsTable.projectId, context.project.id),
              eq(membershipsTable.userId, target),
            ),
          );
        if (
          !member ||
          !["owner", "reviewer", "adjudicator"].includes(member.role)
        )
          throw new FactoryError(
            "Assignee must be a current project reviewer",
            400,
          );
      }
      const result = await db.transaction(async (tx) => {
        const control = await lockFactoryItem(
          tx,
          context.project.id,
          factory,
          id,
        );
        const item = await source(tx, context.project.id, factory, id);
        if (item.version !== req.body?.expectedVersion)
          throw new FactoryError("Work item changed. Reload before claiming.");
        if (control.quarantined)
          throw new FactoryError("Quarantined items cannot be claimed");
        const active =
          control.expiresAt && control.expiresAt.getTime() > Date.now();
        if (
          active &&
          control.assignedTo !== actor &&
          !(context.role === "owner" && req.body?.reassign === true)
        )
          throw new FactoryError(
            "Another reviewer holds this item. An owner must explicitly reassign it.",
          );
        if (
          active &&
          control.assignedTo === actor &&
          req.body?.claimToken !== control.claimToken
        )
          throw new FactoryError(
            "Current claim token required to renew or reassign",
          );
        if (
          active &&
          control.assignedTo !== actor &&
          req.body?.expectedRevision !== control.revision
        ) {
          throw new FactoryError(
            "Work claim changed. Reload before reassigning.",
          );
        }
        const claimToken = randomUUID(),
          expiresAt = new Date(Date.now() + minutes * 60_000);
        await tx
          .update(factoryItemsTable)
          .set({
            assignedTo: target,
            claimToken,
            expiresAt,
            revision: control.revision + 1,
          })
          .where(eq(factoryItemsTable.id, control.id));
        await factoryEvent(
          tx,
          context.project.id,
          actor,
          "factory.item.claimed",
          id,
          {
            factory,
            assignedTo: target,
            expiresAt: expiresAt.toISOString(),
            previousAssignee: control.assignedTo,
            itemVersion: item.version,
          },
        );
        return {
          assignedTo: target,
          claimToken: target === actor ? claimToken : null,
          expiresAt: expiresAt.toISOString(),
        };
      });
      res.status(201).json(result);
    },
  );
  route(
    "post",
    "/items/:id/quarantine",
    ["owner"],
    async (req, res, { project }, actor, factory) => {
      if (
        typeof req.body?.quarantined !== "boolean" ||
        typeof req.body?.reason !== "string" ||
        !req.body.reason.trim() ||
        req.body.reason.length > 2000
      )
        throw new FactoryError(
          "Quarantine changes require a boolean and a reason of 1–2000 characters",
          400,
        );
      const id = String(req.params.id);
      await db.transaction(async (tx) => {
        const control = await lockFactoryItem(tx, project.id, factory, id);
        await source(tx, project.id, factory, id);
        if (control.revision !== req.body?.expectedRevision)
          throw new FactoryError(
            "Work controls changed. Reload before updating.",
          );
        await tx
          .update(factoryItemsTable)
          .set({
            quarantined: req.body.quarantined,
            quarantineReason: req.body.reason.trim(),
            revision: control.revision + 1,
            assignedTo: null,
            claimToken: null,
            expiresAt: null,
          })
          .where(eq(factoryItemsTable.id, control.id));
        await factoryEvent(
          tx,
          project.id,
          actor,
          "factory.item.quarantine.changed",
          id,
          {
            factory,
            quarantined: req.body.quarantined,
            reason: req.body.reason.trim(),
          },
        );
      });
      res.json({ ok: true });
    },
  );
}
