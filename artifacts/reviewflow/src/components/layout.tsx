import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { LayoutDashboard, ListTodo, CheckSquare, ShieldCheck, Tag, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
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
                {user?.firstName?.charAt(0) || user?.emailAddresses[0]?.emailAddress?.charAt(0) || "U"}
              </div>
              <div className="text-xs truncate text-muted-foreground">
                <div className="font-medium text-foreground truncate">{user?.fullName || "User"}</div>
                <div className="truncate">{user?.primaryEmailAddress?.emailAddress}</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
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
      <div className="rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
        Isolated synthetic demo
      </div>
    </div>
  );
}

export function AppLayout({ children, authMode }: { children: React.ReactNode; authMode: "demo" | "clerk" }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-border">
            <h1 className="font-bold text-lg tracking-tight text-primary flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded-md shadow-sm" />
              ReviewFlow
            </h1>
          </div>
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}>
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {authMode === "clerk" ? <ClerkAccount /> : <DemoAccount />}
      </aside>
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-background">
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
