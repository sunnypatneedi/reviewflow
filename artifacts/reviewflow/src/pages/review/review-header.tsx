import { Kbd } from "@/components/ui/kbd";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function ReviewPageHeader({
  awaiting,
  decided,
  total,
  onOpenShortcuts,
  onOpenCommands,
}: {
  awaiting: number | null | undefined;
  decided?: number | null;
  total?: number | null;
  onOpenShortcuts: () => void;
  onOpenCommands?: () => void;
}) {
  const fraction =
    total != null && total > 0 && decided != null
      ? Math.min(1, Math.max(0, decided / total))
      : 0;

  return (
    <header className="sticky top-0 z-sticky flex items-center gap-4 h-14 px-4 min-[861px]:px-8 border-b border-line-hairline shrink-0 bg-surface-glass backdrop-blur">
      <h1 className="text-base font-semibold tracking-tight">Review</h1>

      <div className="ml-auto flex items-center gap-3 type-small text-text-secondary">
        <span aria-live="polite" className="inline-flex items-center gap-1.5">
          {awaiting == null ? (
            "…"
          ) : (
            <>
              <b className="text-text-primary font-semibold tabular-nums">
                {awaiting}
              </b>
              <span>awaiting</span>
            </>
          )}
        </span>

        {decided != null && total != null ? (
          <span className="hidden min-[861px]:inline-flex items-center gap-1.5">
            <b className="text-text-primary font-semibold tabular-nums">
              {decided}
            </b>
            <span>of {total} decided</span>
          </span>
        ) : null}

        <div
          className="w-14 min-[861px]:w-[120px] h-1 rounded-pill bg-fill-emphasis overflow-hidden"
          role="progressbar"
          aria-label="Queue progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div
            className={cn(
              "h-full bg-fill-inverse transition-[width] duration-[length:var(--dur-slow)] ease-[var(--ease-standard)]",
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>

        <div className="hidden min-[861px]:block">
          <ThemeToggle />
        </div>

        {onOpenCommands ? (
          <button
            type="button"
            onClick={onOpenCommands}
            className="hidden min-[861px]:inline-flex items-center gap-1.5 rounded-md px-2 py-1 type-small text-text-secondary hover:bg-fill-subtle hover:text-text-primary"
            aria-label="Open command menu"
          >
            <span>Commands</span>
            <Kbd data-key="/">/</Kbd>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onOpenShortcuts}
          className="hidden min-[861px]:inline-flex items-center gap-1.5 rounded-md px-2 py-1 type-small text-text-secondary hover:bg-fill-subtle hover:text-text-primary"
          aria-label="Keyboard shortcuts"
        >
          <Kbd data-key="?">?</Kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </header>
  );
}
