import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  projectsTable,
  tasksTable,
  jobsTable,
  releasesTable,
  membershipsTable,
  rubricItemsTable,
} from "@workspace/db";
import {
  EvaluationWorker,
  MAX_ACTIVE_LIVE_JOBS_PER_PROJECT,
} from "../evaluation-worker";
import { simulated } from "../evaluation";
import { registerRubricRoutes } from "./rubrics";
import { registerTelemetryRoutes } from "./telemetry";
import { telemetrySnapshot } from "../lib/telemetry";
import type { ProjectRole } from "./authorization";

let server: Server, base: string;
before(async () => {
  assert.equal(
    process.env.REVIEWFLOW_ISOLATED_READY,
    "1",
    "Synthetic disposable database only",
  );
  process.env.APP_MODE = "demo";
  process.env.DEMO_PROJECT_CREATION_WINDOW_MAX = "100";
  process.env.SESSION_SECRET = "isolated-factory-pipeline-secret";
  process.env.LIVE_INFERENCE_ENABLED = "false";
  const { default: app } = await import("../app");
  server = await listen(app);
  base = origin(server) + "/api/reviewflow";
});
after(async () => {
  await close(server);
  await pool.end();
});
async function listen(app: express.Express) {
  return new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}
function origin(s: Server) {
  const a = s.address();
  assert.ok(a && typeof a !== "string");
  return `http://127.0.0.1:${a.port}`;
}
async function close(s: Server) {
  await new Promise<void>((resolve, reject) =>
    s.close((e) => (e ? reject(e) : resolve())),
  );
}
async function request(cookie: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: "http://127.0.0.1:5173",
      "x-reviewflow-csrf": "1",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: r.status, value, text, headers: r.headers };
}
async function evidenceFixture() {
  const boot = await request("", "/bootstrap");
  assert.equal(boot.status, 200, boot.text);
  const cookie = boot.headers.get("set-cookie")!.split(";", 1)[0],
    projectId = boot.value.projectId;
  await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
  const [task] = await db
    .insert(tasksTable)
    .values({
      id: randomUUID(),
      projectId,
      externalId: "synthetic",
      question: "Private synthetic question",
      evidence: "PRIVATE_SYNTHETIC_SNAPSHOT",
      candidateAnswer: "Synthetic answer",
      risk: "low",
      contentHash: randomUUID(),
    })
    .returning();
  const call = (path: string, body?: unknown) => request(cookie, path, body);
  const evaluate = (run: string) =>
    call("/evaluate", {
      taskIds: [task.id],
      mode: "demo",
      experimentRunId: run,
    });
  const current = async () => (await call("/tasks")).value[0];
  return { projectId, task, call, evaluate, current };
}

test("public experiment runs fence stale browsers, expose current jobs only, retry exact identities and freeze used release provenance", async () => {
  const f = await evidenceFixture();
  assert.equal((await f.evaluate("run-a")).status, 202);
  const worker = new EvaluationWorker({
    evaluate: async (task) => simulated(task),
  });
  assert.equal(await worker.runOnce(), true);
  const first = await f.current();
  assert.ok(first.proposal);
  assert.equal((await f.evaluate("run-a")).value.queued, 0);
  assert.equal((await f.current()).version, first.version);
  assert.equal((await f.evaluate("run-b")).status, 202);
  const second = await f.current();
  assert.ok(second.version > first.version);
  assert.equal(second.proposal, null);
  assert.equal(
    (
      await f.call("/reviews", {
        taskId: f.task.id,
        version: first.version,
        action: "accept",
        activeMs: 1,
      })
    ).status,
    409,
  );
  const url = `/evaluation-jobs?taskIds=${f.task.id}`;
  const current = (await f.call(url)).value,
    history = (await f.call(url + "&includeHistory=true")).value;
  assert.equal(current.length, 1);
  assert.equal(history.length, 2);
  assert.equal(current[0].evaluation.experiment_run_id, "run-b");
  assert.equal(current[0].current, true);
  assert.equal(history.filter((j: any) => !j.current).length, 1);
  assert.ok(!JSON.stringify(history).includes("PRIVATE_SYNTHETIC_SNAPSHOT"));
  const previous = history.find((j: any) => !j.current);
  await db
    .update(jobsTable)
    .set({ status: "failed", lastError: "synthetic failure" })
    .where(eq(jobsTable.taskId, f.task.id));
  assert.equal(
    (
      await f.call("/evaluation-jobs/retry", {
        taskId: f.task.id,
        mode: "demo",
        jobId: previous.id,
      })
    ).status,
    409,
  );
  const retried = await f.call("/evaluation-jobs/retry", {
    taskId: f.task.id,
    mode: "demo",
    jobId: current[0].id,
  });
  assert.equal(retried.status, 202, retried.text);
  assert.equal(await worker.runOnce(), true);
  const ready = await f.current();
  assert.ok(ready.proposal);
  assert.equal(
    (
      await f.call("/reviews", {
        taskId: f.task.id,
        version: ready.version,
        action: "accept",
        activeMs: 1,
      })
    ).status,
    200,
  );
  const release = await f.call("/releases", { name: "Synthetic current run" });
  assert.equal(release.status, 201, release.text);
  const bytes = (await f.call(`/releases/${release.value.id}/download`)).text;
  const row = JSON.parse(bytes.trim());
  assert.equal(row.provenance.evaluation.experiment_run_id, "run-b");
  assert.equal(
    row.provenance.evaluation.evaluation_id,
    current[0].evaluationId,
  );
  assert.ok(!bytes.includes("PRIVATE_SYNTHETIC_SNAPSHOT"));
  assert.equal(row.provenance.evaluation.snapshot, undefined);
  const [saved] = await db
    .select()
    .from(releasesTable)
    .where(eq(releasesTable.id, release.value.id));
  assert.deepEqual((saved.manifest as any).evaluation_ids, [
    current[0].evaluationId,
  ]);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    release.value.digest,
  );
  assert.equal(
    (await f.evaluate("run-c")).value.queued,
    0,
    "Finalized tasks are not reopened by inference",
  );
  assert.equal(
    (await f.call(`/releases/${release.value.id}/download`)).text,
    bytes,
  );
});

