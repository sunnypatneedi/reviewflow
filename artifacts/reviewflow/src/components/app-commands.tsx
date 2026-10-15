import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutDashboard,
  ListTodo,
  CheckSquare,
  ShieldCheck,
  Tag,
  Settings,
  GitCompareArrows,
} from "lucide-react";

const COMMAND_ROUTES = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/traces", label: "Trace2Preference", icon: GitCompareArrows },
  { href: "/review", label: "Review", icon: CheckSquare },
  { href: "/audits", label: "Audits", icon: ShieldCheck },
  { href: "/releases", label: "Releases", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function AppCommands() {
  const [, setLocation] = useLocation();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        setHelpOpen(false);
        setCommandsOpen(true);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setCommandsOpen(false);
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-text-secondary"
          onClick={() => setCommandsOpen(true)}
          aria-label="Open commands"
        >
          <span className="hidden lg:inline">Commands</span>
          <Kbd>/</Kbd>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-text-secondary"
          onClick={() => setHelpOpen(true)}
          aria-label="Keyboard shortcuts"
        >
          <Kbd>?</Kbd>
        </Button>
      </div>

      <CommandDialog open={commandsOpen} onOpenChange={setCommandsOpen}>
        <CommandInput placeholder="Go to…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {COMMAND_ROUTES.map(({ href, label, icon: Icon }) => (
              <CommandItem
                key={href}
                value={label}
                onSelect={() => {
                  setCommandsOpen(false);
                  setLocation(href);
                }}
              >
                <Icon className="mr-2 size-4" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Global shortcuts. Review has additional keys while that queue is
              open.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {[
              ["/", "Open command menu"],
              ["?", "Open this help"],
            ].map(([keys, desc]) => (
              <li key={keys} className="flex items-center justify-between gap-4">
                <span className="text-text-secondary">{desc}</span>
                <Kbd>{keys}</Kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
