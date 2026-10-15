import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base px-3 type-small text-text-primary transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] file:border-0 file:bg-transparent file:type-small file:font-medium placeholder:text-text-muted hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-text-secondary",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
