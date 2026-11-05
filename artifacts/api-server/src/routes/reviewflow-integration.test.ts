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
  options: { session?: Session; method?: string; body?: unknown; rawBody?: string } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://127.0.0.1:5173",
      "x-reviewflow-csrf": "1",
      ...(options.body === undefined && options.rawBody === undefined ? {} : { "content-type": "application/json" }),
      ...(options.session ? { cookie: options.session.cookie } : {}),
    },
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
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
  process.env.DEMO_PROJECT_CREATION_WINDOW_MAX = "100";
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

test("anonymous telemetry uses cookie routing, production CSRF, and stable identity scope", async () => {
  const session = await createSession();
  const response = await request("/reviewflow/telemetry/context", { session });
  assert.equal(response.status, 200);
  const context = await response.json() as { projectId: string; scope: string };
  assert.equal(context.projectId, session.projectId);
  const event = { id: randomUUID(), session: randomUUID(), sequence: 1, kind: "foreground",
    factory: "evidence", itemId: null, itemVersion: null, proposalId: null, visibleMs: 100, dropped: 0 };
  const body = { scope: context.scope, events: [event] };
  const withoutCsrf = await fetch(`${baseUrl}/api/reviewflow/telemetry`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(withoutCsrf.status, 403);
  for (let i = 0; i < 2; i++) {
    const accepted = await request("/reviewflow/telemetry", { session, method: "POST", body });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: [event.id] });
  }
  const { telemetrySnapshot } = await import("../lib/telemetry");
  assert.equal((await telemetrySnapshot(session.projectId)).browser.observedForegroundMs, 100);
  const anotherSession = await createSession();
  assert.equal((await request("/reviewflow/telemetry", { session: anotherSession, method: "POST", body })).status, 409);
  const selected = await fetch(`${baseUrl}/api/reviewflow/telemetry/context`, {
    headers: { cookie: session.cookie, "x-reviewflow-project": session.projectId },
  });
  assert.equal(selected.status, 401, "anonymous sessions must never invent shared-project selection");
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

test("cookie-discarding plain GET floods cannot grow projects or seed tasks past admission limits", async () => {
  const originalConfig = app.locals.runtimeConfig;
  const createdProjectIds: string[] = [];
  const trackProject = (response: Response) => {
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const signedValue = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    const demoId = /^s:([^.]+)\./.exec(signedValue)?.[1];
    assert.ok(demoId);
    createdProjectIds.push(`demo:${demoId}`);
    return cookie;
  };
  const snapshot = async () => ({
    projects: (await db.select({ id: projectsTable.id }).from(projectsTable)).length,
    tasks: (await db.select({ id: tasksTable.id }).from(tasksTable)).length,
  });
  const initial = await snapshot();
  const anonymousProjects = await db.select({ id: projectsTable.id })
    .from(projectsTable).where(isNotNull(projectsTable.demoSessionId));
  try {
    app.locals.runtimeConfig = {
      ...originalConfig,
      demoProjectCap: anonymousProjects.length + 2,
      demoProjectCreationWindowMax: anonymousProjects.length + 1,
      demoProjectCreationWindowSeconds: 3600,
    };
    // Deliberately omit Origin, CSRF, and Cookie headers, exactly as in the
    // reported attack. Native fetch does not retain Set-Cookie between calls.
    const first = await fetch(`${baseUrl}/api/reviewflow/bootstrap`);
    assert.equal(first.status, 200);
    const cookie = trackProject(first);
    assert.equal((await first.json() as { tasks: unknown[] }).tasks.length, 20);
    const afterFirst = await snapshot();
    assert.deepEqual(afterFirst, { projects: initial.projects + 1, tasks: initial.tasks + 20 });

    const flood = async (status: number, code: string) => {
      const responses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        fetch(`${baseUrl}/api/reviewflow/${i % 2 ? "tasks" : "bootstrap"}`, {
          // Invalid signatures must not bypass admission either.
          headers: i % 3 ? {} : { cookie: "reviewflow_demo=s:forged.invalid" },
        })));
      for (const response of responses) {
        assert.equal(response.status, status);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal((await response.json() as { code: string }).code, code);
        if (status === 429) assert.equal(response.headers.get("retry-after"), "3600");
      }
    };
    await flood(429, "DEMO_CREATION_THROTTLED");
    assert.deepEqual(await snapshot(), afterFirst);

    // Raise only the window allowance: admit one last project, then verify
    // the lifetime cap independently prevents continued cookie churn.
    app.locals.runtimeConfig = {
      ...app.locals.runtimeConfig,
      demoProjectCreationWindowMax: anonymousProjects.length + 100,
    };
    const last = await fetch(`${baseUrl}/api/reviewflow/tasks`);
    assert.equal(last.status, 200);
    trackProject(last);
    assert.equal((await last.json() as unknown[]).length, 20);
    await flood(503, "DEMO_PROJECT_CAP_REACHED");
    assert.deepEqual(await snapshot(), { projects: initial.projects + 2, tasks: initial.tasks + 40 });

    const existing = await fetch(`${baseUrl}/api/reviewflow/bootstrap`, { headers: { cookie } });
    assert.equal(existing.status, 200);
    assert.equal((await existing.json() as { tasks: unknown[] }).tasks.length, 20);
    assert.deepEqual(await snapshot(), { projects: initial.projects + 2, tasks: initial.tasks + 40 });
  } finally {
    app.locals.runtimeConfig = originalConfig;
    // Remove only this test's fixtures so they do not consume the default
    // creation allowance used by unrelated tests later in this file.
    for (const projectId of createdProjectIds) {
      await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  }
});

