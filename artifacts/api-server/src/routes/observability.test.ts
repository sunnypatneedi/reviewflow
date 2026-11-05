import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import {
  db,
  pool,
  projectsTable,
  membershipsTable,
  tasksTable,
  jobsTable,
  auditsTable,
  auditItemsTable,
  auditDecisionsTable,
  exposuresTable,
  traceRecordsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
let server: Server, base: string;
const project = randomUUID(),
  foreign = randomUUID(),
  owner = randomUUID(),
  reviewer = randomUUID(),
  task = randomUUID();
before(async () => {
  assert.equal(
    process.env.REVIEWFLOW_ISOLATED_READY,
    "1",
    "requires synthetic disposable database harness",
  );
  await db.insert(projectsTable).values([
    { id: project, name: "synthetic-observability", ownerId: owner },
    { id: foreign, name: "synthetic-other", ownerId: "other" },
  ]);
  await db.insert(membershipsTable).values([
    { id: randomUUID(), projectId: project, userId: owner, role: "owner" },
    {
      id: randomUUID(),
      projectId: project,
      userId: reviewer,
      role: "reviewer",
    },
  ]);
  await db.insert(tasksTable).values([
    {
      id: task,
      projectId: project,
      externalId: "synthetic",
      question: "PRIVATE_SOURCE_SENTINEL",
      evidence: "PRIVATE_EVIDENCE_SENTINEL",
      candidateAnswer: "PRIVATE_ANSWER_SENTINEL",
      risk: "low",
      contentHash: "PRIVATE_HASH_SENTINEL",
    },
    {
      id: randomUUID(),
      projectId: foreign,
      externalId: "other",
      question: "foreign",
      evidence: "foreign",
      candidateAnswer: "foreign",
      risk: "low",
      contentHash: "foreign",
    },
  ]);
  await db.insert(jobsTable).values({
    id: randomUUID(),
    projectId: project,
    taskId: task,
    status: "failed",
    attempts: 3,
    lastError: "https://SECRET_PROVIDER_SENTINEL.invalid?key=secret",
  });
  await db.insert(traceRecordsTable).values([
    {
      id: randomUUID(),
      projectId: project,
      kind: "comparison",
      key: "test",
      payload: {
        review: {
          decision: "both_unacceptable",
          assisted: false,
          actor: "PRIVATE_REVIEWER_SENTINEL",
        },
        quality: { status: "passed" },
        evidence: "PRIVATE_TRACE_SENTINEL",
      },
    },
    ...[1, 2].map((n) => ({
      id: randomUUID(),
      projectId: project,
      kind: "release",
      key: `release${n}`,
      payload: {
        snapshot: { complete: [{ id: "PRIVATE_COMPARISON_SENTINEL" }] },
      },
    })),
  ]);
  const app = express();
  app.use(express.json());
  app.use(cookieParser("synthetic-observability-cookie"));
  app.locals.runtimeConfig = {
    appMode: "clerk",
    demoProjectCap: 1000,
    demoProjectCreationWindowMax: 1000,
    demoProjectCreationWindowSeconds: 60,
  };
  app.use((req, _res, next) => {
    const auth = () => ({
      userId: req.get("x-synthetic-user") ?? null,
      tokenType: "session_token",
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as any).auth = auth;
    next();
  });
  app.use((await import("./reviewflow")).default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/reviewflow/observability`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
const call = (actor = owner, selected = project) =>
  fetch(base, {
    headers: { "x-synthetic-user": actor, "x-reviewflow-project": selected },
  });
test("aggregate endpoint is project-scoped, private and refuses blind roles/assignments", async () => {
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = (await response.json()) as ReturnType<
    typeof import("../lib/observability").aggregateObservability
  >;
  assert.equal(data.pipeline.total, 1);
  assert.equal(data.operations.queue.failed, 1);
  assert.equal(data.operations.queue.retryAttempts, 2);
  assert.equal(data.preference.completed, 1);
  assert.equal(data.preference.audited, null);
  assert.equal(data.preference.released, 1);
  assert.equal(data.preference.releases, 2);
  assert.doesNotMatch(JSON.stringify(data), /SENTINEL/);
  assert.ok(!JSON.stringify(data).includes(owner));
  assert.ok(!JSON.stringify(data).includes(task));
  assert.equal((await call(owner, foreign)).status, 403);
  assert.equal((await call(reviewer)).status, 403);
  await db
    .update(membershipsTable)
    .set({ role: "auditor" })
    .where(
      and(
        eq(membershipsTable.projectId, project),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  assert.equal((await call(reviewer)).status, 403);
  await db
    .update(membershipsTable)
    .set({ role: "exporter" })
    .where(
      and(
        eq(membershipsTable.projectId, project),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  assert.equal((await call(reviewer)).status, 403);
  await db
    .update(membershipsTable)
    .set({ role: "adjudicator" })
    .where(
      and(
        eq(membershipsTable.projectId, project),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  assert.equal((await call(reviewer)).status, 200);
  await db
    .delete(membershipsTable)
    .where(
      and(
        eq(membershipsTable.projectId, project),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  assert.equal(
    (await call(reviewer)).status,
    403,
    "revoked access is rechecked",
  );
  const emptyId = randomUUID();
  await db
    .insert(projectsTable)
    .values({ id: emptyId, name: "synthetic-empty", ownerId: owner });
  await db.insert(membershipsTable).values({
    id: randomUUID(),
    projectId: emptyId,
    userId: owner,
    role: "owner",
  });
  const emptyResponse = await call(owner, emptyId);
  assert.equal(emptyResponse.status, 200);
  const empty = (await emptyResponse.json()) as any;
  assert.equal(empty.pipeline.total, 0);
  assert.equal(empty.pipeline.correctionRate, null);
  assert.equal(empty.operations.queue.queued, 0);
  assert.equal(empty.operations.live.averageLatencyMs, null);
  const completedAudit = randomUUID();
  await db.insert(auditsTable).values({
    id: completedAudit,
    projectId: project,
    status: "completed",
    sampleSize: 1,
    seed: "synthetic",
    samplingFrameHash: "synthetic",
    samplingFrame: {},
    independent: true,
    auditorId: "independent-synthetic",
  });
  await db.insert(auditDecisionsTable).values([
    {
      id: randomUUID(),
      auditId: completedAudit,
      auditItemId: "item1",
      taskId: task,
      auditorId: "one",
      label: "supported",
      included: true,
      selfCheck: false,
    },
    {
      id: randomUUID(),
      auditId: completedAudit,
      auditItemId: "item2",
      taskId: task,
      auditorId: "two",
      label: "supported",
      included: true,
      selfCheck: false,
    },
    {
      id: randomUUID(),
      auditId: completedAudit,
      auditItemId: "item3",
      taskId: "other",
      auditorId: "three",
      label: "supported",
      included: false,
      selfCheck: true,
    },
  ]);
  assert.equal(
    ((await (await call()).json()) as any).pipeline.audited,
    1,
    "multiple independent decisions count one task",
  );
  const auditId = randomUUID();
  await db.insert(auditsTable).values({
    id: auditId,
    projectId: project,
    status: "in_progress",
    sampleSize: 1,
    seed: "synthetic",
    samplingFrameHash: "synthetic",
    samplingFrame: {},
    independent: true,
    auditorId: owner,
  });
  await db.insert(auditItemsTable).values({
    id: randomUUID(),
    auditId,
    taskId: task,
    ordinal: 1,
    originalReviewId: "synthetic",
    originalReviewerId: "another",
    originalLabel: "supported",
    taskContentHash: "PRIVATE_HASH_SENTINEL",
  });
  assert.equal(
    (await call()).status,
    403,
    "even an owner must remain blind during independent audit assignment",
  );
  assert.equal(
    (
      await db
        .select()
        .from(exposuresTable)
        .where(eq(exposuresTable.projectId, project))
    ).length,
    0,
    "read-only aggregate must not contaminate blind exposure evidence",
  );
});
