import type { IRouter, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  factoryItemsTable,
  jevControlsTable,
  membershipsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { FactoryError } from "../lib/factory-engine";
import { factoryEvent } from "../lib/factories";
import { assertCurrentRole, lockMemberships } from "../lib/team";
import { jevBudget } from "../lib/jev-budget";
import { isProjectRole, type ProjectRole } from "./authorization";
type Context = {
  project: typeof projectsTable.$inferSelect;
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
export function registerTeamRoutes(router: IRouter, helpers: Helpers) {
  const route = (
    method: "get" | "post",
    path: string,
    roles: readonly ProjectRole[] | undefined,
    action: (req: Request, res: Response, context: Context) => Promise<void>,
  ) => {
    router[method](`/reviewflow${path}`, async (req, res) => {
      const context = await helpers.ensureProject(req);
      if (
        (path !== "/projects" || !context.userId) &&
        !(await helpers.requireProjectAccess(req, res, context, roles))
      )
        return;
      await action(req, res, context);
    });
  };
  route("get", "/context", undefined, async (_req, res, context) => {
    res.json({
      projectId: context.project.id,
      projectName: context.project.name,
      role: context.role ?? "demo",
    });
  });
  route("get", "/projects", undefined, async (_req, res, context) => {
    if (!context.userId) {
      res.json([
        { id: context.project.id, name: context.project.name, role: "demo" },
      ]);
      return;
    }
    const memberships = await db
      .select()
      .from(membershipsTable)
      .innerJoin(
        projectsTable,
        eq(membershipsTable.projectId, projectsTable.id),
      )
      .where(eq(membershipsTable.userId, context.userId));
    res.json(
      memberships
        .filter((row) => isProjectRole(row.rf_memberships.role))
        .map((row) => ({
          id: row.rf_projects.id,
          name: row.rf_projects.name,
          role: row.rf_memberships.role,
        })),
    );
  });
  route("post", "/projects", undefined, async (req, res, context) => {
    if (!context.userId)
      throw new FactoryError("Sign in to create a shared project", 401);
    if (
      typeof req.body?.name !== "string" ||
      !req.body.name.trim() ||
      req.body.name.length > 120
    )
      throw new FactoryError("Project name must contain 1–120 characters", 400);
    const project = await db.transaction(async (tx) => {
      await lockMemberships(tx, `owner:${context.userId}`);
      const rows = await tx
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.ownerId, context.userId!));
      if (rows.length >= 20)
        throw new FactoryError("At most 20 owned projects are allowed");
      const [created] = await tx
        .insert(projectsTable)
        .values({
          id: randomUUID(),
          name: req.body.name.trim(),
          ownerId: context.userId,
        })
        .returning();
      await tx.insert(membershipsTable).values({
        id: randomUUID(),
        projectId: created.id,
        userId: context.userId!,
        role: "owner",
      });
      await factoryEvent(
        tx,
        created.id,
        context.userId!,
        "project.created",
        created.id,
        { name: created.name },
      );
      return created;
    });
    res.status(201).json({ id: project.id, name: project.name, role: "owner" });
  });
  route(
    "get",
    "/members",
    ["owner", "adjudicator"],
    async (_req, res, context) => {
      res.json(
        (
          await db
            .select()
            .from(membershipsTable)
            .where(eq(membershipsTable.projectId, context.project.id))
        ).map((row) => ({
          userId: row.userId,
          role: row.role,
          revision: row.revision,
        })),
      );
    },
  );
  route("post", "/members", ["owner"], async (req, res, context) => {
    if (!context.userId)
      throw new FactoryError("Shared membership requires authentication", 401);
    const { userId, role, expectedRevision } = req.body ?? {};
    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      userId.length > 200 ||
      (!isProjectRole(role) && role !== "revoked")
    )
      throw new FactoryError(
        "Supply a current account ID and a supported role",
        400,
      );
    const member = await db.transaction(async (tx) => {
      await lockMemberships(tx, context.project.id);
      await assertCurrentRole(tx, context.project.id, context.userId!, [
        "owner",
      ]);
      const [current] = await tx
        .select()
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.projectId, context.project.id),
            eq(membershipsTable.userId, userId),
          ),
        )
        .for("update");
      if (expectedRevision !== (current?.revision ?? -1))
        throw new FactoryError("Membership changed. Reload before saving.");
      if (current?.role === "owner" && role !== "owner") {
        const owners = await tx
          .select()
          .from(membershipsTable)
          .where(
            and(
              eq(membershipsTable.projectId, context.project.id),
              eq(membershipsTable.role, "owner"),
            ),
          );
        if (owners.length < 2)
          throw new FactoryError(
            "Keep at least one owner before changing this membership",
          );
      }
      const revision = (current?.revision ?? -1) + 1;
      const [saved] = await tx
        .insert(membershipsTable)
        .values({
          id: randomUUID(),
          projectId: context.project.id,
          userId,
          role,
          revision,
        })
        .onConflictDoUpdate({
          target: [membershipsTable.projectId, membershipsTable.userId],
          set: { role, revision },
        })
        .returning();
      // Role changes invalidate leases too, including demotion to audit/export.
      await tx
        .update(factoryItemsTable)
        .set({
          assignedTo: null,
          claimToken: null,
          expiresAt: null,
          revision: sql`${factoryItemsTable.revision} + 1`,
        })
        .where(
          and(
            eq(factoryItemsTable.projectId, context.project.id),
            eq(factoryItemsTable.assignedTo, userId),
          ),
        );
      await factoryEvent(
        tx,
        context.project.id,
        context.userId!,
        "membership.changed",
        saved.id,
        { userId, role, revision, previousRole: current?.role ?? null },
      );
      return { userId, role, revision };
    });
    res.json(member);
  });
  route("get", "/jev", ["owner"], async (_req, res, context) => {
    res.json(await jevBudget(context.project.id));
  });
  route("post", "/jev", ["owner"], async (req, res, context) => {
    const { enabled, maxCalls, expectedRevision } = req.body ?? {};
    if (
      typeof enabled !== "boolean" ||
      !Number.isSafeInteger(maxCalls) ||
      maxCalls < 0 ||
      maxCalls > 100
    )
      throw new FactoryError(
        "Set enabled and a lifetime call cap from 0 to 100",
        400,
      );
    if (
      enabled &&
      (!context.userId ||
        req.app.locals.runtimeConfig?.appMode !== "clerk" ||
        !req.app.locals.runtimeConfig?.liveInferenceEnabled ||
        req.body?.ownerConsent !== true)
    )
      throw new FactoryError(
        "Enabling Jev requires server opt-in, authenticated owner consent and a positive call cap",
        403,
      );
    if (enabled && maxCalls < 1)
      throw new FactoryError("A positive call cap is required", 400);
    await db.transaction(async (tx) => {
      // Consistent budget -> membership order with outbound admission. Do not
      // retain a membership lock while waiting for the project call-budget lock.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`jev:${context.project.id}`}, 0))`,
      );
      await assertCurrentRole(tx, context.project.id, helpers.identity(req), [
        "owner",
      ]);
      const current = await jevBudget(context.project.id, tx);
      if (expectedRevision !== current.revision || maxCalls < current.used)
        throw new FactoryError(
          "Budget changed or cap is below already reserved calls. Reload.",
        );
      await tx
        .insert(jevControlsTable)
        .values({
          projectId: context.project.id,
          revision: current.revision + 1,
          enabled,
          maxCalls,
        })
        .onConflictDoUpdate({
          target: jevControlsTable.projectId,
          set: { revision: current.revision + 1, enabled, maxCalls },
        });
      await factoryEvent(
        tx,
        context.project.id,
        helpers.identity(req),
        "jev.budget.changed",
        context.project.id,
        { enabled, maxCalls, revision: current.revision + 1 },
      );
    });
    res.json(await jevBudget(context.project.id));
  });
  route(
    "get",
    "/jev/evaluation-plan",
    ["owner"],
    async (_req, res, context) => {
      const tasks = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.projectId, context.project.id))
        .orderBy(tasksTable.id)
        .limit(25);
      res.json({
        qualification: "not_run",
        provider: "jev",
        budget: await jevBudget(context.project.id),
        tasks: tasks.map((task) => ({
          id: task.id,
          contentHash: task.contentHash,
          risk: task.risk,
        })),
        protocol: [
          "Review and authorize the actual outbound text for private data.",
          "Freeze a human-only reference set and scenario-grouped holdout before any provider reveal.",
          "Compare errors by risk and lane; record calls, latency and token use.",
          "Use an independent blind reviewer for disagreements. Do not automate acceptance.",
          "Treat reservations, timeouts and retries as potentially billed; a call cap is not a currency estimate.",
        ],
        automaticAcceptance: false,
      });
    },
  );
}
