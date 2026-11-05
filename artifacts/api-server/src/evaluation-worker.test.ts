import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  jobsTable,
  jevControlsTable,
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
  await db.insert(jevControlsTable).values({ projectId: task.projectId, enabled: true, maxCalls: 1 });
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

test("queued live evaluation rechecks quarantine after budget wait before invoking a provider", async () => {
  const { factoryItemsTable, jevCallsTable } = await import("@workspace/db");
  const task = await createTask();
  await db.insert(factoryItemsTable).values({ id: randomUUID(), projectId: task.projectId, factory: "evidence", itemId: task.id });
  await db.insert(jevControlsTable).values({ projectId: task.projectId, enabled: true, maxCalls: 1 });
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "live" });
  const enabled = process.env.LIVE_INFERENCE_ENABLED, mode = process.env.APP_MODE;
  process.env.LIVE_INFERENCE_ENABLED = "true"; process.env.APP_MODE = "clerk";
  const lock = await pool.connect();
  let run: Promise<boolean> | undefined, calls = 0;
  try {
    await lock.query("BEGIN");
    const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`jev:${task.projectId}`]);
    run = new EvaluationWorker({ workerId: "synthetic-admission", evaluate: async () => { calls++; return simulated(task); } }).runOnce();
    await waitFor(async () => (await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked", [pid])).rows[0].blocked);
    await db.update(factoryItemsTable).set({ quarantined: true }).where(eq(factoryItemsTable.itemId, task.id));
  } finally {
    await lock.query("COMMIT"); lock.release();
    if (run) await run;
    if (enabled === undefined) delete process.env.LIVE_INFERENCE_ENABLED; else process.env.LIVE_INFERENCE_ENABLED = enabled;
    if (mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = mode;
  }
  assert.equal(calls, 0);
  assert.equal((await db.select().from(jevCallsTable).where(eq(jevCallsTable.projectId, task.projectId))).length, 0);
});

test("worker reports polling failures, recovers with bounded retry, and wakes promptly on stop", async () => {
  const worker = new EvaluationWorker({ pollMs: 5 });
  let calls = 0;
  worker.runOnce = async () => {
    calls++;
    if (calls === 1) throw new Error("synthetic-private-database-failure");
    if (calls === 2) { assert.equal(worker.ready(), false); return false; }
    assert.equal(worker.ready(), true); worker.stop(); return false;
  };
  assert.equal(worker.ready(), false);
  await worker.start(); assert.equal(calls, 3); assert.equal(worker.ready(), false);
  const stopped = new EvaluationWorker({ pollMs: 30_000 }); let polled = false;
  stopped.runOnce = async () => { polled = true; return false; };
  const running = stopped.start(); await waitFor(async () => polled);
  const before = performance.now(); stopped.stop(); await running;
  assert.ok(performance.now() - before < 500, "Stop interrupts the poll wait");
});

test("fractional complexity migration preserves historical values and accepts native fractional mapping", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../../../lib/db/drizzle/0006_fractional_complexity.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A temporary relation shadows the persistent table; no application rows are rewritten.
    await client.query("CREATE TEMP TABLE rf_proposals (complexity integer NOT NULL) ON COMMIT DROP");
    await client.query("INSERT INTO rf_proposals (complexity) VALUES (1), (3), (5)");
    await client.query(migration);
    assert.deepEqual((await client.query("SELECT complexity FROM rf_proposals ORDER BY complexity")).rows.map(row => row.complexity), [1, 3, 5]);
    await client.query("INSERT INTO rf_proposals (complexity) VALUES (2.43)");
    const fractional = (await client.query("SELECT complexity FROM rf_proposals WHERE complexity > 2 AND complexity < 3")).rows[0].complexity;
    assert.ok(Math.abs(fractional - 2.43) < 0.00001);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});


