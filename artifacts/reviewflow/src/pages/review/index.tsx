import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  useGetNextReview,
  useSubmitReview,
  useGetMetrics,
  getGetNextReviewQueryKey,
  getGetMetricsQueryKey,
} from "@workspace/api-client-react";
import { CollapsibleBanner } from "@/components/interior/collapsible-banner";
import { queryClient } from "@/lib/queryClient";
import { ActiveTimeTracker } from "@/lib/active-time";
import {
  type ReviewAttempt,
  type ReviewLabel,
  canEscalate,
  friendlyReviewError,
  isConflictError,
  isPrimaryBlocked,
  labelTitle,
  primaryActionForSelection,
  progressFromMetrics,
} from "@/lib/review-decision";
import { ClaimDocument } from "./claim-document";
import { CommandMenu } from "./command-menu";
import { DecisionPanel } from "./decision-panel";
import { EscalateDialog } from "./escalate-dialog";
import { ReviewPageHeader } from "./review-header";
import { LoadError, QueueClear, ReviewLoading } from "./review-states";
import { recordSessionDecision, readSessionSummary } from "./session";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { useOnline } from "./use-online";
import {
  useReviewShortcuts,
  type ReviewShortcutHandlers,
} from "./use-review-shortcuts";

const CROSSFADE = {
  type: "spring",
  stiffness: 260,
  damping: 34,
  mass: 0.8,
} as const;

function SuccessToastBody({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-md bg-fill-inverse text-text-inverse px-4 py-3 shadow-surface min-w-[280px]">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5">
          ✓
        </span>
        <div className="min-w-0">
          <p className="text-small font-medium">{title}</p>
          <p className="text-caption mt-0.5 text-text-inverse">{detail}</p>
        </div>
      </div>
      <div className="rf-toast-life" aria-hidden="true" />
    </div>
  );
}

