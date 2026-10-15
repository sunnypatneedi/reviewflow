import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warn" | "danger";

const TONE = {
  info: {
    wrap: "bg-fill-subtle text-text-secondary border-line-border",
    icon: Info,
    word: "Info",
  },
  warn: {
    wrap: "bg-warn-wash text-warn border-line-border",
    icon: AlertTriangle,
    word: "Caution",
  },
  danger: {
    wrap: "bg-danger-wash text-danger border-line-border",
    icon: AlertCircle,
    word: "Error",
  },
} as const;

export type NoticeProps = {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  word?: string;
};

/** Info / warn / danger wash with a word and icon (colour is never the only signal). */
export function Notice({
  tone = "info",
  children,
  className,
  word,
}: NoticeProps) {
  const config = TONE[tone];
  const Icon = config.icon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[length:var(--radius-panel)] border px-3 py-2.5 type-small",
        config.wrap,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <span className="type-mono mr-2">{word ?? config.word}</span>
        <span>{children}</span>
      </div>
    </div>
  );
}
