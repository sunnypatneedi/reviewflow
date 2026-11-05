import { currentProposal } from "../lib/current-proposal";
import type { IRouter, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, projectsTable, proposalsTable, tasksTable } from "@workspace/db";
import { evaluateTask } from "../evaluation";
import {
  factoryPolicy,
  lockFactoryItem,
  lockFactory,
  factoryEvent,
  type FactoryTransaction,
} from "../lib/factories";
import { FactoryError } from "../lib/factory-engine";
import { routingAdvice } from "../lib/routing-advice";
import { assertCurrentRole, recordExposure } from "../lib/team";
import { finishJevCall, reserveJevCall } from "../lib/jev-budget";
import { REVIEW_ROLES } from "./authorization";

type Context = {
  project: typeof projectsTable.$inferSelect;
  userId: string | null;
};
type Helpers = {
  ensureProject: (req: Request) => Promise<Context>;
  requireProjectAccess: (
    req: Request,
    res: Response,
    context: any,
    roles?: typeof REVIEW_ROLES,
  ) => Promise<boolean>;
  identity: (req: Request) => string;
};
const active = new Set<string>();
export function registerRoutingRoutes(router: IRouter, helpers: Helpers) {
  router.post("/reviewflow/tasks/:taskId/routing-advice", async (req, res) => {
    const started = performance.now();
    const context = await helpers.ensureProject(req);
    if (!(await helpers.requireProjectAccess(req, res, context, REVIEW_ROLES)))
      return;
    const provider = req.body?.provider ?? "rules";
    if (!["rules", "simulator", "jev"].includes(provider))
      throw new FactoryError("Choose rules, simulator or Jev", 400);
    const actor = helpers.identity(req);
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.projectId, context.project.id),
          eq(tasksTable.id, req.params.taskId as string),
        ),
      );
    if (!task) throw new FactoryError("Task not found", 404);
    if (req.body?.expectedVersion !== task.version)
      throw new FactoryError("Task changed. Reload before routing.");
    await recordExposure(context.project.id, actor, [task]);
    const readSnapshot = async (tx: FactoryTransaction, admission = false) => {
      await assertCurrentRole(tx, context.project.id, actor, REVIEW_ROLES);
      if (admission) await lockFactory(tx, context.project.id, "evidence");
      const control = await lockFactoryItem(
        tx,
        context.project.id,
        "evidence",
        task.id,
      );
      const policy = await factoryPolicy(tx, context.project.id, "evidence");
      const [latest] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task.id))
        .for("share");
      if (
        !latest ||
        latest.version !== task.version ||
        latest.contentHash !== task.contentHash
      )
        throw new FactoryError("Task changed during routing. Reload.");
      const proposals = await tx
        .select()
        .from(proposalsTable)
        .where(
          and(
            eq(proposalsTable.taskId, task.id),
            eq(proposalsTable.mode, latest.mode),
          ),
        );
      const proposal = currentProposal(latest, proposals);
      const input = {
        quarantined: control.quarantined,
        finalized: latest.status === "finalized",
        escalated: latest.status === "escalated",
        highRisk: latest.risk === "high",
        hasProposal: Boolean(proposal),
        confidence: proposal ? Number(proposal.confidence) : null,
        redirection: proposal ? Number(proposal.injectionProbability) : null,
      };
      return { policy, input };
    };
    const snapshot = () => db.transaction((tx) => readSnapshot(tx));
    const before = await snapshot();
    const baseline = routingAdvice(before.input, before.policy.definition);
    let source = "rules";
    let fallback: string | null = null;
    let result;
    // Protected routes never send source data to a provider.
    if (provider !== "rules" && !baseline.protectedLane) {
      if (!before.policy.definition.assistanceAllowed)
        throw new FactoryError("Assistance is disabled by policy", 403);
      if (provider === "jev") {
        if (
          !req.app.locals.runtimeConfig.liveInferenceEnabled ||
          req.app.locals.runtimeConfig.appMode !== "clerk" ||
          !context.userId ||
          req.body?.allowOutbound !== true
        )
          throw new FactoryError(
            "Jev routing requires server opt-in, sign-in, project budget approval and explicit outbound approval",
            403,
          );
        if (
          Buffer.byteLength(
            JSON.stringify([
              task.question,
              task.evidence,
              task.candidateAnswer,
            ]),
          ) > 32_000
        )
          throw new FactoryError(
            "Routing payload exceeds the 32 KB outbound limit",
            413,
          );
      }
      if (active.has(context.project.id) || active.size >= 4) fallback = "busy";
      else {
        active.add(context.project.id);
        let reservation: string | undefined;
        try {
          if (provider === "jev")
            reservation = await reserveJevCall(
              context.project.id,
              "routing-advice",
              task.id,
              async (tx) => {
                // Budget admission may have waited while access, policy, source
                // or quarantine changed. Validate them together with reservation.
                const current = await readSnapshot(tx, true);
                if (
                  current.policy.revision !== before.policy.revision ||
                  !current.policy.definition.assistanceAllowed ||
                  routingAdvice(current.input, current.policy.definition)
                    .protectedLane
                )
                  throw new FactoryError(
                    "Outbound routing admission changed. Reload before retrying.",
                  );
              },
            );
          result = await evaluateTask(
            task,
            provider === "simulator" ? "demo" : "live",
            2_000,
          );
          source = provider;
          if (reservation) await finishJevCall(reservation, "succeeded");
        } catch {
          fallback = "provider_unavailable_or_budget_exhausted";
          if (reservation) await finishJevCall(reservation, "failed");
        } finally {
          active.delete(context.project.id);
        }
      }
    }
    // Policy changes and source mutations during the call are never silently accepted.
    const after = await snapshot();
    if (after.policy.revision !== before.policy.revision)
      throw new FactoryError("Routing policy changed. Reload.");
    const advice = routingAdvice(after.input, after.policy.definition, result);
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    await db.transaction(async (tx) => {
      await assertCurrentRole(tx, context.project.id, actor, REVIEW_ROLES);
      await factoryEvent(
        tx,
        context.project.id,
        actor,
        "routing.advised",
        task.id,
        {
          source,
          fallback,
          taskVersion: task.version,
          policyRevision: after.policy.revision,
          recommendedLane: advice.recommendedLane,
          latencyMs,
          automaticAcceptance: false,
        },
      );
    });
    res.set("Cache-Control", "no-store").json({
      ...advice,
      source,
      fallback,
      taskVersion: task.version,
      policyRevision: after.policy.revision,
      latencyMs,
      deadlineMs: provider === "jev" ? 2_000 : null,
      qualification: "unqualified",
      message:
        "Advisory only. Policy routing and explicit human decisions remain authoritative.",
    });
  });
}
