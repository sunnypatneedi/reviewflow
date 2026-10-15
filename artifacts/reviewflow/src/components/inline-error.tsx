import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type InlineErrorProps = {
  id?: string;
  message?: string | null;
  className?: string;
};

/** Danger text + icon on a reserved line (keeps layout stable when empty). */
export function InlineError({ id, message, className }: InlineErrorProps) {
  return (
    <p
      id={id}
      role={message ? "alert" : undefined}
      className={cn(
        "flex min-h-5 items-center gap-1.5 type-caption text-danger",
        !message && "invisible",
        className,
      )}
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{message || "\u00a0"}</span>
    </p>
  );
}
