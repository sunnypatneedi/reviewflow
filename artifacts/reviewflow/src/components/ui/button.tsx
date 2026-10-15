import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap type-small font-medium transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:pointer-events-none disabled:bg-fill-subtle disabled:text-text-secondary disabled:border disabled:border-line-border rounded-[length:var(--radius-button)]",
  {
    variants: {
      variant: {
        default:
          "bg-fill-inverse text-text-inverse hover:bg-fill-inverse-hover h-11 min-h-11 px-4",
        main: "bg-fill-inverse text-text-inverse hover:bg-fill-inverse-hover h-11 min-h-11 px-4",
        secondary: "bg-fill-subtle text-text-primary hover:bg-fill-emphasis h-11 min-h-11 px-4",
        ghost:
          "bg-transparent text-text-secondary hover:bg-fill-subtle hover:text-text-primary h-9 min-h-9 px-3",
        outline:
          "border border-line-strong bg-surface-base text-text-primary hover:bg-fill-subtle h-9 min-h-9 px-3",
        destructive: "bg-danger text-text-inverse hover:bg-danger h-11 min-h-11 px-4",
        icon: "bg-transparent text-text-secondary hover:bg-fill-subtle hover:text-text-primary size-8 min-h-8 min-w-8 p-0",
      },
      size: {
        default: "",
        sm: "h-9 min-h-9 px-3",
        lg: "h-11 min-h-11 px-5 type-body",
        icon: "size-8 min-h-8 min-w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    void asChild;
    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
