import { useQuery } from "@tanstack/react-query";
import { projectHeaders } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  metricNumber as number,
  metricDuration as duration,
  metricPercent as percent,
} from "@/lib/observability";
import type { aggregateObservability } from "../../../api-server/src/lib/observability";

type Snapshot = ReturnType<typeof aggregateObservability>;
async function readSnapshot(): Promise<Snapshot> {
  const response = await fetch("/api/reviewflow/observability", {
    credentials: "same-origin",
    headers: projectHeaders(),
  });
  if (!response.ok) {
    if (response.status === 403)
      throw new Error(
        "Observability is available to owners and adjudicators without active blind audit assignments.",
      );
    throw new Error(
      response.status === 503
        ? "Snapshot unavailable: the database may be busy or the project exceeds the bounded snapshot limit. Retry shortly."
        : "Unable to load observability. Check your project access and try again.",
    );
  }
  return response.json();
}
function Metrics({
  items,
  compact = false,
}: {
  items: [string, string][];
  compact?: boolean;
}) {
  return (
    <dl
      className={
        compact
          ? "grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3"
          : "grid grid-cols-2 min-[861px]:grid-cols-4 gap-3"
      }
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          className={
            compact
              ? "flex justify-between gap-4 border-b pb-2 min-w-0"
              : "rounded-lg border p-4 min-w-0"
          }
        >
          <dt className="text-sm text-muted-foreground break-words">{label}</dt>
          <dd
            className={
              compact
                ? "font-medium shrink-0"
                : "text-2xl font-semibold mt-2 break-words"
            }
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export default function Observability() {
  const query = useQuery({
    queryKey: [
      "observability",
      projectHeaders()["x-reviewflow-project"] ?? "current",
    ],
    queryFn: readSnapshot,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.isError ? undefined : query.data,
    p = data?.pipeline,
    ops = data?.operations,
    pref = data?.preference;
  return (
    <div className="p-4 min-[861px]:p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h1 className="text-3xl font-semibold">Observability</h1>
          <p className="text-muted-foreground mt-2">
            Project pipeline evidence and local operations. No external
            monitoring calls.
          </p>
        </div>
        <Button
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          aria-label="Refresh observability snapshot"
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>
      {query.isPending && <p role="status">Loading project snapshot…</p>}
      {query.isError && (
        <p role="alert" className="border border-destructive rounded-lg p-4">
          {query.error.message}
        </p>
      )}
      {data && p && ops && pref && (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            Snapshot: {new Date(data.generatedAt).toLocaleString()}.{" "}
            {data.scope}.
          </p>
          {p.total === 0 && pref.total === 0 && (
            <p className="border rounded-lg p-4">
              No tasks or comparisons in this project yet. Import evidence or
              traces to begin; unknown measurements remain N/A.
            </p>
          )}
          <section className="space-y-4" aria-labelledby="evidence-heading">
            <h2 id="evidence-heading" className="text-xl font-semibold">
              Evidence pipeline
            </h2>
            <Metrics
              items={[
                ["Imported tasks", number(p.total)],
                ["Assigned now", number(p.assigned)],
                ["Currently finalized", number(p.completed)],
                ["Declared independent review", number(p.audited)],
                ["Released unique content", number(p.released)],
                ["Currently escalated", number(p.escalated)],
                ["Unresolved disagreements", number(p.unresolvedDisagreements)],
                ["Correction event rate", percent(p.correctionRate)],
              ]}
            />
            <p className="text-sm text-muted-foreground">
              Stage counts use different units and are not a conversion funnel.
              Declared independent reviews are not a validated accuracy
              estimate.
            </p>
            <details className="border rounded-lg p-4">
              <summary className="cursor-pointer font-medium">
                Review effort and release timing
              </summary>
              <div className="pt-4 space-y-3">
                <Metrics
                  compact
                  items={[
                    ["Recorded review effort", duration(p.recordedReviewMs)],
                    [
                      "Mean time to first release",
                      duration(p.averageTimeToFirstReleaseMs),
                    ],
                    ["Release timing samples", number(p.releaseTimingSamples)],
                    ["Release snapshots", number(p.releases)],
                    [
                      "Assisted review events",
                      number(p.reviewCohorts.assisted),
                    ],
                    [
                      "Human-only review events",
                      number(p.reviewCohorts.humanOnly),
                    ],
                    [
                      "Correction events / accept + correct",
                      `${p.corrections} / ${p.correctionDenominator}`,
                    ],
                    ["Escalation events", number(p.escalationEvents)],
                    ["Audit disagreement items", number(p.auditDisagreements)],
                  ]}
                />
                <p className="text-sm text-muted-foreground">
                  Recorded effort is client-reported and excludes
                  audit/adjudication time. Review-event counts include rework;
                  assisted and human-only are recorded modes, not randomized
                  comparison groups.
                </p>
              </div>
            </details>
          </section>
          <section className="space-y-4" aria-labelledby="preference-heading">
            <h2 id="preference-heading" className="text-xl font-semibold">
              Preference pipeline
            </h2>
            <Metrics
              compact
              items={[
                ["Comparisons", number(pref.total)],
                ["Assigned now", number(pref.assigned)],
                ["Current finalized decisions", number(pref.completed)],
                ["Released unique comparisons", number(pref.released)],
              ]}
            />
            <details className="border rounded-lg p-4">
              <summary className="cursor-pointer font-medium">
                Preference review details
              </summary>
              <div className="pt-4 space-y-3">
                <Metrics
                  compact
                  items={[
                    ["Current reviews", number(pref.reviewed)],
                    [
                      "Current quality checks passed",
                      number(pref.qualityPassed),
                    ],
                    ["Independent audits", number(pref.audited)],
                    ["Release snapshots", number(pref.releases)],
                    ["Currently escalated", number(pref.escalated)],
                    ["Current assisted reviews", number(pref.assisted)],
                    ["Current human-only reviews", number(pref.humanOnly)],
                  ]}
                />
                <p className="text-sm text-muted-foreground">
                  {data.definitions.preference}
                </p>
              </div>
            </details>
          </section>
          <section
            className="space-y-3 border rounded-lg p-4"
            aria-labelledby="unmeasured-heading"
          >
            <h2 id="unmeasured-heading" className="text-lg font-semibold">
              Not yet measured
            </h2>
            <Metrics
              compact
              items={[
                ["Total human effort", duration(p.totalHumanEffortMs)],
                ["Cost per accepted item", number(p.costPerAcceptedItem)],
                ["Independent accuracy", percent(p.independentAccuracy)],
                ["Baseline improvement", percent(p.baselineImprovement)],
              ]}
            />
            <p className="text-sm text-muted-foreground">
              Complete audit/adjudication timing, pricing/currency records, a
              validated independent quality estimate and a comparable baseline
              are not captured. This dashboard makes no benchmark claim.
            </p>
          </section>
          <section className="space-y-4" aria-labelledby="operations-heading">
            <h2 id="operations-heading" className="text-xl font-semibold">
              Local operations
            </h2>
            <p className="text-sm text-muted-foreground">
              Database reachable at snapshot time. Provider health not probed.
              Worker heartbeat not instrumented; queue state alone does not
              establish readiness.
            </p>
            <Metrics
              compact
              items={[
                ["Queued", number(ops.queue.queued)],
                ["Running", number(ops.queue.running)],
                ["Succeeded", number(ops.queue.succeeded)],
                ["Failed", number(ops.queue.failed)],
                ["Expired leases", number(ops.queue.expiredLeases)],
                ["Oldest active job", duration(ops.queue.oldestActiveAgeMs)],
              ]}
            />
            <details className="border rounded-lg p-4">
              <summary className="cursor-pointer font-medium">
                Queue and evaluation measurements
              </summary>
              <div className="pt-4 space-y-4">
                <Metrics
                  compact
                  items={[
                    ["Ready to claim", number(ops.queue.ready)],
                    ["Delayed", number(ops.queue.delayed)],
                    [
                      "Jobs retried in current cycle",
                      number(ops.queue.retriedJobs),
                    ],
                    [
                      "Current-cycle retry attempts",
                      number(ops.queue.retryAttempts),
                    ],
                    ["Missing leases", number(ops.queue.missingLeases)],
                    ["Unknown job status", number(ops.queue.unknown)],
                  ]}
                />
                <h3 className="font-medium">Evidence evaluation proposals</h3>
                <Metrics
                  compact
                  items={[
                    ["Live proposal samples", number(ops.live.count)],
                    [
                      "Live measured mean latency",
                      duration(ops.live.averageLatencyMs),
                    ],
                    ["Demo proposal samples", number(ops.simulated.count)],
                    [
                      "Demo simulated mean latency",
                      duration(ops.simulated.averageLatencyMs),
                    ],
                    [
                      "Live recorded input tokens",
                      number(ops.live.inputTokens),
                    ],
                    [
                      "Live input token coverage",
                      `${ops.live.tokenCoverage.input}/${ops.live.count}`,
                    ],
                    [
                      "Live recorded output tokens",
                      number(ops.live.outputTokens),
                    ],
                    [
                      "Live output token coverage",
                      `${ops.live.tokenCoverage.output}/${ops.live.count}`,
                    ],
                    [
                      "Unknown proposal modes",
                      number(ops.unknownModeProposals),
                    ],
                  ]}
                />
                <p className="text-sm text-muted-foreground">
                  {data.definitions.latency}
                </p>
              </div>
            </details>
          </section>
          <details className="border rounded-lg p-4">
            <summary className="cursor-pointer font-medium">
              Metric definitions and limits
            </summary>
            <div className="pt-4 space-y-4">
              <dl className="space-y-3">
                {Object.entries(data.definitions).map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium break-words">{key}</dt>
                    <dd className="text-sm text-muted-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">
                Snapshots stop rather than sample if any projected table exceeds
                50,000 rows. Reads have a two-second per-statement database
                timeout. This is a point-in-time local view, not historical
                monitoring or a service availability guarantee.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
