import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useCopyToClipboard } from "@/components/interior/copy-button";
import { PropertyList } from "@/components/property-list";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  formatConfidence,
  formatProbability,
  labelTitle,
  riskTitle,
  type ReviewLabel,
} from "@/lib/review-decision";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@workspace/api-client-react";

export function ClaimDocument({
  item,
  evidenceExcerpt,
  onCite,
  onClearCite,
}: {
  item: ReviewItem;
  evidenceExcerpt: string | null;
  onCite: (excerpt: string) => void;
  onClearCite: () => void;
}) {
  const evidenceRef = useRef<HTMLQuoteElement>(null);
  const { copy, status } = useCopyToClipboard({ timeout: 2000 });
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [citePos, setCitePos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const proposal = item.task.proposal ?? null;
  const proposedLabel = (proposal?.label ?? "supported") as ReviewLabel;
  const highInjection = (proposal?.injectionProbability ?? 0) >= 0.5;

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !evidenceRef.current) {
      setPendingSelection(null);
      setCitePos(null);
      return;
    }
    const text = selection.toString().trim();
    if (
      !text ||
      !item.task.evidence.includes(text) ||
      !evidenceRef.current.contains(selection.anchorNode)
    ) {
      setPendingSelection(null);
      setCitePos(null);
      return;
    }
    setPendingSelection(text);
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    const wrap = evidenceRef.current.getBoundingClientRect();
    if (rect) {
      setCitePos({
        top: rect.top - wrap.top - 44,
        left: Math.max(0, rect.left - wrap.left + rect.width / 2 - 70),
      });
    }
  }, [item.task.evidence]);

  const applyCite = (text?: string | null) => {
    const fromSelection = window.getSelection()?.toString().trim() || null;
    const excerpt = (text ?? pendingSelection ?? fromSelection)?.trim();
    if (!excerpt || !item.task.evidence.includes(excerpt)) return;
    onCite(excerpt);
    setPendingSelection(null);
    setCitePos(null);
    window.getSelection()?.removeAllRanges();
  };

  const renderEvidence = () => {
    const evidence = item.task.evidence;
    if (!evidenceExcerpt || !evidence.includes(evidenceExcerpt)) {
      return evidence;
    }
    const index = evidence.indexOf(evidenceExcerpt);
    return (
      <>
        {evidence.slice(0, index)}
        <mark className="rf-mark">{evidenceExcerpt}</mark>
        {evidence.slice(index + evidenceExcerpt.length)}
      </>
    );
  };

  const tokenDisplay =
    proposal?.inputTokens != null || proposal?.outputTokens != null
      ? `${proposal?.inputTokens ?? "—"} / ${proposal?.outputTokens ?? "—"}`
      : "—";

  return (
    <article className="max-w-[680px] enter" aria-label="Task">
      <p className="type-kicker uppercase tracking-[0.08em] text-text-muted mb-2">
        Question
      </p>
      <p className="font-serif italic type-lead text-text-primary mb-10">
        {item.task.question}
      </p>

      <p className="type-kicker uppercase tracking-[0.08em] text-text-muted mb-2 flex flex-wrap items-center gap-2">
        <span>Candidate answer</span>
        <span className="inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 type-caption font-medium bg-fill-subtle text-text-secondary normal-case tracking-normal">
          <span
            className="size-1.5 rounded-full bg-current"
            aria-hidden="true"
          />
          {riskTitle(item.task.risk)}
        </span>
        <SimulatedBadge mode={item.task.mode} />
      </p>

      <h1 className="font-serif type-display text-balance mb-8">
        {item.task.candidateAnswer}
      </h1>

      <div className="group mb-2 flex items-center gap-2 type-meta text-text-muted">
        <span className="font-mono type-mono text-text-primary">
          {item.task.externalId}
        </span>
        <button
          type="button"
          className="reveal type-small text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
          onClick={() => copy(item.task.externalId)}
        >
          {status === "copied" ? "Copied" : "Copy ID"}
        </button>
        <span className="sr-only" aria-live="polite">
          {status === "copied" ? "Task ID copied" : ""}
        </span>
      </div>

      <PropertyList
        className="mb-8"
        aria-label="Proposal details"
        rows={[
          {
            id: "proposes",
            label: "Model proposes",
            value: proposal ? (
              <>
                <b className="font-semibold">{labelTitle(proposedLabel)}</b>
                <span className="type-meta text-text-muted ml-2">
                  {formatConfidence(proposal.confidence)}
                </span>
              </>
            ) : (
              "—"
            ),
          },
          {
            id: "latency",
            label: "Latency",
            value: proposal ? `${proposal.latencyMs} ms` : "—",
          },
          {
            id: "model",
            label: "Model",
            mono: true,
            value: proposal?.model ?? "—",
            action: proposal ? (
              <button
                type="button"
                className="type-small text-text-secondary hover:text-text-primary"
                aria-label="Copy model name"
                onClick={() => copy(proposal.model)}
              >
                Copy
              </button>
            ) : undefined,
          },
          {
            id: "injection",
            label: "Injection risk",
            danger: highInjection,
            value: proposal
              ? `${(proposal.injectionProbability * 100).toFixed(1)}%`
              : "—",
          },
          {
            id: "complexity",
            label: "Complexity",
            value: proposal ? proposal.complexity.toFixed(2) : "—",
          },
          {
            id: "tokens",
            label: "Tokens",
            value: tokenDisplay,
          },
        ]}
      />

      <section
        className={cn(
          "mb-10 grid grid-cols-[24px_1fr] gap-x-3 gap-y-1 rounded-md px-5 py-4",
          highInjection ? "bg-danger-wash" : "bg-fill-subtle",
        )}
        aria-labelledby="why-heading"
      >
        {highInjection ? (
          <AlertTriangle
            className="size-[18px] mt-0.5 text-danger"
            aria-hidden="true"
          />
        ) : (
          <Info
            className="size-[18px] mt-0.5 text-text-secondary"
            aria-hidden="true"
          />
        )}
        <h2
          id="why-heading"
          className={cn(
            "type-small font-semibold",
            highInjection ? "text-danger" : "text-text-primary",
          )}
        >
          Why you&apos;re seeing this
        </h2>
        <ul className="col-start-2 space-y-0.5 list-none">
          {item.routingReasons.map((reasonText) => (
            <li key={reasonText} className="type-small text-text-secondary">
              {reasonText}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="evidence-heading" className="group">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2
            id="evidence-heading"
            className="type-kicker uppercase tracking-[0.08em] text-text-muted"
          >
            Evidence
          </h2>
          <div className="reveal flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => applyCite(pendingSelection)}
            >
              Cite selection <Kbd data-key="c">C</Kbd>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => copy(item.task.evidence)}
            >
              {status === "copied" ? "Copied" : "Copy evidence"}
            </Button>
          </div>
        </div>

        <div className="relative">
          <blockquote
            ref={evidenceRef}
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
            className="font-serif type-lead border-l-[3px] border-fill-inverse pl-6 whitespace-pre-wrap text-text-primary selection:bg-fill-emphasis"
          >
            {renderEvidence()}
          </blockquote>

          {pendingSelection && citePos && !evidenceExcerpt ? (
            <button
              type="button"
              className="absolute z-popover inline-flex items-center gap-2 rounded-md bg-fill-inverse text-text-inverse type-small px-3 h-9 shadow-surface"
              style={{ top: citePos.top, left: citePos.left }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyCite(pendingSelection)}
            >
              Cite selection <Kbd data-key="c">C</Kbd>
            </button>
          ) : null}
        </div>

        {!evidenceExcerpt ? (
          <p className="mt-3 pl-6 type-caption text-text-muted">
            Select text in the evidence to cite it with your decision.
          </p>
        ) : (
          <p className="mt-3 pl-6 type-caption text-text-secondary">
            Cited in decision.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-text-primary"
              onClick={onClearCite}
            >
              Remove
            </button>
          </p>
        )}

        {/* probability hint for a11y — unused visually when no proposal */}
        <span className="sr-only">
          {proposal
            ? `Model probability ${formatProbability(proposal.probabilities?.[proposedLabel])}`
            : null}
        </span>
      </section>
    </article>
  );
}
