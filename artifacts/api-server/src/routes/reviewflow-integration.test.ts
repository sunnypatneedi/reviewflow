import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Express } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  auditDecisionsTable,
  auditDisputesTable,
  auditItemsTable,
  auditsTable,
  db,
  eventsTable,
  jobsTable,
  pool,
  projectsTable,
  proposalsTable,
  reviewsTable,
  tasksTable,
} from "@workspace/db";

let server: Server;
let baseUrl: string;
let app: Express;

type Session = { cookie: string; projectId: string };

async function request(
  path: string,
  options: { session?: Session; method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-reviewflow-csrf": "1",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.session ? { cookie: options.session.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function createSession(): Promise<Session> {
  const response = await request("/reviewflow/bootstrap");
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";", 1)[0];
  const signedValue = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const demoId = /^s:([^.]+)\./.exec(signedValue)?.[1];
  assert.ok(demoId);
  return { cookie, projectId: `demo:${demoId}` };
}

before(async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  process.env.APP_MODE = "demo";
  process.env.SESSION_SECRET = "isolated-reviewflow-test-secret";
  process.env.NODE_ENV = "test";
  ({ default: app } = await import("../app"));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("concurrent identical imports are idempotent and conflicting batches roll back", async () => {
  const session = await createSession();
  const shared = {
    externalId: `same-${randomUUID()}`,
    question: "Q",
    evidence: "E",
    candidateAnswer: "A",
    risk: "low",
  };
  const identical = await Promise.all([
    request("/reviewflow/tasks/import", { session, method: "POST", body: { tasks: [shared] } }),
    request("/reviewflow/tasks/import", { session, method: "POST", body: { tasks: [shared] } }),
  ]);
  assert.deepEqual(identical.map((response) => response.status).sort(), [200, 200]);
  const identicalBodies = await Promise.all(identical.map((response) => response.json() as Promise<{ imported: number }>));
  assert.deepEqual(identicalBodies.map((body) => body.imported).sort(), [0, 1]);

  const racedId = `conflict-${randomUUID()}`;
  const companionA = `companion-a-${randomUUID()}`;
  const companionB = `companion-b-${randomUUID()}`;
  const makeTask = (externalId: string, evidence: string) => ({
    externalId, question: "Q", evidence, candidateAnswer: "A", risk: "medium",
  });
  const conflicting = await Promise.all([
    request("/reviewflow/tasks/import", {
      session,
      method: "POST",
      body: { tasks: [makeTask(racedId, "Evidence A"), makeTask(companionA, "A")] },
    }),
    request("/reviewflow/tasks/import", {
      session,
      method: "POST",
      body: { tasks: [makeTask(racedId, "Evidence B"), makeTask(companionB, "B")] },
    }),
  ]);
  assert.deepEqual(conflicting.map((response) => response.status).sort(), [200, 409]);

  const tasksResponse = await request("/reviewflow/tasks", { session });
  const tasks = await tasksResponse.json() as Array<{ externalId: string; evidence: string }>;
  const winner = tasks.find((task) => task.externalId === racedId);
  assert.ok(winner);
  const winningCompanion = winner.evidence === "Evidence A" ? companionA : companionB;
  const losingCompanion = winner.evidence === "Evidence A" ? companionB : companionA;
  assert.ok(tasks.some((task) => task.externalId === winningCompanion));
  assert.ok(!tasks.some((task) => task.externalId === losingCompanion));
});

test("demo admission is atomic, globally capped, and preserves existing projects at capacity", async () => {
  const { DemoProjectAdmissionError, ensureDemoProject } = await import("./reviewflow");
  const existingProjects = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(isNotNull(projectsTable.demoSessionId));
  const config = {
    demoProjectCap: existingProjects.length + 1,
    demoProjectCreationWindowMax: existingProjects.length + 10,
    demoProjectCreationWindowSeconds: 60,
  };
  const demoIds = [randomUUID(), randomUUID()];
  const raced = await Promise.allSettled(demoIds.map((id) => ensureDemoProject(id, config)));
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = raced.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof DemoProjectAdmissionError);
  assert.equal(rejected.reason.code, "DEMO_PROJECT_CAP_REACHED");

  const created = raced.find((result): result is PromiseFulfilledResult<typeof projectsTable.$inferSelect> =>
    result.status === "fulfilled");
  assert.ok(created);
  // A newly constructed config has no in-process admission state; the cap is
  // still enforced because its count is persisted in PostgreSQL.
  const recreatedConfig = { ...config };
  await assert.rejects(
    () => ensureDemoProject(randomUUID(), recreatedConfig),
    (error: unknown) =>
      error instanceof DemoProjectAdmissionError
      && error.code === "DEMO_PROJECT_CAP_REACHED",
  );
  const reopened = await ensureDemoProject(created.value.demoSessionId!, recreatedConfig);
  assert.equal(reopened.id, created.value.id);
  const seededTasks = await db.select({ id: tasksTable.id })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, created.value.id));
  assert.equal(seededTasks.length, 20);
});

