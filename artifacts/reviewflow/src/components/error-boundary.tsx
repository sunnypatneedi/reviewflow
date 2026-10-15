import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AppLayout } from "@/components/layout";
import { EmptyState } from "@/components/empty-state";

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  // Always demo chrome: this fallback may render outside ClerkProvider.
  return (
    <AppLayout authMode="demo">
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Error"
          heading="Something went wrong"
          description="This part of the app hit an error. Reload to try again."
          actionLabel="Reload"
          onAction={resetError}
        >
          {import.meta.env.DEV ? (
            <pre className="mt-2 w-full overflow-x-auto border border-line-hairline bg-fill-subtle p-3 text-left type-caption text-text-secondary">
              {error.message || String(error)}
            </pre>
          ) : null}
        </EmptyState>
      </div>
    </AppLayout>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      "ErrorBoundary caught an error:",
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
