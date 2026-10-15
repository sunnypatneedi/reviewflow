import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  REASON_MAX_LENGTH,
  reasonFieldCopy,
  reasonHelpText,
  submitShortcutLabel,
  type ReviewAttempt,
} from "@/lib/review-decision";
import { cn } from "@/lib/utils";

export function EscalateDialog({
  open,
  onOpenChange,
  taskId,
  initialReason,
  onConfirm,
  onReasonSync,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  initialReason: string;
  onConfirm: (reason: string) => void;
  onReasonSync: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState(initialReason);
  const [attempt, setAttempt] = useState<ReviewAttempt>(null);
  const [nudge, setNudge] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = reasonFieldCopy("escalate");
  const help = reasonHelpText({ action: "escalate", attempt, reason });
  const shortcut = submitShortcutLabel();

  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setAttempt(null);
      setNudge(false);
      queueMicrotask(() => ref.current?.focus());
    }
  }, [open, initialReason]);

  const close = (next: boolean) => {
    if (!next) onReasonSync(reason);
    onOpenChange(next);
  };

  const confirm = () => {
    setAttempt("escalate");
    if (!reason.trim()) {
      setNudge(true);
      ref.current?.focus();
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escalate {taskId}?</DialogTitle>
          <DialogDescription>
            The task leaves your queue without a label and waits for someone
            with release access. Your label choice is not saved.
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <label
              htmlFor="escalate-reason"
              className="type-small font-semibold"
            >
              {copy.label}
            </label>
            <span className="type-caption text-text-primary font-medium">
              {copy.hint}
            </span>
          </div>
          <Textarea
            id="escalate-reason"
            ref={ref}
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            aria-invalid={help.invalid || undefined}
            aria-describedby="escalate-reason-help"
            placeholder="Why does this need release access?"
            onChange={(e) => setReason(e.target.value)}
            onAnimationEnd={(e) => {
              e.currentTarget.classList.remove("animate-rf-nudge");
              setNudge(false);
            }}
            className={cn(
              "min-h-28 resize-y type-small border-line-strong",
              help.invalid && "border-danger",
              nudge && "animate-rf-nudge",
            )}
          />
          <div
            id="escalate-reason-help"
            className="mt-2 min-h-5 type-caption text-text-muted"
            aria-live="polite"
          >
            <span className={cn(help.invalid && "text-danger font-medium")}>
              {help.message}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => close(false)}
            disabled={pending}
          >
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" onClick={confirm} disabled={pending}>
            {pending ? "Saving…" : "Escalate"}{" "}
            <Kbd data-key="enter">{shortcut}</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