export default function Review() {
  const {
    data: item,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGetNextReview();
  const { data: metrics } = useGetMetrics();
  const submitReview = useSubmitReview();
  const online = useOnline();
  const reduced = useReducedMotion();

  const [reason, setReason] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<ReviewLabel | "">("");
  const [attempt, setAttempt] = useState<ReviewAttempt>(null);
  const [evidenceExcerpt, setEvidenceExcerpt] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [nudgeReason, setNudgeReason] = useState(false);
  const [session, setSession] = useState(readSessionSummary);

  const activeTime = useRef(new ActiveTimeTracker());
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const caseHeadingRef = useRef<HTMLHeadingElement>(null);

  const proposal = item?.task.proposal ?? null;
  const proposedLabel = (proposal?.label ?? "supported") as ReviewLabel;
  const effectiveLabel = (selectedLabel || proposedLabel) as ReviewLabel;
  const progress = metrics ? progressFromMetrics(metrics) : null;

  const handlersRef = useRef<ReviewShortcutHandlers>({
    tryPrimary: () => {},
    openEscalate: () => {},
    setSelectedLabel: () => {},
    focusReason: () => {},
    cite: () => {},
    openShortcuts: () => {},
    openCommands: () => {},
    closeTop: () => false,
    hasProposal: false,
    escalateOpen: false,
    commandsOpen: false,
  });

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
    setNudgeReason(false);
    submitReview.reset();
    queueMicrotask(() => caseHeadingRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on task change only
  }, [item?.task.id]);

  const reloadQueue = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetNextReviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
  }, []);

  const showSuccessToast = (
    action: "accept" | "correct" | "escalate",
    externalId: string,
    label: ReviewLabel,
  ) => {
    const title =
      action === "accept"
        ? `Accepted ${externalId}`
        : action === "correct"
          ? `Corrected ${externalId}`
          : `Escalated ${externalId}`;
    const detail =
      action === "escalate"
        ? "Waiting for release access"
        : labelTitle(label);

    // Ship without Undo — no revert endpoint exists (documented).
    toast.custom(() => <SuccessToastBody title={title} detail={detail} />, {
      duration: 5000,
    });
  };

  const handleAction = (
    action: "accept" | "correct" | "escalate",
    reasonOverride?: string,
  ) => {
    if (!item || !proposal) return Promise.resolve();
    if (!online) return Promise.resolve();
    const reasonValue = reasonOverride ?? reason;

    return new Promise<void>((resolve, reject) => {
      submitReview.mutate(
        {
          data: {
            taskId: item.task.id,
            version: item.task.version,
            action,
            reason: action === "accept" ? undefined : reasonValue || undefined,
            correctedLabel: action === "correct" ? effectiveLabel : undefined,
            evidenceExcerpt: evidenceExcerpt || undefined,
            activeMs: activeTime.current.milliseconds(),
          },
        },
        {
          onSuccess: () => {
            const next = recordSessionDecision(action);
            setSession(next);
            showSuccessToast(
              action,
              item.task.externalId,
              action === "correct" ? effectiveLabel : proposedLabel,
            );
            setReason("");
            setAttempt(null);
            setEvidenceExcerpt(null);
            setSelectedLabel("");
            setEscalateOpen(false);
            reloadQueue();
            resolve();
          },
          onError: (error: unknown) => {
            reject(error);
          },
        },
      );
    });
  };

  const tryPrimary = async () => {
    if (!proposal || submitReview.isPending || !online) return;
    const primaryAction = primaryActionForSelection(
      effectiveLabel,
      proposedLabel,
    );
    setAttempt("primary");
    if (isPrimaryBlocked(primaryAction, reason)) {
      setNudgeReason(true);
      reasonRef.current?.focus();
      reasonRef.current?.classList.add("animate-rf-nudge");
      return;
    }
    await handleAction(primaryAction);
  };

  const openEscalate = () => {
    if (!proposal || submitReview.isPending || !online) return;
    setEscalateOpen(true);
  };

  const confirmEscalate = async (escalateReason?: string) => {
    if (!proposal || submitReview.isPending || !online) return;
    const value = escalateReason ?? reason;
    setAttempt("escalate");
    if (!canEscalate(value)) {
      return;
    }
    setReason(value);
    await handleAction("escalate", value);
  };

  const citeFromSelection = () => {
    if (!item) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text || !item.task.evidence.includes(text)) return;
    setEvidenceExcerpt(text);
  };

  const copyTaskId = () => {
    if (!item) return;
    void navigator.clipboard?.writeText(item.task.externalId);
  };

  const closeTop = () => {
    if (escalateOpen) {
      setEscalateOpen(false);
      return true;
    }
    if (commandsOpen) {
      setCommandsOpen(false);
      return true;
    }
    if (shortcutsOpen) {
      setShortcutsOpen(false);
      return true;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
      return true;
    }
    return false;
  };

  handlersRef.current = {
    tryPrimary: () => {
      void tryPrimary();
    },
    openEscalate,
    confirmEscalate: () => {
      void confirmEscalate();
    },
    setSelectedLabel: (label) => {
      setSelectedLabel(label);
      setAttempt(null);
    },
    focusReason: () => reasonRef.current?.focus(),
    cite: citeFromSelection,
    openShortcuts: () => setShortcutsOpen(true),
    openCommands: () => setCommandsOpen(true),
    closeTop,
    hasProposal: Boolean(proposal),
    escalateOpen,
    commandsOpen,
  };

  useReviewShortcuts(handlersRef);

  const openShortcuts = () => setShortcutsOpen(true);
  const openCommands = () => setCommandsOpen(true);

  const dialogs = (
    <>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandMenu
        open={commandsOpen}
        onOpenChange={setCommandsOpen}
        hasProposal={Boolean(proposal)}
        onSelectLabel={(label) => {
          setSelectedLabel(label);
          setAttempt(null);
        }}
        onOpenEscalate={openEscalate}
        onFocusReason={() => reasonRef.current?.focus()}
        onCite={citeFromSelection}
        onCopyId={copyTaskId}
        onOpenShortcuts={openShortcuts}
      />
      {item ? (
        <EscalateDialog
          open={escalateOpen}
          onOpenChange={setEscalateOpen}
          taskId={item.task.externalId}
          initialReason={reason}
          pending={submitReview.isPending}
          onReasonSync={setReason}
          onConfirm={(value) => {
            void confirmEscalate(value);
          }}
        />
      ) : null}
    </>
  );

  const offlineBanner = !online ? (
    <CollapsibleBanner
      dismissible={false}
      title="You're offline"
      description="Decisions can't be saved. Your work on this task stays here until you reconnect."
      action={
        <button
          type="button"
          className="text-small font-medium underline underline-offset-2"
          onClick={() => refetch()}
        >
          Try again
        </button>
      }
      className="mx-4 min-[861px]:mx-8 mt-3"
    />
  ) : null;

  if (isError && !item) {
    return (
      <>
        <LoadError
          onRetry={() => refetch()}
          onOpenShortcuts={openShortcuts}
          onOpenCommands={openCommands}
        />
        {dialogs}
      </>
    );
  }

  if (isLoading && !item) {
    return (
      <>
        <ReviewLoading
          awaiting={progress?.awaiting}
          decided={progress?.decided}
          total={progress?.total}
          onOpenShortcuts={openShortcuts}
          onOpenCommands={openCommands}
          ready={false}
        >
          <div />
        </ReviewLoading>
        {dialogs}
      </>
    );
  }

  if (!item && !isFetching) {
    return (
      <>
        <QueueClear
          total={metrics?.total ?? 0}
          session={session}
          awaiting={progress?.awaiting ?? 0}
          decided={progress?.decided}
          onCheck={() => refetch()}
          onOpenShortcuts={openShortcuts}
          onOpenCommands={openCommands}
        />
        {dialogs}
      </>
    );
  }

  if (!item) {
    return (
      <>
        <ReviewLoading
          awaiting={progress?.awaiting}
          decided={progress?.decided}
          total={progress?.total}
          onOpenShortcuts={openShortcuts}
          onOpenCommands={openCommands}
          ready={false}
        >
          <div />
        </ReviewLoading>
        {dialogs}
      </>
    );
  }

  const submitError = submitReview.isError
    ? friendlyReviewError(submitReview.error)
    : null;
  const conflict = submitReview.isError
    ? isConflictError(submitReview.error)
    : false;

  return (
    <div className="h-full flex flex-col min-h-0">
      <ReviewPageHeader
        awaiting={progress?.awaiting}
        decided={progress?.decided}
        total={progress?.total}
        onOpenShortcuts={openShortcuts}
        onOpenCommands={openCommands}
      />
      {offlineBanner}

      <AnimatePresence mode="wait">
        <motion.div
          key={item.task.id}
          className="flex-1 min-h-0 grid grid-cols-1 min-[861px]:grid-cols-[1fr_400px]"
          initial={
            reduced
              ? { opacity: 1 }
              : { opacity: 0, y: 8, scale: 0.995, filter: "blur(2px)" }
          }
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={
            reduced
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  y: -8,
                  transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                }
          }
          transition={reduced ? { duration: 0 } : CROSSFADE}
        >
          <section
            className="min-[861px]:overflow-auto px-4 py-6 min-[861px]:px-8 min-[861px]:py-12"
            aria-label="Task"
          >
            <h2 ref={caseHeadingRef} tabIndex={-1} className="sr-only">
              Reviewing {item.task.externalId}
            </h2>
            <ClaimDocument
              item={item}
              evidenceExcerpt={evidenceExcerpt}
              onCite={setEvidenceExcerpt}
              onClearCite={() => setEvidenceExcerpt(null)}
            />
          </section>

          <DecisionPanel
            proposal={proposal}
            effectiveLabel={effectiveLabel}
            proposedLabel={proposedLabel}
            reason={reason}
            attempt={attempt}
            evidenceExcerpt={evidenceExcerpt}
            offline={!online}
            submitting={submitReview.isPending}
            submitError={submitError}
            conflict={conflict}
            onSelectLabel={(label) => {
              setSelectedLabel(label);
              setAttempt(null);
            }}
            onReasonChange={(value) => {
              setReason(value);
              setNudgeReason(false);
            }}
            onClearCite={() => setEvidenceExcerpt(null)}
            onSubmitPrimary={tryPrimary}
            onOpenEscalate={openEscalate}
            onRetry={() => {
              void tryPrimary();
            }}
            onReload={reloadQueue}
            reasonRef={reasonRef}
            nudgeReason={nudgeReason}
            stickyActions
          />
        </motion.div>
      </AnimatePresence>

      {dialogs}
    </div>
  );
}
