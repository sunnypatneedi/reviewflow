import * as React from "react";
import { cn } from "@/lib/utils";

export type EyebrowProps = React.HTMLAttributes<HTMLElement> & {
  as?: "p" | "span" | "label";
  htmlFor?: string;
};

/** Mono 11px uppercase tracked label — chrome / section eyebrows. */
export function Eyebrow({
  className,
  as: Comp = "p",
  ...props
}: EyebrowProps) {
  return <Comp className={cn("type-mono text-text-muted", className)} {...props} />;
}

export const Label = Eyebrow;
