import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/eyebrow";

export type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  matchIndex?: number;
  matchTotal?: number;
  className?: string;
  id?: string;
};

/** Search input with icon, clear (Esc), and optional "N of M match" count. */
export function SearchField({
  value,
  onChange,
  label = "Search",
  placeholder = "Search…",
  matchIndex,
  matchTotal,
  className,
  id,
}: SearchFieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const inputRef = React.useRef<HTMLInputElement>(null);

  const clear = React.useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && value) {
      event.preventDefault();
      clear();
    }
  };

  const showCount =
    typeof matchTotal === "number" &&
    matchTotal >= 0 &&
    value.trim().length > 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Eyebrow as="label" htmlFor={fieldId}>
        {label}
      </Eyebrow>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={fieldId}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base py-2 pl-10 pr-10 type-small text-text-primary transition-colors duration-[length:var(--dur-fast)] ease-[var(--ease-standard)] placeholder:text-text-muted hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        />
        {value ? (
          <Button
            type="button"
            variant="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
            onClick={clear}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "min-h-5 type-caption text-text-muted",
          !showCount && "invisible",
        )}
        aria-live="polite"
      >
        {showCount
          ? `${typeof matchIndex === "number" ? matchIndex : 0} of ${matchTotal} match${matchTotal === 1 ? "" : "es"}`
          : "\u00a0"}
      </p>
    </div>
  );
}
