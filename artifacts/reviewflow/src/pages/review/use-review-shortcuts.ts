import { useEffect } from "react";
import {
  flashKey,
  REVIEW_LABELS,
  type ReviewLabel,
} from "@/lib/review-decision";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return type !== "radio" && type !== "checkbox" && type !== "button";
  }
  return target.isContentEditable;
}

export type ReviewShortcutHandlers = {
  tryPrimary: () => void;
  openEscalate: () => void;
  confirmEscalate?: () => void;
  setSelectedLabel: (label: ReviewLabel) => void;
  focusReason: () => void;
  cite: () => void;
  openShortcuts: () => void;
  openCommands: () => void;
  closeTop: () => boolean;
  hasProposal: boolean;
  escalateOpen: boolean;
  commandsOpen: boolean;
};

export function useReviewShortcuts(
  handlersRef: React.MutableRefObject<ReviewShortcutHandlers>,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handlers = handlersRef.current;
      const typing = isTypingTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        flashKey("enter");
        if (handlers.escalateOpen) {
          handlers.confirmEscalate?.();
        } else {
          handlers.tryPrimary();
        }
        return;
      }

      if (event.key === "Escape") {
        if (handlers.closeTop()) {
          event.preventDefault();
        }
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (handlers.escalateOpen || handlers.commandsOpen) return;

      if (event.key === "1" || event.key === "2" || event.key === "3") {
        if (!handlers.hasProposal) return;
        const next = REVIEW_LABELS[Number(event.key) - 1];
        flashKey(event.key);
        handlers.setSelectedLabel(next);
        return;
      }

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        flashKey("r");
        handlers.focusReason();
        return;
      }

      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        flashKey("e");
        handlers.openEscalate();
        return;
      }

      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        flashKey("c");
        handlers.cite();
        return;
      }

      if (event.key === "/" && !event.shiftKey) {
        event.preventDefault();
        flashKey("/");
        handlers.openCommands();
        return;
      }

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        flashKey("?");
        handlers.openShortcuts();
      }

      // Plain Enter intentionally does nothing (v4).
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlersRef]);
}