test("worker persists fractional compatibility complexity without rounding", async () => {
  const task = await createTask();
  await enqueueEvaluationJobs({ projectId: task.projectId, taskIds: [task.id], mode: "demo" });
  const worker = new EvaluationWorker({ workerId: "fractional-complexity", evaluate: async () => ({ ...simulated(task), complexity: 2.43 }) });
  assert.equal(await worker.runOnce(), true);
  const [proposal] = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  assert.ok(Math.abs(proposal.complexity - 2.43) < 0.00001);
});

test("versioned inference dedupes identical concurrent requests and preserves separate runs", async () => {
  const task = await createTask();
  const input = { projectId: task.projectId, taskIds: [task.id], mode: "demo" as const };
  assert.equal((await Promise.all([enqueueEvaluationJobs(input), enqueueEvaluationJobs(input)])).reduce((a,b) => a+b), 1);
  const worker = new EvaluationWorker();
  await worker.runOnce();
  const [first] = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  assert.ok(first.evaluationId);
  assert.equal(await enqueueEvaluationJobs(input), 0);
  assert.equal(await enqueueEvaluationJobs({ ...input, experimentRunId: "second" }), 1);
  const [pending] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
  assert.equal(pending.currentProposalId, null);
  assert.equal(pending.status, "pending");
  await worker.runOnce();
  const proposals = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals.find(p => p.id === first.id), first);
  await assert.rejects(db.update(proposalsTable).set({ label: "contradicted" }).where(eq(proposalsTable.id, first.id)), (error: any) => /immutable/.test(error.cause?.message ?? error.message));
  assert.equal(await enqueueEvaluationJobs(input), 0);
  const [restored] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
  assert.equal(restored.currentProposalId, first.id);
});

test("superseded in-flight result remains historical and never attaches to newer selection", async () => {
  const task = await createTask();
  const input = { projectId: task.projectId, taskIds: [task.id], mode: "demo" as const };
  await enqueueEvaluationJobs(input);
  let finish!: () => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const block = new Promise<void>(resolve => { finish = resolve; });
  const running = new EvaluationWorker({ evaluate: async () => { started(); await block; return simulated(task); } }).runOnce();
  await start;
  await enqueueEvaluationJobs({ ...input, experimentRunId: "replacement" });
  finish(); await running;
  const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
  const historical = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  assert.equal(historical.length, 1);
  assert.notEqual(historical[0].evaluationId, current.currentEvaluationId);
  assert.equal(current.currentProposalId, null);
  await new EvaluationWorker().runOnce();
  const [completed] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
  assert.ok(completed.currentProposalId);
  assert.notEqual(completed.currentProposalId, historical[0].id);
});

test("changed input never uses stale cache even if caller retained contentHash", async () => {
  const task = await createTask();
  const input = { projectId: task.projectId, taskIds: [task.id], mode: "demo" as const };
  await enqueueEvaluationJobs(input); await new EvaluationWorker().runOnce();
  await db.update(tasksTable).set({ evidence: "A different source" }).where(eq(tasksTable.id, task.id));
  assert.equal(await enqueueEvaluationJobs(input), 1);
  await new EvaluationWorker().runOnce();
  const proposals = await db.select().from(proposalsTable).where(eq(proposalsTable.taskId, task.id));
  assert.equal(proposals.length, 2);
  assert.notEqual(proposals[0].evaluationId, proposals[1].evaluationId);
  await assert.rejects(enqueueEvaluationJobs({ ...input, requestedModel: "unimplemented-model" }), /Unsupported/);
});

