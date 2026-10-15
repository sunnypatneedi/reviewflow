import { Link } from "wouter";
import { SkeletonSwap } from "@/components/interior/skeleton-swap";
import { PropertyList } from "@/components/property-list";
import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
    <div
      className="h-full flex flex-col min-h-0"
      role="status"
      aria-label="Loading next task"
    >
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
        <div className="max-w-md w-full">
          <EmptyState
            eyebrow="Clear"
            heading="Queue clear."
            description={`All ${total} tasks have a decision. Nothing is waiting for review.`}
            hatchHalf={false}
          >
            <PropertyList
              className="text-left max-w-sm !grid-cols-1"
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
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <Button type="button" variant="default" onClick={onCheck}>
                Check for new tasks
              </Button>
              <Link
                href="/tasks"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "inline-flex",
                )}
              >
                Open Tasks
              </Link>
            </div>
          </EmptyState>
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
        <div className="max-w-md w-full">
          <EmptyState
            eyebrow="Error"
            heading="Couldn’t load the next task"
            description="Check your connection and try again."
            actionLabel="Try again"
            onAction={onRetry}
            hatchHalf={false}
          >
            <Link
              href="/tasks"
              className={cn(buttonVariants({ variant: "outline" }), "inline-flex")}
            >
              Open Tasks
            </Link>
          </EmptyState>
        </div>
      </div>
    </div>
  );
}
