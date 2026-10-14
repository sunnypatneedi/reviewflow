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

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/traces", label: "Trace2Preference", icon: GitCompareArrows },
  { href: "/review", label: "Review", icon: CheckSquare },
  { href: "/audits", label: "Audits", icon: ShieldCheck },
  { href: "/releases", label: "Releases", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

function ClerkAccount() {
  const { signOut } = useClerk();
  const { user } = useUser();
  return (
    <div className="p-4 border-t border-border">
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-semibold text-secondary-foreground shrink-0">
            {user?.firstName?.charAt(0) ||
              user?.emailAddresses[0]?.emailAddress?.charAt(0) ||
              "U"}
          </div>
          <div className="text-xs truncate text-muted-foreground">
            <div className="font-medium text-foreground truncate">
              {user?.fullName || "User"}
            </div>
            <div className="truncate">
              {user?.primaryEmailAddress?.emailAddress}
            </div>
          </div>
        </div>
      </div>
      <button
        onClick={() => signOut()}
        className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-ink-2 hover:text-foreground hover:bg-accent rounded-md transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </div>
  );
}

function DemoAccount() {
  return (
    <div className="p-4 border-t border-border">
      <p className="flex items-center gap-2 text-xs text-ink-2 px-1">
        <span
          className="inline-block size-1.5 rounded-full bg-warn shrink-0"
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
    <nav className="p-3 space-y-0.5" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-[7px] rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-foreground font-semibold"
                : "text-ink-2 hover:text-foreground hover:bg-accent",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="w-4 h-4" />
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
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="hidden min-[861px]:flex w-52 border-r border-border bg-sidebar flex-col justify-between flex-shrink-0">
        <div>
          <div className="h-14 flex items-center px-5 border-b border-border">
            <h1 className="font-semibold text-base tracking-tight text-foreground flex items-center gap-2.5">
              <div className="w-4 h-4 bg-primary rounded" aria-hidden="true" />
              ReviewFlow
            </h1>
          </div>
          <NavLinks location={location} />
        </div>
        {authMode === "clerk" ? <ClerkAccount /> : <DemoAccount />}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="min-[861px]:hidden flex items-center gap-3 h-14 px-4 border-b border-border shrink-0 bg-background">
          <button
            type="button"
            className="inline-flex items-center justify-center size-9 rounded-md text-ink-2 hover:bg-accent hover:text-foreground"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
          <span className="font-semibold text-sm tracking-tight flex items-center gap-2">
            <span
              className="w-3.5 h-3.5 bg-primary rounded-sm"
              aria-hidden="true"
            />
            ReviewFlow
          </span>
        </div>

        {mobileNavOpen ? (
          <div className="min-[861px]:hidden fixed inset-0 z-40">
            <button
              type="button"
              className="absolute inset-0 bg-foreground/20"
              aria-label="Dismiss navigation"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-border flex flex-col justify-between shadow-lg">
              <div>
                <div className="h-14 flex items-center justify-between px-5 border-b border-border">
                  <span className="font-semibold text-base tracking-tight flex items-center gap-2.5">
                    <span
                      className="w-4 h-4 bg-primary rounded"
                      aria-hidden="true"
                    />
                    ReviewFlow
                  </span>
                  <button
                    type="button"
                    className="size-8 inline-flex items-center justify-center rounded-md text-ink-2 hover:bg-accent"
                    aria-label="Close navigation"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <X className="w-4 h-4" />
                  </button>
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

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
