import { Link } from "wouter";
import { useGetMetrics, useGetBootstrap } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Target,
} from "lucide-react";

export default function Home() {
  const {
    data: metrics,
    isLoading: loadingMetrics,
    error: metricsError,
  } = useGetMetrics();
  const {
    data: bootstrap,
    isLoading: loadingBootstrap,
    error: bootstrapError,
  } = useGetBootstrap();

  if (loadingMetrics || loadingBootstrap) {
    return <div className="p-8 text-muted-foreground">Loading overview...</div>;
  }
  const loadError = bootstrapError ?? metricsError;
  if (loadError) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>ReviewFlow unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">
            {loadError.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
          Review workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Turn evidence into trusted decisions.
        </h1>
        <p className="text-muted-foreground mt-2">
          {bootstrap?.projectName} ·{" "}
          {bootstrap?.mode === "demo"
            ? "Synthetic demo · provider calls off by default"
            : "Human decisions with optional model assistance"}
        </p>
      </div>

      <div
        className="grid gap-4 md:grid-cols-3"
        aria-label="End-to-end workflow"
      >
        {[
          {
            step: "01",
            title: "Bring the data",
            text: "Import evidence tasks or complete trace comparisons. Inspect source context before review.",
            href: "/tasks",
            action: "Open data lane",
          },
          {
            step: "02",
            title: "Review with context",
            text: "Route and claim work, write live team notes, and make explicit human decisions.",
            href: "/factories",
            action: "Open review & evaluation",
          },
          {
            step: "03",
            title: "Qualify the release",
            text: "Resolve escalations, collect independent blind audits, and freeze an export with provenance.",
            href: "/audits",
            action: "Open quality lane",
          },
        ].map((item) => (
          <Link
            key={item.step}
            href={item.href}
            className="group block rounded-2xl border bg-card p-6 hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary transition-colors"
          >
            <p className="text-xs font-mono text-muted-foreground">
              {item.step}
            </p>
            <h2 className="text-lg font-semibold mt-3">{item.title}</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {item.text}
            </p>
            <p className="text-sm font-medium text-primary mt-5">
              {item.action} →
            </p>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/traces" className="underline underline-offset-4">
          Trace preference workflow
        </Link>
        <Link href="/releases" className="underline underline-offset-4">
          Frozen releases
        </Link>
        <Link href="/team" className="underline underline-offset-4">
          Project & team controls
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Tasks"
          value={metrics?.total}
          icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title="Pending Review"
          value={metrics?.pending}
          icon={<Activity className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title="Finalized"
          value={metrics?.finalized}
          icon={<CheckCircle className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title="Escalated"
          value={metrics?.escalated}
          icon={<AlertTriangle className="w-4 h-4 text-muted-foreground" />}
        />

        <MetricCard
          title="Corrections"
          value={`${metrics?.corrections} / ${metrics?.correctionDenominator}`}
          icon={<Target className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title="Independent Accuracy"
          value={
            metrics?.independentAccuracy != null
              ? formatPercent(metrics.independentAccuracy)
              : "N/A"
          }
          icon={<Target className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title="Avg Review Time"
          value={
            metrics?.averageReviewMs
              ? `${(metrics.averageReviewMs / 1000).toFixed(1)}s`
              : "N/A"
          }
          icon={<Clock className="w-4 h-4 text-muted-foreground" />}
        />
        <MetricCard
          title={
            bootstrap?.mode === "demo"
              ? "Simulated Proposal Latency"
              : "Observed Proposal Latency"
          }
          value={
            metrics?.averageLatencyMs
              ? `${metrics.averageLatencyMs.toFixed(0)}ms`
              : "N/A"
          }
          icon={<Activity className="w-4 h-4 text-muted-foreground" />}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Independent accuracy remains unavailable until a qualified evaluation
        exists. A finalized item still needs the release checks.
      </p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: any;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value ?? "-"}</div>
      </CardContent>
    </Card>
  );
}
