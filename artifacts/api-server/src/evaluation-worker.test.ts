import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  jobsTable,
  pool,
  projectsTable,
  proposalsTable,
  tasksTable,
} from "@workspace/db";
import {
  evaluateTask,
  getRetryDelayMs,
  simulated,
  ProviderError,
  type EvaluationTask,
} from "./evaluation";
import { enqueueEvaluationJobs, EvaluationWorker, isLiveInferenceEnabled } from "./evaluation-worker";

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
    const result = await db.execute(sql`
      SELECT lease_expires_at <= NOW() AS expired
      FROM rf_jobs
      WHERE task_id = ${task.id}
    `);
    return result.rows[0]?.expired === true;
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
  const proposalEvents = await db.select().from(eventsTable).where(and(
    eq(eventsTable.projectId, task.projectId),
    eq(eventsTable.type, "proposal.created"),
  ));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  assert.equal(proposals.length, 1);
  assert.equal(proposalEvents.length, 1);
  assert.equal(job?.status, "succeeded");
  assert.equal(job?.attempts, 2);
});

test("repeated enqueue is a no-op for running and succeeded jobs", async () => {
  const task = await createTask();
  assert.equal(await enqueueEvaluationJobs({
    projectId: task.projectId,
    taskIds: [task.id],
    mode: "demo",
  }), 1);

  let releaseProvider!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const run = new EvaluationWorker({
    workerId: "worker-idempotent-enqueue",
    leaseMs: 5_000,
    evaluate: async () => {
      await blocked;
      return simulated(task);
    },
  }).runOnce();
  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return job?.status === "running";
  });

  assert.equal(await enqueueEvaluationJobs({
    projectId: task.projectId,
    taskIds: [task.id],
    mode: "demo",
  }), 0);
  releaseProvider();
  await run;
  assert.equal(await enqueueEvaluationJobs({
    projectId: task.projectId,
    taskIds: [task.id],
    mode: "demo",
  }), 0);
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
    const result = await db.execute(sql`
      SELECT lease_expires_at <= NOW() AS expired
      FROM rf_jobs
      WHERE task_id = ${task.id}
    `);
    return result.rows[0]?.expired === true;
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

test("a provider result arriving after human finalization cannot create proposal side effects", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "demo" });

  let releaseProvider!: () => void;
  const providerBlocked = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const workerRun = new EvaluationWorker({
    workerId: "worker-final-state-fence",
    leaseMs: 5_000,
    evaluate: async () => {
      await providerBlocked;
      return simulated(task);
    },
  }).runOnce();

  await waitFor(async () => {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
    return job?.status === "running";
  });
  await db.update(tasksTable).set({
    status: "finalized",
    finalLabel: "supported",
  }).where(eq(tasksTable.id, task.id));
  releaseProvider();
  await workerRun;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  const proposals = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  const proposalEvents = await db.select().from(eventsTable).where(and(
    eq(eventsTable.projectId, task.projectId),
    eq(eventsTable.type, "proposal.created"),
  ));
  assert.equal(job?.status, "succeeded");
  assert.equal(proposals.length, 0);
  assert.equal(proposalEvents.length, 0);
});

test("live jobs stay queued unless both live inference gates are enabled", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "live" });
  const originalEnabled = process.env.LIVE_INFERENCE_ENABLED;
  const originalMode = process.env.APP_MODE;
  let providerCalls = 0;
  const worker = new EvaluationWorker({
    workerId: "worker-live-gate",
    evaluate: async () => {
      providerCalls++;
      return simulated(task);
    },
  });

  try {
    process.env.LIVE_INFERENCE_ENABLED = "true";
    process.env.APP_MODE = "demo";
    assert.equal(isLiveInferenceEnabled(), false);
    assert.equal(await worker.runOnce(), false);
    process.env.LIVE_INFERENCE_ENABLED = "false";
    process.env.APP_MODE = "clerk";
    assert.equal(await worker.runOnce(), false);
    assert.equal(providerCalls, 0);

    process.env.LIVE_INFERENCE_ENABLED = "true";
    process.env.APP_MODE = "clerk";
    assert.equal(isLiveInferenceEnabled(), true);
    assert.equal(await worker.runOnce(), true);
    assert.equal(providerCalls, 1);
  } finally {
    if (originalEnabled === undefined) delete process.env.LIVE_INFERENCE_ENABLED;
    else process.env.LIVE_INFERENCE_ENABLED = originalEnabled;
    if (originalMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = originalMode;
  }
});

