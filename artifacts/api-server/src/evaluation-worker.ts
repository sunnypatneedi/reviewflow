import { FactoryError } from "./lib/factory-engine";
import { randomUUID } from "node:crypto";
import { assertFactoryAssistance, lockFactory } from "./lib/factories";
import { reserveJevCall, finishJevCall } from "./lib/jev-budget";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  jobsTable,
  proposalsTable,
  tasksTable,
  projectsTable,
} from "@workspace/db";
import {
  evaluateTask,
  MODEL,
  getRetryDelayMs,
  type EvaluationMode,
  type EvaluationResult,
  ProviderError,
} from "./evaluation";

import { createEvaluationIdentity, evidenceSnapshot, evaluationHash, type EvaluationConfiguration, type EvaluationIdentity } from "./lib/evaluation-identity";

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_MS = 30_000;
export const DEFAULT_POLL_MS = 250;
export const MAX_ACTIVE_LIVE_JOBS_PER_PROJECT = 25;

type Job = typeof jobsTable.$inferSelect;
type WorkerOptions = {
  workerId?: string;
  maxAttempts?: number;
  leaseMs?: number;
  pollMs?: number;
  evaluate?: typeof evaluateTask;
};

export async function enqueueEvaluationJobs(input: {
  projectId: string;
  taskIds: string[];
  mode: EvaluationMode;
  executor?: Pick<typeof db, "select" | "update" | "insert">;
  retryExpected?: { jobId: string; evaluationId: string | null };
} & EvaluationConfiguration): Promise<number> {
  if (!input.taskIds.length) return 0;
  if (!input.executor) return db.transaction(tx => enqueueEvaluationJobs({ ...input, executor: tx }));
  const executor = input.executor;
  const requestedModel = input.mode === "demo" ? "demo-simulator-v1" : MODEL;
  if ((input.requestedModel && input.requestedModel !== requestedModel)
    || (input.questionVersion && input.questionVersion !== "evidence-v1")
    || (input.contextPreparationVersion && input.contextPreparationVersion !== "raw-evidence-v1")) {
    throw new ProviderError("Unsupported evaluation configuration");
  }
  const [project] = await executor.select().from(projectsTable).where(eq(projectsTable.id, input.projectId));
  if (!project || project.rubricVersion !== "evidence-v1") throw new ProviderError("Project rubric is not supported by this evaluator");
  // Serialize enqueue with publication so competing configurations cannot attach
  // a late result to a newer task selection. Stable ordering avoids deadlocks.
  const tasks = await executor.select().from(tasksTable).where(and(
    eq(tasksTable.projectId, input.projectId), inArray(tasksTable.id, input.taskIds),
  )).orderBy(tasksTable.id).for("update");
  if (input.retryExpected) {
    const task = tasks.length === 1 ? tasks[0] : undefined;
    if (!task || task.currentEvaluationId !== input.retryExpected.evaluationId || task.mode !== input.mode
      || !["pending", "proposed", "in_review"].includes(task.status)) {
      throw new FactoryError("Evaluation selection changed; superseded jobs cannot be retried");
    }
    const [job] = await executor.select().from(jobsTable).where(and(
      eq(jobsTable.id, input.retryExpected.jobId), eq(jobsTable.projectId, input.projectId),
      eq(jobsTable.taskId, task.id), eq(jobsTable.mode, input.mode),
    )).for("update");
    if (!job || job.evaluationId !== input.retryExpected.evaluationId || job.status !== "failed") {
      throw new FactoryError("Only the current terminally failed evaluation job can be retried");
    }
  }
  let queued = 0;
  for (const task of tasks) {
    if (!["pending", "proposed", "in_review"].includes(task.status)) continue;
    const { evaluationId, identity } = createEvaluationIdentity({
      projectId: input.projectId, taskId: task.id, workload: "evidence", snapshot: evidenceSnapshot(task),
      questionVersion: "evidence-v1", contextPreparationVersion: "raw-evidence-v1", requestedModel,
      experimentRunId: input.experimentRunId ?? "default",
    });
    const rows = await executor.insert(jobsTable).values({
      id: randomUUID(), projectId: input.projectId, taskId: task.id, mode: input.mode,
      evaluationId, evaluationIdentity: identity, provenance: "captured", status: "queued", availableAt: new Date(),
    }).onConflictDoNothing({ target: jobsTable.evaluationId }).returning({ id: jobsTable.id });
    queued += rows.length;
    if (!rows.length) {
      const retried = await executor.update(jobsTable).set({ status: "queued", attempts: 0, availableAt: new Date(),
        leaseOwner: null, leaseExpiresAt: null, lastError: null, updatedAt: new Date(),
      }).where(and(eq(jobsTable.evaluationId, evaluationId), eq(jobsTable.status, "failed"))).returning({ id: jobsTable.id });
      queued += retried.length;
    }
    const [proposal] = await executor.select().from(proposalsTable).where(eq(proposalsTable.evaluationId, evaluationId));
    await executor.update(tasksTable).set({ currentEvaluationId: evaluationId, currentProposalId: proposal?.id ?? null,
      mode: input.mode, ...(task.currentEvaluationId !== evaluationId ? { version: sql`${tasksTable.version} + 1`, status: proposal ? "proposed" : "pending" } : {}),
    }).where(eq(tasksTable.id, task.id));
  }
  return queued;
}

