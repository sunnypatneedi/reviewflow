import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  jobsTable,
  proposalsTable,
  tasksTable,
} from "@workspace/db";
import {
  evaluateTask,
  getRetryDelayMs,
  type EvaluationMode,
  type EvaluationResult,
  ProviderError,
} from "./evaluation";

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_MS = 30_000;
export const DEFAULT_POLL_MS = 250;

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
}): Promise<number> {
  if (!input.taskIds.length) return 0;
  const existing = await db.select().from(jobsTable).where(and(
    eq(jobsTable.projectId, input.projectId),
    eq(jobsTable.mode, input.mode),
    inArray(jobsTable.taskId, input.taskIds),
  ));
  const existingByTask = new Map(existing.map((job) => [job.taskId, job]));
  let queued = 0;
  for (const job of existing) {
    if (job.status === "failed") {
      await db.update(jobsTable).set({
        status: "queued",
        attempts: 0,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(and(eq(jobsTable.id, job.id), eq(jobsTable.status, "failed")));
      queued++;
    }
  }
  const rows = await db.insert(jobsTable).values(input.taskIds
    .filter((taskId) => !existingByTask.has(taskId))
    .map((taskId) => ({
    id: randomUUID(),
    projectId: input.projectId,
    taskId,
    mode: input.mode,
    status: "queued",
    availableAt: new Date(),
  }))).onConflictDoNothing({
    target: [jobsTable.taskId, jobsTable.mode],
  }).returning({ id: jobsTable.id });
  return queued + rows.length;
}

async function claimJob(workerId: string, leaseMs: number, maxAttempts: number): Promise<Job | null> {
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
    return (claimed.rows[0] as Job | undefined) ?? null;
  });
}

async function loadTask(job: Job) {
  const [task] = await db.select().from(tasksTable).where(and(
    eq(tasksTable.id, job.taskId),
    eq(tasksTable.projectId, job.projectId),
  ));
  return task;
}

async function saveSuccess(job: Job, result: EvaluationResult, workerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(proposalsTable).values({
      id: randomUUID(),
      projectId: job.projectId,
      taskId: job.taskId,
      mode: job.mode,
      requestedModel: job.mode === "demo" ? "demo-simulator-v1" : "jev-1.13.0",
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

    if (inserted.length) {
      await tx.update(tasksTable).set({
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
        payload: { mode: job.mode, jobId: job.id },
      });
    }
    await tx.update(jobsTable).set({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    }).where(and(eq(jobsTable.id, job.id), eq(jobsTable.leaseOwner, workerId)));
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
  }).where(and(eq(jobsTable.id, job.id), eq(jobsTable.leaseOwner, workerId)));
  return shouldRetry;
}

export class EvaluationWorker {
  private readonly workerId: string;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly evaluate: typeof evaluateTask;
  private stopped = false;

  constructor(options: WorkerOptions = {}) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.evaluate = options.evaluate ?? evaluateTask;
  }

  async runOnce(): Promise<boolean> {
    const job = await claimJob(this.workerId, this.leaseMs, this.maxAttempts);
    if (!job) return false;
    try {
      const task = await loadTask(job);
      if (!task) throw new ProviderError("Evaluation task no longer exists");
      const result = await this.evaluate(task, job.mode as EvaluationMode);
      await saveSuccess(job, result, this.workerId);
    } catch (error) {
      await saveFailure(job, this.workerId, error, this.maxAttempts);
    }
    return true;
  }

  async start(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      const claimed = await this.runOnce();
      if (!claimed) await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}