test("live admission counts distinct runs of one task and rolls back the entire over-cap identity", async () => {
  const f = await evidenceFixture();
  const { enqueueLiveJobsWithProjectLock } = await import("./reviewflow");
  // Queue only. Never instantiate a live worker or configure real credentials.
  try {
    for (let i = 0; i < MAX_ACTIVE_LIVE_JOBS_PER_PROJECT; i++)
      assert.equal(
        await enqueueLiveJobsWithProjectLock(
          f.projectId,
          [f.task.id],
          undefined,
          { experimentRunId: `cap-${i}` },
        ),
        1,
      );
    const [before] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(
      await enqueueLiveJobsWithProjectLock(
        f.projectId,
        [f.task.id],
        undefined,
        { experimentRunId: "over-cap" },
      ),
      null,
    );
    const [after] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(after.currentEvaluationId, before.currentEvaluationId);
    assert.equal(after.version, before.version);
    assert.equal(
      (
        await db
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.projectId, f.projectId))
      ).length,
      MAX_ACTIVE_LIVE_JOBS_PER_PROJECT,
    );
    assert.equal(
      await enqueueLiveJobsWithProjectLock(
        f.projectId,
        [f.task.id],
        undefined,
        { experimentRunId: `cap-${MAX_ACTIVE_LIVE_JOBS_PER_PROJECT - 1}` },
      ),
      0,
    );
  } finally {
    await db.delete(jobsTable).where(eq(jobsTable.projectId, f.projectId));
  }
});