export function isLiveInferenceEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.LIVE_INFERENCE_ENABLED === "true" && environment.APP_MODE === "clerk";
}

async function claimJob(
  workerId: string,
  leaseMs: number,
  maxAttempts: number,
  liveEnabled: boolean,
): Promise<Job | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE rf_jobs
      SET status = 'failed',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = 'Evaluation lease expired after the maximum number of attempts',
          updated_at = NOW()
      WHERE status = 'running'
        AND lease_expires_at <= NOW()
        AND attempts >= ${maxAttempts}
    `);
    const claimed = await tx.execute(sql`
      WITH candidate AS (
        SELECT id
        FROM rf_jobs
        WHERE (
          (status = 'queued' AND available_at <= NOW())
          OR (status = 'running' AND lease_expires_at <= NOW() AND attempts < ${maxAttempts})
        )
          AND (mode <> 'live' OR ${liveEnabled})
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE rf_jobs AS job
      SET status = 'running',
          attempts = job.attempts + 1,
          lease_owner = ${workerId},
          lease_expires_at = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
          updated_at = NOW()
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING
        job.id,
        job.project_id AS "projectId",
        job.task_id AS "taskId",
        job.evaluation_id AS "evaluationId",
        job.evaluation_identity AS "evaluationIdentity",
        job.provenance,
        job.status,
        job.mode,
        job.attempts,
        job.available_at AS "availableAt",
        job.lease_owner AS "leaseOwner",
        job.lease_expires_at AS "leaseExpiresAt",
        job.last_error AS "lastError",
        job.created_at AS "createdAt",
        job.updated_at AS "updatedAt"
    `);
    const job = (claimed.rows[0] as Job | undefined) ?? null;
    if (job) await tx.insert(eventsTable).values({
      id: randomUUID(), projectId: job.projectId, actorId: `worker:${workerId}`,
      type: "evaluation.attempt.started", entityId: job.taskId,
      payload: { jobId: job.id, evaluationId: job.evaluationId, attempt: job.attempts, mode: job.mode },
    });
    return job;
  });
}

async function loadTask(job: Job) {
  const [task] = await db.select().from(tasksTable).where(and(
    eq(tasksTable.id, job.taskId),
    eq(tasksTable.projectId, job.projectId),
  ));
  return task;
}

async function saveSuccess(
  job: Job,
  result: EvaluationResult,
  workerId: string,
  maxAttempts: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await assertFactoryAssistance(tx, job.projectId, "evidence", job.taskId);
    // Match enqueue's task -> job lock order. Taking a lock is not publication;
    // the lease fence below must still succeed before any domain mutation.
    const locked = await tx.execute(sql`
      SELECT id FROM rf_tasks WHERE id = ${job.taskId} AND project_id = ${job.projectId} FOR UPDATE
    `);
    if (!locked.rows.length) return;
    // Fence the lease before touching any domain row. An expired or reclaimed
    // worker cannot publish a proposal even if its provider call later returns.
    const fenced = await tx.update(jobsTable).set({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(jobsTable.id, job.id),
      eq(jobsTable.status, "running"),
      eq(jobsTable.leaseOwner, workerId),
      eq(jobsTable.attempts, job.attempts),
      sql`${jobsTable.leaseExpiresAt} > NOW()`,
    )).returning({ id: jobsTable.id });
    if (!fenced.length) {
      // A final-attempt provider response that arrives after lease expiry is
      // terminal even when no replacement worker has polled yet.
      await tx.update(jobsTable).set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: "Evaluation lease expired after the maximum number of attempts",
        updatedAt: new Date(),
      }).where(and(
        eq(jobsTable.id, job.id),
        eq(jobsTable.status, "running"),
        eq(jobsTable.leaseOwner, workerId),
        eq(jobsTable.attempts, job.attempts),
        sql`${jobsTable.leaseExpiresAt} <= NOW()`,
        sql`${jobsTable.attempts} >= ${maxAttempts}`,
      ));
      return;
    }

    const [currentTask] = await tx.select().from(tasksTable).where(eq(tasksTable.id, job.taskId));
    const identity = job.evaluationIdentity as EvaluationIdentity;
    if (!identity || !["pending", "proposed", "in_review"].includes(currentTask.status)) return;

    const inserted = await tx.insert(proposalsTable).values({
      id: randomUUID(),
      projectId: job.projectId,
      taskId: job.taskId,
      mode: job.mode,
      evaluationId: job.evaluationId, evaluationIdentity: job.evaluationIdentity, provenance: job.provenance,
      requestedModel: identity.requestedModel,
      returnedModel: job.mode === "demo" ? "demo-simulator-v1" : (result.model ?? "unknown"),
      label: result.label,
      labelProbability: String(result.labelProbability),
      probabilities: result.probabilities,
      injectionProbability: String(result.injection),
      complexity: result.complexity,
      confidence: String(result.confidence),
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      rawResponse: result.raw ?? result,
    }).onConflictDoNothing().returning({ id: proposalsTable.id });

    if (inserted.length && currentTask.currentEvaluationId === job.evaluationId &&
      evaluationHash(evidenceSnapshot(currentTask)) === identity.snapshotHash &&
      ["pending", "proposed", "in_review"].includes(currentTask.status)) {
      await tx.update(tasksTable).set({
        currentProposalId: inserted[0].id,
        status: "proposed",
        mode: job.mode,
        version: sql`${tasksTable.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(tasksTable.id, job.taskId),
        inArray(tasksTable.status, ["pending", "proposed", "in_review"]),
      ));
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        projectId: job.projectId,
        actorId: `worker:${workerId}`,
        type: "proposal.created",
        entityId: job.taskId,
        payload: { mode: job.mode, jobId: job.id, evaluationId: job.evaluationId },
      });
    }
  });
}

