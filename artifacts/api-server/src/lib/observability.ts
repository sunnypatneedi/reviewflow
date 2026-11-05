/** Aggregate only evidence-factory records. No labels, identities or source text in output. */
export type ObservationRows = {
  tasks: { id: string; status: string; contentHash: string; createdAt: Date }[];
  jobs: {
    status: string;
    attempts: number;
    createdAt: Date;
    availableAt: Date;
    leaseExpiresAt: Date | null;
  }[];
  proposals: {
    mode: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  reviews: {
    taskId: string;
    action: string;
    activeMs: number;
    assisted: boolean;
  }[];
  assignments: { itemId: string; expiresAt: Date | null }[];
  preference: {
    kind: string;
    reviewed: boolean;
    finalized: boolean;
    escalated: boolean;
    qualityPassed: boolean;
    assisted: boolean | null;
    releasedIds: unknown;
  }[];
  preferenceAssignments: { expiresAt: Date | null }[];
  decisions: { taskId: string }[];
  disputes: { status: string }[];
  releases: { hashes: unknown; createdAt: Date }[];
};
export const OBSERVABILITY_ROLES = ["owner", "adjudicator"] as const;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const unique = (xs: string[]) => new Set(xs).size;
export function aggregateObservability(
  rows: ObservationRows,
  now = new Date(),
) {
  const taskIds = new Set(rows.tasks.map((t) => t.id));
  const review = rows.reviews.filter((r) => taskIds.has(r.taskId));
  const completedReviews = review.filter((r) =>
    ["accept", "correct"].includes(r.action),
  );
  const firstRelease = new Map<string, number>();
  for (const release of rows.releases) {
    if (!Array.isArray(release.hashes)) continue;
    for (const hash of release.hashes)
      if (typeof hash === "string") {
        firstRelease.set(
          hash,
          Math.min(
            firstRelease.get(hash) ?? Infinity,
            release.createdAt.getTime(),
          ),
        );
      }
  }
  const releaseDurations = rows.tasks.flatMap((task) => {
    const releasedAt = firstRelease.get(task.contentHash);
    return releasedAt !== undefined && releasedAt >= task.createdAt.getTime()
      ? [releasedAt - task.createdAt.getTime()]
      : [];
  });
  const statuses = ["queued", "running", "succeeded", "failed"] as const;
  const active = rows.jobs.filter((j) =>
    ["queued", "running"].includes(j.status),
  );
  const latency = (mode: string) => {
    const proposals = rows.proposals.filter((p) => p.mode === mode);
    const validLatency = proposals
      .map((p) => p.latencyMs)
      .filter((n) => Number.isFinite(n) && n >= 0);
    return {
      count: proposals.length,
      latencySamples: validLatency.length,
      averageLatencyMs: mean(validLatency),
      inputTokens: proposals.some((p) => p.inputTokens !== null)
        ? proposals.reduce((n, p) => n + (p.inputTokens ?? 0), 0)
        : null,
      outputTokens: proposals.some((p) => p.outputTokens !== null)
        ? proposals.reduce((n, p) => n + (p.outputTokens ?? 0), 0)
        : null,
      tokenCoverage: {
        input: proposals.filter((p) => p.inputTokens !== null).length,
        output: proposals.filter((p) => p.outputTokens !== null).length,
      },
    };
  };
  return {
    generatedAt: now.toISOString(),
    scope:
      "Evidence and preference factories; retained project records; incomplete effort and quality instrumentation",
    pipeline: {
      total: rows.tasks.length,
      assigned: unique(
        rows.assignments
          .filter(
            (a) => taskIds.has(a.itemId) && a.expiresAt && a.expiresAt > now,
          )
          .map((a) => a.itemId),
      ),
      completed: rows.tasks.filter((t) => t.status === "finalized").length,
      audited: unique(
        rows.decisions
          .filter((d) => taskIds.has(d.taskId))
          .map((d) => d.taskId),
      ),
      released: firstRelease.size,
      releases: rows.releases.length,
      escalated: rows.tasks.filter((t) => t.status === "escalated").length,
      escalationEvents: review.filter((r) => r.action === "escalate").length,
      corrections: completedReviews.filter((r) => r.action === "correct")
        .length,
      correctionDenominator: completedReviews.length,
      correctionRate: completedReviews.length
        ? completedReviews.filter((r) => r.action === "correct").length /
          completedReviews.length
        : null,
      auditDisagreements: rows.disputes.length,
      unresolvedDisagreements: rows.disputes.filter(
        (d) => d.status === "pending",
      ).length,
      reviewCohorts: {
        assisted: review.filter((r) => r.assisted).length,
        humanOnly: review.filter((r) => !r.assisted).length,
      },
      recordedReviewMs: review.reduce((n, r) => n + Math.max(0, r.activeMs), 0),
      totalHumanEffortMs: null,
      costPerAcceptedItem: null,
      independentAccuracy: null,
      baselineImprovement: null,
      averageTimeToFirstReleaseMs: mean(releaseDurations),
      p95TimeToFirstReleaseMs: releaseDurations.length
        ? [...releaseDurations].sort((a, b) => a - b)[
            Math.ceil(releaseDurations.length * 0.95) - 1
          ]
        : null,
      releaseTimingSamples: releaseDurations.length,
    },
    preference: {
      total: rows.preference.filter((r) => r.kind === "comparison").length,
      assigned: rows.preferenceAssignments.filter(
        (a) => a.expiresAt && a.expiresAt > now,
      ).length,
      reviewed: rows.preference.filter(
        (r) => r.kind === "comparison" && r.reviewed,
      ).length,
      completed: rows.preference.filter(
        (r) => r.kind === "comparison" && r.finalized,
      ).length,
      qualityPassed: rows.preference.filter(
        (r) => r.kind === "comparison" && r.qualityPassed,
      ).length,
      audited: null,
      escalated: rows.preference.filter(
        (r) => r.kind === "comparison" && r.escalated,
      ).length,
      assisted: rows.preference.filter(
        (r) => r.kind === "comparison" && r.assisted === true,
      ).length,
      humanOnly: rows.preference.filter(
        (r) => r.kind === "comparison" && r.assisted === false,
      ).length,
      releases: rows.preference.filter((r) => r.kind === "release").length,
      released: unique(
        rows.preference
          .filter((r) => r.kind === "release")
          .flatMap((r) =>
            Array.isArray(r.releasedIds)
              ? r.releasedIds.filter(
                  (id): id is string => typeof id === "string",
                )
              : [],
          ),
      ),
    },
    operations: {
      database: "reachable",
      providerHealth: "not_probed",
      workerHeartbeat: "not_instrumented",
      queue: {
        ...(Object.fromEntries(
          statuses.map((status) => [
            status,
            rows.jobs.filter((j) => j.status === status).length,
          ]),
        ) as Record<(typeof statuses)[number], number>),
        unknown: rows.jobs.filter(
          (j) => !statuses.includes(j.status as (typeof statuses)[number]),
        ).length,
        ready: rows.jobs.filter(
          (j) => j.status === "queued" && j.availableAt <= now,
        ).length,
        delayed: rows.jobs.filter(
          (j) => j.status === "queued" && j.availableAt > now,
        ).length,
        retriedJobs: rows.jobs.filter((j) => j.attempts > 1).length,
        retryAttempts: rows.jobs.reduce(
          (n, j) => n + Math.max(0, j.attempts - 1),
          0,
        ),
        expiredLeases: rows.jobs.filter(
          (j) =>
            j.status === "running" &&
            j.leaseExpiresAt !== null &&
            j.leaseExpiresAt <= now,
        ).length,
        missingLeases: rows.jobs.filter(
          (j) => j.status === "running" && j.leaseExpiresAt === null,
        ).length,
        oldestActiveAgeMs: active.length
          ? Math.max(
              ...active.map((j) =>
                Math.max(0, now.getTime() - j.createdAt.getTime()),
              ),
            )
          : null,
      },
      live: latency("live"),
      simulated: latency("demo"),
      unknownModeProposals: rows.proposals.filter(
        (p) => !["live", "demo"].includes(p.mode),
      ).length,
    },
    definitions: {
      preference:
        "Preference completed means a current finalized decision with no pending annotation, not release eligibility. Quality-passed is a current evidence/privacy check, not independent audit. Released counts distinct pseudonymous IDs across retained complete snapshots (including non-training items); no cross-factory deduplication. Review cohorts describe current reviews, not causal treatment groups. Effort/provider metrics below cover evidence only; use Trace2Preference analysis for partial preference effort.",
      reviewCohorts:
        "Evidence review-event counts split by saved proposal linkage (assisted/human-only), including rework; not randomized cohorts or proof of no prior exposure.",
      assigned:
        "Distinct evidence tasks with an unexpired assignment now; not cumulative assignments.",
      completed:
        "Tasks currently finalized; not proof that a release gate passed.",
      audited:
        "Distinct tasks with an included, non-self-check decision in a declared independent audit; not validated accuracy.",
      released:
        "Distinct content hashes in retained evidence release manifests, deduplicated across releases; not current task versions.",
      correctionRate:
        "Correct review events / (accept + correct review events). Human-only labels and escalations excluded; not independent model error.",
      recordedReviewMs:
        "Sum of client-reported activeMs on saved review events, including escalation/rework. Audit/adjudication time is not captured, so total human effort is unavailable.",
      averageTimeToFirstReleaseMs:
        "Mean and nearest-rank p95 task creation to first retained release containing its current content hash; denominator is releaseTimingSamples, not release count.",
      latency:
        "Successful persisted evaluation proposals only; live is measured, demo is simulated. Failed attempts and routing-advice calls are excluded. Token totals are partial when coverage is incomplete.",
      queue:
        "All retained evaluation jobs in all modes. Retry counts describe each job's current attempt cycle. Manual requeue resets attempts; these are not lifetime attempts or billed calls. Oldest age is since job creation, including retries. Expired leases signal reclaimable work, not proof of worker failure.",
      unavailable:
        "N/A: no complete effort instrumentation, pricing/currency records, validated independent quality estimate or comparable baseline. No benchmark claim.",
    },
  };
}
