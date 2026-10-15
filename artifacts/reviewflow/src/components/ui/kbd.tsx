import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type KbdProps = React.ComponentProps<"kbd"> & {
  "data-key"?: string;
};

function Kbd({ className, children, ...props }: KbdProps) {
  const [hit, setHit] = useState(false);
  const dataKey = props["data-key"];

  useEffect(() => {
    if (!dataKey) return;
    const onFlash = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== dataKey) return;
      setHit(true);
      window.setTimeout(() => setHit(false), 140);
    };
    window.addEventListener("rf:key", onFlash);
    return () => window.removeEventListener("rf:key", onFlash);
  }, [dataKey]);

  return (
    <kbd
      data-slot="kbd"
      data-hit={hit ? "" : undefined}
      className={cn(
        "bg-surface-base text-text-secondary pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm border border-line-border border-b-2 px-1 font-sans text-kicker font-medium transition-[background-color,color,transform] duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
        "data-[hit]:bg-fill-inverse data-[hit]:text-text-inverse data-[hit]:border-fill-inverse data-[hit]:translate-y-px",
        "[&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
