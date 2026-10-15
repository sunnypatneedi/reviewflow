import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { submitShortcutLabel } from "@/lib/review-decision";

const DECIDE = [
  ["1 / 2 / 3", "Choose a label"],
  ["submit", "Submit accept or correct"],
  ["E", "Open escalate confirmation"],
] as const;

const EVIDENCE = [
  ["R", "Focus the reason field"],
  ["C", "Cite the current selection"],
  ["Esc", "Close dialog or blur field"],
  ["?", "Open this help"],
  ["/", "Open command menu"],
] as const;

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const submit = submitShortcutLabel();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while typing in the reason field, except{" "}
            {submit}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <section>
            <h3 className="type-kicker uppercase tracking-[0.08em] text-text-muted mb-2">
              Decide
            </h3>
            <ul>
              {DECIDE.map(([keys, desc]) => (
                <li
                  key={keys}
                  className="flex items-center justify-between gap-4 min-h-10 border-b border-line-hairline last:border-0 type-small text-text-secondary"
                >
                  <span>{desc}</span>
                  <Kbd>{keys === "submit" ? submit : keys}</Kbd>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="type-kicker uppercase tracking-[0.08em] text-text-muted mb-2">
              Evidence
            </h3>
            <ul>
              {EVIDENCE.map(([keys, desc]) => (
                <li
                  key={keys}
                  className="flex items-center justify-between gap-4 min-h-10 border-b border-line-hairline last:border-0 type-small text-text-secondary"
                >
                  <span>{desc}</span>
                  <Kbd>{keys}</Kbd>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="type-caption text-text-muted border-t border-line-hairline pt-3">
          ⌘ Command (Ctrl on Windows and Linux) · ↵ Enter
        </p>
      </DialogContent>
    </Dialog>
  );
}
