import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useGetNextReview,
  useSubmitReview,
  useGetMetrics,
  getGetNextReviewQueryKey,
  getGetMetricsQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ActiveTimeTracker } from "@/lib/active-time";
import { cn } from "@/lib/utils";
import {
  REVIEW_LABELS,
  REASON_MAX_LENGTH,
  type ReviewAttempt,
  type ReviewLabel,
  canEscalate,
  formatConfidence,
  formatProbability,
  friendlyReviewError,
  isPrimaryBlocked,
  labelTitle,
  primaryActionForSelection,
  primaryButtonLabel,
  reasonHelpText,
  reasonRequirementHint,
  riskTitle,
} from "@/lib/review-decision";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return type !== "radio" && type !== "checkbox" && type !== "button";
  }
  return target.isContentEditable;
}

function ReviewPageHeader({
  awaiting,
  onOpenShortcuts,
}: {
  awaiting: number | null | undefined;
  onOpenShortcuts: () => void;
}) {
  return (
    <header className="flex items-center gap-4 h-14 px-4 min-[861px]:px-8 border-b border-border shrink-0">
      <h1 className="text-base font-semibold tracking-tight">Review</h1>
      <div className="ml-auto flex items-center gap-4 text-sm text-ink-2">
        <span aria-live="polite">
          {awaiting == null ? (
            "…"
          ) : (
            <>
              <b className="text-foreground font-semibold tabular-nums">
                {awaiting}
              </b>
              {" awaiting review"}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="hidden min-[861px]:inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-secondary hover:text-foreground"
          aria-label="Keyboard shortcuts"
        >
          <Kbd>?</Kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </header>
  );
}

function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while typing in the reason field, except
            ⌘/Ctrl+Enter.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {[
            ["1 / 2 / 3", "Choose a label"],
            ["R", "Focus the reason field"],
            ["Enter / ⌘↵", "Submit accept or correct"],
            ["E", "Escalate"],
            ["?", "Open this help"],
          ].map(([keys, desc]) => (
            <li key={keys} className="flex items-center justify-between gap-4">
              <span className="text-ink-2">{desc}</span>
              <Kbd>{keys}</Kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ReviewLoading({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  return (
    <div
      className="h-full flex flex-col"
      role="status"
      aria-label="Loading next task"
    >
      <ReviewPageHeader awaiting={null} onOpenShortcuts={onOpenShortcuts} />
      <div className="flex-1 overflow-auto p-6 min-[861px]:p-12 space-y-4 max-w-[680px]">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-3 w-[420px] max-w-full mb-8" />
        <Skeleton className="h-7 w-[560px] max-w-full" />
        <Skeleton className="h-7 w-[460px] max-w-full mb-8" />
        <Skeleton className="h-3.5 w-[600px] max-w-full" />
        <Skeleton className="h-3.5 w-[520px] max-w-full" />
        <p className="text-sm text-ink-2 pt-4">Loading the next task…</p>
      </div>
    </div>
  );
}

export default function Review() {
  const { data: item, isLoading } = useGetNextReview();
  const { data: metrics } = useGetMetrics();
  const submitReview = useSubmitReview();
  const [reason, setReason] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<ReviewLabel | "">("");
  const [attempt, setAttempt] = useState<ReviewAttempt>(null);
  const [evidenceExcerpt, setEvidenceExcerpt] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const activeTime = useRef(new ActiveTimeTracker());
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const evidenceRef = useRef<HTMLParagraphElement>(null);
  const handlersRef = useRef({
    tryPrimary: () => {},
    tryEscalate: () => {},
    setSelectedLabel: (_label: ReviewLabel) => {},
    setAttempt: (_attempt: ReviewAttempt) => {},
    hasProposal: false,
  });

  const proposal = item?.task.proposal ?? null;
  const proposedLabel = (proposal?.label ?? "supported") as ReviewLabel;
  const effectiveLabel = (selectedLabel || proposedLabel) as ReviewLabel;

  useEffect(() => {
    const isActive = () =>
      document.visibilityState === "visible" && document.hasFocus();
    activeTime.current.reset(isActive());
    const update = () => activeTime.current.setActive(isActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      update();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [item?.task.id]);

  useEffect(() => {
    if (!item) return;
    setReason("");
    setAttempt(null);
    setEvidenceExcerpt(null);
    setSelectedLabel(item.task.proposal?.label ?? "");
    submitReview.reset();
  }, [item?.task.id]);

  const primaryAction = proposal
    ? primaryActionForSelection(effectiveLabel, proposedLabel)
    : null;
  const help = primaryAction
    ? reasonHelpText({ action: primaryAction, attempt, reason })
    : { invalid: false, message: "" };

  const reloadQueue = () => {
    queryClient.invalidateQueries({ queryKey: getGetNextReviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
  };

  const handleAction = (action: "accept" | "correct" | "escalate") => {
    if (!item || !proposal) return;
    submitReview.mutate(
      {
        data: {
          taskId: item.task.id,
          version: item.task.version,
          action,
          reason: action === "accept" ? undefined : reason || undefined,
          correctedLabel: action === "correct" ? effectiveLabel : undefined,
          evidenceExcerpt: evidenceExcerpt || undefined,
          activeMs: activeTime.current.milliseconds(),
        },
      },
      {
        onSuccess: () => {
          setReason("");
          setAttempt(null);
          setEvidenceExcerpt(null);
          setSelectedLabel("");
          reloadQueue();
        },
      },
    );
  };

  const tryPrimary = () => {
    if (!proposal || !primaryAction || submitReview.isPending) return;
    setAttempt("primary");
    if (isPrimaryBlocked(primaryAction, reason)) {
      reasonRef.current?.focus();
      return;
    }
    handleAction(primaryAction);
  };

  const tryEscalate = () => {
    if (!proposal || submitReview.isPending) return;
    setAttempt("escalate");
    if (!canEscalate(reason)) {
      reasonRef.current?.focus();
      return;
    }
    handleAction("escalate");
  };

  handlersRef.current = {
    tryPrimary,
    tryEscalate,
    setSelectedLabel,
    setAttempt,
    hasProposal: Boolean(proposal),
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      const handlers = handlersRef.current;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handlers.tryPrimary();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        if (!handlers.hasProposal) return;
        const next = REVIEW_LABELS[Number(event.key) - 1];
        handlers.setSelectedLabel(next);
        handlers.setAttempt(null);
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        reasonRef.current?.focus();
        return;
      }
      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        handlers.tryEscalate();
        return;
      }
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        handlers.tryPrimary();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const citeSelection = () => {
    if (!item || !evidenceRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text || !item.task.evidence.includes(text)) return;
    if (!evidenceRef.current.contains(selection.anchorNode)) return;
    setEvidenceExcerpt(text);
  };

  const openShortcuts = () => setShortcutsOpen(true);

  if (isLoading) {
    return (
      <>
        <ReviewLoading onOpenShortcuts={openShortcuts} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </>
    );
  }

  if (!item) {
    return (
      <div className="h-full flex flex-col">
        <ReviewPageHeader
          awaiting={metrics?.proposed ?? 0}
          onOpenShortcuts={openShortcuts}
        />
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle>Queue clear</EmptyTitle>
            <EmptyDescription>
              No tasks are waiting for review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              href="/tasks"
              className="text-primary font-medium underline underline-offset-4 hover:text-primary/90"
            >
              Go to Tasks
            </Link>
          </EmptyContent>
        </Empty>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    );
  }

  const renderEvidence = () => {
    const evidence = item.task.evidence;
    if (!evidenceExcerpt || !evidence.includes(evidenceExcerpt)) {
      return evidence;
    }
    const index = evidence.indexOf(evidenceExcerpt);
    return (
      <>
        {evidence.slice(0, index)}
        <mark className="bg-mark text-foreground px-0 shadow-[0_2px_0_hsl(var(--warn))]">
          {evidenceExcerpt}
        </mark>
        {evidence.slice(index + evidenceExcerpt.length)}
      </>
    );
  };

  const primaryNeedsReason =
    !!primaryAction && isPrimaryBlocked(primaryAction, reason);
  const primaryUnavailable = !proposal || submitReview.isPending;

  return (
    <div className="h-full flex flex-col min-h-0">
      <ReviewPageHeader
        awaiting={metrics?.proposed}
        onOpenShortcuts={openShortcuts}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 min-[861px]:grid-cols-[1fr_400px]">
        <section
          className="overflow-auto px-4 py-6 min-[861px]:px-8 min-[861px]:py-12"
          aria-label="Task"
        >
          <div className="max-w-[680px]">
            <p className="flex flex-wrap items-center gap-3 text-sm text-ink-2 mb-6">
              <span className="font-mono font-medium text-foreground text-sm">
                {item.task.externalId}
              </span>
              <span className="text-input" aria-hidden="true">
                ·
              </span>
              <span>{riskTitle(item.task.risk)}</span>
              <SimulatedBadge mode={item.task.mode} />
            </p>

            <section
              className="border-l-2 border-warn pl-4 py-0.5 mb-12"
              aria-labelledby="why-heading"
            >
              <h2
                id="why-heading"
                className="text-xs font-medium text-muted-foreground mb-1"
              >
                Why you&apos;re seeing this
              </h2>
              <ul className="space-y-1">
                {item.routingReasons.map((reasonText) => (
                  <li
                    key={reasonText}
                    className="text-base text-foreground list-none"
                  >
                    {reasonText}
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-xs font-medium text-muted-foreground mb-1">
              Question
            </p>
            <p className="text-lg text-ink-2 mb-8 leading-relaxed">
              {item.task.question}
            </p>

            <p className="text-xs font-medium text-muted-foreground mb-1">
              Candidate answer
            </p>
            <p className="text-[1.5rem] min-[861px]:text-[1.75rem] leading-[1.3] tracking-[-0.015em] font-medium mb-12 text-balance">
              {item.task.candidateAnswer}
            </p>

            <p className="text-xs font-medium text-muted-foreground mb-1">
              Evidence
            </p>
            <p
              ref={evidenceRef}
              onMouseUp={citeSelection}
              className="text-lg leading-[1.65] pl-4 border-l-2 border-border whitespace-pre-wrap selection:bg-mark selection:text-foreground"
            >
              {renderEvidence()}
            </p>
            {!evidenceExcerpt ? (
              <p className="mt-3 pl-[18px] text-xs text-muted-foreground">
                Select text in the evidence to cite it with your decision.
              </p>
            ) : null}
          </div>
        </section>

        <aside
          className="border-t min-[861px]:border-t-0 min-[861px]:border-l border-border flex flex-col min-h-0 bg-background"
          aria-labelledby="decision-heading"
        >
          <div className="flex-1 overflow-auto px-4 py-5 min-[861px]:px-6 min-[861px]:pt-6 min-[861px]:pb-5">
            <h2 id="decision-heading" className="text-base font-semibold mb-1">
              Your decision
            </h2>

            {!proposal ? (
              <p className="text-sm text-ink-2 mb-5">
                No proposal generated. This task cannot be reviewed until a
                proposal exists.
              </p>
            ) : (
              <p className="text-sm text-ink-2 mb-5">
                Model proposes{" "}
                <b className="text-foreground font-semibold">
                  {labelTitle(proposedLabel)}
                </b>
                {" · "}
                {formatConfidence(proposal.confidence)} confidence
              </p>
            )}

            <fieldset disabled={!proposal} className="border-0 p-0 m-0 min-w-0">
              <legend className="sr-only">Label</legend>
              <div
                className="grid gap-1.5 mb-5"
                role="radiogroup"
                aria-label="Label"
              >
                {REVIEW_LABELS.map((label, index) => {
                  const selected =
                    Boolean(proposal) && effectiveLabel === label;
                  const isModel = Boolean(proposal) && proposedLabel === label;
                  const probability = proposal?.probabilities?.[label];
                  return (
                    <label
                      key={label}
                      className={cn(
                        "relative grid grid-cols-[20px_1fr_auto] gap-3 items-center px-3 py-[11px] rounded-md border cursor-pointer text-sm font-medium transition-colors",
                        selected
                          ? "border-primary bg-accent-wash shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
                          : "border-border hover:border-input",
                        !proposal &&
                          "cursor-not-allowed bg-secondary text-muted-foreground hover:border-border",
                        selected && "outline-none",
                      )}
                    >
                      <input
                        type="radio"
                        name="review-label"
                        value={label}
                        className="sr-only"
                        checked={selected}
                        disabled={!proposal}
                        onChange={() => {
                          setSelectedLabel(label);
                          setAttempt(null);
                        }}
                      />
                      <Kbd className="hidden min-[861px]:inline-flex justify-self-start">
                        {index + 1}
                      </Kbd>
                      <span>
                        {labelTitle(label)}
                        {isModel ? (
                          <span className="ml-1.5 font-normal text-xs text-muted-foreground">
                            Model
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
                        {formatProbability(probability)}
                      </span>
                      {probability != null ? (
                        <span
                          className="absolute left-3 right-3 bottom-[5px] h-0.5"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full bg-input opacity-55"
                            style={{
                              width: `${Math.max(0, Math.min(100, probability * 100))}%`,
                            }}
                          />
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              <div className="mb-4">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <label
                    htmlFor="review-reason"
                    className="text-sm font-medium"
                  >
                    Reason
                  </label>
                  <span
                    className={cn(
                      "text-xs text-muted-foreground",
                      primaryAction === "correct" &&
                        "text-foreground font-medium",
                    )}
                  >
                    {primaryAction
                      ? reasonRequirementHint(primaryAction)
                      : "Needed to correct or escalate"}
                  </span>
                </div>
                <Textarea
                  id="review-reason"
                  ref={reasonRef}
                  value={reason}
                  maxLength={REASON_MAX_LENGTH}
                  disabled={!proposal}
                  aria-invalid={help.invalid || undefined}
                  aria-describedby="review-reason-help"
                  placeholder={
                    primaryAction === "correct"
                      ? `Why is it ${labelTitle(effectiveLabel).toLowerCase()}?`
                      : "What in the evidence decides it?"
                  }
                  onChange={(event) => setReason(event.target.value)}
                  className={cn(
                    "min-h-24 resize-y text-sm border-input shadow-none focus-visible:ring-ring",
                    help.invalid &&
                      "border-destructive shadow-[inset_0_0_0_1px_hsl(var(--destructive))]",
                  )}
                />
                <div
                  id="review-reason-help"
                  className="mt-1.5 flex justify-between gap-3 text-xs text-muted-foreground"
                >
                  <span
                    className={cn(
                      help.invalid && "text-destructive font-medium",
                    )}
                  >
                    {help.message}
                  </span>
                  <span className="tabular-nums shrink-0">
                    {reason.length} / {REASON_MAX_LENGTH}
                  </span>
                </div>
              </div>
            </fieldset>

            {evidenceExcerpt ? (
              <div className="mb-4 text-xs text-ink-2" aria-live="polite">
                <div className="flex items-center gap-2">
                  <span>Cited evidence</span>
                  <button
                    type="button"
                    className="underline underline-offset-2 text-ink-2 hover:text-foreground"
                    onClick={() => setEvidenceExcerpt(null)}
                  >
                    Remove
                  </button>
                </div>
                <q className="mt-1 block not-italic rounded bg-secondary px-2.5 py-1.5 text-sm text-foreground">
                  {evidenceExcerpt}
                </q>
              </div>
            ) : null}

            {proposal ? (
              <div
                className="border-t border-border pt-4 text-xs text-muted-foreground"
                aria-label="Model details"
              >
                <dl className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1">
                  <dt>Latency</dt>
                  <dd className="font-mono text-ink-2">
                    {proposal.latencyMs}ms
                  </dd>
                  <dt>Complexity</dt>
                  <dd className="font-mono text-ink-2">
                    {proposal.complexity.toFixed(2)}
                  </dd>
                  <dt>Injection risk</dt>
                  <dd
                    className={cn(
                      "font-mono text-ink-2",
                      proposal.injectionProbability >= 0.5 &&
                        "text-destructive font-medium",
                    )}
                  >
                    {(proposal.injectionProbability * 100).toFixed(1)}%
                  </dd>
                  <dt>Model</dt>
                  <dd className="font-mono text-ink-2 truncate">
                    {proposal.model}
                  </dd>
                </dl>
              </div>
            ) : null}
          </div>

          <div className="border-t border-border px-4 py-4 min-[861px]:px-6 min-[861px]:pb-5 space-y-3 bg-background">
            {submitReview.isError ? (
              <div
                role="alert"
                className="text-sm text-destructive bg-danger-wash border-l-2 border-destructive px-3 py-2"
              >
                <p>Review failed: {friendlyReviewError(submitReview.error)}</p>
                <button
                  type="button"
                  className="mt-1 text-sm font-medium text-primary underline underline-offset-2"
                  onClick={reloadQueue}
                >
                  Reload queue
                </button>
              </div>
            ) : null}

            <Button
              type="button"
              className={cn(
                "w-full h-[46px] text-base font-medium justify-between px-4",
                (!proposal || primaryNeedsReason) &&
                  "bg-secondary text-ink-2 border border-dashed border-input hover:bg-secondary hover:text-ink-2 shadow-none",
              )}
              aria-disabled={
                primaryUnavailable || primaryNeedsReason || undefined
              }
              disabled={submitReview.isPending}
              onClick={tryPrimary}
            >
              <span>
                {!proposal
                  ? "Waiting for a proposal"
                  : primaryAction
                    ? primaryButtonLabel(
                        primaryAction,
                        effectiveLabel,
                        proposedLabel,
                      )
                    : "Accept"}
              </span>
              {proposal ? (
                <Kbd className="hidden min-[861px]:inline-flex bg-transparent text-primary-foreground border-primary-foreground/70">
                  ⌘ ↵
                </Kbd>
              ) : null}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full h-10 text-sm font-medium justify-between border-input text-foreground hover:bg-secondary"
              aria-disabled={!proposal || undefined}
              disabled={submitReview.isPending || !proposal}
              onClick={tryEscalate}
            >
              <span>Escalate</span>
              <Kbd className="hidden min-[861px]:inline-flex">E</Kbd>
            </Button>

            <p className="hidden min-[861px]:flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Kbd className="h-[18px] min-w-[18px] text-[11px]">R</Kbd>
                write reason
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd className="h-[18px] min-w-[18px] text-[11px]">?</Kbd>
                all shortcuts
              </span>
            </p>
          </div>
        </aside>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