test("demo throttle persists across recreated config and existing projects bypass it", async () => {
  const { DemoProjectAdmissionError, ensureDemoProject } = await import("./reviewflow");
  const existingProjects = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(isNotNull(projectsTable.demoSessionId));
  const firstConfig = {
    demoProjectCap: existingProjects.length + 10,
    demoProjectCreationWindowMax: existingProjects.length + 1,
    demoProjectCreationWindowSeconds: 60,
  };
  const demoId = randomUUID();
  const created = await ensureDemoProject(demoId, firstConfig);

  // A fresh config object simulates a recreated process: admission state comes
  // from PostgreSQL rather than process memory.
  const recreatedConfig = { ...firstConfig };
  await assert.rejects(
    () => ensureDemoProject(randomUUID(), recreatedConfig),
    (error: unknown) =>
      error instanceof DemoProjectAdmissionError
      && error.code === "DEMO_CREATION_THROTTLED"
      && error.retryAfterSeconds === 60,
  );
  const reopened = await ensureDemoProject(demoId, recreatedConfig);
  assert.equal(reopened.id, created.id);
});

test("HTTP admission errors map Retry-After and existing cookies work at throttle and cap", async () => {
  const session = await createSession();
  const projects = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(isNotNull(projectsTable.demoSessionId));
  const originalConfig = app.locals.runtimeConfig;
  try {
    app.locals.runtimeConfig = {
      ...originalConfig,
      demoProjectCap: projects.length,
      demoProjectCreationWindowMax: projects.length + 100,
      demoProjectCreationWindowSeconds: 60,
    };
    const capped = await request("/reviewflow/bootstrap");
    assert.equal(capped.status, 503);
    assert.equal(capped.headers.get("set-cookie"), null);
    assert.equal((await capped.json() as { code: string }).code, "DEMO_PROJECT_CAP_REACHED");
    assert.equal((await request("/reviewflow/bootstrap", { session })).status, 200);

    app.locals.runtimeConfig = {
      ...originalConfig,
      demoProjectCap: projects.length + 100,
      demoProjectCreationWindowMax: 1,
      demoProjectCreationWindowSeconds: 37,
    };
    const throttled = await request("/reviewflow/bootstrap");
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("retry-after"), "37");
    assert.equal(throttled.headers.get("set-cookie"), null);
    assert.equal((await throttled.json() as { code: string }).code, "DEMO_CREATION_THROTTLED");
    assert.equal((await request("/reviewflow/bootstrap", { session })).status, 200);
  } finally {
    app.locals.runtimeConfig = originalConfig;
  }
});

test("concurrent reviews commit exactly one decision and protect final state and project scope", async () => {
  const session = await createSession();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, session.projectId));
  assert.ok(project);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id));
  assert.ok(task);
  const proposalId = randomUUID();
  await db.insert(proposalsTable).values({
    id: proposalId,
    projectId: project.id,
    taskId: task.id,
    mode: "demo",
    requestedModel: "demo-simulator-v1",
    returnedModel: "demo-simulator-v1",
    label: "supported",
    labelProbability: "0.9",
    probabilities: { supported: 0.9, contradicted: 0.05, insufficient_evidence: 0.05 },
    injectionProbability: "0.01",
    complexity: 1,
    confidence: "0.9",
    latencyMs: 1,
    rawResponse: {},
  });
  await db.update(tasksTable).set({ status: "proposed" }).where(eq(tasksTable.id, task.id));

  const body = { taskId: task.id, version: task.version, action: "accept", activeMs: 10 };
  const raced = await Promise.all([
    request("/reviewflow/reviews", { session, method: "POST", body }),
    request("/reviewflow/reviews", { session, method: "POST", body }),
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await request("/reviewflow/reviews", { session, method: "POST", body })).status, 409);

  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.taskId, task.id));
  const events = await db.select().from(eventsTable).where(and(
    eq(eventsTable.entityId, task.id),
    eq(eventsTable.type, "review.accept"),
  ));
  const [finalTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
  assert.equal(reviews.length, 1);
  assert.equal(events.length, 1);
  assert.equal(finalTask.status, "finalized");

  const otherSession = await createSession();
  const crossProject = await request("/reviewflow/reviews", {
    session: otherSession,
    method: "POST",
    body,
  });
  assert.equal(crossProject.status, 404);
});

