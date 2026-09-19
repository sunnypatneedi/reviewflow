import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Switch, Route, useLocation, Router as WouterRouter } from 'wouter';
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AppLayout } from '@/components/layout';

import Home from '@/pages/home';
import Tasks from '@/pages/tasks';
import Review from '@/pages/review';
import Audits from '@/pages/audits';
import Releases from '@/pages/releases';
import Settings from '@/pages/settings';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(221, 83%, 53%)",
    colorBackground: "hsl(0, 0%, 100%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-gray-100",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-slate-900",
    headerSubtitle: "text-slate-500",
    formButtonPrimary: "bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors",
    formFieldInput: "border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900",
    formFieldLabel: "text-sm font-medium text-slate-700",
    footerActionLink: "text-blue-600 hover:text-blue-700 font-medium",
    footerActionText: "text-slate-500",
    socialButtonsBlockButtonText: "text-slate-700 font-medium",
    socialButtonsBlockButton: "border border-gray-200 hover:bg-gray-50 text-slate-700 font-medium py-2 px-4 rounded-md transition-colors",
    dividerText: "text-slate-400",
    dividerLine: "bg-gray-200",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4">
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
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function HomeRedirect() {
  return <ProtectedRoute component={Home} />;
}

function App() {
  const [, setLocation] = useLocation();

  return (
    <QueryClientProvider client={queryClient}>
      <ClerkProvider
        publishableKey={clerkPubKey}
        proxyUrl={clerkProxyUrl}
        appearance={clerkAppearance}
        signInUrl={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        routerPush={(to) => setLocation(stripBase(to))}
        routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      >
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <ErrorBoundary resetKey={location.pathname}>
              <Switch>
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />
                
                <Route path="/">
                  <HomeRedirect />
                </Route>
                <Route path="/tasks">
                  <ProtectedRoute component={Tasks} />
                </Route>
                <Route path="/review">
                  <ProtectedRoute component={Review} />
                </Route>
                <Route path="/audits">
                  <ProtectedRoute component={Audits} />
                </Route>
                <Route path="/releases">
                  <ProtectedRoute component={Releases} />
                </Route>
                <Route path="/settings">
                  <ProtectedRoute component={Settings} />
                </Route>
                
                <Route component={NotFound} />
              </Switch>
            </ErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ClerkProvider>
    </QueryClientProvider>
  );
}

export default App;