test("concurrent first requests for one demo identity seed exactly once", async () => {
  const { ensureDemoProject } = await import("./reviewflow");
  const projects = await db.select({ id: projectsTable.id })
    .from(projectsTable).where(isNotNull(projectsTable.demoSessionId));
  const config = {
    demoProjectCap: projects.length + 1,
    demoProjectCreationWindowMax: projects.length + 1,
    demoProjectCreationWindowSeconds: 3600,
  };
  const demoId = randomUUID();
  const projectId = `demo:${demoId}`;
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureDemoProject(demoId, config)));
    assert.ok(results.every((project) => project.id === projectId));
    const tasks = await db.select({ id: tasksTable.id })
      .from(tasksTable).where(eq(tasksTable.projectId, projectId));
    assert.equal(tasks.length, 20);
  } finally {
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
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

test("review durations are validated before writes and valid boundaries preserve analytics", async () => {
  const session = await createSession();
  const tasks = (await db.select().from(tasksTable)
    .where(eq(tasksTable.projectId, session.projectId))).slice(0, 3);
  assert.equal(tasks.length, 3);
  await db.insert(proposalsTable).values(tasks.map((task) => ({
    id: randomUUID(),
    projectId: session.projectId,
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
  })));
  await db.update(tasksTable).set({ status: "proposed" })
    .where(eq(tasksTable.projectId, session.projectId));
  const body = { taskId: tasks[0].id, version: tasks[0].version, action: "accept" };
  const originalMetrics = await (await request("/reviewflow/metrics", { session })).json();
  const originalEvents = await db.select().from(eventsTable)
    .where(eq(eventsTable.projectId, session.projectId));
  const [originalTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, tasks[0].id));

  // Use raw JSON for overflow exponents: JSON.stringify would replace Infinity
  // and NaN with null, missing the non-finite-number path in the HTTP parser.
  const invalidValues = [
    undefined, "-999999", "-1", "0.5", "7200001", "1e15", "1e309", "-1e309",
    "null", '"100"', '""', "true", "false", "[]", "{}",
  ];
  for (const value of invalidValues) {
    const rawBody = `${JSON.stringify(body).slice(0, -1)}${value === undefined ? "" : `,"activeMs":${value}`}}`;
    const response = await request("/reviewflow/reviews", { session, method: "POST", rawBody });
    assert.equal(response.status, 400, `activeMs=${value} must be rejected`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.ok((await response.json() as { error: string }).error);
  }
  const [unchangedTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, tasks[0].id));
  assert.deepEqual(unchangedTask, originalTask);
  assert.deepEqual(await db.select().from(reviewsTable)
    .where(eq(reviewsTable.projectId, session.projectId)), []);
  assert.deepEqual(await db.select().from(eventsTable)
    .where(eq(eventsTable.projectId, session.projectId)), originalEvents);
  assert.deepEqual(await (await request("/reviewflow/metrics", { session })).json(), originalMetrics);
  const next = await request("/reviewflow/review/next", { session });
  assert.equal(next.status, 200);
  assert.ok((await next.json() as { task: unknown }).task);

  const validValues = [0, 1, 7_200_000];
  for (const [index, activeMs] of validValues.entries()) {
    const response = await request("/reviewflow/reviews", {
      session,
      method: "POST",
      body: { ...body, taskId: tasks[index].id, version: tasks[index].version, activeMs },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { status: string }).status, "finalized");
  }
  const stored = await db.select().from(reviewsTable)
    .where(eq(reviewsTable.projectId, session.projectId));
  assert.deepEqual(stored.map((review) => review.activeMs).sort((a, b) => a - b), validValues);
  const metrics = await (await request("/reviewflow/metrics", { session })).json() as { averageReviewMs: number };
  assert.equal(metrics.averageReviewMs, validValues.reduce((sum, value) => sum + value, 0) / validValues.length);
});

