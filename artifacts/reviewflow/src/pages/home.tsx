import type { ReactNode } from "react";
import { Link } from "wouter";
import { useGetMetrics, useGetBootstrap } from "@workspace/api-client-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Eyebrow } from "@/components/eyebrow";
import { cn, formatPercent } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Target,
} from "lucide-react";

export default function Home() {
  const {
    data: metrics,
    isLoading: loadingMetrics,
    error: metricsError,
    refetch: refetchMetrics,
  } = useGetMetrics();
  const {
    data: bootstrap,
    isLoading: loadingBootstrap,
    error: bootstrapError,
    refetch: refetchBootstrap,
  } = useGetBootstrap();

  const retry = () => {
    void refetchBootstrap();
    void refetchMetrics();
  };

  if (loadingMetrics || loadingBootstrap) {
    return (
      <div
        className="p-6 min-[861px]:p-8 space-y-8"
        role="status"
        aria-label="Loading overview"
      >
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 min-[861px]:grid-cols-4 border-l border-t border-line-hairline">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="border-r border-b border-line-hairline p-4 space-y-3"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const loadError = bootstrapError ?? metricsError;
  if (loadError) {
    return (
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Unavailable"
          heading="ReviewFlow unavailable"
          description={loadError.message}
          actionLabel="Retry"
          onAction={retry}
        />
      </div>
    );
  }

  const pending = metrics?.pending ?? 0;
  const ctaLabel = pending > 0 ? "Continue reviewing" : "Start review";

  const cells: {
    title: string;
    value: string | number;
    icon: ReactNode;
  }[] = [
    {
      title: "Total Tasks",
      value: metrics?.total ?? "-",
      icon: <FileText className="size-4 text-text-muted" aria-hidden="true" />,
    },
    {
      title: "Pending Review",
      value: metrics?.pending ?? "-",
      icon: <Activity className="size-4 text-text-muted" aria-hidden="true" />,
    },
    {
      title: "Finalized",
      value: metrics?.finalized ?? "-",
      icon: (
        <CheckCircle className="size-4 text-text-muted" aria-hidden="true" />
      ),
    },
    {
      title: "Escalated",
      value: metrics?.escalated ?? "-",
      icon: (
        <AlertTriangle className="size-4 text-text-muted" aria-hidden="true" />
      ),
    },
    {
      title: "Corrections",
      value: `${metrics?.corrections ?? "-"} / ${metrics?.correctionDenominator ?? "-"}`,
      icon: <Target className="size-4 text-text-muted" aria-hidden="true" />,
    },
    {
      title: "Independent Accuracy",
      value:
        metrics?.independentAccuracy != null
          ? formatPercent(metrics.independentAccuracy)
          : "N/A",
      icon: <Target className="size-4 text-text-muted" aria-hidden="true" />,
    },
    {
      title: "Avg Review Time",
      value: metrics?.averageReviewMs
        ? `${(metrics.averageReviewMs / 1000).toFixed(1)}s`
        : "N/A",
      icon: <Clock className="size-4 text-text-muted" aria-hidden="true" />,
    },
    {
      title: "Avg Latency",
      value: metrics?.averageLatencyMs
        ? `${metrics.averageLatencyMs.toFixed(0)}ms`
        : "N/A",
      icon: <Activity className="size-4 text-text-muted" aria-hidden="true" />,
    },
  ];

  return (
    <div className="p-6 min-[861px]:p-8 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Eyebrow>Workbench</Eyebrow>
          <h1 className="type-headline text-text-primary">Overview</h1>
          <p className="type-small text-text-secondary">
            Project: {bootstrap?.projectName} · Model:{" "}
            <span className="font-mono type-meta">{bootstrap?.providerModel}</span>
          </p>
        </div>
        <Link
          href="/review"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          {ctaLabel}
        </Link>
      </div>

      <div
        className="grid grid-cols-2 min-[861px]:grid-cols-4 border-l border-t border-line-hairline"
        aria-label="Overview metrics"
      >
        {cells.map((cell) => (
          <div
            key={cell.title}
            className="border-r border-b border-line-hairline p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>{cell.title}</Eyebrow>
              {cell.icon}
            </div>
            <p className="font-mono type-lead text-text-primary tabular-nums">
              {cell.value}
            </p>
          </div>
        ))}
      </div>

      {(metrics?.total ?? 0) === 0 ? (
        <p className="type-small text-text-muted">
          No tasks yet — start review once a queue is imported, or open Tasks to
          import JSONL.
        </p>
      ) : null}
    </div>
  );
}
