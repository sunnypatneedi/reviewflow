import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PropertyRow = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  action?: ReactNode;
  danger?: boolean;
  mono?: boolean;
  className?: string;
};

export function PropertyList({
  rows,
  className,
  "aria-label": ariaLabel = "Properties",
}: {
  rows: PropertyRow[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-1 min-[700px]:grid-cols-2 gap-x-8",
        className,
      )}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            "group grid grid-cols-[136px_1fr] items-center min-h-9 gap-3 rounded-sm transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] hover:bg-fill-subtle",
            row.className,
          )}
        >
          <dt className="flex items-center gap-2 pl-2 text-caption text-text-muted whitespace-nowrap">
            {row.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 flex items-center gap-2 text-small text-text-primary",
              row.mono && "font-mono text-mono overflow-wrap-anywhere",
              row.danger && "text-danger font-semibold",
            )}
          >
            <span className="min-w-0 truncate">{row.value}</span>
            {row.action ? (
              <span className="reveal ml-auto mr-1 shrink-0">{row.action}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
