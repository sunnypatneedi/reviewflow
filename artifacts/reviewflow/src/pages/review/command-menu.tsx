import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { labelTitle, REVIEW_LABELS, type ReviewLabel } from "@/lib/review-decision";
import { useTheme } from "next-themes";

export function CommandMenu({
  open,
  onOpenChange,
  hasProposal,
  onSelectLabel,
  onOpenEscalate,
  onFocusReason,
  onCite,
  onCopyId,
  onOpenShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasProposal: boolean;
  onSelectLabel: (label: ReviewLabel) => void;
  onOpenEscalate: () => void;
  onFocusReason: () => void;
  onCite: () => void;
  onCopyId: () => void;
  onOpenShortcuts: () => void;
}) {
  const { setTheme } = useTheme();

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  let i = 0;
  const delay = () => {
    const d = i;
    i += 1;
    return { animationDelay: `calc(${d} * var(--stagger))` };
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching command</CommandEmpty>

        <CommandGroup heading="Decide">
          {REVIEW_LABELS.map((label, index) => (
            <CommandItem
              key={label}
              disabled={!hasProposal}
              style={delay()}
              className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
              onSelect={() => run(() => onSelectLabel(label))}
            >
              Choose {labelTitle(label)}
              <CommandShortcut>{index + 1}</CommandShortcut>
            </CommandItem>
          ))}
          <CommandItem
            disabled={!hasProposal}
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(onOpenEscalate)}
          >
            Escalate…
            <CommandShortcut>E</CommandShortcut>
          </CommandItem>
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(onFocusReason)}
          >
            Focus reason
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Evidence">
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(onCite)}
          >
            Cite selection
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(onCopyId)}
          >
            Copy task ID
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="View">
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(() => setTheme("light"))}
          >
            Theme · Light
          </CommandItem>
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(() => setTheme("dark"))}
          >
            Theme · Dark
          </CommandItem>
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(() => setTheme("plum"))}
          >
            Theme · Plum
          </CommandItem>
          <CommandItem
            style={delay()}
            className="animate-[rf-fadeup_var(--dur-fast)_var(--ease-standard)_both]"
            onSelect={() => run(onOpenShortcuts)}
          >
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
