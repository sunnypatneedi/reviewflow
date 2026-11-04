import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  factoryItemsTable,
  factoryPoliciesTable,
  pool,
  proposalsTable,
  tasksTable,
  membershipsTable,
} from "@workspace/db";
import { registerFactoryRoutes } from "./factories";
import { assertFactoryWork } from "../lib/factories";
import { roleAllows, type ProjectRole } from "./authorization";
import { EvaluationWorker } from "../evaluation-worker";
import { DEFAULT_FACTORY_POLICY } from "../lib/factory-engine";

type Session = { cookie: string; projectId: string };
// Simulated identities exercise the persisted role/assignment contract. They
// are not a substitute for real multi-account Clerk/session verification.
test("synthetic member roles, explicit owner reassignment and claim-token privacy", async () => {
  const s = await session();
  const owner = `owner-${randomUUID()}`,
    reviewer = `reviewer-${randomUUID()}`,
    adjudicator = `adjudicator-${randomUUID()}`;
  await db.insert(membershipsTable).values([
    { id: randomUUID(), projectId: s.projectId, userId: owner, role: "owner" },
    {
      id: randomUUID(),
      projectId: s.projectId,
      userId: reviewer,
      role: "reviewer",
    },
    {
      id: randomUUID(),
      projectId: s.projectId,
      userId: adjudicator,
      role: "adjudicator",
    },
  ]);
  const app = express(),
    router = Router();
  app.use(express.json());
  registerFactoryRoutes(router, {
    ensureProject: async (req) => {
      const userId = req.get("x-synthetic-user")!;
      const [membership] = await db
        .select()
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.projectId, s.projectId),
            eq(membershipsTable.userId, userId),
          ),
        );
      return {
        project: { id: s.projectId, mode: "demo" },
        userId,
        role: (membership?.role ?? null) as ProjectRole | null,
      };
    },
    identity: (req) => req.get("x-synthetic-user")!,
    requireProjectAccess: async (_req, res, context, roles) => {
      if (!context.role || !roleAllows(context.role, roles)) {
        res.status(403).json({ error: "Not permitted" });
        return false;
      }
      return true;
    },
  });
  app.use(router);
  const memberServer = await new Promise<Server>((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  const address = memberServer.address();
  assert.ok(address && typeof address !== "string");
  const memberCall = (actor: string, path: string, body?: unknown) =>
    fetch(
      `http://127.0.0.1:${address.port}/reviewflow/factories/evidence${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-synthetic-user": actor,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
  try {
    assert.equal((await memberCall("outsider", "")).status, 403);
    const queue = (await (await memberCall(owner, "")).json()) as any,
      item = queue.items[0];
    assert.equal(
      (
        await memberCall(reviewer, "/policy", {
          expectedRevision: 0,
          definition: DEFAULT_FACTORY_POLICY,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await memberCall(reviewer, `/items/${item.id}/quarantine`, {
          expectedRevision: 0,
          quarantined: true,
          reason: "Hold",
        })
      ).status,
      403,
    );
    const assigned = await memberCall(owner, `/items/${item.id}/claim`, {
      expectedVersion: item.version,
      assignedTo: reviewer,
    });
    assert.equal(assigned.status, 201);
    assert.equal(
      ((await assigned.json()) as any).claimToken,
      null,
      "Owner cannot use another assignee's fencing token",
    );
    const claimed = (
      (await (await memberCall(reviewer, "")).json()) as any
    ).items.find((row: any) => row.id === item.id);
    assert.ok(claimed.claimToken);
    const ownerView = (
      (await (await memberCall(owner, "")).json()) as any
    ).items.find((row: any) => row.id === item.id);
    assert.equal(ownerView.claimToken, null);
    assert.equal(
      (
        await memberCall(reviewer, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
          assignedTo: adjudicator,
          claimToken: claimed.claimToken,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await memberCall(owner, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
          assignedTo: adjudicator,
          reassign: true,
          expectedRevision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await memberCall(owner, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
          assignedTo: adjudicator,
          reassign: true,
          expectedRevision: claimed.controlRevision,
        })
      ).status,
      201,
    );
    await assert.rejects(
      () =>
        db.transaction((tx) =>
          assertFactoryWork(tx, {
            projectId: s.projectId,
            factory: "evidence",
            itemId: item.id,
            actorId: reviewer,
            claimToken: claimed.claimToken,
          }),
        ),
      /another reviewer/,
    );
    const reassigned = (
      (await (await memberCall(adjudicator, "")).json()) as any
    ).items.find((row: any) => row.id === item.id);
    await db.transaction((tx) =>
      assertFactoryWork(tx, {
        projectId: s.projectId,
        factory: "evidence",
        itemId: item.id,
        actorId: adjudicator,
        claimToken: reassigned.claimToken,
      }),
    );
  } finally {
    await new Promise<void>((resolve) => memberServer.close(() => resolve()));
  }
});
let server: Server, base: string;
async function call(session: Session | null, path: string, body?: unknown) {
  return fetch(`${base}/api/reviewflow${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-reviewflow-csrf": "1",
      "content-type": "application/json",
      ...(session ? { cookie: session.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function session() {
  const response = await call(null, "/bootstrap");
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
  const id = /^s:([^.]+)\./.exec(
    decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)),
  )![1];
  return { cookie, projectId: `demo:${id}` };
}
before(async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  process.env.APP_MODE = "demo";
  process.env.LIVE_INFERENCE_ENABLED = "false";
  process.env.DEMO_PROJECT_CREATION_WINDOW_MAX = "100";
  process.env.SESSION_SECRET = "factory-isolated-test-secret";
  process.env.NODE_ENV = "test";
  const { default: app } = await import("../app");
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("factory policy and work claims reject concurrent writes, stale tokens and expired claims", async () => {
  const s = await session();
  const queue = (await (await call(s, "/factories/evidence")).json()) as any;
  const item = queue.items[0];
  assert.equal(item.lane, "human_review");
  const updates = await Promise.all(
    [1, 2].map(() =>
      call(s, "/factories/evidence/policy", {
        expectedRevision: 0,
        definition: { ...DEFAULT_FACTORY_POLICY, requireAssignments: true },
      }),
    ),
  );
  assert.deepEqual(updates.map((row) => row.status).sort(), [201, 409]);
  assert.equal(
    (
      await db
        .select()
        .from(factoryPoliciesTable)
        .where(eq(factoryPoliciesTable.projectId, s.projectId))
    ).length,
    1,
  );
  const review = {
    taskId: item.id,
    version: item.version,
    action: "label",
    correctedLabel: "supported",
    reason: "Synthetic evidence checked",
    activeMs: 10,
  };
  assert.equal((await call(s, "/reviews", review)).status, 409);
  const claims = await Promise.all(
    [1, 2].map(() =>
      call(s, `/factories/evidence/items/${item.id}/claim`, {
        expectedVersion: item.version,
      }),
    ),
  );
  assert.deepEqual(claims.map((row) => row.status).sort(), [201, 409]);
  const claim = (await claims.find((row) => row.status === 201)!.json()) as any;
  const renewed = await call(s, `/factories/evidence/items/${item.id}/claim`, {
    expectedVersion: item.version,
    claimToken: claim.claimToken,
  });
  assert.equal(renewed.status, 201);
  const nextClaim = (await renewed.json()) as any;
  assert.notEqual(nextClaim.claimToken, claim.claimToken);
  assert.equal(
    (await call(s, "/reviews", { ...review, claimToken: claim.claimToken }))
      .status,
    409,
  );
  await db
    .update(factoryItemsTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(factoryItemsTable.projectId, s.projectId),
        eq(factoryItemsTable.itemId, item.id),
      ),
    );
  assert.equal(
    (await call(s, "/reviews", { ...review, claimToken: nextClaim.claimToken }))
      .status,
    409,
  );
  const reclaimed = (await (
    await call(s, `/factories/evidence/items/${item.id}/claim`, {
      expectedVersion: item.version,
    })
  ).json()) as any;
  assert.equal(
    (await call(s, "/reviews", { ...review, claimToken: reclaimed.claimToken }))
      .status,
    200,
  );
  const other = await session();
  assert.equal(
    (
      await call(other, `/factories/evidence/items/${item.id}/claim`, {
        expectedVersion: item.version,
      })
    ).status,
    404,
  );
});

test("human-only evidence decisions release without fabricating model provenance; quarantine blocks work and exports", async () => {
  const s = await session();
  let queue = (await (await call(s, "/factories/evidence")).json()) as any;
  const item = queue.items[0];
  const quarantinePath = `/factories/evidence/items/${item.id}/quarantine`;
  assert.equal(
    (
      await call(s, quarantinePath, {
        expectedRevision: 0,
        quarantined: true,
        reason: "Synthetic privacy check",
      })
    ).status,
    200,
  );
  const review = {
    taskId: item.id,
    version: item.version,
    action: "label",
    correctedLabel: "supported",
    reason: "Synthetic evidence checked",
    activeMs: 1,
  };
  assert.equal((await call(s, "/reviews", review)).status, 409);
  assert.equal(
    (await call(s, "/evaluate", { taskIds: [item.id], mode: "demo" })).status,
    409,
  );
  assert.equal(
    (await call(s, "/releases", { name: "Blocked hold" })).status,
    409,
  );
  assert.equal(
    (
      await call(s, quarantinePath, {
        expectedRevision: 0,
        quarantined: false,
        reason: "Stale update",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(s, quarantinePath, {
        expectedRevision: 1,
        quarantined: false,
        reason: "Synthetic hold resolved",
      })
    ).status,
    200,
  );
  for (const action of ["accept", "correct"]) {
    assert.equal(
      (await call(s, "/reviews", { ...review, action })).status,
      409,
      "Proposal-dependent actions must fail before finalizing a proposal-less task",
    );
    const [unchanged] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, item.id));
    assert.equal(unchanged.status, "pending");
    assert.equal(unchanged.version, item.version);
  }
  for (const row of queue.items)
    assert.equal(
      (
        await call(s, "/reviews", {
          ...review,
          taskId: row.id,
          version: row.version,
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await call(s, "/releases", {
        name: "Unreviewed source",
        includeSourceText: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(s, "/releases", {
        name: "Reviewed synthetic source",
        includeSourceText: true,
        privacyReviewed: true,
      })
    ).status,
    201,
  );
  const released = await call(s, "/releases", { name: "Synthetic human-only" });
  assert.equal(released.status, 201, await released.clone().text());
  const release = (await released.json()) as any;
  const before = await (
    await call(s, `/releases/${release.id}/download`)
  ).text();
  const lines = before
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  assert.equal(lines.length, 20);
  assert.ok(
    lines.every(
      (row) =>
        row.provenance.model === null &&
        row.provenance.proposal_id === null &&
        row.provenance.review_mode === "human_only" &&
        row.provenance.factory_policy_revision === 0,
    ),
  );
  queue = (await (await call(s, "/factories/evidence")).json()) as any;
  assert.equal(
    (
      await call(s, quarantinePath, {
        expectedRevision: queue.items.find((row: any) => row.id === item.id)
          .controlRevision,
        quarantined: true,
        reason: "Recheck after frozen release",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(s, "/releases", { name: "Held new snapshot" })).status,
    409,
  );
  assert.equal(
    await (await call(s, `/releases/${release.id}/download`)).text(),
    before,
    "Existing releases remain immutable",
  );
});

test("preference factory shares claims and quarantine gates while keeping queue metadata blind", async () => {
  const s = await session();
  const document = {
    schemaVersion: 1,
    runs: ["a", "b"].map((id, index) => ({
      id,
      scenarioId: "factory-synthetic-case",
      groupId: "family",
      task: "Pick an observed color",
      decisionPoint: "turn-1",
      context: {
        complete: true,
        messages: [{ role: "user", content: "Name a color" }],
        tools: [],
        parameters: {},
      },
      response: index ? "blue" : "green",
      events: [{ sequence: 0, observation: "color chart" }],
      provenance: { source: "synthetic-private-path" },
      candidateIdentity: `synthetic-candidate-${id}`,
      kind: "scripted",
    })),
  };
  assert.equal((await call(s, "/traces/imports", { document })).status, 201);
  let queue = (await (await call(s, "/factories/preference")).json()) as any;
  assert.equal(queue.items.length, 1);
  assert.equal(
    JSON.stringify(queue.items).includes("synthetic-candidate"),
    false,
  );
  assert.equal(
    JSON.stringify(queue.items).includes("synthetic-private-path"),
    false,
  );
  const item = queue.items[0],
    path = `/traces/comparisons/${item.id}`;
  assert.equal(
    (
      await call(s, "/factories/preference/policy", {
        expectedRevision: 0,
        definition: {
          ...DEFAULT_FACTORY_POLICY,
          assistanceAllowed: false,
          requireAssignments: true,
        },
      })
    ).status,
    201,
  );
  const review = {
    decision: "a",
    expectedVersion: 1,
    evidenceRefs: [],
    effort: { activeMs: 10 },
  };
  assert.equal((await call(s, `${path}/reviews`, review)).status, 409);
  const claim = (await (
    await call(s, `/factories/preference/items/${item.id}/claim`, {
      expectedVersion: 1,
    })
  ).json()) as any;
  assert.equal(
    (
      await call(s, `${path}/proposals`, {
        provider: "simulator",
        claimToken: claim.claimToken,
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(s, `${path}/reveal`, { claimToken: claim.claimToken })).status,
    403,
  );
  const reviewed = await call(s, `${path}/reviews`, {
    ...review,
    claimToken: claim.claimToken,
  });
  assert.equal(reviewed.status, 200);
  const value = (await reviewed.json()) as any;
  assert.equal(value.review.assisted, false);
  assert.equal(value.review.factoryPolicyRevision, 1);
  await db
    .update(factoryItemsTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(factoryItemsTable.projectId, s.projectId),
        eq(factoryItemsTable.itemId, item.id),
      ),
    );
  const reclaimed = await call(
    s,
    `/factories/preference/items/${item.id}/claim`,
    { expectedVersion: value.version },
  );
  assert.equal(
    reclaimed.status,
    201,
    "Reviewed comparisons can be claimed for quality checking and corrections",
  );
  const currentClaim = (await reclaimed.json()) as any;
  const quality = await call(s, `${path}/quality`, {
    status: "passed",
    note: "Synthetic evidence and privacy checked",
    expectedVersion: value.version,
    claimToken: currentClaim.claimToken,
  });
  assert.equal(quality.status, 200);
  queue = (await (await call(s, "/factories/preference")).json()) as any;
  assert.equal(
    (
      await call(s, `/factories/preference/items/${item.id}/quarantine`, {
        expectedRevision: queue.items[0].controlRevision,
        quarantined: true,
        reason: "Synthetic hold",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(s, "/traces/releases", { name: "Blocked preference export" }))
      .status,
    409,
  );
  assert.equal((await call(s, "/traces/labelstudio")).status, 409);
  assert.equal(
    (
      await call(s, `${path}/reviews`, {
        ...review,
        expectedVersion: value.version,
        claimToken: currentClaim.claimToken,
      })
    ).status,
    409,
  );
});

test("a late evaluation result cannot bypass quarantine or a disabled assistance policy", async () => {
  const s = await session();
  const queue = (await (await call(s, "/factories/evidence")).json()) as any;
  const item = queue.items[0];
  assert.equal(
    (await call(s, "/evaluate", { taskIds: [item.id], mode: "demo" })).status,
    202,
  );
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const worker = new EvaluationWorker({
    evaluate: async () => {
      entered();
      await waiting;
      return {
        label: "supported",
        probabilities: {
          supported: 1,
          contradicted: 0,
          insufficient_evidence: 0,
        },
        labelProbability: 1,
        injection: 0,
        complexity: 1,
        confidence: 1,
        latencyMs: 1,
      };
    },
  });
  const running = worker.runOnce();
  await started;
  assert.equal(
    (
      await call(s, `/factories/evidence/items/${item.id}/quarantine`, {
        expectedRevision: 0,
        quarantined: true,
        reason: "Hold while provider runs",
      })
    ).status,
    200,
  );
  finish();
  await running;
  assert.equal(
    (
      await db
        .select()
        .from(proposalsTable)
        .where(eq(proposalsTable.taskId, item.id))
    ).length,
    0,
  );
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, item.id));
  assert.equal(task.status, "pending");
  assert.equal(
    (
      await call(s, "/factories/evidence/policy", {
        expectedRevision: 0,
        definition: { ...DEFAULT_FACTORY_POLICY, assistanceAllowed: false },
      })
    ).status,
    201,
  );
  assert.equal(
    (await call(s, "/evaluate", { taskIds: [queue.items[1].id], mode: "demo" }))
      .status,
    409,
  );
});
