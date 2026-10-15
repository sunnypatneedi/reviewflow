import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout";
import { EmptyState } from "@/components/empty-state";

function resolveAuthMode(): "demo" | "clerk" {
  const configured = import.meta.env.VITE_APP_MODE;
  if (configured === "clerk" || configured === "demo") return configured;
  return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ? "clerk" : "demo";
}

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <AppLayout authMode={resolveAuthMode()}>
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="404"
          heading="Page not found"
          description="The requested path could not be found."
          actionLabel="Go home"
          onAction={() => setLocation("/")}
        />
      </div>
    </AppLayout>
  );
}