test("identity migration preserves legacy proposal/release bytes and labels unknown provenance", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../../../lib/db/drizzle/0008_evaluation_identity.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  const schema = `identity_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    await client.query(`
      CREATE TABLE rf_tasks (id text, project_id text, mode text);
      CREATE TABLE rf_jobs (id text, project_id text, task_id text, mode text, status text, lease_owner text, lease_expires_at timestamptz, last_error text, updated_at timestamptz);
      CREATE UNIQUE INDEX rf_jobs_task_mode_unique ON rf_jobs(task_id,mode);
      CREATE TABLE rf_proposals (id text, project_id text, task_id text, mode text, raw_response jsonb);
      CREATE UNIQUE INDEX rf_proposals_task_mode_unique ON rf_proposals(task_id,mode);
      CREATE TABLE rf_trace_records (kind text, payload jsonb);
      CREATE TABLE rf_releases (jsonl text, digest text);
      INSERT INTO rf_tasks VALUES ('t','p','demo');
      INSERT INTO rf_jobs VALUES ('j','p','t','demo','running','old-worker',now(),null,now());
      INSERT INTO rf_proposals VALUES ('proposal','p','t','demo','{"original":true}');
      INSERT INTO rf_releases VALUES ('immutable original release', 'original digest');
    `);
    await client.query(migration);
    const proposal = (await client.query("SELECT * FROM rf_proposals")).rows[0];
    assert.equal(proposal.id, "proposal"); assert.deepEqual(proposal.raw_response, { original: true });
    assert.equal(proposal.provenance, "legacy-unknown"); assert.equal(proposal.evaluation_id, null);
    const task = (await client.query("SELECT * FROM rf_tasks")).rows[0];
    assert.equal(task.current_proposal_id, "proposal"); assert.equal(task.current_evaluation_id, null);
    assert.deepEqual((await client.query("SELECT * FROM rf_releases")).rows, [{ jsonl: "immutable original release", digest: "original digest" }]);
    const job = (await client.query("SELECT * FROM rf_jobs")).rows[0];
    assert.equal(job.status, "failed"); assert.equal(job.lease_owner, null); assert.match(job.last_error, /unknown provenance/);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("each claimed retry has a durable attempt event even after manual attempt counter reset", async () => {
  const task = await createTask();
  const input = { projectId: task.projectId, taskIds: [task.id], mode: "demo" as const };
  await enqueueEvaluationJobs(input);
  const worker = new EvaluationWorker({ evaluate: async () => { throw new ProviderError("synthetic failure"); } });
  await worker.runOnce();
  await enqueueEvaluationJobs(input);
  await worker.runOnce();
  const events = await db.select().from(eventsTable).where(and(eq(eventsTable.projectId, task.projectId), eq(eventsTable.type, "evaluation.attempt.started")));
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
  assert.ok(events.every(event => (event.payload as any).attempt === 1));
  assert.equal(await worker.runOnce(), false);
  assert.equal((await db.select().from(eventsTable).where(and(eq(eventsTable.projectId, task.projectId), eq(eventsTable.type, "evaluation.attempt.started")))).length, 2);
});


test("retry checks expected current identity after waiting for the task mutation lock", async () => {
  const task = await createTask();
  const input = { projectId: task.projectId, taskIds: [task.id], mode: "demo" as const };
  await enqueueEvaluationJobs(input);
  const [first] = await db.select().from(jobsTable).where(eq(jobsTable.taskId, task.id));
  await db.update(jobsTable).set({ status: "failed" }).where(eq(jobsTable.id, first.id));
  const lock = await pool.connect();
  let retried: Promise<number> | undefined;
  try {
    await lock.query("BEGIN");
    const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await lock.query("SELECT id FROM rf_tasks WHERE id = $1 FOR UPDATE", [task.id]);
    retried = enqueueEvaluationJobs({ ...input, retryExpected: { jobId: first.id, evaluationId: first.evaluationId } });
    // Attach the rejection handler before releasing the lock.
    const rejected = assert.rejects(retried, /selection changed/);
    await waitFor(async () => (await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked", [pid])).rows[0].blocked);
    await lock.query("UPDATE rf_tasks SET current_evaluation_id = $1 WHERE id = $2", ["newer-experiment", task.id]);
    await lock.query("COMMIT");
    await rejected;
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, first.id));
    assert.equal(current.currentEvaluationId, "newer-experiment");
    assert.equal(job.status, "failed");
  } finally {
    await lock.query("ROLLBACK"); lock.release();
    await retried?.catch(() => {});
  }
});
