import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  db,
  membershipsTable,
  pool,
  projectsTable,
  rubricItemsTable,
  rubricRecordsTable,
  rubricSpecsTable,
} from "@workspace/db";
import { registerRubricRoutes } from "./rubrics";
import { roleAllows, type ProjectRole } from "./authorization";
import { contentHash } from "../lib/rubric-engine";
const definition = {
  schemaVersion: 1,
  name: "Test rubric",
  criteria: [
    { id: "quality", label: "Quality", kind: "score", min: 0, max: 5 },
    { id: "safe", label: "Safe", kind: "option", options: ["yes", "no"] },
  ],
  minimumAudits: 1,
};
const scores = { quality: 5, safe: "yes" };
after(async () => {
  await pool.end();
});
// Synthetic fixture actors test authorization/state contracts, not real human independence or Clerk sessions.
async function fixture() {
  const projectId = randomUUID(),
    outsider = `outsider-${randomUUID()}`;
  const actors = Object.fromEntries(
    ["owner", "reviewer", "adjudicator", "auditor", "exporter"].map((role) => [
      role,
      `${role}-${randomUUID()}`,
    ]),
  );
  await db
    .insert(projectsTable)
    .values({
      id: projectId,
      name: "Synthetic rubric contract",
      ownerId: actors.owner,
    });
  await db
    .insert(membershipsTable)
    .values(
      Object.entries(actors).map(([role, userId]) => ({
        id: randomUUID(),
        projectId,
        userId,
        role,
      })),
    );
  const app = express(),
    router = Router();
  app.use(express.json());
  registerRubricRoutes(router, {
    ensureProject: async (req) => {
      const userId = req.get("x-synthetic-user")!;
      const [member] = await db
        .select()
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.projectId, projectId),
            eq(membershipsTable.userId, userId),
          ),
        );
      return {
        project: { id: projectId, mode: "demo" },
        userId: req.get("x-anonymous") ? null : userId,
        role: (member?.role as ProjectRole) ?? null,
      };
    },
    identity: (req) => req.get("x-synthetic-user")!,
    requireProjectAccess: async (_req, res, ctx, roles) => {
      if (!ctx.role || !roleAllows(ctx.role, roles)) {
        res.status(403).json({ error: "Not permitted" });
        return false;
      }
      return true;
    },
  });
  app.use(router);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = async (
    actor: string,
    path = "",
    body?: unknown,
    anonymous = false,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/reviewflow/rubrics${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          "x-synthetic-user": actor,
          ...(anonymous ? { "x-anonymous": "true" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    return { status: response.status, value, text };
  };
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  const queue = async (actor = actors.owner) => (await call(actor)).value;
  return { projectId, actors, outsider, call, close, queue };
}
test("rubric route: immutable revisions/import, fencing, roles, full independent release, frozen privacy-safe provenance", async () => {
  const f = await fixture(),
    { actors: a, call, queue } = f;
  try {
    assert.equal((await call(f.outsider)).status, 403);
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      409,
    );
    assert.equal(
      (await call(a.reviewer, "/specs", { definition, expectedRevision: 0 }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(a.owner, "/specs", {
          definition: { ...definition, minimumAudits: 0 },
          expectedRevision: 0,
        })
      ).status,
      400,
    );
    const spec = await call(a.owner, "/specs", {
      definition,
      expectedRevision: 0,
    });
    assert.equal(spec.status, 201);
    assert.equal(
      (await call(a.owner, "/specs", { definition, expectedRevision: 0 }))
        .status,
      409,
    );
    const imported = {
      rubricId: spec.value.id,
      items: [{ externalId: "item", content: "  Source bytes preserved.\n" }],
    };
    assert.equal((await call(a.owner, "/items", imported)).value.imported, 1);
    assert.equal((await call(a.owner, "/items", imported)).value.imported, 0);
    assert.equal(
      (
        await call(a.owner, "/items", {
          ...imported,
          items: [{ externalId: "item", content: "different" }],
        })
      ).status,
      409,
    );
    let item = (await queue()).items[0];
    assert.equal(item.content, imported.items[0].content);
    assert.equal(item.contentHash, contentHash(item.content));
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      409,
    );
    assert.equal(
      (
        await call(a.auditor, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
        })
      ).status,
      403,
    );
    const claims = await Promise.all([
      call(a.reviewer, `/items/${item.id}/claim`, {
        expectedVersion: item.version,
      }),
      call(a.reviewer, `/items/${item.id}/claim`, {
        expectedVersion: item.version,
      }),
    ]);
    assert.deepEqual(claims.map((r) => r.status).sort(), [201, 409]);
    item = (await queue(a.reviewer)).items[0];
    assert.ok(item.claimToken);
    assert.equal((await queue()).items[0].claimToken, null);
    assert.equal(
      (
        await call(a.owner, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
        })
      ).status,
      409,
    );
    const review = {
      expectedVersion: item.version,
      claimToken: item.claimToken,
      action: "finalize",
      scores,
      reason: "Checked source",
      privacyReviewed: true,
    };
    assert.equal(
      (
        await call(a.reviewer, `/items/${item.id}/review`, {
          ...review,
          claimToken: "stale",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(a.reviewer, `/items/${item.id}/review`, {
          ...review,
          scores: { quality: 99, safe: "yes" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(a.reviewer, `/items/${item.id}/review`, {
          ...review,
          privacyReviewed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call(a.reviewer, `/items/${item.id}/review`, review)).status,
      201,
    );
    item = (await queue()).items[0];
    const audit = {
      expectedVersion: item.version,
      scores,
      reason: "Independent check",
      independentHuman: true,
    };
    assert.equal(
      (await call(a.reviewer, `/items/${item.id}/audit`, audit)).status,
      403,
    );
    assert.equal(
      (await call(a.auditor, `/items/${item.id}/audit`, audit, true)).status,
      403,
    );
    assert.equal(
      (
        await call(a.auditor, `/items/${item.id}/audit`, {
          ...audit,
          independentHuman: false,
        })
      ).status,
      403,
    );
    assert.equal((await queue(a.auditor)).items[0].decision, undefined);
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      409,
    );
    assert.equal(
      (await call(a.auditor, `/items/${item.id}/audit`, audit)).status,
      201,
    );
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: false })).status,
      400,
    );
    const release = await call(a.exporter, "/releases", {
      privacyReviewed: true,
    });
    assert.equal(release.status, 201, release.text);
    const exported = await call(
      a.exporter,
      `/releases/${release.value.id}/export`,
    );
    assert.equal(exported.status, 200);
    assert.equal(contentHash(exported.text), release.value.sha256);
    const line = JSON.parse(exported.text);
    assert.equal(line.content, undefined);
    assert.notEqual(line.humanDecision.actor, a.reviewer);
    assert.equal(line.rubric.id, spec.value.id);
    assert.equal(line.independentAudits.length, 1);
    assert.equal(
      (await call(a.auditor, `/releases/${release.value.id}/export`)).status,
      403,
    );
    const full = await call(a.owner, "/releases", {
      privacyReviewed: true,
      includeSourceText: true,
    });
    assert.equal(full.status, 201);
    assert.equal(
      JSON.parse(
        (await call(a.owner, `/releases/${full.value.id}/export`)).text,
      ).content,
      imported.items[0].content,
    );
    assert.equal(
      (
        await call(a.owner, "/specs", {
          definition: { ...definition, minimumAudits: 2 },
          expectedRevision: 1,
        })
      ).status,
      201,
    );
    assert.equal(
      (await call(a.owner, `/releases/${release.value.id}/export`)).text,
      exported.text,
    );
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.owner, `/items/${item.id}/quarantine`, {
          expectedVersion: item.version,
          quarantined: true,
          reason: "Privacy hold",
        })
      ).status,
      201,
    );
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      409,
    );
    assert.equal(
      (await call(a.owner, `/releases/${release.value.id}/export`)).text,
      exported.text,
    );
    await assert.rejects(
      db
        .update(rubricSpecsTable)
        .set({ hash: "forged" })
        .where(eq(rubricSpecsTable.id, spec.value.id)),
    );
    await assert.rejects(
      db
        .update(rubricItemsTable)
        .set({ content: "forged", version: item.version + 2 })
        .where(eq(rubricItemsTable.id, item.id)),
    );
    await assert.rejects(
      db
        .update(rubricRecordsTable)
        .set({ payload: {} })
        .where(eq(rubricRecordsTable.id, release.value.id)),
    );
  } finally {
    await f.close();
  }
});
test("failed independent audit requires distinct adjudicator and fresh audit; forged mutable lineage cannot release", async () => {
  const f = await fixture(),
    { actors: a, call, queue } = f;
  try {
    const spec = (
      await call(a.owner, "/specs", { definition, expectedRevision: 0 })
    ).value;
    await call(a.owner, "/items", {
      rubricId: spec.id,
      items: [{ externalId: "conflict", content: "Conflict example" }],
    });
    let item = (await queue()).items[0];
    await call(a.owner, `/items/${item.id}/claim`, {
      expectedVersion: item.version,
    });
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.owner, `/items/${item.id}/review`, {
          expectedVersion: item.version,
          claimToken: item.claimToken,
          action: "finalize",
          scores,
          reason: "First review",
          privacyReviewed: true,
        })
      ).status,
      201,
    );
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.auditor, `/items/${item.id}/audit`, {
          expectedVersion: item.version,
          scores: { ...scores, quality: 2 },
          independentHuman: true,
          reason: "Disagreement",
        })
      ).status,
      201,
    );
    item = (await queue()).items[0];
    assert.equal(item.status, "escalated");
    await call(a.owner, `/items/${item.id}/claim`, {
      expectedVersion: item.version,
    });
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.owner, `/items/${item.id}/adjudicate`, {
          expectedVersion: item.version,
          claimToken: item.claimToken,
          action: "finalize",
          scores,
          reason: "Self adjudication",
          privacyReviewed: true,
        })
      ).status,
      403,
    );
    // Quarantine clears the owner's claim without weakening the adjudication rule.
    await call(a.owner, `/items/${item.id}/quarantine`, {
      expectedVersion: item.version,
      quarantined: true,
      reason: "Release claim",
    });
    item = (await queue()).items[0];
    await call(a.owner, `/items/${item.id}/quarantine`, {
      expectedVersion: item.version,
      quarantined: false,
      reason: "Ready for adjudicator",
    });
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.adjudicator, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
        })
      ).status,
      201,
    );
    item = (await queue(a.adjudicator)).items[0];
    assert.equal(
      (
        await call(a.adjudicator, `/items/${item.id}/adjudicate`, {
          expectedVersion: item.version,
          claimToken: item.claimToken,
          action: "finalize",
          scores,
          reason: "Resolved conflict",
          privacyReviewed: true,
        })
      ).status,
      201,
    );
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      409,
    );
    item = (await queue()).items[0];
    assert.equal(
      (
        await call(a.auditor, `/items/${item.id}/audit`, {
          expectedVersion: item.version,
          scores,
          independentHuman: true,
          reason: "Fresh decision audited",
        })
      ).status,
      201,
    );
    assert.equal(
      (await call(a.owner, "/releases", { privacyReviewed: true })).status,
      201,
    );
    const [persisted] = await db
      .select()
      .from(rubricItemsTable)
      .where(eq(rubricItemsTable.id, item.id));
    const state = structuredClone(persisted.state) as any;
    state.decision.id = randomUUID();
    await db
      .update(rubricItemsTable)
      .set({ state, version: persisted.version + 1 })
      .where(eq(rubricItemsTable.id, item.id));
    const forged = await call(a.owner, "/releases", { privacyReviewed: true });
    assert.equal(forged.status, 409);
    assert.match(forged.value.error, /provenance/);
    const tampered = structuredClone(persisted.state) as any;
    tampered.audits = [];
    await db
      .update(rubricItemsTable)
      .set({ state: tampered, version: persisted.version + 2 })
      .where(eq(rubricItemsTable.id, item.id));
    assert.match(
      (await call(a.owner, "/releases", { privacyReviewed: true })).value.error,
      /provenance/,
    );
  } finally {
    await f.close();
  }
});