test("concurrent audit decisions and adjudications each produce one committed event", async () => {
  const session = await createSession();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, session.projectId));
  assert.ok(project?.demoSessionId);
  const actorId = `demo:${project.demoSessionId}`;
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id));
  assert.ok(task);

  const auditId = randomUUID();
  const itemId = randomUUID();
  await db.insert(auditsTable).values({
    id: auditId,
    projectId: project.id,
    status: "in_progress",
    sampleSize: 1,
    seed: "race",
    samplingFrameHash: "frame",
    samplingFrame: [],
    independent: true,
    required: false,
    auditorId: actorId,
  });
  await db.insert(auditItemsTable).values({
    id: itemId,
    auditId,
    taskId: task.id,
    ordinal: 1,
    originalReviewId: randomUUID(),
    originalReviewerId: "different-reviewer",
    originalLabel: "supported",
    taskContentHash: task.contentHash,
  });
  const decisionBody = { auditItemId: itemId, label: "supported", reason: "same" };
  const decisionRace = await Promise.all([
    request(`/reviewflow/audits/${auditId}/decisions`, { session, method: "POST", body: decisionBody }),
    request(`/reviewflow/audits/${auditId}/decisions`, { session, method: "POST", body: decisionBody }),
  ]);
  assert.deepEqual(decisionRace.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await db.select().from(auditDecisionsTable).where(eq(auditDecisionsTable.auditItemId, itemId))).length, 1);
  assert.equal((await db.select().from(eventsTable).where(and(
    eq(eventsTable.entityId, auditId),
    eq(eventsTable.type, "audit.decision.submitted"),
  ))).length, 1);

  const adjudicationAuditId = randomUUID();
  const adjudicationItemId = randomUUID();
  const disputeId = randomUUID();
  await db.insert(auditsTable).values({
    id: adjudicationAuditId,
    projectId: project.id,
    status: "needs_adjudication",
    sampleSize: 1,
    seed: "adjudication-race",
    samplingFrameHash: "frame",
    samplingFrame: [],
    independent: true,
    required: false,
    auditorId: "different-auditor",
  });
  await db.insert(auditItemsTable).values({
    id: adjudicationItemId,
    auditId: adjudicationAuditId,
    taskId: task.id,
    ordinal: 1,
    originalReviewId: randomUUID(),
    originalReviewerId: "different-reviewer",
    originalLabel: "supported",
    taskContentHash: task.contentHash,
  });
  await db.insert(auditDisputesTable).values({
    id: disputeId,
    auditId: adjudicationAuditId,
    auditItemId: adjudicationItemId,
    taskId: task.id,
    originalLabel: "supported",
    auditLabel: "contradicted",
    status: "pending",
  });
  const adjudicationBody = { resolvedLabel: "supported", reason: "resolved" };
  const adjudicationRace = await Promise.all([
    request(`/reviewflow/audits/${adjudicationAuditId}/disputes/${disputeId}/adjudicate`, {
      session, method: "POST", body: adjudicationBody,
    }),
    request(`/reviewflow/audits/${adjudicationAuditId}/disputes/${disputeId}/adjudicate`, {
      session, method: "POST", body: adjudicationBody,
    }),
  ]);
  assert.deepEqual(adjudicationRace.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await db.select().from(eventsTable).where(and(
    eq(eventsTable.entityId, disputeId),
    eq(eventsTable.type, "audit.dispute.adjudicated"),
  ))).length, 1);
});

test("concurrent live admission is bounded atomically and rejection does not switch project mode", async () => {
  const session = await createSession();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, session.projectId));
  assert.ok(project);
  const taskRows = Array.from({ length: 26 }, (_, index) => ({
    id: randomUUID(),
    projectId: project.id,
    externalId: `live-cap-${index}-${randomUUID()}`,
    question: "Q",
    evidence: "E",
    candidateAnswer: "A",
    risk: "low",
    contentHash: randomUUID(),
    mode: "demo",
  }));
  await db.insert(tasksTable).values(taskRows);
  await db.insert(jobsTable).values(taskRows.slice(0, 24).map((task) => ({
    id: randomUUID(),
    projectId: project.id,
    taskId: task.id,
    status: "queued",
    mode: "live",
  })));
  const { enqueueLiveJobsWithProjectLock } = await import("./reviewflow");
  const admissions = await Promise.all([
    enqueueLiveJobsWithProjectLock(project.id, [taskRows[24].id]),
    enqueueLiveJobsWithProjectLock(project.id, [taskRows[25].id]),
  ]);
  assert.equal(admissions.filter((result) => result === null).length, 1);
  assert.equal(admissions.filter((result) => result === 1).length, 1);
  const active = await db.select().from(jobsTable).where(and(
    eq(jobsTable.projectId, project.id),
    eq(jobsTable.mode, "live"),
    eq(jobsTable.status, "queued"),
  ));
  assert.equal(active.length, 25);

  await db.update(projectsTable).set({ mode: "demo" }).where(eq(projectsTable.id, project.id));
  assert.equal(await enqueueLiveJobsWithProjectLock(project.id, [taskRows[25].id]), null);
  const [unchangedProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, project.id));
  assert.equal(unchangedProject.mode, "demo");
});