test("live provider transport classifies retryable failures without network access", async () => {
  const task = {
    question: "What is the return window?",
    evidence: "Items may be returned within 30 days.",
    candidateAnswer: "The return window is 30 days.",
  } as EvaluationTask;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TYPESAFE_API_KEY;
  const requests: RequestInit[] = [];
  process.env.TYPESAFE_API_KEY = "transport-test-key";

  try {
    const cases: Array<{
      name: string;
      response?: Response;
      error?: Error;
      retryable: boolean;
      status?: number;
      retryAfterMs?: number;
      retryAfterAtLeastMs?: number;
    }> = [
      {
        name: "401 authentication failure",
        response: new Response("", { status: 401 }),
        retryable: false,
        status: 401,
      },
      {
        name: "invalid 422 request",
        response: new Response("", { status: 422 }),
        retryable: false,
        status: 422,
      },
      {
        name: "429 seconds-based rate limit",
        response: new Response("", { status: 429, headers: { "retry-after": "7" } }),
        retryable: true,
        status: 429,
        retryAfterMs: 7_000,
      },
      {
        name: "529 HTTP-date rate limit",
        response: new Response("", {
          status: 529,
          headers: { "retry-after": new Date(Date.now() + 10_000).toUTCString() },
        }),
        retryable: true,
        status: 529,
        retryAfterAtLeastMs: 8_000,
      },
      {
        name: "malformed JSON",
        response: new Response("{", { status: 200 }),
        retryable: false,
        status: 200,
      },
      {
        name: "invalid typed response",
        response: new Response(JSON.stringify({
          answers: { label: { choice: "supported" } },
        }), { status: 200 }),
        retryable: false,
        status: 200,
      },
      {
        name: "out-of-range confidence",
        response: new Response(JSON.stringify({
          answers: {
            label: {
              choice: "supported",
              probabilities: { supported: 0.8, contradicted: 0.1, insufficient_evidence: 0.1 },
              confidence: 1.1,
            },
            attempted_redirection: { noul: 0.1 },
            review_complexity: { score: 2 },
          },
        }), { status: 200 }),
        retryable: false,
        status: 200,
      },
      {
        name: "transient 503 response",
        response: new Response("", { status: 503 }),
        retryable: true,
        status: 503,
      },
      {
        name: "transient network failure",
        error: new Error("socket closed"),
        retryable: true,
      },
    ];

    for (const currentCase of cases) {
      globalThis.fetch = async (_input, init) => {
        requests.push(init ?? {});
        if (currentCase.error) throw currentCase.error;
        return currentCase.response!;
      };

      const result = evaluateTask(task, "live");
      if (currentCase.name === "transient network failure") {
        await assert.rejects(result, (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.retryable, currentCase.retryable);
          assert.equal(error.status, currentCase.status);
          return true;
        });
        continue;
      }

      await assert.rejects(result, (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.retryable, currentCase.retryable);
        assert.equal(error.status, currentCase.status);
        if (currentCase.retryAfterMs !== undefined) {
          assert.equal(error.retryAfterMs, currentCase.retryAfterMs);
          assert.equal(getRetryDelayMs(error, 1), currentCase.retryAfterMs);
        } else if (currentCase.retryAfterAtLeastMs !== undefined) {
          assert.ok((error.retryAfterMs ?? 0) >= currentCase.retryAfterAtLeastMs);
          assert.ok(getRetryDelayMs(error, 1) >= currentCase.retryAfterAtLeastMs);
        } else {
          assert.equal(error.retryAfterMs, undefined);
        }
        return true;
      }, currentCase.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }

  assert.equal(requests.length, 9);
  assert.ok(requests.every((request) => request.method === "POST"));
  assert.ok(requests.every((request) => request.headers instanceof Headers
    ? request.headers.get("authorization") === "Bearer transport-test-key"
    : (request.headers as Record<string, string>).authorization === "Bearer transport-test-key"));
});
