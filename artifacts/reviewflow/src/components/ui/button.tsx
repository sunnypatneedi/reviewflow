import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md type-small font-medium transition-[background-color,color,transform] duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-fill-subtle disabled:text-text-secondary disabled:border disabled:border-line-border active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-fill-inverse text-text-inverse hover:bg-fill-inverse-hover",
        secondary: "bg-fill-subtle text-text-primary hover:bg-fill-emphasis",
        ghost:
          "bg-transparent text-text-secondary hover:bg-fill-subtle hover:text-text-primary",
        outline:
          "border border-line-strong bg-surface-base text-text-primary hover:bg-fill-subtle",
        destructive: "bg-danger text-text-inverse hover:bg-danger",
      },
      size: {
        default: "min-h-11 h-11 px-4 py-2",
        sm: "min-h-9 h-9 rounded-md px-3 type-small",
        lg: "min-h-[52px] h-[52px] rounded-md px-5 type-body",
        icon: "size-11",
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
