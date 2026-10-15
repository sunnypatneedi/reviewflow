import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/eyebrow";
import { Button } from "@/components/ui/button";

export type EmptyStateProps = {
  eyebrow?: string;
  heading: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  hatchHalf?: boolean;
  className?: string;
  children?: ReactNode;
};

/** Empty region: optional hatch half, heading, description, one primary CTA. */
export function EmptyState({
  eyebrow,
  heading,
  description,
  actionLabel,
  onAction,
  hatchHalf = true,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-[240px] flex-col items-start justify-center gap-3 border border-line-hairline p-6 min-[861px]:p-8",
        className,
      )}
    >
      {hatchHalf ? (
        <div
          className="hatch pointer-events-none absolute inset-y-0 right-0 w-1/2"
          aria-hidden="true"
        />
      ) : null}
      <div className="relative z-raised max-w-md space-y-3">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 className="type-headline text-text-primary">{heading}</h2>
        {description ? (
          <p className="type-small text-text-secondary">{description}</p>
        ) : null}
        {actionLabel && onAction ? (
          <Button type="button" variant="main" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