const definition = {
  schemaVersion: 1,
  name: "Independent invariant rubric",
  criteria: [
    { id: "quality", label: "Quality", kind: "score", min: 0, max: 5 },
  ],
  minimumAudits: 1,
};
async function rubricFixture() {
  const projectId = randomUUID(),
    actors = {
      owner: randomUUID(),
      reviewer: randomUUID(),
      auditor: randomUUID(),
    };
  await db
    .insert(projectsTable)
    .values({
      id: projectId,
      name: "Synthetic independent invariants",
      ownerId: actors.owner,
    });
  await db
    .insert(membershipsTable)
    .values(
      Object.entries(actors).map(([role, userId]) => ({
        id: randomUUID(),
        projectId,
        role,
        userId,
      })),
    );
  const app = express();
  app.use(express.json());
  // Deliberately stale outer authorization: transactional role checks must still reject revocation.
  registerRubricRoutes(app, {
    ensureProject: async (req) => ({
      project: { id: projectId, mode: "demo" },
      userId: req.get("x-actor")!,
      role: Object.entries(actors).find(
        ([, id]) => id === req.get("x-actor"),
      )![0] as ProjectRole,
    }),
    identity: (req) => req.get("x-actor")!,
    requireProjectAccess: async () => true,
  });
  const s = await listen(app);
  const call = async (actor: string, path = "", body?: unknown) => {
    const r = await fetch(origin(s) + "/reviewflow/rubrics" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-actor": actor },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let value: any;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    return { status: r.status, value, text };
  };
  const items = async (actor = actors.owner) => (await call(actor)).value.items;
  return { projectId, actors, call, items, close: () => close(s) };
}

test("rubric writes reject membership revoked after a valid claim, despite stale middleware authorization", async () => {
  const f = await rubricFixture(),
    a = f.actors;
  try {
    const spec = await f.call(a.owner, "/specs", {
      definition,
      expectedRevision: 0,
    });
    assert.equal(spec.status, 201);
    assert.equal(
      (
        await f.call(a.owner, "/items", {
          rubricId: spec.value.id,
          items: [{ externalId: "one", content: "Synthetic source" }],
        })
      ).status,
      201,
    );
    let item = (await f.items())[0];
    assert.equal(
      (
        await f.call(a.reviewer, `/items/${item.id}/claim`, {
          expectedVersion: item.version,
        })
      ).status,
      201,
    );
    item = (await f.items(a.reviewer))[0];
    await db
      .delete(membershipsTable)
      .where(
        and(
          eq(membershipsTable.projectId, f.projectId),
          eq(membershipsTable.userId, a.reviewer),
        ),
      );
    const rejected = await f.call(a.reviewer, `/items/${item.id}/review`, {
      expectedVersion: item.version,
      claimToken: item.claimToken,
      action: "finalize",
      scores: { quality: 5 },
      privacyReviewed: true,
      reason: "Revoked reviewer",
    });
    assert.equal(rejected.status, 403, rejected.text);
    const [persisted] = await db
      .select()
      .from(rubricItemsTable)
      .where(eq(rubricItemsTable.id, item.id));
    assert.equal(persisted.version, item.version);
    assert.equal((persisted.state as any).decision, undefined);
    await db
      .delete(membershipsTable)
      .where(
        and(
          eq(membershipsTable.projectId, f.projectId),
          eq(membershipsTable.userId, a.owner),
        ),
      );
    assert.equal(
      (await f.call(a.owner, "/specs", { definition, expectedRevision: 1 }))
        .status,
      403,
    );
    assert.equal(
      (await f.call(a.owner, "/releases", { privacyReviewed: true })).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test("rubric stale decisions and cross-item forged lineage fail closed while prior release bytes remain immutable", async () => {
  const f = await rubricFixture(),
    a = f.actors;
  try {
    const spec = await f.call(a.owner, "/specs", {
      definition,
      expectedRevision: 0,
    });
    assert.equal(
      (
        await f.call(a.owner, "/items", {
          rubricId: spec.value.id,
          items: [
            { externalId: "one", content: "First synthetic source" },
            { externalId: "two", content: "Second synthetic source" },
          ],
        })
      ).status,
      201,
    );
    for (const original of await f.items()) {
      assert.equal(
        (
          await f.call(a.reviewer, `/items/${original.id}/claim`, {
            expectedVersion: original.version,
          })
        ).status,
        201,
      );
      const item = (await f.items(a.reviewer)).find(
        (i: any) => i.id === original.id,
      );
      const review = {
        expectedVersion: item.version,
        claimToken: item.claimToken,
        action: "finalize",
        scores: { quality: 5 },
        privacyReviewed: true,
        reason: "Independent synthetic review",
      };
      assert.equal(
        (await f.call(a.reviewer, `/items/${item.id}/review`, review)).status,
        201,
      );
      assert.equal(
        (await f.call(a.reviewer, `/items/${item.id}/review`, review)).status,
        409,
      );
      assert.equal(
        (
          await f.call(a.auditor, `/items/${item.id}/audit`, {
            expectedVersion: item.version,
            scores: { quality: 5 },
            independentHuman: true,
            reason: "Stale decision version",
          })
        ).status,
        409,
      );
      const ready = (await f.items()).find((i: any) => i.id === original.id);
      const audit = {
        expectedVersion: ready.version,
        scores: { quality: 5 },
        independentHuman: true,
        reason: "Independent synthetic audit",
      };
      assert.equal(
        (await f.call(a.auditor, `/items/${item.id}/audit`, audit)).status,
        201,
      );
      assert.equal(
        (await f.call(a.auditor, `/items/${item.id}/audit`, audit)).status,
        409,
      );
    }
    const release = await f.call(a.owner, "/releases", {
      privacyReviewed: true,
    });
    assert.equal(release.status, 201, release.text);
    const exported = await f.call(
      a.owner,
      `/releases/${release.value.id}/export`,
    );
    assert.equal(exported.status, 200);
    assert.equal(
      (
        await f.call(a.owner, "/specs", {
          definition: { ...definition, minimumAudits: 2 },
          expectedRevision: 1,
        })
      ).status,
      201,
    );
    const originals = await db
      .select()
      .from(rubricItemsTable)
      .where(eq(rubricItemsTable.projectId, f.projectId));
    const [one, two] = originals;
    // Both pointers are valid existing immutable decisions, but the second belongs to a different item.
    const state = structuredClone(one.state) as any;
    state.decision = structuredClone((two.state as any).decision);
    state.audits = structuredClone((two.state as any).audits);
    await db
      .update(rubricItemsTable)
      .set({ state, version: one.version + 1 })
      .where(eq(rubricItemsTable.id, one.id));
    const forged = await f.call(a.owner, "/releases", {
      privacyReviewed: true,
    });
    assert.equal(forged.status, 409, forged.text);
    assert.match(forged.value.error, /provenance/);
    assert.equal(
      (await f.call(a.owner, `/releases/${release.value.id}/export`)).text,
      exported.text,
    );
    assert.equal(
      createHash("sha256").update(exported.text).digest("hex"),
      release.value.sha256,
    );
  } finally {
    await f.close();
  }
});

test("telemetry late delivery repairs gaps without double counting and never crosses actor or project scope", async () => {
  const projectA = randomUUID(),
    projectB = randomUUID(),
    actorA = randomUUID(),
    actorB = randomUUID();
  await db.insert(projectsTable).values([
    { id: projectA, name: "Synthetic telemetry A", ownerId: actorA },
    { id: projectB, name: "Synthetic telemetry B", ownerId: actorA },
  ]);
  await db
    .insert(membershipsTable)
    .values(
      [projectA, projectB].flatMap((projectId) =>
        [actorA, actorB].map((userId) => ({
          id: randomUUID(),
          projectId,
          userId,
          role: "owner",
        })),
      ),
    );
  let project = projectA,
    actor = actorA;
  const app = express();
  app.use(express.json());
  registerTelemetryRoutes(app, {
    ensureProject: async () => ({ project: { id: project } }),
    identity: () => actor,
    requireProjectAccess: async () => true,
  });
  const s = await listen(app),
    url = origin(s) + "/reviewflow/telemetry";
  const context = async () =>
    (await (await fetch(url + "/context")).json()) as { scope: string };
  const event = (sequence: number, kind = "foreground") => ({
    id: `event-${sequence}`,
    session: "shared-session",
    sequence,
    kind,
    factory: "rubric",
    itemId: null,
    itemVersion: null,
    proposalId: null,
    visibleMs: kind === "foreground" ? 100 : 0,
    dropped: 0,
  });
  const send = (scope: string, events: unknown[]) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, events }),
    });
  try {
    const first = await context();
    assert.equal(
      (await send(first.scope, [event(3, "session_closed")])).status,
      202,
    );
    let snap = await telemetrySnapshot(projectA);
    assert.equal(snap.browser.missingSequences, 2);
    assert.equal(snap.browser.unclosedSessions, 0);
    assert.equal((await send(first.scope, [event(1), event(2)])).status, 202);
    assert.equal(
      (
        await send(first.scope, [
          event(1),
          event(2),
          event(3, "session_closed"),
        ])
      ).status,
      202,
    );
    snap = await telemetrySnapshot(projectA);
    assert.equal(snap.browser.missingSequences, 0);
    assert.equal(snap.browser.observedForegroundMs, 200);
    assert.equal(snap.browser.unclosedSessions, 0);
    project = projectB;
    assert.equal((await send(first.scope, [event(1)])).status, 409);
    const otherProject = await context();
    assert.notEqual(otherProject.scope, first.scope);
    assert.equal((await send(otherProject.scope, [event(1)])).status, 202);
    assert.equal(
      (await telemetrySnapshot(projectB)).browser.observedForegroundMs,
      100,
    );
    project = projectA;
    actor = actorB;
    assert.equal((await send(first.scope, [event(1)])).status, 409);
    const otherActor = await context();
    assert.notEqual(otherActor.scope, first.scope);
    assert.equal((await send(otherActor.scope, [event(1)])).status, 202);
    snap = await telemetrySnapshot(projectA);
    assert.equal(snap.browser.sessions, 2);
    assert.equal(snap.browser.observedForegroundMs, 300);
    await db
      .delete(membershipsTable)
      .where(
        and(
          eq(membershipsTable.projectId, projectA),
          eq(membershipsTable.userId, actorB),
        ),
      );
    assert.equal(
      (await send(otherActor.scope, [event(2)])).status,
      403,
      "Transactional scope check rejects revoked membership despite stale middleware",
    );
    assert.equal(
      (await telemetrySnapshot(projectA)).browser.observedForegroundMs,
      300,
    );
  } finally {
    await close(s);
  }
});
