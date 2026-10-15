import { Link } from "wouter";
import { Check } from "lucide-react";
import { SkeletonSwap } from "@/components/interior/skeleton-swap";
import { PropertyList } from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionSummary } from "@/lib/review-decision";
import { ReviewPageHeader } from "./review-header";

export function ReviewLoadingSkeleton() {
  return (
    <div className="flex-1 grid grid-cols-1 min-[861px]:grid-cols-[1fr_400px] min-h-0">
      <div className="px-4 py-6 min-[861px]:px-8 min-[861px]:py-12 space-y-4 max-w-[680px]">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-[55%] mb-8" />
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-10 w-[88%]" />
        <Skeleton className="h-10 w-[42%] mb-8" />
        <Skeleton className="h-28 w-full mb-6" />
        <Skeleton className="h-20 w-full mb-8" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="border-t min-[861px]:border-t-0 min-[861px]:border-l border-line-hairline px-4 py-5 min-[861px]:px-6 space-y-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-52 mb-4" />
        <Skeleton className="h-40 w-full mb-4" />
        <Skeleton className="h-28 w-full mb-6" />
        <Skeleton className="h-[52px] w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}

export function ReviewLoading({
  awaiting,
  decided,
  total,
  onOpenShortcuts,
  onOpenCommands,
  ready,
  children,
}: {
  awaiting: number | null | undefined;
  decided?: number | null;
  total?: number | null;
  onOpenShortcuts: () => void;
  onOpenCommands?: () => void;
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col min-h-0" role="status" aria-label="Loading next task">
      <ReviewPageHeader
        awaiting={awaiting}
        decided={decided}
        total={total}
        onOpenShortcuts={onOpenShortcuts}
        onOpenCommands={onOpenCommands}
      />
      <SkeletonSwap
        ready={ready}
        delay={120}
        reserve={640}
        className="flex-1 min-h-0 !h-auto overflow-visible"
        skeleton={<ReviewLoadingSkeleton />}
        label="Next review task"
      >
        {children}
      </SkeletonSwap>
    </div>
  );
}

export function QueueClear({
  total,
  session,
  onCheck,
  onOpenShortcuts,
  onOpenCommands,
  awaiting,
  decided,
}: {
  total: number;
  session: SessionSummary;
  onCheck: () => void;
  onOpenShortcuts: () => void;
  onOpenCommands?: () => void;
  awaiting?: number;
  decided?: number;
}) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <ReviewPageHeader
        awaiting={awaiting ?? 0}
        decided={decided ?? session.decided}
        total={total}
        onOpenShortcuts={onOpenShortcuts}
        onOpenCommands={onOpenCommands}
      />
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-fill-subtle text-text-primary mb-6">
            <Check className="size-6" strokeWidth={2} aria-hidden="true" />
          </span>
          <h2 className="font-serif text-display mb-3">Queue clear.</h2>
          <p className="text-small text-text-secondary mb-8">
            All {total} tasks have a decision. Nothing is waiting for review.
          </p>
          <PropertyList
            className="mb-8 text-left max-w-sm mx-auto !grid-cols-1"
            aria-label="Session summary"
            rows={[
              {
                id: "decided",
                label: "Decided this session",
                value: String(session.decided),
              },
              {
                id: "corrected",
                label: "Corrected",
                value: String(session.corrected),
              },
              {
                id: "escalated",
                label: "Escalated",
                value: String(session.escalated),
              },
            ]}
          />
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
            <Button type="button" size="lg" onClick={onCheck}>
              Check for new tasks
            </Button>
            <Link
              href="/tasks"
              className="inline-flex items-center justify-center min-h-[52px] h-[52px] px-5 rounded-md bg-fill-subtle text-text-primary text-body font-medium hover:bg-fill-emphasis"
            >
              Open Tasks
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoadError({
  onRetry,
  onOpenShortcuts,
  onOpenCommands,
}: {
  onRetry: () => void;
  onOpenShortcuts: () => void;
  onOpenCommands?: () => void;
}) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <ReviewPageHeader
        awaiting={null}
        onOpenShortcuts={onOpenShortcuts}
        onOpenCommands={onOpenCommands}
      />
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full text-center" role="alert">
          <h2 className="font-serif text-display mb-3">
            Couldn&apos;t load the next task
          </h2>
          <p className="text-small text-text-secondary mb-8">
            Check your connection and try again.
          </p>
          <Button type="button" size="lg" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
