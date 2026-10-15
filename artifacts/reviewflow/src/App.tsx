import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Switch, Route, useLocation, Router as WouterRouter } from 'wouter';
import { ThemeProvider, useTheme } from "next-themes";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AppLayout } from '@/components/layout';

import Home from '@/pages/home';
import Tasks from '@/pages/tasks';
import Review from '@/pages/review';
import Audits from '@/pages/audits';
import Releases from '@/pages/releases';
import Settings from '@/pages/settings';
import Traces from '@/pages/traces';

const THEME_VALUES = ["light", "dark", "plum"] as const;

function ThemeQueryBootstrap() {
  const { setTheme } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param && (THEME_VALUES as readonly string[]).includes(param)) {
      setTheme(param);
      applied.current = true;
    }
  }, [setTheme]);

  return null;
}

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const configuredMode = import.meta.env.VITE_APP_MODE;
if (configuredMode && configuredMode !== "demo" && configuredMode !== "clerk") {
  throw new Error('VITE_APP_MODE must be either "demo" or "clerk"');
}
const appMode: "demo" | "clerk" = configuredMode
  ?? (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ? "clerk" : "demo");
const clerkPubKey = appMode === "clerk"
  ? publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
  : undefined;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (appMode === "clerk" && !clerkPubKey) {
  throw new Error("APP_MODE=clerk requires VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(221, 83%, 53%)",
    colorBackground: "hsl(0, 0%, 100%)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-surface-base rounded-2xl w-[440px] max-w-full overflow-hidden shadow-surface border border-line-hairline",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-text-primary",
    headerSubtitle: "text-text-muted",
    formButtonPrimary: "bg-fill-inverse hover:bg-fill-inverse-hover text-text-inverse font-medium py-2 px-4 rounded-md transition-colors",
    formFieldInput: "border-line-border rounded-md focus:ring-2 focus:ring-ring focus:border-transparent text-text-primary",
    formFieldLabel: "text-sm font-medium text-text-secondary",
    footerActionLink: "text-text-primary hover:text-text-secondary font-medium underline",
    footerActionText: "text-text-muted",
    socialButtonsBlockButtonText: "text-text-secondary font-medium",
    socialButtonsBlockButton: "border border-line-border hover:bg-fill-subtle text-text-secondary font-medium py-2 px-4 rounded-md transition-colors",
    dividerText: "text-text-muted",
    dividerLine: "bg-fill-subtle",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-surface-base px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-surface-base px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedRoute({ component: Component }: { component: any }) {
  return (
    <AppLayout authMode={appMode}>
      <Component />
    </AppLayout>
  );
}

function HomeRedirect() {
  return <ProtectedRoute component={Home} />;
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ErrorBoundary resetKey={location.pathname}>
          <Switch>
            {appMode === "clerk" && <Route path="/sign-in/*?" component={SignInPage} />}
            {appMode === "clerk" && <Route path="/sign-up/*?" component={SignUpPage} />}
            <Route path="/"><HomeRedirect /></Route>
            <Route path="/tasks"><ProtectedRoute component={Tasks} /></Route>
            <Route path="/traces"><ProtectedRoute component={Traces} /></Route>
            <Route path="/review"><ProtectedRoute component={Review} /></Route>
            <Route path="/audits"><ProtectedRoute component={Audits} /></Route>
            <Route path="/releases"><ProtectedRoute component={Releases} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
            <Route component={NotFound} />
          </Switch>
        </ErrorBoundary>
      </WouterRouter>
      <Toaster />
      <SonnerToaster position="bottom-left" offset={{ left: 248 }} />
    </TooltipProvider>
  );
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <AppRoutes />
    </ClerkProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-theme"
        themes={[...THEME_VALUES]}
        defaultTheme="system"
        enableSystem
        storageKey="rf.theme"
        disableTransitionOnChange={false}
      >
        <ThemeQueryBootstrap />
        {appMode === "clerk" ? <ClerkApp /> : <AppRoutes />}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