test("concurrent audit decisions and adjudications each produce one committed event", async () => {
  const session = await createSession();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, session.projectId));
  assert.ok(project?.demoSessionId);
  const actorId = `demo:${project.demoSessionId}`;
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id));
  assert.ok(task);

  const proposalId = randomUUID(), reviewId = randomUUID();
  await db.update(tasksTable).set({ status: "finalized", version: 2, finalLabel: "supported" }).where(eq(tasksTable.id, task.id));
  await db.insert(proposalsTable).values({ id: proposalId, projectId: project.id, taskId: task.id, mode: "demo", requestedModel: "demo-simulator-v1", returnedModel: "demo-simulator-v1", label: "supported", labelProbability: "0.9", probabilities: {}, injectionProbability: "0", complexity: 1, confidence: "0.9", latencyMs: 1, rawResponse: {} });
  await db.insert(reviewsTable).values({ id: reviewId, projectId: project.id, taskId: task.id, proposalId, reviewerId: "different-reviewer", action: "accept", label: "supported", taskVersion: 1, activeMs: 1 });
  const frame = { version: "rf-audit-v2" as const, eligible: [{ taskId: task.id, contentHash: task.contentHash, taskVersion: 2, reviewId, label: "supported", reviewerId: "different-reviewer", adjudicationId: null }] };
  const { samplingFrameHash } = await import("../lib/audits");
  const auditId = randomUUID();
  const itemId = randomUUID();
  await db.insert(auditsTable).values({
    id: auditId,
    projectId: project.id,
    status: "in_progress",
    sampleSize: 1,
    seed: "race",
    samplingFrameHash: samplingFrameHash(frame),
    samplingFrame: frame,
    independent: true,
    required: false,
    auditorId: actorId,
  });
  await db.insert(auditItemsTable).values({
    id: itemId,
    auditId,
    taskId: task.id,
    ordinal: 1,
    originalReviewId: reviewId,
    originalReviewerId: "different-reviewer",
    originalLabel: "supported",
    taskContentHash: task.contentHash,
    taskVersion: 2,
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
    status: "blocked",
    sampleSize: 1,
    seed: "adjudication-race",
    samplingFrameHash: samplingFrameHash(frame),
    samplingFrame: frame,
    independent: true,
    required: false,
    auditorId: "different-auditor",
  });
  await db.insert(auditItemsTable).values({
    id: adjudicationItemId,
    auditId: adjudicationAuditId,
    taskId: task.id,
    ordinal: 1,
    originalReviewId: reviewId,
    originalReviewerId: "different-reviewer",
    originalLabel: "supported",
    taskContentHash: task.contentHash,
    taskVersion: 2,
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
  await db.insert(auditDecisionsTable).values({ id: randomUUID(), auditId: adjudicationAuditId, auditItemId: adjudicationItemId, taskId: task.id, auditorId: "different-auditor", label: "contradicted" });
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
  // Which of the two racers was rejected is nondeterministic; only an
  // over-capacity *new* task is guaranteed to return null without flipping mode.
  const activeTaskIds = new Set(active.map((job) => job.taskId));
  const rejectedRacer = [taskRows[24], taskRows[25]].find((task) => !activeTaskIds.has(task.id));
  assert.ok(rejectedRacer);

  await db.update(projectsTable).set({ mode: "demo" }).where(eq(projectsTable.id, project.id));
  assert.equal(await enqueueLiveJobsWithProjectLock(project.id, [rejectedRacer.id]), null);
  const [unchangedProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, project.id));
  assert.equal(unchangedProject.mode, "demo");
});
