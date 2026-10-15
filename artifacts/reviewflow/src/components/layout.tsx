import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  LayoutDashboard,
  ListTodo,
  CheckSquare,
  ShieldCheck,
  Tag,
  Settings,
  LogOut,
  GitCompareArrows,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppCommands } from "@/components/app-commands";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/traces", label: "Trace2Preference", icon: GitCompareArrows },
  { href: "/review", label: "Review", icon: CheckSquare },
  { href: "/audits", label: "Audits", icon: ShieldCheck },
  { href: "/releases", label: "Releases", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3.5 shrink-0 rounded-sm bg-fill-inverse",
        className,
      )}
      aria-hidden="true"
    />
  );
}

function ClerkAccount() {
  const { signOut } = useClerk();
  const { user } = useUser();
  return (
    <div className="border-t border-line-hairline p-4">
      <div className="mb-3 flex items-center gap-2 overflow-hidden px-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-hairline bg-fill-subtle type-mono text-text-secondary">
          {user?.firstName?.charAt(0) ||
            user?.emailAddresses[0]?.emailAddress?.charAt(0) ||
            "U"}
        </div>
        <div className="min-w-0 truncate type-caption text-text-muted">
          <div className="truncate font-medium text-text-primary">
            {user?.fullName || "User"}
          </div>
          <div className="truncate">
            {user?.primaryEmailAddress?.emailAddress}
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => signOut()}
      >
        <LogOut className="size-4" />
        Sign out
      </Button>
    </div>
  );
}

function DemoAccount() {
  return (
    <div className="border-t border-line-hairline px-4 py-3">
      <p className="flex items-center gap-2 type-caption text-text-secondary">
        <span
          className="inline-block size-1.5 shrink-0 rounded-full bg-warn"
          aria-hidden="true"
        />
        Isolated synthetic demo
      </p>
    </div>
  );
}

function NavLinks({
  location,
  onNavigate,
}: {
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-0.5 p-3" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-[length:var(--radius-control)] px-3 py-[7px] type-small font-medium transition-colors",
              isActive
                ? "bg-fill-emphasis font-semibold text-text-primary"
                : "text-text-secondary hover:bg-fill-subtle hover:text-text-primary",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppLayout({
  children,
  authMode,
}: {
  children: React.ReactNode;
  authMode: "demo" | "clerk";
}) {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="hatch min-h-[100dvh] w-full text-text-primary">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[var(--frame-max)] flex-col border-x border-line-hairline bg-surface-base">
        <header className="sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-3 border-b border-line-hairline bg-surface-glass px-3 backdrop-blur min-[861px]:gap-4 min-[861px]:px-4">
          <Button
            type="button"
            variant="icon"
            className="min-[861px]:hidden"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </Button>

          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 type-small font-semibold tracking-tight text-text-primary"
          >
            <BrandMark />
            ReviewFlow
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <AppCommands />
            <ThemeToggle />
          </div>
        </header>

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-scrim min-[861px]:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-surface-scrim"
              aria-label="Dismiss navigation"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="absolute bottom-0 left-0 top-0 z-dialog flex w-64 flex-col justify-between border-r border-line-hairline bg-surface-base">
              <div>
                <div className="flex h-14 items-center justify-between border-b border-line-hairline px-4">
                  <span className="flex items-center gap-2 type-small font-semibold tracking-tight">
                    <BrandMark />
                    ReviewFlow
                  </span>
                  <Button
                    type="button"
                    variant="icon"
                    aria-label="Close navigation"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <NavLinks
                  location={location}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
              {authMode === "clerk" ? <ClerkAccount /> : <DemoAccount />}
            </aside>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[var(--side)] shrink-0 flex-col justify-between border-r border-line-hairline bg-surface-base min-[861px]:flex">
            <NavLinks location={location} />
            {authMode === "clerk" ? <ClerkAccount /> : <DemoAccount />}
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
            <div className="rf-enter flex-1 min-[861px]:overflow-auto">
              {children}
            </div>
          </main>
        </div>

        <footer className="shrink-0 border-t border-line-hairline px-4 py-2">
          <p className="type-mono text-text-muted">
            ReviewFlow · {authMode === "demo" ? "demo" : "live"} · theme follows
            system until toggled
          </p>
        </footer>
      </div>
    </div>
  );
}
