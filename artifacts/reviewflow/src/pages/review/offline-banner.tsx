type OfflineBannerProps = {
  onRetry: () => void;
  className?: string;
};

/** Token-based offline notice — avoids CollapsibleBanner's interior stone chrome. */
export function OfflineBanner({ onRetry, className = "" }: OfflineBannerProps) {
  return (
    <div
      role="status"
      className={`rounded-md border border-line-border bg-warn-wash px-4 py-3 text-warn ${className}`.trim()}
    >
      <p className="text-small font-medium text-warn">You're offline</p>
      <p className="mt-1 text-caption text-text-secondary">
        Decisions can't be saved. Your work on this task stays here until you
        reconnect.
      </p>
      <button
        type="button"
        className="mt-2 text-small font-medium text-warn underline underline-offset-2"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}