async function saveFailure(
  job: Job,
  workerId: string,
  error: unknown,
  maxAttempts: number,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = error instanceof ProviderError && error.retryable;
  const shouldRetry = retryable && job.attempts < maxAttempts;
  const delayMs = shouldRetry ? getRetryDelayMs(error, job.attempts) : 0;
  await db.update(jobsTable).set({
    status: shouldRetry ? "queued" : "failed",
    availableAt: new Date(Date.now() + delayMs),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: message,
    updatedAt: new Date(),
  }).where(and(
    eq(jobsTable.id, job.id),
    eq(jobsTable.status, "running"),
    eq(jobsTable.leaseOwner, workerId),
    eq(jobsTable.attempts, job.attempts),
    sql`${jobsTable.leaseExpiresAt} > NOW()`,
  ));
  return shouldRetry;
}

export class EvaluationWorker {
  private readonly workerId: string;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly evaluate: typeof evaluateTask;
  private stopped = false;
  private wake?: () => void;
  private lastPollAt = 0;
  private lastPollSucceeded = false;

  constructor(options: WorkerOptions = {}) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.evaluate = options.evaluate ?? evaluateTask;
  }

  async runOnce(): Promise<boolean> {
    const job = await claimJob(
      this.workerId,
      this.leaseMs,
      this.maxAttempts,
      isLiveInferenceEnabled(),
    );
    if (!job) return false;
    try {
      const task = await loadTask(job);
      if (!task) throw new ProviderError("Evaluation task no longer exists");
      const identity = job.evaluationIdentity as EvaluationIdentity | null;
      if (!identity || job.provenance !== "captured" || !job.evaluationId) throw new ProviderError("Legacy evaluation has unknown provenance; enqueue a versioned evaluation");
      if (task.currentEvaluationId !== job.evaluationId || evaluationHash(evidenceSnapshot(task)) !== identity.snapshotHash)
        throw new ProviderError("Evaluation snapshot was superseded");
      await db.transaction(tx => assertFactoryAssistance(tx, job.projectId, "evidence", job.taskId));
      if (!["pending", "proposed", "in_review"].includes(task.status)) throw new ProviderError("Task no longer needs evaluation");
      const reservation = job.mode === "live" ? await reserveJevCall(job.projectId, "evidence", job.taskId, async tx => {
        if (!isLiveInferenceEnabled()) throw new ProviderError("Live inference was disabled before admission");
        await lockFactory(tx, job.projectId, "evidence");
        await assertFactoryAssistance(tx, job.projectId, "evidence", job.taskId);
        const [currentJob] = await tx.select().from(jobsTable).where(and(
          eq(jobsTable.id, job.id), eq(jobsTable.status, "running"),
          eq(jobsTable.leaseOwner, this.workerId), eq(jobsTable.attempts, job.attempts),
          sql`${jobsTable.leaseExpiresAt} > NOW()`,
        )).for("share");
        const [currentTask] = await tx.select().from(tasksTable).where(and(eq(tasksTable.projectId, job.projectId), eq(tasksTable.id, job.taskId))).for("share");
        if (!currentJob || !currentTask || currentTask.currentEvaluationId !== job.evaluationId || evaluationHash(evidenceSnapshot(currentTask)) !== identity.snapshotHash ||
            !["pending", "proposed", "in_review"].includes(currentTask.status)) throw new ProviderError("Evaluation admission changed");
      }) : null;
      let result;
      try { result = await this.evaluate(task, job.mode as EvaluationMode); if (reservation) await finishJevCall(reservation, "succeeded"); }
      catch (error) { if (reservation) await finishJevCall(reservation, "failed"); throw error; }
      await saveSuccess(job, result, this.workerId, this.maxAttempts);
    } catch (error) {
      await saveFailure(job, this.workerId, error, this.maxAttempts);
    }
    return true;
  }

  /** Queue polling health, not provider quality or human-label qualification. */
  ready(): boolean {
    return !this.stopped && this.lastPollSucceeded && performance.now() - this.lastPollAt < this.leaseMs;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(done, ms);
      this.wake = done;
      if (this.stopped) done();
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.lastPollSucceeded = false;
    let failures = 0;
    while (!this.stopped) {
      try {
        const claimed = await this.runOnce();
        this.lastPollSucceeded = true; this.lastPollAt = performance.now(); failures = 0;
        if (!claimed && !this.stopped) await this.wait(this.pollMs);
      } catch {
        this.lastPollSucceeded = false;
        const delayMs = Math.min(5_000, 500 * 2 ** Math.min(failures++, 4));
        console.error(JSON.stringify({ level: "warn", event: "worker_poll_unavailable", retryDelayMs: delayMs }));
        if (!this.stopped) await this.wait(delayMs);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }
}
