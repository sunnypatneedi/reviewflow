import type { IRouter, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parseTelemetry, telemetryIdentity } from "../lib/telemetry";
import { assertCurrentRole } from "../lib/team";
import type { ProjectRole } from "./authorization";
type Helpers = {
  ensureProject: (req: Request) => Promise<any>;
  requireProjectAccess: (
    req: Request,
    res: Response,
    context: any,
    roles?: readonly ProjectRole[],
  ) => Promise<boolean>;
  identity: (req: Request) => string;
};
export function registerTelemetryRoutes(router: IRouter, helpers: Helpers) {
  router.get("/reviewflow/telemetry/context", async (req, res) => {
    const context = await helpers.ensureProject(req);
    if (!(await helpers.requireProjectAccess(req, res, context))) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      projectId: context.project.id,
      scope: telemetryIdentity(
        context.project.id,
        helpers.identity(req),
        "browser-v1",
      ),
    });
  });
  router.post("/reviewflow/telemetry", async (req, res) => {
    const context = await helpers.ensureProject(req);
    if (!(await helpers.requireProjectAccess(req, res, context))) return;
    const project = context.project.id,
      actor = helpers.identity(req);
    if (
      !req.body ||
      req.body.scope !== telemetryIdentity(project, actor, "browser-v1")
    ) {
      res
        .status(409)
        .json({
          error:
            "Telemetry identity changed; keep this queue for its original session",
        });
      return;
    }
    let events;
    try {
      if (Object.keys(req.body).some((k) => !["scope", "events"].includes(k)))
        throw new Error("Invalid envelope");
      events = parseTelemetry(req.body.events);
    } catch {
      res.status(400).json({ error: "Invalid metadata-only telemetry batch" });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        await assertCurrentRole(tx, project, actor, [
          "owner",
          "reviewer",
          "auditor",
          "adjudicator",
        ]);
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        for (const e of events) {
          const eventId = telemetryIdentity(project, actor, e.id),
            sessionId = telemetryIdentity(project, actor, e.session);
          await tx.execute(sql`INSERT INTO rf_browser_telemetry(event_id,project_id,session_id,sequence,kind,factory,item_id,item_version,proposal_id,visible_ms,dropped)
            VALUES(${eventId},${project},${sessionId},${e.sequence},${e.kind},${e.factory},${e.itemId},${e.itemVersion},${e.proposalId},${e.visibleMs},${e.dropped}) ON CONFLICT DO NOTHING`);
          const persisted =
            await tx.execute(sql`SELECT event_id,session_id,sequence,kind,factory,item_id,item_version,proposal_id,visible_ms,dropped
            FROM rf_browser_telemetry WHERE project_id=${project} AND (event_id=${eventId} OR (session_id=${sessionId} AND sequence=${e.sequence}))`);
          const row = persisted.rows[0];
          if (
            persisted.rows.length !== 1 ||
            !row ||
            row.event_id !== eventId ||
            row.session_id !== sessionId ||
            row.sequence !== e.sequence ||
            row.kind !== e.kind ||
            row.factory !== e.factory ||
            row.item_id !== e.itemId ||
            row.item_version !== e.itemVersion ||
            row.proposal_id !== e.proposalId ||
            row.visible_ms !== e.visibleMs ||
            row.dropped !== e.dropped
          )
            throw Object.assign(new Error("Conflicting telemetry retry"), {
              status: 409,
            });
        }
      });
      res.status(202).json({ accepted: events.map((e) => e.id) });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 409
      ) {
        res
          .status(409)
          .json({
            error:
              "Conflicting event ID or session sequence; no batch events were accepted",
          });
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 403
      ) {
        res.status(403).json({ error: "Project access changed" });
        return;
      }
      res
        .status(503)
        .json({
          error: "Telemetry storage unavailable; retry with the same event IDs",
        });
    }
  });
}
