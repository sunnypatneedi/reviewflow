import type { IRouter, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  rubricItemsTable,
  rubricRecordsTable,
  rubricSpecsTable,
} from "@workspace/db";
import { FactoryError } from "../lib/factory-engine";
import { factoryEvent, type FactoryTransaction } from "../lib/factories";
import { assertCurrentRole } from "../lib/team";
import {
  boundedText,
  canonical,
  contentHash,
  releaseProblems,
  rubricHash,
  validateRubric,
  validateScores,
  type RubricState,
} from "../lib/rubric-engine";
import { verifyRubricLineage } from "../lib/rubrics";
import type { ProjectRole } from "./authorization";

type Context = {
  project: { id: string; mode: string };
  userId: string | null;
  role: ProjectRole | null;
};
type Helpers = {
  ensureProject(req: Request): Promise<Context>;
  requireProjectAccess(
    req: Request,
    res: Response,
    context: any,
    roles?: readonly ProjectRole[],
  ): Promise<boolean>;
  identity(req: Request): string;
};
const reviewRoles: ProjectRole[] = ["owner", "reviewer", "adjudicator"];
const auditRoles: ProjectRole[] = [
  "owner",
  "reviewer",
  "adjudicator",
  "auditor",
];
const releaseRoles: ProjectRole[] = ["owner", "adjudicator", "exporter"];
const initialState = (): RubricState => ({
  status: "pending",
  quarantined: false,
  audits: [],
  contributors: [],
});
async function lock(tx: FactoryTransaction, projectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rubrics:${projectId}`}, 0))`,
  );
}
async function record(
  tx: FactoryTransaction,
  projectId: string,
  actor: string,
  kind: string,
  itemId: string | null,
  payload: Record<string, unknown>,
) {
  const id = randomUUID();
  await tx
    .insert(rubricRecordsTable)
    .values({ id, projectId, actor, kind, itemId, payload });
  await factoryEvent(tx, projectId, actor, `rubric.${kind}`, itemId ?? id, {
    recordId: id,
  });
  return id;
}
export function registerRubricRoutes(router: IRouter, helpers: Helpers) {
  const route = (
    method: "get" | "post",
    path: string,
    roles: ProjectRole[] | undefined,
    action: (
      req: Request,
      res: Response,
      ctx: Context,
      actor: string,
    ) => Promise<void>,
  ) => {
    router[method](`/reviewflow/rubrics${path}`, async (req, res) => {
      try {
        const ctx = await helpers.ensureProject(req);
        if (!(await helpers.requireProjectAccess(req, res, ctx, roles))) return;
        res.set("Cache-Control", "no-store");
        await action(req, res, ctx, helpers.identity(req));
      } catch (error) {
        if (error instanceof FactoryError)
          res.status(error.status).json({ error: error.message });
        else throw error;
      }
    });
  };
  route("get", "", undefined, async (_req, res, ctx, actor) => {
    const projectId = ctx.project.id;
    const rubrics = await db
      .select()
      .from(rubricSpecsTable)
      .where(eq(rubricSpecsTable.projectId, projectId))
      .orderBy(asc(rubricSpecsTable.revision));
    const items = await db
      .select()
      .from(rubricItemsTable)
      .where(eq(rubricItemsTable.projectId, projectId))
      .orderBy(asc(rubricItemsTable.externalId));
    const releases = await db
      .select()
      .from(rubricRecordsTable)
      .where(
        and(
          eq(rubricRecordsTable.projectId, projectId),
          eq(rubricRecordsTable.kind, "release"),
        ),
      );
    res.json({
      actor,
      role: ctx.role,
      authenticated: Boolean(ctx.userId),
      canConfigure: !ctx.userId || ctx.role === "owner",
      canRelease: !ctx.userId || releaseRoles.includes(ctx.role!),
      rubrics,
      items:
        ctx.role === "exporter"
          ? []
          : items.map((item) => {
              const state = item.state as RubricState;
              const active =
                state.expiresAt && Date.parse(state.expiresAt) > Date.now();
              return {
                ...item,
                state: undefined,
                ...state,
                decision: ctx.role === "auditor" ? undefined : state.decision,
                audits: state.audits.map((a) => ({
                  id: a.id,
                  actor: a.actor,
                  pass: a.pass,
                  decisionId: a.decisionId,
                })),
                claimToken:
                  active && state.assignedTo === actor
                    ? state.claimToken
                    : null,
                assignedTo: active ? state.assignedTo : null,
              };
            }),
      releases: releases.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        itemCount: (r.payload as any).itemCount,
        sha256: (r.payload as any).sha256,
      })),
      releaseGate:
        "Every item needs human review, privacy review and its rubric minimum of independent human audits. Solo self-checks do not qualify. Audits are independent, not claimed blind or statistically representative.",
    });
  });
  route("post", "/specs", ["owner"], async (req, res, ctx, actor) => {
    const definition = validateRubric(req.body?.definition);
    const result = await db.transaction(async (tx) => {
      await assertCurrentRole(tx, ctx.project.id, actor, ["owner"]);
      await lock(tx, ctx.project.id);
      const specs = await tx
        .select()
        .from(rubricSpecsTable)
        .where(eq(rubricSpecsTable.projectId, ctx.project.id));
      const revision = Math.max(0, ...specs.map((s) => s.revision));
      if (req.body?.expectedRevision !== revision)
        throw new FactoryError(
          "Rubric changed. Reload before creating a new revision.",
        );
      const row = {
        id: randomUUID(),
        projectId: ctx.project.id,
        revision: revision + 1,
        hash: rubricHash(definition),
        definition,
        createdBy: actor,
      };
      await tx.insert(rubricSpecsTable).values(row);
      await factoryEvent(
        tx,
        ctx.project.id,
        actor,
        "rubric.spec.created",
        row.id,
        { revision: row.revision, hash: row.hash },
      );
      return row;
    });
    res.status(201).json(result);
  });
  route("post", "/items", ["owner"], async (req, res, ctx, actor) => {
    if (
      !Array.isArray(req.body?.items) ||
      !req.body.items.length ||
      req.body.items.length > 100
    )
      throw new FactoryError("Import 1–100 items at a time", 400);
    const inputs = req.body.items.map((v: any) => ({
      externalId: boundedText(v?.externalId, "External ID", 120),
      content:
        (boundedText(v?.content, "Content", 20_000), v.content as string),
    }));
    if (new Set(inputs.map((v: any) => v.externalId)).size !== inputs.length)
      throw new FactoryError("Duplicate external IDs in import", 400);
    const result = await db.transaction(async (tx) => {
      await assertCurrentRole(tx, ctx.project.id, actor, ["owner"]);
      await lock(tx, ctx.project.id);
      const [rubric] = await tx
        .select()
        .from(rubricSpecsTable)
        .where(
          and(
            eq(rubricSpecsTable.projectId, ctx.project.id),
            eq(rubricSpecsTable.id, String(req.body?.rubricId)),
          ),
        );
      if (!rubric) throw new FactoryError("Rubric revision not found", 404);
      const existing = await tx
        .select()
        .from(rubricItemsTable)
        .where(eq(rubricItemsTable.projectId, ctx.project.id));
      const fresh = inputs.filter((v: any) => {
        const previous = existing.find((e) => e.externalId === v.externalId);
        if (
          previous &&
          (previous.rubricId !== rubric.id || previous.content !== v.content)
        )
          throw new FactoryError(
            "External ID conflicts with immutable content or rubric; use a new external ID",
          );
        return !previous;
      });
      if (existing.length + fresh.length > 500)
        throw new FactoryError(
          "This local rubric factory supports at most 500 items per project",
          400,
        );
      if (!fresh.length) return { imported: 0, unchanged: inputs.length };
      const rows = fresh.map((v: any) => ({
        id: randomUUID(),
        projectId: ctx.project.id,
        rubricId: rubric.id,
        ...v,
        contentHash: contentHash(v.content),
        version: 1,
        state: initialState(),
        createdBy: actor,
      }));
      await tx.insert(rubricItemsTable).values(rows);
      await record(tx, ctx.project.id, actor, "import", null, {
        rubricId: rubric.id,
        rubricHash: rubric.hash,
        items: rows.map((r: any) => ({ id: r.id, contentHash: r.contentHash })),
      });
      return { imported: rows.length, unchanged: inputs.length - rows.length };
    });
    res.status(201).json(result);
  });
  for (const operation of [
    "claim",
    "quarantine",
    "review",
    "adjudicate",
    "audit",
  ] as const) {
    const roles =
      operation === "quarantine"
        ? (["owner"] as ProjectRole[])
        : operation === "adjudicate"
          ? (["owner", "adjudicator"] as ProjectRole[])
          : operation === "audit"
            ? auditRoles
            : reviewRoles;
    route(
      "post",
      `/items/:id/${operation}`,
      roles,
      async (req, res, ctx, actor) => {
        const result = await db.transaction(async (tx) => {
          await assertCurrentRole(tx, ctx.project.id, actor, roles);
          await lock(tx, ctx.project.id);
          const [item] = await tx
            .select()
            .from(rubricItemsTable)
            .where(
              and(
                eq(rubricItemsTable.projectId, ctx.project.id),
                eq(rubricItemsTable.id, String(req.params.id)),
              ),
            )
            .for("update");
          if (!item) throw new FactoryError("Rubric item not found", 404);
          if (req.body?.expectedVersion !== item.version)
            throw new FactoryError("Item changed. Reload before retrying.");
          const state = structuredClone(item.state) as RubricState;
          const [spec] = await tx
            .select()
            .from(rubricSpecsTable)
            .where(
              and(
                eq(rubricSpecsTable.projectId, ctx.project.id),
                eq(rubricSpecsTable.id, item.rubricId),
              ),
            );
          const rubric = validateRubric(spec.definition);
          const liveClaim =
            state.expiresAt && Date.parse(state.expiresAt) > Date.now();
          if (operation === "quarantine") {
            if (typeof req.body?.quarantined !== "boolean")
              throw new FactoryError("Quarantined must be a boolean", 400);
            state.quarantineReason = boundedText(
              req.body?.reason,
              "Quarantine reason",
              2000,
            );
            state.quarantined = req.body.quarantined;
            delete state.assignedTo;
            delete state.claimToken;
            delete state.expiresAt;
            await record(tx, ctx.project.id, actor, "quarantine", item.id, {
              quarantined: state.quarantined,
              reason: state.quarantineReason,
              sourceVersion: item.version,
            });
          } else {
            if (state.quarantined)
              throw new FactoryError(
                "Resolve quarantine before working on this item",
              );
            if (operation === "claim") {
              if (state.status === "reviewed")
                throw new FactoryError(
                  "Reviewed items need an audit, not another claim",
                );
              if (state.status === "escalated")
                await assertCurrentRole(tx, ctx.project.id, actor, [
                  "owner",
                  "adjudicator",
                ]);
              if (liveClaim && state.assignedTo !== actor)
                throw new FactoryError(
                  "Another reviewer holds this claim. Wait for it to expire.",
                );
              state.assignedTo = actor;
              state.claimToken = randomUUID();
              state.expiresAt = new Date(
                Date.now() + 10 * 60_000,
              ).toISOString();
              await record(tx, ctx.project.id, actor, "claim", item.id, {
                expiresAt: state.expiresAt,
                sourceVersion: item.version,
              });
            } else if (operation === "audit") {
              if (!ctx.userId || req.body?.independentHuman !== true)
                throw new FactoryError(
                  "Independent audit requires an authenticated, distinct human reviewer and explicit independence confirmation. A solo self-check cannot qualify.",
                  403,
                );
              if (state.status !== "reviewed" || !state.decision)
                throw new FactoryError("Finalize human review before auditing");
              if (
                state.contributors.includes(actor) ||
                state.decision.actor === actor
              )
                throw new FactoryError(
                  "An item contributor cannot independently audit their own work",
                  403,
                );
              if (
                state.audits.some(
                  (a) =>
                    a.decisionId === state.decision!.id && a.actor === actor,
                )
              )
                throw new FactoryError(
                  "This actor already audited this decision",
                );
              const scores = validateScores(req.body?.scores, rubric),
                reason = boundedText(req.body?.reason, "Audit reason", 2000);
              const pass =
                canonical(scores) === canonical(state.decision.scores);
              const audit = {
                actor,
                decisionId: state.decision.id,
                pass,
                independentHuman: true as const,
                scores,
                reason,
              };
              const id = await record(
                tx,
                ctx.project.id,
                actor,
                "audit",
                item.id,
                {
                  ...audit,
                  rubricId: spec.id,
                  rubricHash: spec.hash,
                  contentHash: item.contentHash,
                  sourceVersion: item.version,
                },
              );
              state.audits.push({ id, ...audit });
              if (!pass) {
                state.status = "escalated";
                state.escalationReason =
                  "Independent audit disagreed; adjudication and a fresh independent audit are required";
              }
            } else {
              if (
                !liveClaim ||
                state.assignedTo !== actor ||
                state.claimToken !== req.body?.claimToken
              )
                throw new FactoryError(
                  "A current matching work claim is required",
                );
              if (operation === "review" && state.status !== "pending")
                throw new FactoryError(
                  "This item requires adjudication or is already reviewed",
                );
              if (operation === "adjudicate" && state.status !== "escalated")
                throw new FactoryError(
                  "Only escalated items can be adjudicated",
                );
              if (
                operation === "adjudicate" &&
                (state.contributors.includes(actor) ||
                  state.audits.some((a) => a.actor === actor))
              )
                throw new FactoryError(
                  "Adjudication requires a different human from prior reviewers and auditors",
                  403,
                );
              const reason = boundedText(
                req.body?.reason,
                "Review reason",
                2000,
              );
              if (operation === "review" && req.body?.action === "escalate") {
                state.status = "escalated";
                state.escalationReason = reason;
                await record(tx, ctx.project.id, actor, "review", item.id, {
                  action: "escalate",
                  reason,
                  sourceVersion: item.version,
                });
              } else {
                if (
                  req.body?.action !== "finalize" ||
                  req.body?.privacyReviewed !== true
                )
                  throw new FactoryError(
                    "Final review requires action=finalize and explicit privacy review",
                    400,
                  );
                const scores = validateScores(req.body?.scores, rubric);
                const kind =
                  operation === "adjudicate" ? "adjudication" : "review";
                const decision = {
                  actor,
                  scores,
                  reason,
                  privacyReviewed: true as const,
                  kind: kind as "review" | "adjudication",
                };
                const id = await record(
                  tx,
                  ctx.project.id,
                  actor,
                  kind,
                  item.id,
                  {
                    ...decision,
                    rubricId: spec.id,
                    rubricHash: spec.hash,
                    contentHash: item.contentHash,
                    sourceVersion: item.version,
                  },
                );
                state.decision = { id, ...decision };
                state.status = "reviewed";
                delete state.escalationReason;
              }
              state.contributors = [...new Set([...state.contributors, actor])];
              delete state.assignedTo;
              delete state.claimToken;
              delete state.expiresAt;
            }
          }
          await tx
            .update(rubricItemsTable)
            .set({ state, version: item.version + 1 })
            .where(eq(rubricItemsTable.id, item.id));
          return {
            id: item.id,
            version: item.version + 1,
            claimToken:
              state.assignedTo === actor ? state.claimToken : undefined,
            status: state.status,
          };
        });
        res.status(201).json(result);
      },
    );
  }
  route("post", "/releases", releaseRoles, async (req, res, ctx, actor) => {
    if (req.body?.privacyReviewed !== true)
      throw new FactoryError(
        "Explicit release privacy review is required",
        400,
      );
    const result = await db.transaction(async (tx) => {
      await assertCurrentRole(tx, ctx.project.id, actor, releaseRoles);
      await lock(tx, ctx.project.id);
      const items = await tx
        .select()
        .from(rubricItemsTable)
        .where(eq(rubricItemsTable.projectId, ctx.project.id))
        .orderBy(asc(rubricItemsTable.externalId));
      const specs = await tx
        .select()
        .from(rubricSpecsTable)
        .where(eq(rubricSpecsTable.projectId, ctx.project.id));
      const lineage = await tx
        .select()
        .from(rubricRecordsTable)
        .where(eq(rubricRecordsTable.projectId, ctx.project.id));
      const enriched = items.map((item) => {
        const spec = specs.find((s) => s.id === item.rubricId)!;
        return {
          ...item,
          state: (item.state as RubricState).decision
            ? verifyRubricLineage(item, spec, lineage)
            : (item.state as RubricState),
          rubric: validateRubric(spec.definition),
        };
      });
      const problems = releaseProblems(enriched);
      if (problems.length)
        throw new FactoryError(
          `Release blocked: ${problems.slice(0, 10).join("; ")}`,
        );
      const createdAt = new Date().toISOString();
      const jsonl =
        enriched
          .map((item) => {
            const spec = specs.find((s) => s.id === item.rubricId)!;
            return canonical({
              schemaVersion: 1,
              factory: "rubric",
              projectId: ctx.project.id,
              itemId: item.id,
              externalId: item.externalId,
              ...(req.body?.includeSourceText === true
                ? { content: item.content }
                : {}),
              contentHash: item.contentHash,
              rubric: {
                id: spec.id,
                revision: spec.revision,
                hash: spec.hash,
                definition: spec.definition,
              },
              itemVersion: item.version,
              humanDecision: {
                ...item.state.decision,
                actor: contentHash(
                  `${ctx.project.id}:${item.state.decision!.actor}`,
                ),
              },
              independentAudits: item.state.audits
                .filter((a) => a.decisionId === item.state.decision?.id)
                .map((a) => ({
                  ...a,
                  actor: contentHash(`${ctx.project.id}:${a.actor}`),
                })),
              provenance: {
                importedBy: contentHash(`${ctx.project.id}:${item.createdBy}`),
                importedAt: item.createdAt.toISOString(),
                releasedBy: contentHash(`${ctx.project.id}:${actor}`),
                releasedAt: createdAt,
              },
              qualification:
                "Independent human agreement checks only; no blind-audit or statistical generalization claim",
            });
          })
          .join("\n") + "\n";
      const sha256 = contentHash(jsonl),
        itemCount = items.length;
      const id = await record(tx, ctx.project.id, actor, "release", null, {
        schemaVersion: 1,
        jsonl,
        sha256,
        itemCount,
        privacyReviewed: true,
        includeSourceText: req.body?.includeSourceText === true,
        createdAt,
      });
      return { id, sha256, itemCount, createdAt };
    });
    res.status(201).json(result);
  });
  route("get", "/releases/:id/export", releaseRoles, async (req, res, ctx) => {
    const [row] = await db
      .select()
      .from(rubricRecordsTable)
      .where(
        and(
          eq(rubricRecordsTable.projectId, ctx.project.id),
          eq(rubricRecordsTable.kind, "release"),
          eq(rubricRecordsTable.id, String(req.params.id)),
        ),
      );
    if (!row) throw new FactoryError("Release not found", 404);
    const payload = row.payload as { jsonl: string; sha256: string };
    if (contentHash(payload.jsonl) !== payload.sha256)
      throw new FactoryError("Release integrity verification failed", 500);
    res
      .set("Content-Type", "application/x-ndjson")
      .set(
        "Content-Disposition",
        `attachment; filename="rubric-release-${row.id}.jsonl"`,
      )
      .set("X-Content-SHA256", payload.sha256)
      .send(payload.jsonl);
  });
}
