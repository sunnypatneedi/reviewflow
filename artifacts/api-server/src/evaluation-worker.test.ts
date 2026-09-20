import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  eventsTable,
  jobsTable,
  pool,
  projectsTable,
  proposalsTable,
  tasksTable,
} from "@workspace/db";
import { simulated, ProviderError, type EvaluationTask } from "./evaluation";
import { enqueueEvaluationJobs, EvaluationWorker } from "./evaluation-worker";

const createdProjectIds: string[] = [];

async function createTask(): Promise<EvaluationTask> {
  const projectId = `worker-test-project-${randomUUID()}`;
  const taskId = `worker-test-task-${randomUUID()}`;
  createdProjectIds.push(projectId);
  await db.insert(projectsTable).values({ id: projectId, name: "Worker test project" });
  const [task] = await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    externalId: `worker-${randomUUID()}`,
    question: "What is the return window?",
    evidence: "Items may be returned within 30 days.",
    candidateAnswer: "The return window is 30 days.",
    risk: "low",
    contentHash: randomUUID(),
    mode: "demo",
  }).returning();
  return task;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for worker state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
    await db.delete(proposalsTable).where(eq(proposalsTable.projectId, projectId));
    await db.delete(jobsTable).where(eq(jobsTable.projectId, projectId));
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

after(async () => {
  await pool.end();
});

test("a claimed job is recovered after the worker lease expires", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "demo" });

  let releaseFirstWorker!: () => void;
  const firstWorkerBlocked = new Promise<void>((resolve) => { releaseFirstWorker = resolve; });
  const firstWorkerRun = new EvaluationWorker({
    workerId: "worker-before-restart",
    leaseMs: 30,
    evaluate: async () => {
      await firstWorkerBlocked;
      return simulated(task);
    },
  }).runOnce();

  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return job?.status === "running";
  });
  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return Boolean(job?.leaseExpiresAt && job.leaseExpiresAt <= new Date());
  });

  const restartedWorker = new EvaluationWorker({
    workerId: "worker-after-restart",
    leaseMs: 1_000,
    evaluate: async () => simulated(task),
  });
  assert.equal(await restartedWorker.runOnce(), true);
  releaseFirstWorker();
  await firstWorkerRun;

  const proposals = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  assert.equal(proposals.length, 1);
  assert.equal(job?.status, "succeeded");
  assert.equal(job?.attempts, 2);
});

test("provider rate limits are delayed, while authentication failures are terminal", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "demo" });

  const rateLimitedWorker = new EvaluationWorker({
    workerId: "worker-rate-limit",
    maxAttempts: 3,
    evaluate: async () => {
      throw new ProviderError("rate limited", { status: 429, retryable: true, retryAfterMs: 100 });
    },
  });
  assert.equal(await rateLimitedWorker.runOnce(), true);
  const [delayedJob] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  assert.equal(delayedJob?.status, "queued");
  assert.equal(delayedJob?.attempts, 1);
  assert.ok((delayedJob?.availableAt.getTime() ?? 0) >= Date.now() + 80);
  assert.equal(await rateLimitedWorker.runOnce(), false);

  const authFailureWorker = new EvaluationWorker({
    workerId: "worker-auth-failure",
    maxAttempts: 3,
    evaluate: async () => {
      throw new ProviderError("unauthorized", { status: 401 });
    },
  });
  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return Boolean(job?.availableAt && job.availableAt <= new Date());
  });
  assert.equal(await authFailureWorker.runOnce(), true);
  const [failedJob] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  assert.equal(failedJob?.status, "failed");
  assert.equal(failedJob?.attempts, 2);
  assert.equal(await authFailureWorker.runOnce(), false);
});

test("an expired lease on the final attempt becomes terminal without another provider call", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "demo" });

  let releaseFirstWorker!: () => void;
  const firstWorkerBlocked = new Promise<void>((resolve) => { releaseFirstWorker = resolve; });
  const firstWorkerRun = new EvaluationWorker({
    workerId: "worker-final-attempt",
    maxAttempts: 1,
    leaseMs: 30,
    evaluate: async () => {
      await firstWorkerBlocked;
      return simulated(task);
    },
  }).runOnce();

  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return job?.status === "running";
  });
  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return Boolean(job?.leaseExpiresAt && job.leaseExpiresAt <= new Date());
  });

  let providerCalled = false;
  const restartedWorker = new EvaluationWorker({
    workerId: "worker-final-attempt-restart",
    maxAttempts: 1,
    evaluate: async () => {
      providerCalled = true;
      return simulated(task);
    },
  });
  assert.equal(await restartedWorker.runOnce(), false);
  releaseFirstWorker();
  await firstWorkerRun;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  assert.equal(providerCalled, false);
  assert.equal(job?.status, "failed");
  assert.equal(job?.attempts, 1);
});