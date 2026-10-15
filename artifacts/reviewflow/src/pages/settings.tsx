import type { ReactNode } from "react";
import { useGetBootstrap } from "@workspace/api-client-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulatedBadge } from "@/components/simulated-badge";
import { EmptyState } from "@/components/empty-state";
import { Eyebrow } from "@/components/eyebrow";
import { cn } from "@/lib/utils";

const SETUP_DOCS_URL =
  "https://github.com/sunnypatneedi/reviewflow/blob/main/docs/setup.md";

function DefinitionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 min-[700px]:grid-cols-[160px_1fr] gap-1 min-[700px]:gap-4 border-b border-line-hairline py-3 last:border-b-0">
      <dt>
        <Eyebrow>{label}</Eyebrow>
      </dt>
      <dd className="type-small text-text-primary min-w-0">{children}</dd>
    </div>
  );
}

export default function Settings() {
  const { data: config, isLoading, isError, error, refetch } = useGetBootstrap();

  if (isLoading) {
    return (
      <div
        className="p-6 min-[861px]:p-8 space-y-8"
        role="status"
        aria-label="Loading settings"
      >
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="border border-line-hairline p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Settings"
          heading="Couldn’t load settings"
          description={error?.message ?? "Check your connection and try again."}
          actionLabel="Retry"
          onAction={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  const credentialsMissing = config?.liveCredentialConfigured === false;

  return (
    <div className="p-6 min-[861px]:p-8 space-y-8 max-w-[720px]">
      <div className="space-y-2">
        <Eyebrow>Configuration</Eyebrow>
        <h1 className="type-headline text-text-primary">Settings</h1>
        <p className="type-small text-text-secondary">
          Workbench configuration and policy status
        </p>
      </div>

      <section className="border border-line-hairline">
        <div className="border-b border-line-hairline px-4 py-3">
          <Eyebrow>Project Profile</Eyebrow>
        </div>
        <dl className="px-4">
          <DefinitionRow label="Project Name">
            <span className="font-semibold">{config?.projectName}</span>
          </DefinitionRow>
          <DefinitionRow label="Active Mode">
            <span className="inline-flex items-center gap-2">
              <span className="capitalize font-semibold">{config?.mode}</span>
              <SimulatedBadge mode={config?.mode as "demo" | "live"} />
            </span>
          </DefinitionRow>
        </dl>
      </section>

      <section className="border border-line-hairline">
        <div className="border-b border-line-hairline px-4 py-3">
          <Eyebrow>Model & Policies</Eyebrow>
        </div>
        <dl className="px-4">
          <DefinitionRow label="Provider & Model">
            <span className="font-mono type-meta bg-fill-subtle px-3 py-1.5 rounded-[length:var(--radius-sm)] inline-block border border-line-hairline">
              {config?.providerModel}
            </span>
          </DefinitionRow>
          <DefinitionRow label="Shadow Policy">
            <span className="font-mono type-meta bg-fill-subtle px-3 py-1.5 rounded-[length:var(--radius-sm)] inline-block border border-line-hairline">
              {config?.shadowPolicyVersion}
            </span>
          </DefinitionRow>
          <DefinitionRow label="Live API Credentials">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "size-3 rounded-full",
                    config?.liveCredentialConfigured
                      ? "bg-fill-bar"
                      : "bg-danger",
                  )}
                  aria-hidden="true"
                />
                <span className="type-small font-medium">
                  {config?.liveCredentialConfigured
                    ? "Configured and ready"
                    : "Not configured. Live evaluations will fail."}
                </span>
              </div>
              {credentialsMissing ? (
                <a
                  href={SETUP_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "inline-flex",
                  )}
                >
                  Open setup documentation
                </a>
              ) : null}
            </div>
          </DefinitionRow>
        </dl>
      </section>
    </div>
  );
}
