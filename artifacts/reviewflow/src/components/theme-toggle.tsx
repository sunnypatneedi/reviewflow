import { Moon, Sun, Droplet } from "lucide-react";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const THEMES = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "plum", label: "Plum theme", icon: Droplet },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const set = (t: string) => {
    if (!t || t === theme) return;
    const run = () => setTheme(t);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return run();
    }
    if (document.startViewTransition) {
      document.startViewTransition(run);
      return;
    }
    // Firefox: colour transition fallback via html.theming
    document.documentElement.classList.add("theming");
    run();
    window.setTimeout(
      () => document.documentElement.classList.remove("theming"),
      450,
    );
  };

  return (
    <ToggleGroup
      type="single"
      value={theme === "system" ? undefined : theme}
      onValueChange={set}
      variant="outline"
      size="sm"
      aria-label="Color theme"
      className="gap-0"
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className="size-11 min-w-11 p-0 data-[state=on]:bg-fill-emphasis"
        >
          <Icon className="size-4" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
