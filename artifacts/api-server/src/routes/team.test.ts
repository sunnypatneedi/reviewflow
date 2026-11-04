import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import {
  db,
  pool,
  factoryItemsTable,
  membershipsTable,
  tasksTable,
  exposuresTable,
  projectsTable,
  auditsTable,
  auditItemsTable,
  auditDecisionsTable,
} from "@workspace/db";
import { DEFAULT_FACTORY_POLICY } from "../lib/factory-engine";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reserveJevCall, finishJevCall, jevBudget } from "../lib/jev-budget";
import { FactoryError } from "../lib/factory-engine";
let server: Server, base: string, projectId: string;
const owner = "synthetic-owner-" + randomUUID(),
  reviewer = "synthetic-reviewer-" + randomUUID(),
  auditor = "synthetic-auditor-" + randomUUID(),
  exporter = "synthetic-exporter-" + randomUUID();
before(async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  const app = express();
  app.use(express.json());
  app.use(cookieParser("synthetic-team-cookie"));
  app.locals.runtimeConfig = {
    appMode: "clerk",
    liveInferenceEnabled: true,
    demoProjectCap: 1000,
    demoProjectCreationWindowMax: 1000,
    demoProjectCreationWindowSeconds: 60,
  };
  // Explicit test-only authentication stub; production has no header auth mode.
  app.use((req, _res, next) => {
    const auth = () => ({
      userId: req.get("x-synthetic-user") ?? null,
      tokenType: "session_token",
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as any).auth = auth;
    next();
  });
  const { default: router } = await import("./reviewflow");
  app.use(router);
  app.use(((
    error: unknown,
    _req: unknown,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (error instanceof FactoryError)
      res.status(error.status).json({ error: error.message });
    else next(error);
  }) as express.ErrorRequestHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = "http://127.0.0.1:" + address.port + "/reviewflow";
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
async function call(
  actor: string,
  path: string,
  body?: unknown,
  selected = projectId,
) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-synthetic-user": actor,
      ...(selected ? { "x-reviewflow-project": selected } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("concurrent first sign-in provisions one complete personal project", async () => {
  const actor = "synthetic-first-" + randomUUID();
  const responses = await Promise.all([
    call(actor, "/projects", undefined, ""),
    call(actor, "/projects", undefined, ""),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  const lists = await Promise.all(
    responses.map((response) => response.json() as Promise<any[]>),
  );
  assert.equal(lists[0].length, 1);
  assert.equal(lists[0][0].id, lists[1][0].id);
});
test("synthetic multiplayer: shared selection, owner roles, blind auditor, exporter and revocation", async () => {
  const created = await call(
    owner,
    "/projects",
    { name: "Synthetic shared project" },
    "",
  );
  assert.equal(created.status, 201, await created.clone().text());
  projectId = ((await created.json()) as any).id;
  for (const [userId, role] of [
    [reviewer, "reviewer"],
    [auditor, "auditor"],
    [exporter, "exporter"],
  ])
    assert.equal(
      (await call(owner, "/members", { userId, role, expectedRevision: -1 }))
        .status,
      200,
    );
  assert.equal(
    (
      await call(owner, "/members", {
        userId: owner,
        role: "revoked",
        expectedRevision: 0,
      })
    ).status,
    409,
    "Last owner cannot be revoked",
  );
  assert.equal(
    (
      await call(reviewer, "/members", {
        userId: owner,
        role: "revoked",
        expectedRevision: 0,
      })
    ).status,
    403,
  );
  const listed = (await (await call(reviewer, "/projects")).json()) as any[];
  assert.ok(listed.some((row) => row.id === projectId));
  assert.equal(
    (await call("outsider-" + randomUUID(), "/bootstrap")).status,
    403,
  );
  assert.equal(
    (
      await call(owner, "/tasks/import", {
        tasks: [
          {
            externalId: "team-1",
            question: "Return window?",
            evidence: "30 days",
            candidateAnswer: "30 days",
            risk: "low",
          },
        ],
      })
    ).status,
    200,
  );
  const task = ((await (await call(reviewer, "/tasks")).json()) as any[])[0];
  const claimPath = "/factories/evidence/items/" + task.id + "/claim";
  const claim = (await (
    await call(owner, claimPath, {
      expectedVersion: task.version,
      assignedTo: reviewer,
    })
  ).json()) as any;
  assert.equal(claim.claimToken, null);
  const queue = (await (
    await call(reviewer, "/factories/evidence")
  ).json()) as any;
  assert.equal(
    (
      await call(reviewer, "/reviews", {
        taskId: task.id,
        version: task.version,
        action: "label",
        correctedLabel: "supported",
        reason: "Synthetic source checked",
        activeMs: 10,
        claimToken: queue.items[0].claimToken,
      })
    ).status,
    200,
  );
  assert.equal((await call(auditor, "/tasks")).status, 403);
  assert.deepEqual(
    ((await (await call(auditor, "/bootstrap")).json()) as any).tasks,
    [],
  );
  assert.equal((await call(owner, "/tasks")).status, 200);
  assert.equal(
    (await call(owner, "/audits", { sampleSize: 1, independent: true })).status,
    409,
    "Prior decision exposure prevents independent audit",
  );
  const auditResponse = await call(auditor, "/audits", {
    sampleSize: 1,
    independent: true,
    required: true,
    seed: "synthetic-team",
  });
  assert.equal(auditResponse.status, 201, await auditResponse.clone().text());
  const audit = (await auditResponse.json()) as any,
    auditPath = "/audits/" + audit.id;
  const view = (await (await call(auditor, auditPath)).json()) as any;
  assert.equal(view.items[0].originalLabel, undefined);
  assert.equal(view.items[0].proposal, undefined);
  const auditQueue = (await (
    await call(auditor, "/factories/evidence")
  ).json()) as any;
  assert.equal(auditQueue.items.length, 1);
  assert.equal(auditQueue.items[0].workKind, "audit");
  assert.equal(
    (await call(auditor, "/releases", { name: "Forbidden" })).status,
    403,
  );
  assert.equal(
    (
      await call(auditor, auditPath + "/decisions", {
        auditItemId: view.items[0].id,
        label: "supported",
        reason: "Synthetic blind check",
      })
    ).status,
    201,
  );
  const released = await call(exporter, "/releases", {
    name: "Synthetic independently checked",
  });
  assert.equal(released.status, 201, await released.clone().text());
  const release = (await released.json()) as any;
  assert.equal(
    (await call(exporter, "/releases/" + release.id + "/download")).status,
    200,
  );
  assert.equal(
    (await call(auditor, "/releases/" + release.id + "/download")).status,
    403,
  );
  assert.equal(
    (
      await call(owner, "/members", {
        userId: reviewer,
        role: "revoked",
        expectedRevision: 0,
      })
    ).status,
    200,
  );
  assert.equal((await call(reviewer, "/bootstrap")).status, 403);
  const [control] = await db
    .select()
    .from(factoryItemsTable)
    .where(
      and(
        eq(factoryItemsTable.projectId, projectId),
        eq(factoryItemsTable.itemId, task.id),
      ),
    );
  assert.equal(control.claimToken, null);
});
test("Jev is off by default and atomic lifetime reservations include failures and concurrent calls", async () => {
  assert.equal((await jevBudget(projectId)).enabled, false);
  await assert.rejects(
    reserveJevCall(projectId, "test", "synthetic-item", async () => {}),
    /disabled/,
  );
  assert.equal(
    (
      await call(reviewer, "/jev", {
        expectedRevision: 0,
        enabled: true,
        maxCalls: 2,
        ownerConsent: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(owner, "/jev", {
        expectedRevision: 0,
        enabled: true,
        maxCalls: 2,
        ownerConsent: true,
      })
    ).status,
    200,
  );
  const raced = await Promise.allSettled(
    [1, 2, 3].map((index) =>
      reserveJevCall(projectId, "mock-only", "synthetic-" + index, async () => {}),
    ),
  );
  assert.equal(raced.filter((value) => value.status === "fulfilled").length, 2);
  assert.equal(raced.filter((value) => value.status === "rejected").length, 1);
  for (const value of raced)
    if (value.status === "fulfilled")
      await finishJevCall(value.value, "failed");
  const budget = await jevBudget(projectId);
  assert.equal(budget.used, 2);
  assert.equal(budget.remaining, 0);
  assert.equal(
    (
      await call(owner, "/jev", {
        expectedRevision: budget.revision,
        enabled: false,
        maxCalls: 1,
      })
    ).status,
    409,
  );
  const plan = (await (
    await call(owner, "/jev/evaluation-plan")
  ).json()) as any;
  assert.equal(plan.qualification, "not_run");
  assert.equal(plan.automaticAcceptance, false);
});

test("concurrent budget updates do not exhaust the connection pool", async () => {
  const current = await jevBudget(projectId);
  const responses = await Promise.race([
    Promise.all(
      Array.from({ length: 10 }, () =>
        call(owner, "/jev", {
          expectedRevision: current.revision,
          enabled: false,
          maxCalls: current.maxCalls,
        }),
      ),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Concurrent budget update stalled")),
        5000,
      ).unref(),
    ),
  ]);
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    1,
  );
  assert.equal(
    responses.filter((response) => response.status === 409).length,
    9,
  );
});

test("adjudication label views and audit outcomes prevent later falsely independent audits", async () => {
  const nextAuditor = "synthetic-next-auditor-" + randomUUID(),
    observer = "synthetic-observer-" + randomUUID(),
    resolver = "synthetic-resolver-" + randomUUID();
  for (const [userId, role] of [
    [nextAuditor, "auditor"],
    [observer, "adjudicator"],
    [resolver, "adjudicator"],
  ])
    assert.equal(
      (await call(owner, "/members", { userId, role, expectedRevision: -1 }))
        .status,
      200,
    );
  const auditResponse = await call(nextAuditor, "/audits", {
    sampleSize: 1,
    independent: true,
    seed: "synthetic-dispute",
  });
  assert.equal(auditResponse.status, 201, await auditResponse.clone().text());
  const audit = (await auditResponse.json()) as any,
    path = "/audits/" + audit.id;
  const view = (await (await call(nextAuditor, path)).json()) as any;
  const decision = (await (
    await call(nextAuditor, path + "/decisions", {
      auditItemId: view.items[0].id,
      label: "contradicted",
      reason: "Synthetic disagreement",
    })
  ).json()) as any;
  assert.equal(
    (await call(nextAuditor, "/audits", { sampleSize: 1, independent: true }))
      .status,
    409,
    "Audit result status itself can reveal agreement with the original label",
  );
  const observed = await call(observer, path + "/adjudication");
  assert.equal(observed.status, 200);
  assert.equal(
    (await call(observer, "/audits", { sampleSize: 1, independent: true }))
      .status,
    409,
  );
  assert.equal(
    (
      await call(
        resolver,
        path + "/disputes/" + decision.disputeId + "/adjudicate",
        { resolvedLabel: "supported", reason: "Synthetic resolution" },
      )
    ).status,
    200,
  );
  const ledger = await db
    .select()
    .from(exposuresTable)
    .where(
      and(
        eq(exposuresTable.projectId, projectId),
        eq(exposuresTable.actorId, resolver),
      ),
    );
  assert.equal(
    ledger.length,
    1,
    "Label-bearing adjudication response is recorded",
  );
});

test("operation-specific authority is rechecked after a concurrent owner demotion", async () => {
  const restored = await call(owner, "/members", {
    userId: reviewer,
    role: "reviewer",
    expectedRevision: 1,
  });
  assert.equal(restored.status, 200);
  assert.equal(
    (
      await call(owner, "/tasks/import", {
        tasks: [
          {
            externalId: "demotion-1",
            question: "Q",
            evidence: "E",
            candidateAnswer: "A",
            risk: "high",
          },
        ],
      })
    ).status,
    200,
  );
  const task = ((await (await call(owner, "/tasks")).json()) as any[]).find(
    (task) => task.externalId === "demotion-1",
  );
  assert.equal(
    (
      await call(owner, "/factories/evidence/policy", {
        expectedRevision: 0,
        definition: { ...DEFAULT_FACTORY_POLICY, highRiskLane: "escalation" },
      })
    ).status,
    201,
  );
  async function demotedRequest(path: string, body: unknown) {
    const original = db.transaction;
    let changed = false;
    (db as any).transaction = async (...args: any[]) => {
      (db as any).transaction = original;
      changed = true;
      await db
        .update(membershipsTable)
        .set({ role: "reviewer" })
        .where(
          and(
            eq(membershipsTable.projectId, projectId),
            eq(membershipsTable.userId, owner),
          ),
        );
      return (original as any).apply(db, args);
    };
    try {
      const response = await call(owner, path, body);
      assert.ok(changed);
      assert.equal(response.status, 403, await response.clone().text());
    } finally {
      (db as any).transaction = original;
      await db
        .update(membershipsTable)
        .set({ role: "owner" })
        .where(
          and(
            eq(membershipsTable.projectId, projectId),
            eq(membershipsTable.userId, owner),
          ),
        );
    }
  }
  await demotedRequest("/reviews", {
    taskId: task.id,
    version: task.version,
    action: "label",
    correctedLabel: "supported",
    reason: "Synthetic escalation resolution",
    activeMs: 1,
  });
  const [unchanged] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(unchanged.status, "pending");
  await demotedRequest("/factories/evidence/items/" + task.id + "/claim", {
    expectedVersion: task.version,
    assignedTo: reviewer,
  });
});

test("global project discovery works after personal-project membership is revoked", async () => {
  const personal = "user:" + owner,
    secondOwner = "synthetic-personal-owner-" + randomUUID();
  assert.equal(
    (
      await call(
        owner,
        "/members",
        { userId: secondOwner, role: "owner", expectedRevision: -1 },
        personal,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        owner,
        "/members",
        { userId: owner, role: "revoked", expectedRevision: 0 },
        personal,
      )
    ).status,
    200,
  );
  const listed = await call(owner, "/projects");
  assert.equal(listed.status, 200);
  assert.ok(
    ((await listed.json()) as any[]).some(
      (project) => project.id === projectId,
    ),
  );
  assert.equal(
    (
      await call(owner, "/projects", {
        name: "Synthetic new project after personal revocation",
      })
    ).status,
    201,
  );
});
test("untracked legacy exposure history cannot qualify a new independent release", async () => {
  await db
    .update(projectsTable)
    .set({ exposureTrackingEnabled: false })
    .where(eq(projectsTable.id, projectId));
  try {
    const audit = await call(owner, "/audits", {
      sampleSize: 1,
      independent: true,
    });
    assert.equal(audit.status, 409);
    assert.match(((await audit.json()) as any).error, /predates tracking/);
    const release = await call(owner, "/releases", {
      name: "Blocked legacy qualification",
    });
    assert.equal(release.status, 409);
    assert.match(((await release.json()) as any).error, /predates tracking/);
  } finally {
    await db
      .update(projectsTable)
      .set({ exposureTrackingEnabled: true })
      .where(eq(projectsTable.id, projectId));
  }
});
test("overlapping audit assignments cannot reuse an auditor after learning an outcome", async () => {
  const actor = "synthetic-overlap-" + randomUUID();
  assert.equal(
    (
      await call(owner, "/members", {
        userId: actor,
        role: "auditor",
        expectedRevision: -1,
      })
    ).status,
    200,
  );
  const firstResponse = await call(actor, "/audits", {
    sampleSize: 1,
    independent: true,
    seed: "overlap",
  });
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()) as any;
  assert.equal(
    (
      await call(actor, "/audits", {
        sampleSize: 1,
        independent: true,
        seed: "overlap-again",
      })
    ).status,
    409,
    "Only one independent assignment may be active per actor and project",
  );
  const [audit] = await db
    .select()
    .from(auditsTable)
    .where(eq(auditsTable.id, first.id));
  const [item] = await db
    .select()
    .from(auditItemsTable)
    .where(eq(auditItemsTable.auditId, first.id));
  // Simulates an already-stored overlapping assignment from before the guard.
  const secondId = randomUUID(),
    secondItemId = randomUUID();
  await db
    .insert(auditsTable)
    .values({ ...audit, id: secondId, required: false });
  await db
    .insert(auditItemsTable)
    .values({ ...item, id: secondItemId, auditId: secondId });
  assert.equal(
    (
      await call(actor, "/audits/" + first.id + "/decisions", {
        auditItemId: item.id,
        label: item.originalLabel,
      })
    ).status,
    201,
  );
  const second = await call(actor, "/audits/" + secondId + "/decisions", {
    auditItemId: secondItemId,
    label: item.originalLabel,
  });
  assert.equal(second.status, 409);
  assert.match(((await second.json()) as any).error, /not accessed/);
  assert.equal(
    (
      await db
        .select()
        .from(auditDecisionsTable)
        .where(eq(auditDecisionsTable.auditId, secondId))
    ).length,
    0,
  );
});

test("signed-out Clerk requests cannot provision a demo project or receive a demo cookie", async () => {
  const before = await db.select({ id: projectsTable.id }).from(projectsTable);
  const denied = await call("", "/bootstrap", undefined, "");
  assert.equal(denied.status, 401); assert.equal(denied.headers.get("set-cookie"), null);
  assert.equal((await db.select({ id: projectsTable.id }).from(projectsTable)).length, before.length);
  const authenticated = await call(owner, "/context");
  assert.equal(authenticated.status, 200); assert.equal(authenticated.headers.get("set-cookie"), null);
});
