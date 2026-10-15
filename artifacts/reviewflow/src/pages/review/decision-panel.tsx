import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useAsyncAction } from "@/components/interior/loading-button";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  REVIEW_LABELS,
  REASON_MAX_LENGTH,
  formatProbability,
  labelTitle,
  primaryActionForSelection,
  primaryButtonLabel,
  reasonFieldCopy,
  reasonHelpText,
  submitShortcutLabel,
  type ReviewAttempt,
  type ReviewLabel,
} from "@/lib/review-decision";
import { cn } from "@/lib/utils";
import type { Proposal } from "@workspace/api-client-react";

const CELL = {
  type: "spring",
  stiffness: 520,
  damping: 34,
  mass: 0.45,
} as const;

function ActionStack({
  proposal,
  offline,
  pending,
  primaryLabel,
  showEscalatePrimary,
  shortcut,
  submitError,
  conflict,
  onSubmitPrimary,
  onOpenEscalate,
  onRetry,
  onReload,
  sticky,
}: {
  proposal: Proposal | null;
  offline: boolean;
  pending: boolean;
  primaryLabel: string;
  showEscalatePrimary: boolean;
  shortcut: string;
  submitError: string | null;
  conflict: boolean;
  onSubmitPrimary: () => void;
  onOpenEscalate: () => void;
  onRetry: () => void;
  onReload: () => void;
  sticky?: boolean;
}) {
  const escalateBtn = (
    <Button
      type="button"
      size="lg"
      variant={showEscalatePrimary ? "default" : "secondary"}
      className="w-full justify-between px-4 max-[860px]:min-h-12 max-[860px]:h-12"
      disabled={offline || !proposal || pending}
      onClick={onOpenEscalate}
    >
      <span>Escalate…</span>
      <Kbd
        data-key="e"
        className={cn(
          "hidden min-[861px]:inline-flex",
          showEscalatePrimary &&
            "bg-transparent text-text-inverse border-text-inverse",
        )}
      >
        E
      </Kbd>
    </Button>
  );

  const primaryBtn = (
    <Button
      type="button"
      size="lg"
      variant={showEscalatePrimary ? "secondary" : "default"}
      className="w-full justify-between px-4 max-[860px]:min-h-12 max-[860px]:h-12"
      disabled={offline || !proposal || pending}
      onClick={onSubmitPrimary}
    >
      <span className="min-w-0 flex-1 truncate text-left">
        {pending ? "Saving…" : primaryLabel}
      </span>
      {proposal && !offline && !pending ? (
        <Kbd
          data-key="enter"
          className={cn(
            "hidden min-[861px]:inline-flex shrink-0",
            !showEscalatePrimary &&
              "bg-transparent text-text-inverse border-text-inverse",
          )}
        >
          {shortcut}
        </Kbd>
      ) : null}
    </Button>
  );

  return (
    <div
      className={cn(
        "space-y-3",
        sticky &&
          "max-[860px]:fixed max-[860px]:inset-x-0 max-[860px]:bottom-0 max-[860px]:z-sticky max-[860px]:bg-surface-glass max-[860px]:backdrop-blur max-[860px]:border-t max-[860px]:border-line-hairline max-[860px]:px-4 max-[860px]:pt-3 max-[860px]:pb-[calc(12px+env(safe-area-inset-bottom))] max-[860px]:grid max-[860px]:grid-cols-[auto_1fr] max-[860px]:gap-2 max-[860px]:space-y-0",
      )}
    >
      {submitError ? (
        <div
          role="alert"
          className={cn(
            "rounded-md px-4 py-3 type-small",
            conflict ? "bg-warn-wash text-warn" : "bg-danger-wash text-danger",
            sticky && "max-[860px]:col-span-2",
          )}
        >
          <b className="font-semibold block">
            {conflict
              ? "This task changed in another session."
              : "Couldn't save your decision."}
          </b>
          <p className="mt-1 text-text-secondary">{submitError}</p>
          <div className="mt-2 flex gap-2">
            {conflict ? (
              <Button type="button" size="sm" onClick={onReload}>
                Load latest
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={onRetry}>
                Retry <Kbd data-key="enter">{shortcut}</Kbd>
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {showEscalatePrimary ? (
        <p
          className={cn(
            "flex items-start gap-2 type-small text-danger",
            sticky && "max-[860px]:col-span-2",
          )}
        >
          <AlertTriangle
            className="size-4 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Routing asks for escalation: the evidence may be redirecting the
          evaluator.
        </p>
      ) : null}

      {sticky || showEscalatePrimary ? (
        <>
          {escalateBtn}
          {primaryBtn}
        </>
      ) : (
        <>
          {primaryBtn}
          {escalateBtn}
        </>
      )}

      <p className="hidden min-[861px]:flex flex-wrap gap-x-3 gap-y-1 type-caption text-text-muted">
        <span className="inline-flex items-center gap-1">
          <Kbd data-key="/">/</Kbd> Commands
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd data-key="r">R</Kbd> Reason
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd data-key="?">?</Kbd> Shortcuts
        </span>
      </p>
    </div>
  );
}

export function DecisionPanel({
  proposal,
  effectiveLabel,
  proposedLabel,
  reason,
  attempt,
  evidenceExcerpt,
  offline,
  submitting,
  submitError,
  conflict,
  onSelectLabel,
  onReasonChange,
  onClearCite,
  onSubmitPrimary,
  onOpenEscalate,
  onRetry,
  onReload,
  reasonRef,
  nudgeReason,
  stickyActions,
}: {
  proposal: Proposal | null;
  effectiveLabel: ReviewLabel;
  proposedLabel: ReviewLabel;
  reason: string;
  attempt: ReviewAttempt;
  evidenceExcerpt: string | null;
  offline: boolean;
  submitting: boolean;
  submitError: string | null;
  conflict: boolean;
  onSelectLabel: (label: ReviewLabel) => void;
  onReasonChange: (value: string) => void;
  onClearCite: () => void;
  onSubmitPrimary: () => Promise<void> | void;
  onOpenEscalate: () => void;
  onRetry: () => void;
  onReload: () => void;
  reasonRef: React.RefObject<HTMLTextAreaElement | null>;
  nudgeReason: boolean;
  stickyActions?: boolean;
}) {
  const reduced = useReducedMotion();
  const selectedIndex = Math.max(0, REVIEW_LABELS.indexOf(effectiveLabel));
  const primaryAction = proposal
    ? primaryActionForSelection(effectiveLabel, proposedLabel)
    : null;
  const fieldAction = primaryAction ?? "accept";
  const copy = reasonFieldCopy(fieldAction);
  const help = reasonHelpText({
    action: fieldAction,
    attempt: attempt === "escalate" ? null : attempt,
    reason,
  });
  const highInjection = (proposal?.injectionProbability ?? 0) >= 0.5;
  const shortcut = submitShortcutLabel();

  const asyncAction = useAsyncAction({
    action: () => onSubmitPrimary(),
    resetAfter: 400,
  });

  const pending = submitting || asyncAction.pending;
  const showEscalatePrimary = highInjection && Boolean(proposal);

  const primaryLabel = !proposal
    ? "Waiting for a proposal"
    : offline
      ? "Offline · can't submit"
      : primaryAction
        ? primaryButtonLabel(primaryAction, effectiveLabel, proposedLabel)
        : "Accept";

  const actionProps = {
    proposal,
    offline,
    pending,
    primaryLabel,
    showEscalatePrimary,
    shortcut,
    submitError,
    conflict,
    onSubmitPrimary: () => asyncAction.run(),
    onOpenEscalate,
    onRetry,
    onReload,
  };

  return (
    <aside
      className="border-t min-[861px]:border-t-0 min-[861px]:border-l border-line-hairline flex flex-col min-h-0 bg-surface-base"
      aria-labelledby="decision-heading"
    >
      <div
        className={cn(
          "flex-1 min-[861px]:overflow-auto px-4 py-5 min-[861px]:px-6 min-[861px]:pt-6 min-[861px]:pb-5",
          stickyActions && "pb-32 min-[861px]:pb-5",
        )}
      >
        <h2 id="decision-heading" className="type-headline mb-1">
          Your decision
        </h2>

        {!proposal ? (
          <div
            role="alert"
            className="mb-5 rounded-md bg-fill-subtle px-4 py-3 type-small"
          >
            <b className="font-semibold block text-text-primary">
              Review needs a proposal
            </b>
            <p className="mt-1 text-text-secondary">
              This task cannot be reviewed until a proposal exists.
            </p>
            <Button type="button" size="sm" className="mt-2" onClick={onReload}>
              Check again
            </Button>
          </div>
        ) : (
          <p className="type-small text-text-secondary mb-5">
            Model proposes{" "}
            <b className="text-text-primary font-semibold">
              {labelTitle(proposedLabel)}
            </b>
            {" · "}
            {formatProbability(proposal.probabilities?.[proposedLabel])}
          </p>
        )}

        <fieldset disabled={!proposal} className="border-0 p-0 m-0 min-w-0">
          <legend className="sr-only">Label</legend>
          <div
            className="relative grid gap-0.5 mb-5"
            role="radiogroup"
            aria-label="Label"
          >
            {proposal ? (
              <motion.span
                layoutId="label-ind"
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 h-[52px] rounded-md bg-fill-emphasis"
                animate={{ top: selectedIndex * 54 }}
                transition={reduced ? { duration: 0 } : CELL}
              >
                <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-pill bg-fill-inverse" />
              </motion.span>
            ) : null}

            {REVIEW_LABELS.map((label, index) => {
              const selected = Boolean(proposal) && effectiveLabel === label;
              const isModel = Boolean(proposal) && proposedLabel === label;
              const probability = proposal?.probabilities?.[label];
              return (
                <label
                  key={label}
                  className={cn(
                    "relative grid grid-cols-[24px_1fr_auto] gap-3 items-center min-h-[52px] px-3 pl-4 rounded-md cursor-pointer type-small font-medium text-text-secondary transition-colors",
                    selected && "text-text-primary font-semibold",
                    !proposal && "cursor-not-allowed text-text-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="review-label"
                    value={label}
                    className="sr-only"
                    checked={selected}
                    disabled={!proposal}
                    onChange={() => onSelectLabel(label)}
                  />
                  <Kbd
                    data-key={String(index + 1)}
                    className="hidden min-[861px]:inline-flex justify-self-start"
                  >
                    {index + 1}
                  </Kbd>
                  <span className="truncate">
                    {labelTitle(label)}
                    {isModel ? (
                      <span className="ml-1.5 font-normal type-caption text-text-muted">
                        Model
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 font-mono type-meta tabular-nums text-text-secondary">
                    {probability != null ? (
                      <span
                        className="w-10 h-1 rounded-pill bg-fill-emphasis overflow-hidden"
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            "block h-full rounded-pill",
                            selected ? "bg-fill-inverse" : "bg-fill-bar",
                          )}
                          style={{
                            width: `${Math.max(0, Math.min(100, probability * 100))}%`,
                          }}
                        />
                      </span>
                    ) : null}
                    <span className="min-w-8 text-right">
                      {formatProbability(probability)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mb-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <label
                htmlFor="review-reason"
                className="type-small font-semibold"
              >
                {copy.label}
              </label>
              <span
                className={cn(
                  "type-caption text-text-muted",
                  fieldAction === "correct" && "text-text-primary font-medium",
                )}
              >
                {copy.hint}
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
                fieldAction === "correct"
                  ? `Why is it ${labelTitle(effectiveLabel).toLowerCase()}?`
                  : "What in the evidence decides it?"
              }
              onChange={(event) => onReasonChange(event.target.value)}
              onAnimationEnd={(event) => {
                event.currentTarget.classList.remove("animate-rf-nudge");
              }}
              className={cn(
                "min-h-28 resize-y type-small border-line-strong shadow-none focus-visible:ring-ring",
                help.invalid && "border-danger",
                nudgeReason && "animate-rf-nudge",
              )}
            />
            <div
              id="review-reason-help"
              className="mt-2 flex justify-between gap-3 min-h-5 type-caption text-text-muted"
            >
              <span
                className={cn(help.invalid && "text-danger font-medium")}
                aria-live="polite"
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
          <div
            className="mb-4 type-caption text-text-secondary"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 type-small text-text-primary font-medium">
              <span>✓ Cited evidence</span>
              <button
                type="button"
                className="underline underline-offset-2 text-text-secondary hover:text-text-primary font-normal"
                onClick={onClearCite}
              >
                Remove
              </button>
            </div>
            <q className="mt-1 block not-italic rounded-md bg-fill-subtle px-2.5 py-1.5 type-small text-text-primary">
              {evidenceExcerpt}
            </q>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line-hairline px-4 py-4 min-[861px]:px-6 min-[861px]:pb-5 hidden min-[861px]:block">
        <ActionStack {...actionProps} />
      </div>

      {stickyActions ? (
        <div className="min-[861px]:hidden">
          <ActionStack {...actionProps} sticky />
        </div>
      ) : (
        <div className="border-t border-line-hairline px-4 py-4 min-[861px]:hidden">
          <ActionStack {...actionProps} />
        </div>
      )}
    </aside>
  );
}
