import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/eyebrow";
import { InlineError } from "@/components/inline-error";

export type FieldProps = {
  id?: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>;
};

/** Label-above control: 44px input, border darkens on hover, accent ring on focus. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint && !error ? `${fieldId}-hint` : undefined;

  const control = React.cloneElement(children, {
    id: fieldId,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": errorId ?? hintId,
    className: cn(
      "h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base px-3 type-small text-text-primary transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] placeholder:text-text-muted hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-text-secondary",
      children.props.className,
    ),
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Eyebrow as="label" htmlFor={fieldId}>
        {label}
      </Eyebrow>
      {control}
      {hint && !error ? (
        <p id={hintId} className="type-caption text-text-muted">
          {hint}
        </p>
      ) : null}
      <InlineError id={errorId} message={error} />
    </div>
  );
}

export type FieldInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const FieldInput = React.forwardRef<HTMLInputElement, FieldInputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base px-3 type-small text-text-primary transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] placeholder:text-text-muted hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-text-secondary",
        className,
      )}
      {...props}
    />
  ),
);
FieldInput.displayName = "FieldInput";
