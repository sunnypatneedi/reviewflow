import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useCopyToClipboard,
  type UseCopyToClipboardOptions,
} from "@/components/interior/copy-button";

export type CopyControlProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  timeout?: number;
  className?: string;
  onCopy?: UseCopyToClipboardOptions["onCopy"];
  onError?: UseCopyToClipboardOptions["onError"];
  disabled?: boolean;
};

/** Copy control that surfaces Copied / Failed and resets after 1.8s. */
export function CopyControl({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Failed",
  timeout = 1800,
  className,
  onCopy,
  onError,
  disabled = false,
}: CopyControlProps) {
  const { copy, status } = useCopyToClipboard({ timeout, onCopy, onError });

  const statusLabel =
    status === "copied"
      ? copiedLabel
      : status === "error"
        ? failedLabel
        : label;

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className={cn(className)}
      aria-label={label}
      onClick={() => {
        void copy(value);
      }}
    >
      {status === "copied" ? (
        <Check className="size-4" aria-hidden="true" />
      ) : status === "error" ? (
        <X className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      <span aria-hidden="true">{statusLabel}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied"
          ? copiedLabel
          : status === "error"
            ? failedLabel
            : ""}
      </span>
    </Button>
  );
}

export { useCopyToClipboard };
